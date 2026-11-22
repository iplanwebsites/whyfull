#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activation;
mod launcher;

use serde::Deserialize;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::PageLoadEvent,
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

struct Engine(Mutex<Option<Child>>);
impl Engine {
    fn stop(&self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            drop(child.stdin.take());
            for _ in 0..40 {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

fn node(_runtime: &std::path::Path) -> Command {
    let sidecar = std::env::current_exe()
        .expect("Could not locate Whyfull executable")
        .parent()
        .unwrap()
        .join(if cfg!(windows) {
            "whyfull-node.exe"
        } else {
            "whyfull-node"
        });
    let mut command = Command::new(&sidecar);
    // Inherited Node injection flags must not modify the bundled engine.
    command.env_remove("NODE_OPTIONS").env_remove("NODE_PATH");
    // Prefer the executable Tauri signs as an external binary. The portable
    // archive also carries its own helper beside the Node engine.
    let crawler = sidecar.parent().unwrap().join("whyfull-crawler");
    if crawler.is_file() {
        command.env("WHYFULL_RUST_CRAWLER", crawler);
    }
    command
}

#[derive(Deserialize)]
struct Ready {
    url: String,
}

fn start_engine(runtime: PathBuf) -> Result<(Engine, url::Url), Box<dyn std::error::Error>> {
    let mut command = node(&runtime);
    command
        .arg("--max-old-space-size=12288")
        .arg(runtime.join("desktop.mjs"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().unwrap();
    let engine = Engine(Mutex::new(Some(child)));
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout)
            .take(8192)
            .read_line(&mut line)
            .map(|_| line);
        let _ = tx.send(result);
    });
    let line = rx.recv_timeout(Duration::from_secs(30))??;
    let ready: Ready = serde_json::from_str(&line)?;
    let url = url::Url::parse(&ready.url)?;
    // The webview has no IPC permissions, and may navigate only within this server.
    let token = url.fragment().unwrap_or("");
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || token.len() != 64
        || !token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid engine readiness message".into());
    }
    Ok((engine, url))
}

/// Restarts the engine if it exits while the app is open, and reopens the
/// same view on the new server. Stops after repeated crashes.
fn watch_engine(app: tauri::AppHandle, runtime: PathBuf, allowed: Arc<Mutex<url::Origin>>) {
    std::thread::spawn(move || {
        let mut restarts: Vec<Instant> = Vec::new();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let engine = app.state::<Engine>();
            let exited = match engine.0.lock().unwrap().as_mut() {
                None => return, // Quitting.
                Some(child) => child.try_wait().ok().flatten().is_some(),
            };
            if !exited {
                continue;
            }
            restarts.retain(|at| at.elapsed() < Duration::from_secs(120));
            if restarts.len() >= 3 {
                *engine.0.lock().unwrap() = None;
                app.dialog()
                    .message("The Whyfull engine stopped repeatedly. Quit and reopen Whyfull.")
                    .show(|_| {});
                return;
            }
            restarts.push(Instant::now());
            let (next, url) = match start_engine(runtime.clone()) {
                Ok(started) => started,
                Err(error) => {
                    eprintln!("whyfull: could not restart engine: {error}");
                    continue;
                }
            };
            {
                let mut slot = engine.0.lock().unwrap();
                if slot.is_none() {
                    return; // Quit while restarting; `next` stops on drop.
                }
                *slot = next.0.lock().unwrap().take();
            }
            if let Some(window) = app.get_webview_window("main") {
                let mut target = url.clone();
                if let Ok(current) = window.url() {
                    target.set_path(current.path());
                    target.set_query(current.query());
                }
                *allowed.lock().unwrap() = url.origin();
                *app.state::<Mutex<activation::EngineApi>>().lock().unwrap() =
                    activation::EngineApi::from_url(&url);
                let _ = window.navigate(target);
            }
        }
    });
}

/// Whether the viewer page has loaded, and activation results it hasn't seen yet.
#[derive(Default)]
struct Viewer {
    loaded: AtomicBool,
    pending: Mutex<Vec<String>>,
}

fn focus(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Opens Settings › License in the viewer without leaving the current page.
fn open_license(app: &tauri::AppHandle) {
    focus(app);
    let script = "(()=>{const detail={section:'license'};window.__whyfullSettings=detail;window.dispatchEvent(new CustomEvent('whyfull-settings',{detail}))})()".to_string();
    let viewer = app.state::<Viewer>();
    match app.get_webview_window("main") {
        Some(window) if viewer.loaded.load(Ordering::SeqCst) => {
            let _ = window.eval(script);
        }
        _ => viewer.pending.lock().unwrap().push(script),
    }
}

fn notify_viewer(app: &tauri::AppHandle, outcome: activation::Outcome) {
    let viewer = app.state::<Viewer>();
    match app.get_webview_window("main") {
        Some(window) if viewer.loaded.load(Ordering::SeqCst) => {
            let _ = window.eval(activation::viewer_script(&outcome));
        }
        // The viewer reads it once the page loads.
        _ if outcome.ok => viewer
            .pending
            .lock()
            .unwrap()
            .push(activation::viewer_script(&outcome)),
        _ => {
            app.dialog()
                .message(outcome.message)
                .title("Could not activate Whyfull")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    }
}

static LAST_LINK: Mutex<Option<(String, Instant)>> = Mutex::new(None);
/// Activate the key in each `whyfull://activate` link through the local engine.
fn open_links(app: &tauri::AppHandle, urls: Vec<url::Url>) {
    for url in urls {
        // macOS can report the launch URL both at startup and as an event.
        {
            let mut last = LAST_LINK.lock().unwrap();
            if last.as_ref().is_some_and(|(seen, at)| {
                seen == url.as_str() && at.elapsed() < Duration::from_secs(5)
            }) {
                continue;
            }
            *last = Some((url.to_string(), Instant::now()));
        }
        focus(app);
        let app = app.clone();
        std::thread::spawn(move || {
            let outcome = match activation::key_from_url(url.as_str()) {
                Ok(key) => {
                    // The engine may have restarted; use its current address.
                    let api = app
                        .state::<Mutex<activation::EngineApi>>()
                        .lock()
                        .unwrap()
                        .clone();
                    activation::activate(&api, &key)
                }
                Err(message) => activation::Outcome {
                    ok: false,
                    message: message.into(),
                },
            };
            // Messages never include the key.
            eprintln!("whyfull: activation link: {}", outcome.message);
            focus(&app);
            notify_viewer(&app, outcome);
        });
    }
}

static CHECKING: AtomicBool = AtomicBool::new(false);
fn check_updates(app: tauri::AppHandle, manual: bool) {
    if CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    if !app.config().plugins.0.contains_key("updater") {
        CHECKING.store(false, Ordering::SeqCst);
        if manual {
            app.dialog().message("Automatic updates are enabled in signed release builds. This is a local development build.").show(|_| {});
        }
        return;
    }
    tauri::async_runtime::spawn(async move {
        let result = async { app.updater()?.check().await }.await;
        match result {
            Ok(Some(update)) => {
                let handle = app.clone();
                app.dialog().message(format!("Whyfull {} is available. Install it and restart? Any active scan will stop. The bundled command-line tool updates with the app.", update.version))
                    .title("Update Whyfull").buttons(MessageDialogButtons::OkCancel).show(move |accepted| {
                        if !accepted { CHECKING.store(false, Ordering::SeqCst); return; }
                        tauri::async_runtime::spawn(async move {
                            let stopping = handle.clone();
                            let result = update.download_and_install(|_, _| {}, move || stopping.state::<Engine>().stop()).await;
                            CHECKING.store(false, Ordering::SeqCst);
                            match result {
                                Ok(_) => handle.restart(),
                                Err(error) => {
                                    let restart = handle.clone();
                                    handle.dialog().message(format!("Could not install the update: {error}\nWhyfull will restart to resume the explorer.")).show(move |_| restart.restart());
                                }
                            }
                        });
                    });
            }
            Ok(None) => {
                CHECKING.store(false, Ordering::SeqCst);
                if manual {
                    app.dialog()
                        .message("You’re running the latest version of Whyfull.")
                        .show(|_| {});
                }
            }
            Err(error) => {
                CHECKING.store(false, Ordering::SeqCst);
                if manual {
                    app.dialog()
                        .message(format!("Could not check for updates: {error}"))
                        .show(|_| {});
                }
            }
        }
    });
}

/// Tauri returns Windows resource paths in verbatim form (`\\?\D:\...`).
/// Node can't resolve a main script given that way (it fails with EISDIR on
/// `lstat 'D:'`), so pass the engine ordinary drive or UNC paths.
fn plain_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            if rest.as_bytes().get(1) == Some(&b':') {
                return PathBuf::from(rest);
            }
        }
    }
    path
}

#[cfg(all(test, windows))]
mod plain_path_tests {
    use super::plain_path;
    use std::path::PathBuf;

    #[test]
    fn strips_verbatim_prefixes() {
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\D:\a\Whyfull\runtime")),
            PathBuf::from(r"D:\a\Whyfull\runtime")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share\runtime")),
            PathBuf::from(r"\\server\share\runtime")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"C:\Program Files\Whyfull")),
            PathBuf::from(r"C:\Program Files\Whyfull")
        );
    }
}

fn main() {
    let context = tauri::generate_context!();
    let runtime = plain_path(
        tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default())
            .expect("Could not locate Whyfull resources")
            .join("runtime"),
    );
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    // This path runs before Tauri, single-instance registration, or a webview:
    // headless reports work in SSH sessions and while the desktop is open.
    if args.first().is_some_and(|a| a == "--cli") {
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::System::Console::AttachConsole(
                windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
            );
        }
        let result = node(&runtime)
            .arg(runtime.join("engine/cli.mjs"))
            .args(&args[1..])
            .status();
        std::process::exit(match result {
            Ok(status) => status.code().unwrap_or(1),
            Err(error) => {
                eprintln!("whyfull: {error}");
                1
            }
        });
    }
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());
    // Local builds have no updater config, which the plugin can't deserialize;
    // check_updates explains that instead.
    if context.config().plugins.0.contains_key("updater") {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    let app = builder
        .setup(move |app| {
            let (engine, url) = start_engine(runtime.clone())?;
            app.manage(engine);
            app.manage(Mutex::new(activation::EngineApi::from_url(&url)));
            app.manage(Viewer::default());
            let allowed = Arc::new(Mutex::new(url.origin()));
            let navigation = allowed.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Whyfull").inner_size(1280.0, 860.0).min_inner_size(800.0, 600.0)
                .on_navigation(move |url| url.origin() == *navigation.lock().unwrap())
                .on_page_load(|window, payload| {
                    let viewer = window.state::<Viewer>();
                    let loaded = matches!(payload.event(), PageLoadEvent::Finished);
                    viewer.loaded.store(loaded, Ordering::SeqCst);
                    if loaded {
                        for script in viewer.pending.lock().unwrap().drain(..) {
                            let _ = window.eval(script);
                        }
                    }
                })
                .build()?;
            watch_engine(app.handle().clone(), runtime.clone(), allowed);
            // Installers register the scheme. AppImages and Linux/Windows dev builds do it here.
            #[cfg(any(target_os = "linux", windows))]
            if cfg!(debug_assertions) || std::env::var_os("APPIMAGE").is_some() {
                let _ = app.deep_link().register_all();
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| open_links(&handle, event.urls()));
            if let Some(urls) = app.deep_link().get_current()? {
                open_links(app.handle(), urls);
            }
            let install = MenuItem::with_id(app, "install-cli", "Install command-line tool…", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "check-updates", "Check for updates…", true, None::<&str>)?;
            let license = MenuItem::with_id(app, "license", "License…", true, None::<&str>)?;
            let tools = Submenu::with_items(app, "Whyfull", true, &[
                &PredefinedMenuItem::about(app, Some("About Whyfull"), None)?,
                &license, &PredefinedMenuItem::separator(app)?,
                &install, &update, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::quit(app, None)?,
            ])?;
            let edit = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, None)?, &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::cut(app, None)?, &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?, &PredefinedMenuItem::select_all(app, None)?,
            ])?;
            app.set_menu(Menu::with_items(app, &[&tools, &edit])?)?;
            check_updates(app.handle().clone(), false);
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "install-cli" => {
                let message = match launcher::install() {
                    Ok(path) => format!("Installed {}\n\nRun whyfull in your terminal to print a report. Add its directory to PATH if needed. This launcher follows desktop app updates. npm installations earlier in PATH keep their own version.", path.display()),
                    Err(error) => format!("Could not install the command-line tool: {error}"),
                };
                app.dialog().message(message).show(|_| {});
            }
            "check-updates" => check_updates(app.clone(), true),
            "license" => open_license(app),
            _ => {}
        })
        .build(context).expect("Could not start Whyfull");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<Engine>().stop();
        }
    });
}

use std::io::Read;
