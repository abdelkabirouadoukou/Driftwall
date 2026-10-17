#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};
use tauri_plugin_sql::{Migration, MigrationKind};

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

/// SQLite migrations. One statement per migration (the plugin executes each
/// migration's SQL as a single statement).
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_wallpapers_table",
            sql: "CREATE TABLE IF NOT EXISTS wallpapers (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL CHECK (type IN ('static','video')),
                file_path TEXT NOT NULL,
                title TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                width INTEGER,
                height INTEGER,
                duration REAL,
                created_at TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_settings_table",
            sql: "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
    ]
}

fn main() {
    tauri::Builder::default()
        .manage(DockMode(Mutex::new(true)))
        .invoke_handler(tauri::generate_handler![get_dock_mode, set_dock_mode])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:driftwall.db", migrations())
                .build(),
        )
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Driftwall", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Driftwall", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon-template.png"))?;
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
