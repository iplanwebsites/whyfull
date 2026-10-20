use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::PathBuf,
};
const MARKER: &str = "whyfull desktop launcher v1";

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn install() -> io::Result<PathBuf> {
    // Reference the AppImage itself, never its temporary mount directory.
    let executable = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .unwrap_or(std::env::current_exe()?);
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or_else(|| io::Error::other("Could not locate your home directory"))?;
    let directory = PathBuf::from(home).join(if cfg!(windows) {
        "AppData/Local/Whyfull/bin"
    } else {
        ".local/bin"
    });
    install_at(executable, directory)
}

fn install_at(executable: PathBuf, directory: PathBuf) -> io::Result<PathBuf> {
    fs::create_dir_all(&directory)?;
    let path = directory.join(if cfg!(windows) {
        "whyfull.cmd"
    } else {
        "whyfull"
    });
    let executable = executable
        .to_str()
        .ok_or_else(|| io::Error::other("Application path is not valid UTF-8"))?;
    if executable.contains(['\n', '\r']) {
        return Err(io::Error::other("Unsupported newline in application path"));
    }
    let contents = if cfg!(windows) {
        if executable.contains(['%', '"']) {
            return Err(io::Error::other(
                "Unsupported character in application path",
            ));
        }
        format!("@echo off\r\nrem {MARKER}\r\n\"{executable}\" --cli %*\r\n")
    } else {
        format!(
            "#!/bin/sh\n# {MARKER}\nexec {} --cli \"$@\"\n",
            shell_quote(executable)
        )
    };
    // Never take over npm shims, symlinks, or unrelated commands.
    let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if fs::symlink_metadata(&path)?.file_type().is_symlink()
                || !fs::read_to_string(&path)?
                    .lines()
                    .nth(1)
                    .is_some_and(|line| {
                        line == format!("# {MARKER}") || line == format!("rem {MARKER}")
                    })
            {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!(
                        "{} already exists. Move it or keep using your existing CLI.",
                        path.display()
                    ),
                ));
            }
            OpenOptions::new().write(true).truncate(true).open(&path)?
        }
        Err(error) => return Err(error),
    };
    file.write_all(contents.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o755))?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("whyfull-launcher-{id}"));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn preserves_existing_commands_and_refreshes_owned_launchers() {
        let fixture = Fixture::new();
        let exe = fixture.0.join("Whyfull");
        let path = install_at(exe.clone(), fixture.0.clone()).unwrap();
        install_at(exe.clone(), fixture.0.clone()).unwrap();
        fs::write(&path, "npm-owned command").unwrap();
        let error = install_at(exe, fixture.0.clone()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(path).unwrap(), "npm-owned command");
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_without_touching_target() {
        let fixture = Fixture::new();
        let target = fixture.0.join("existing");
        fs::write(&target, "keep this").unwrap();
        std::os::unix::fs::symlink(&target, fixture.0.join("whyfull")).unwrap();
        assert!(install_at(fixture.0.join("Whyfull"), fixture.0.clone()).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "keep this");
    }
    #[cfg(unix)]
    #[test]
    fn passes_arguments_and_exit_status_through_paths_with_shell_metacharacters() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let executable = fixture.0.join("Whyfull's $(echo nope) tool");
        fs::write(&executable, "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 7\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let path = install_at(executable, fixture.0.clone()).unwrap();
        let output = std::process::Command::new(path)
            .args(["--json-file", "path with spaces.json"])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(7), "{output:?}");
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            "--cli\n--json-file\npath with spaces.json\n"
        );
    }
}
