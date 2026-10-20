#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod launcher;

use serde::Deserialize;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
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
    let mut command = Command::new(sidecar);
    // Inherited Node injection flags must not modify the bundled engine.
    command.env_remove("NODE_OPTIONS").env_remove("NODE_PATH");
    command
}

#[derive(Deserialize)]
struct Ready {
    url: String,
}

fn start_engine(runtime: PathBuf) -> Result<(Engine, url::Url), Box<dyn std::error::Error>> {
    let mut command = node(&runtime);
    command
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

fn main() {
    let context = tauri::generate_context!();
    let runtime =
        tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default())
            .expect("Could not locate Whyfull resources")
            .join("runtime");
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let (engine, url) = start_engine(runtime)?;
            app.manage(engine);
            let origin = url.origin();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Whyfull").inner_size(1280.0, 860.0).min_inner_size(800.0, 600.0)
                .on_navigation(move |url| url.origin() == origin)
                .build()?;
            let install = MenuItem::with_id(app, "install-cli", "Install command-line tool…", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "check-updates", "Check for updates…", true, None::<&str>)?;
            let tools = Submenu::with_items(app, "Whyfull", true, &[
                &PredefinedMenuItem::about(app, Some("About Whyfull"), None)?,
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
