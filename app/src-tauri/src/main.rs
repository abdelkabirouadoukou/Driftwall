#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discover;
mod store;

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

use discover::{Discover, DiscoverKind, DiscoverPage, DownloadedFile, Source};
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

/* ---------------------------------------------------------------- discover */

/// Shared HTTP client (rustls + `Driftwall/<version>` User-Agent).
static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(discover::USER_AGENT)
            .build()
            .expect("failed to build the HTTP client")
    })
}

async fn http_get_text(url: &str) -> Result<String, String> {
    let response = http_client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if !status.is_success() {
        return Err(format!("Request failed with status {status}."));
    }
    Ok(body)
}

/// The stored Pixabay API key, if any.
fn pixabay_key(app: &AppHandle) -> Option<String> {
    let library = app.state::<Mutex<Library>>();
    let library = library.lock().unwrap();
    library
        .settings
        .get("pixabay_api_key")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The category chips shown in Discover (kept in Rust as the source of truth).
#[tauri::command]
fn discover_categories() -> Vec<String> {
    discover::CATEGORIES.iter().map(|c| c.to_string()).collect()
}

/// Searches a provider, honouring the 24-hour cache and the rate limiter.
#[tauri::command]
async fn discover_search(
    app: AppHandle,
    query: String,
    source: Source,
    category: String,
    page: u32,
) -> Result<DiscoverPage, String> {
    let page = page.max(1);
    let key = discover::cache_key(source, &query, &category, page);

    if let Some(hit) = app
        .state::<Mutex<Discover>>()
        .lock()
        .unwrap()
        .cache
        .get(&key)
    {
        return Ok(hit);
    }

    let wait = app.state::<Mutex<Discover>>().lock().unwrap().limiter(source).wait_time();
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }

    let url = match source {
        Source::Wallhaven => discover::wallhaven_url(&query, &category, page),
        Source::Pixabay => {
            let api_key = pixabay_key(&app).ok_or_else(|| {
                "Add a Pixabay API key in Settings to browse videos.".to_string()
            })?;
            discover::pixabay_url(&query, &category, page, &api_key)
        }
    };

    let body = http_get_text(&url).await?;
    let parsed = match source {
        Source::Wallhaven => discover::parse_wallhaven(&body, page)?,
        Source::Pixabay => discover::parse_pixabay(&body, page)?,
    };

    {
        let state = app.state::<Mutex<Discover>>();
        let mut state = state.lock().unwrap();
        state.mark(source);
        state.cache.put(&key, &parsed);
    }

    Ok(parsed)
}

/// Streams a remote asset into the library directory. The webview probes and
/// thumbnails it afterwards, mirroring the local import flow.
#[tauri::command]
async fn discover_download(
    app: AppHandle,
    url: String,
    kind: DiscoverKind,
    title: String,
    source: Source,
    source_url: Option<String>,
    author: Option<String>,
) -> Result<DownloadedFile, String> {
    let dir = app_data_dir(&app)?.join("wallpapers");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let ext = discover::extension_for(&url, kind);
    let dest = dir.join(format!("{id}.{ext}"));

    let mut response = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with status {}.", response.status()));
    }

    {
        let mut file = fs::File::create(&dest).map_err(|e| e.to_string())?;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Download failed: {e}"))?
        {
            file.write_all(&chunk).map_err(|e| e.to_string())?;
        }
        file.sync_all().map_err(|e| e.to_string())?;
    }

    Ok(DownloadedFile {
        id,
        file_path: dest.to_string_lossy().to_string(),
        kind,
        title,
        source,
        source_url,
        author,
    })
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
            discover_categories,
            discover_search,
            discover_download,
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
            app.manage(Mutex::new(Discover::new(dir.join("cache").join("discover"))));

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
