// JobSniper.app: a thin native shell around the local engine.
// It starts the Bun API (compiled sidecar) and the Rust crawler, shows the dashboard in a
// system WebKit window, keeps crawling when the window is closed, and stops both on Quit.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod glass;

use std::fs::{create_dir_all, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const PORT: u16 = 4870;
const DATABASE_URL: &str = "postgres://localhost:5432/jobsniper";

struct Engine(Mutex<Vec<Child>>);

fn api_listening() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn crawler_running() -> bool {
    Command::new("/usr/bin/pgrep")
        .args(["-x", "jobsniper-crawler"])
        .stdout(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn log_file(name: &str) -> Stdio {
    let dir = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/Logs/JobSniper");
    let _ = create_dir_all(&dir);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(format!("{name}.log")))
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null())
}

/// Starts whatever is not already running (a dev server or a previous instance may own it).
fn start_engine(app: &AppHandle) -> Vec<Child> {
    let mut children = Vec::new();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_default();
    let resources = app.path().resource_dir().unwrap_or_default();

    if !api_listening() {
        match Command::new(exe_dir.join("jobsniper-api"))
            .env("DATABASE_URL", DATABASE_URL)
            .env("JOBSNIPER_PORT", PORT.to_string())
            .env("JOBSNIPER_MIGRATIONS_DIR", resources.join("migrations"))
            .env("JOBSNIPER_WEB_DIST", resources.join("web"))
            .stdout(log_file("api"))
            .stderr(log_file("api"))
            .spawn()
        {
            Ok(child) => children.push(child),
            Err(error) => eprintln!("could not start the API: {error}"),
        }
    }
    if !crawler_running() {
        match Command::new(exe_dir.join("jobsniper-crawler"))
            .env("DATABASE_URL", DATABASE_URL)
            .stdout(log_file("crawler"))
            .stderr(log_file("crawler"))
            .spawn()
        {
            Ok(child) => children.push(child),
            Err(error) => eprintln!("could not start the crawler: {error}"),
        }
    }
    children
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Waits for the API, then points the window at the dashboard.
fn open_dashboard_when_ready(app: AppHandle) {
    std::thread::spawn(move || {
        let started = Instant::now();
        while !api_listening() {
            if started.elapsed() > Duration::from_secs(45) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(
                        "document.getElementById('msg').textContent = \
                         'JobSniper could not start. Is Postgres running? See ~/Library/Logs/JobSniper/api.log';",
                    );
                }
                return;
            }
            std::thread::sleep(Duration::from_millis(400));
        }
        if let (Some(window), Ok(url)) = (
            app.get_webview_window("main"),
            url::Url::parse(&format!("http://127.0.0.1:{PORT}/")),
        ) {
            let _ = window.navigate(url);
        }
    });
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let handle = app.handle().clone();
            // Always on: hourly crawling only works while the app runs, so it starts at login.
            if let Ok(false) = handle.autolaunch().is_enabled() {
                let _ = handle.autolaunch().enable();
            }
            let children = start_engine(&handle);
            app.manage(Engine(Mutex::new(children)));

            let open = MenuItem::with_id(app, "open", "Open JobSniper", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit JobSniper", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &separator, &quit])?;
            let mut tray = TrayIconBuilder::with_id("jobsniper")
                .tooltip("JobSniper")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.with_webview(|webview| unsafe {
                    let added = glass::add_sidebar_glass(webview.inner() as *mut objc2::runtime::AnyObject);
                    if !added {
                        eprintln!("Liquid Glass unavailable (macOS < 26); using vibrancy");
                    }
                });
            }

            open_dashboard_when_ready(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the engine crawling; Quit lives in the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build JobSniper");

    app.run(|app, event| match event {
        RunEvent::Reopen { .. } => show_main(app),
        RunEvent::Exit => {
            if let Some(engine) = app.try_state::<Engine>() {
                if let Ok(mut children) = engine.0.lock() {
                    for child in children.iter_mut() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
        _ => {}
    });
}
