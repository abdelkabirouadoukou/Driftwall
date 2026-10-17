#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod store;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

use store::{Library, Wallpaper};

/// Whether the app shows a Dock icon (`Regular`) or is menu-bar only (`Accessory`).
struct DockMode(Mutex<bool>);

#[tauri::command]
fn get_dock_mode(state: State<'_, DockMode>) -> bool {
    *state.0.lock().unwrap()
}

#[tauri::command]
fn set_dock_mode(app: AppHandle, state: State<'_, DockMode>, dock: bool) {
    *state.0.lock().unwrap() = dock;
    apply_activation(&app, dock);
}

fn apply_activation(app: &AppHandle, dock: bool) {
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        let policy = if dock {
            ActivationPolicy::Regular
        } else {
            ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
        if let Some(window) = app.get_webview_window("main") {
            if dock {
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, dock);
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/* ------------------------------------------------------------------ library */

/// Returns the app data directory, creating it if necessary.
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Persists the given library snapshot to disk.
fn persist(app: &AppHandle, library: &Library) -> Result<(), String> {
    let dir = app_data_dir(app)?;
    store::save(&dir, library).map_err(|e| e.to_string())
}

#[tauri::command]
fn library_list(state: State<'_, Mutex<Library>>) -> Vec<Wallpaper> {
    let mut wallpapers = state.lock().unwrap().wallpapers.clone();
    wallpapers.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    wallpapers
}

#[tauri::command]
fn library_add(
    app: AppHandle,
    state: State<'_, Mutex<Library>>,
    wallpaper: Wallpaper,
) -> Result<(), String> {
    let snapshot = {
        let mut library = state.lock().unwrap();
        library.add(wallpaper);
        library.clone()
    };
    persist(&app, &snapshot)
}

#[tauri::command]
fn library_rename(
    app: AppHandle,
    state: State<'_, Mutex<Library>>,
    id: String,
    title: String,
) -> Result<(), String> {
    let snapshot = {
        let mut library = state.lock().unwrap();
        if !library.rename(&id, &title) {
            return Ok(());
        }
        library.clone()
    };
    persist(&app, &snapshot)
}

#[tauri::command]
fn library_delete(
    app: AppHandle,
    state: State<'_, Mutex<Library>>,
    id: String,
) -> Result<(), String> {
    let removed = {
        let mut library = state.lock().unwrap();
        library.remove(&id)
    };

    let Some(wallpaper) = removed else {
        return Ok(());
    };

    if !wallpaper.file_path.is_empty() {
        let _ = fs::remove_file(&wallpaper.file_path);
    }
    if let Ok(dir) = app.path().app_data_dir() {
        let thumbnail = dir.join("thumbnails").join(format!("{id}.thumb.png"));
        let _ = fs::remove_file(thumbnail);
    }

    let snapshot = state.lock().unwrap().clone();
    persist(&app, &snapshot)
}

/// Reveals a file in the OS file manager, selecting it where supported.
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{path}"));
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        if let Some(parent) = std::path::Path::new(&path).parent() {
            c.arg(parent);
        }
        c
    };

    cmd.status().map_err(|e| e.to_string())?;
    Ok(())
}

/* ----------------------------------------------------------------- settings */

#[tauri::command]
fn settings_get(state: State<'_, Mutex<Library>>, key: String) -> Option<serde_json::Value> {
    state.lock().unwrap().settings.get(&key).cloned()
}

#[tauri::command]
fn settings_set(
    app: AppHandle,
    state: State<'_, Mutex<Library>>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let snapshot = {
        let mut library = state.lock().unwrap();
        library.settings.insert(key, value);
        library.clone()
    };
    persist(&app, &snapshot)
}

/* --------------------------------------------------------------------- main */

fn main() {
    tauri::Builder::default()
        .manage(DockMode(Mutex::new(true)))
        .invoke_handler(tauri::generate_handler![
            get_dock_mode,
            set_dock_mode,
            library_list,
            library_add,
            library_rename,
            library_delete,
            reveal_in_finder,
            settings_get,
            settings_set
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Load (or create) the Rust-owned library and put it in managed state.
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Mutex::new(store::load(&dir)));

            let show = MenuItem::with_id(app, "show", "Show Driftwall", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Driftwall", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!(
                "../icons/tray-icon-template@2x.png"
            ))?;
            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            tray.set_tooltip(Some("Driftwall"))?;

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Driftwall")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    show_window(app_handle);
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app_handle, event);
            }
        });
}
