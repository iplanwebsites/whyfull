//! Experimental Unix crawler. No file contents are opened. NDJSON on stdout;
//! the consumer owns the inventory and hard-link ledger on disk.
#[cfg(not(unix))]
compile_error!("This spike needs Unix allocated-block metadata; Windows needs a separate backend.");

use serde::Serialize;
use serde_json::json;
use std::collections::VecDeque;
use std::ffi::{CStr, CString, OsString};
use std::fs;
use std::io::{self, BufWriter, Write};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{Condvar, Mutex};
use std::time::Instant;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct File {
    name: String,
    bytes: u64,
    apparent_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Directory {
    kind: &'static str,
    id: u64,
    parent: Option<u64>,
    name: String,
    own_bytes: u64,
    own_apparent_bytes: u64,
    own_files: u64,
    top_files: Vec<File>,
    skipped_links: u64,
    issues: u64,
    state: &'static str,
    reason: Option<String>,
}

struct Task {
    id: u64,
    parent: Option<u64>,
    path: PathBuf,
}

struct Frame {
    task: Task,
    entries: DirStream,
    result: Directory,
}

struct Queue {
    tasks: VecDeque<Task>,
    active: usize,
}

struct Crawler {
    device: u64,
    top_files: usize,
    queue_limit: usize,
    excludes: Vec<PathBuf>,
    queue: Mutex<Queue>,
    wake: Condvar,
    output: Mutex<BufWriter<io::Stdout>>,
    next_id: AtomicU64,
    completed: AtomicU64,
    files: AtomicU64,
    bytes: AtomicU64,
    apparent_bytes: AtomicU64,
    skipped_links: AtomicU64,
    issues: AtomicU64,
    interrupted_retries: AtomicU64,
    last_progress: AtomicU64,
    start: Instant,
}

fn retry_interrupted<T>(
    count: &AtomicU64,
    mut operation: impl FnMut() -> io::Result<T>,
) -> io::Result<T> {
    loop {
        match operation() {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                count.fetch_add(1, Relaxed);
            }
            result => return result,
        }
    }
}

// Rust 1.90's std::fs::ReadDir fuses after any enumeration error, including
// EINTR. Calling next() again therefore silently loses the rest of a directory.
// Own the native stream so interrupted reads retry at the SAME cursor. Each
// stream is used by exactly one worker and closed on drop, including error paths.
struct DirStream(*mut libc::DIR);

impl DirStream {
    fn open(path: &std::path::Path) -> io::Result<Self> {
        let path = CString::new(path.as_os_str().as_bytes())?;
        let directory = unsafe { libc::opendir(path.as_ptr()) };
        if directory.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(directory))
        }
    }

    #[cfg(target_os = "macos")]
    fn next_name(&mut self, retries: &AtomicU64) -> io::Result<Option<OsString>> {
        self.next_with(retries, |directory, entry, result| unsafe {
            libc::readdir_r(directory, entry, result)
        })
    }

    #[cfg(target_os = "macos")]
    fn next_with(
        &mut self,
        retries: &AtomicU64,
        mut read: impl FnMut(*mut libc::DIR, *mut libc::dirent, *mut *mut libc::dirent) -> libc::c_int,
    ) -> io::Result<Option<OsString>> {
        loop {
            let mut entry = std::mem::MaybeUninit::<libc::dirent>::uninit();
            let mut result = std::ptr::null_mut();
            retry_interrupted(retries, || {
                // Darwin has a fixed-size dirent. readdir_r returns the errno
                // directly and copies the entry into our caller-owned buffer.
                let code = read(self.0, entry.as_mut_ptr(), &mut result);
                if code == 0 {
                    Ok(())
                } else {
                    Err(io::Error::from_raw_os_error(code))
                }
            })?;
            if result.is_null() {
                return Ok(None);
            }
            let bytes =
                unsafe { CStr::from_ptr(std::ptr::addr_of!((*result).d_name).cast()).to_bytes() };
            if bytes != b"." && bytes != b".." {
                return Ok(Some(OsString::from_vec(bytes.to_vec())));
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn next_name(&mut self, retries: &AtomicU64) -> io::Result<Option<OsString>> {
        loop {
            let result = retry_interrupted(retries, || unsafe {
                *libc::__errno_location() = 0;
                let result = libc::readdir(self.0);
                if result.is_null() && *libc::__errno_location() != 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(result)
                }
            })?;
            if result.is_null() {
                return Ok(None);
            }
            let bytes =
                unsafe { CStr::from_ptr(std::ptr::addr_of!((*result).d_name).cast()).to_bytes() };
            if bytes != b"." && bytes != b".." {
                return Ok(Some(OsString::from_vec(bytes.to_vec())));
            }
        }
    }
}

impl Drop for DirStream {
    fn drop(&mut self) {
        unsafe {
            libc::closedir(self.0);
        }
    }
}

fn utf8(value: &std::ffi::OsStr) -> String {
    value
        .to_str()
        .unwrap_or_else(|| {
            eprintln!("Non-UTF-8 filename: this spike cannot represent it losslessly");
            std::process::exit(1)
        })
        .to_owned()
}

impl Crawler {
    fn emit(&self, value: &impl Serialize) {
        let mut output = self.output.lock().unwrap();
        let result = serde_json::to_writer(&mut *output, value)
            .map_err(io::Error::other)
            .and_then(|()| output.write_all(b"\n"))
            .and_then(|()| output.flush());
        if let Err(error) = result {
            eprintln!("Crawler output failed: {error}");
            std::process::exit(1);
        }
    }

    fn stats(&self, kind: &str) -> serde_json::Value {
        json!({
            "kind": kind,
            "directories": self.completed.load(Relaxed),
            "discoveredDirectories": self.next_id.load(Relaxed),
            "files": self.files.load(Relaxed),
            // Linked-file bytes are added by the SQLite consumer exactly once.
            "bytes": self.bytes.load(Relaxed),
            "apparentBytes": self.apparent_bytes.load(Relaxed),
            "skippedLinks": self.skipped_links.load(Relaxed),
            "issues": self.issues.load(Relaxed),
            "interruptedRetries": self.interrupted_retries.load(Relaxed),
            "durationMs": self.start.elapsed().as_millis() as u64,
        })
    }

    fn progress(&self) {
        let elapsed = self.start.elapsed().as_millis() as u64;
        let last = self.last_progress.load(Relaxed);
        if elapsed >= last + 500
            && self
                .last_progress
                .compare_exchange(last, elapsed, Relaxed, Relaxed)
                .is_ok()
        {
            self.emit(&self.stats("progress"));
        }
    }

    fn finish(&self, result: Directory) {
        self.completed.fetch_add(1, Relaxed);
        self.emit(&result);
        self.progress();
    }

    fn open(&self, task: Task) -> Option<Frame> {
        let mut result = Directory {
            kind: "directory",
            id: task.id,
            parent: task.parent,
            name: utf8(task.path.file_name().unwrap_or(task.path.as_os_str())),
            own_bytes: 0,
            own_apparent_bytes: 0,
            own_files: 0,
            top_files: Vec::new(),
            skipped_links: 0,
            issues: 0,
            state: "scanned",
            reason: None,
        };
        if (task.parent.is_some() && task.path.file_name().is_some_and(|n| n == ".whyfull"))
            || self.excludes.iter().any(|p| task.path.starts_with(p))
        {
            result.state = "excluded";
            result.reason = Some("Excluded directory or Whyfull scan cache".into());
            self.finish(result);
            return None;
        }
        // Recheck queued directories without following a replaced final symlink.
        let entries = retry_interrupted(&self.interrupted_retries, || {
            fs::symlink_metadata(&task.path)
        })
        .and_then(|metadata| {
            if metadata.is_dir() && metadata.dev() != self.device {
                result.state = "excluded";
                return Err(io::Error::other("Different filesystem; scan separately"));
            }
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(io::Error::other("Directory changed during scan"));
            }
            retry_interrupted(&self.interrupted_retries, || DirStream::open(&task.path))
        });
        match entries {
            Ok(entries) => Some(Frame {
                task,
                entries,
                result,
            }),
            Err(error) => {
                if result.state != "excluded" {
                    result.state = "unreadable";
                    result.issues = 1;
                    self.issues.fetch_add(1, Relaxed);
                }
                result.reason = Some(error.to_string());
                self.finish(result);
                None
            }
        }
    }

    fn scan(&self, task: Task) {
        // Streaming DFS fallback when the shared queue fills. Retains open
        // iterators and top K per active depth, never a wide directory listing.
        let mut stack = Vec::new();
        if let Some(frame) = self.open(task) {
            stack.push(frame);
        }
        while let Some(frame) = stack.last_mut() {
            let entry = match frame.entries.next_name(&self.interrupted_retries) {
                Ok(None) => {
                    self.finish(stack.pop().unwrap().result);
                    continue;
                }
                Err(error) => {
                    frame.result.issues += 1;
                    frame.result.state = "unreadable";
                    frame.result.reason = Some(error.to_string());
                    self.issues.fetch_add(1, Relaxed);
                    self.finish(stack.pop().unwrap().result);
                    continue;
                }
                Ok(Some(entry)) => entry,
            };
            let path = frame.task.path.join(&entry);
            let metadata = match retry_interrupted(&self.interrupted_retries, || {
                fs::symlink_metadata(&path)
            }) {
                Ok(metadata) => metadata,
                Err(_) => {
                    frame.result.issues += 1;
                    self.issues.fetch_add(1, Relaxed);
                    continue;
                }
            };
            if metadata.file_type().is_symlink() {
                frame.result.skipped_links += 1;
                self.skipped_links.fetch_add(1, Relaxed);
            } else if metadata.is_dir() {
                let child = Task {
                    id: self.next_id.fetch_add(1, Relaxed),
                    parent: Some(frame.task.id),
                    path,
                };
                let mut queue = self.queue.lock().unwrap();
                if queue.tasks.len() < self.queue_limit {
                    queue.tasks.push_back(child);
                    self.wake.notify_one();
                } else {
                    drop(queue);
                    if let Some(child) = self.open(child) {
                        stack.push(child);
                    }
                }
            } else if metadata.is_file() {
                frame.result.own_files += 1;
                self.files.fetch_add(1, Relaxed);
                let file = File {
                    name: utf8(&entry),
                    bytes: metadata.blocks() * 512,
                    apparent_bytes: metadata.len(),
                };
                if metadata.nlink() > 1 {
                    self.emit(&json!({
                        "kind": "linked", "directory": frame.task.id,
                        "inode": format!("{}:{}", metadata.dev(), metadata.ino()),
                        "name": file.name, "bytes": file.bytes,
                        "apparentBytes": file.apparent_bytes,
                    }));
                } else {
                    frame.result.own_bytes += file.bytes;
                    frame.result.own_apparent_bytes += file.apparent_bytes;
                    self.bytes.fetch_add(file.bytes, Relaxed);
                    self.apparent_bytes.fetch_add(file.apparent_bytes, Relaxed);
                    retain(&mut frame.result.top_files, file, self.top_files);
                }
            }
            self.progress();
        }
    }

    fn worker(&self) {
        loop {
            let mut queue = self.queue.lock().unwrap();
            let task = loop {
                if let Some(task) = queue.tasks.pop_front() {
                    queue.active += 1;
                    break task;
                }
                if queue.active == 0 {
                    return;
                }
                queue = self.wake.wait(queue).unwrap();
            };
            drop(queue);
            self.scan(task);
            let mut queue = self.queue.lock().unwrap();
            queue.active -= 1;
            self.wake.notify_all();
        }
    }
}

fn retain(files: &mut Vec<File>, file: File, limit: usize) {
    if limit == 0 {
        return;
    }
    let at = files.partition_point(|f| {
        f.bytes > file.bytes || (f.bytes == file.bytes && f.name <= file.name)
    });
    if at < limit {
        files.insert(at, file);
        files.truncate(limit);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() < 4 {
        return Err("Usage: whyfull-crawler-spike ROOT WORKERS TOP_FILES QUEUE_LIMIT [ABSOLUTE_EXCLUDE ...]".into());
    }
    let number = |i: usize| -> Result<usize, Box<dyn std::error::Error>> {
        Ok(args[i]
            .to_str()
            .ok_or("Invalid numeric argument")?
            .parse()?)
    };
    let workers = number(1)?;
    let top_files = number(2)?;
    let queue_limit = number(3)?;
    if !(1..=32).contains(&workers) || top_files > 1000 || !(1..=65536).contains(&queue_limit) {
        return Err("Workers: 1..32; top files: 0..1000; queue: 1..65536".into());
    }
    let input = PathBuf::from(&args[0]);
    let metadata = fs::symlink_metadata(&input)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Scan root must be a directory, not a symlink".into());
    }
    let root = fs::canonicalize(input)?;
    utf8(root.as_os_str());
    let excludes: Vec<PathBuf> = args[4..].iter().map(PathBuf::from).collect();
    if excludes.iter().any(|p| {
        !p.is_absolute()
            || p.components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
    }) {
        return Err("Excludes must be normalized absolute paths".into());
    }
    let crawler = Crawler {
        device: metadata.dev(),
        top_files,
        queue_limit,
        excludes,
        queue: Mutex::new(Queue {
            tasks: VecDeque::from([Task {
                id: 0,
                parent: None,
                path: root.clone(),
            }]),
            active: 0,
        }),
        wake: Condvar::new(),
        output: Mutex::new(BufWriter::with_capacity(65536, io::stdout())),
        next_id: AtomicU64::new(1),
        completed: AtomicU64::new(0),
        files: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        apparent_bytes: AtomicU64::new(0),
        skipped_links: AtomicU64::new(0),
        issues: AtomicU64::new(0),
        interrupted_retries: AtomicU64::new(0),
        last_progress: AtomicU64::new(0),
        start: Instant::now(),
    };
    crawler.emit(&json!({ "kind": "start", "protocol": 1, "root": root, "workers": workers, "topFiles": top_files, "queueLimit": queue_limit }));
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| crawler.worker());
        }
    });
    let mut summary = crawler.stats("summary");
    // getrusage includes all Rust worker threads. macOS reports RSS in bytes;
    // other supported Unix targets report KiB. Node also normalizes to KiB.
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } == 0 {
        let usage = unsafe { usage.assume_init() };
        let rss = usage.ru_maxrss as u64;
        summary["peakRssKiB"] = json!(if cfg!(target_os = "macos") {
            rss / 1024
        } else {
            rss
        });
        summary["cpuMs"] = json!(
            (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) as f64 * 1000.0
                + (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) as f64 / 1000.0
        );
    }
    crawler.emit(&summary);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_calls_retry_but_permanent_errors_do_not() {
        let retries = AtomicU64::new(0);
        let mut attempts = 0;
        let value = retry_interrupted(&retries, || {
            attempts += 1;
            if attempts < 4 {
                Err(io::Error::from(io::ErrorKind::Interrupted))
            } else {
                Ok(42)
            }
        })
        .unwrap();
        assert_eq!((value, attempts, retries.load(Relaxed)), (42, 4, 3));
        assert_eq!(
            retry_interrupted::<()>(&retries, || Err(io::Error::from(
                io::ErrorKind::PermissionDenied
            )))
            .unwrap_err()
            .kind(),
            io::ErrorKind::PermissionDenied
        );
        assert_eq!(retries.load(Relaxed), 3);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn interrupted_directory_enumeration_keeps_its_cursor_and_all_entries() {
        let path = std::env::temp_dir().join(format!("whyfull-eintr-{}", std::process::id()));
        fs::create_dir(&path).unwrap();
        for i in 0..40 {
            fs::write(path.join(format!("file-{i}")), []).unwrap();
        }
        let retries = AtomicU64::new(0);
        let mut stream = DirStream::open(&path).unwrap();
        let mut names = std::collections::HashSet::new();
        names.insert(stream.next_name(&retries).unwrap().unwrap());
        let mut interrupted = false;
        let name = stream
            .next_with(&retries, |directory, entry, result| {
                if !interrupted {
                    interrupted = true;
                    libc::EINTR
                } else {
                    unsafe { libc::readdir_r(directory, entry, result) }
                }
            })
            .unwrap()
            .unwrap();
        assert!(names.insert(name));
        while let Some(name) = stream.next_name(&retries).unwrap() {
            assert!(names.insert(name));
        }
        assert_eq!(names.len(), 40);
        assert_eq!(retries.load(Relaxed), 1);
        drop(stream);
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn top_files_stays_bounded_and_orders_ties() {
        let mut files = Vec::new();
        for (name, bytes) in [("z", 8), ("b", 9), ("a", 9), ("small", 1)] {
            retain(
                &mut files,
                File {
                    name: name.into(),
                    bytes,
                    apparent_bytes: bytes,
                },
                2,
            );
        }
        assert_eq!(
            files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );
        retain(
            &mut files,
            File {
                name: "zero".into(),
                bytes: 100,
                apparent_bytes: 100,
            },
            0,
        );
        assert_eq!(files.len(), 2);
    }
}
