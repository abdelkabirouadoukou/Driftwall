#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discover;
mod download;
mod store;

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::{
    ipc::Channel,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};

use discover::{Discover, DiscoverKind, DiscoverPage, DownloadedFile, SearchOptions, Source};
use download::{DownloadProgress, Downloads, Phase};
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
            .connect_timeout(download::CONNECT_TIMEOUT)
            .build()
            .expect("failed to build the HTTP client")
    })
}

/// GETs a provider URL (with any auth headers) and maps the failures people
/// actually hit — a bad key, a rate limit — to messages they can act on.
async fn http_get_text(request: &discover::Request, source: Source) -> Result<String, String> {
    let mut builder = http_client()
        .get(&request.url)
        .timeout(std::time::Duration::from_secs(30));
    for (name, value) in &request.headers {
        builder = builder.header(*name, value);
    }
    let response = builder
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if status.is_success() {
        return Ok(body);
    }

    let provider = source.provider();
    // Pixabay answers an invalid key with HTTP 400 and a plain-text body.
    let bad_key = status.as_u16() == 401
        || status.as_u16() == 403
        || (status.as_u16() == 400 && body.to_lowercase().contains("api key"));
    if bad_key && source.key_setting().is_some() {
        return Err(format!(
            "{provider} rejected the API key. Check it in Settings."
        ));
    }
    if status.as_u16() == 429 {
        return Err(format!(
            "{provider} rate limit reached. Try again in a little while."
        ));
    }
    Err(format!("{provider} request failed with status {status}."))
}

/// The stored API key for a source, if it uses one and one is saved.
fn source_key(app: &AppHandle, source: Source) -> Option<String> {
    let setting = source.key_setting()?;
    let library = app.state::<Mutex<Library>>();
    let library = library.lock().unwrap();
    library
        .settings
        .get(setting)
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

/// Every source with its capabilities and whether an API key is saved.
#[tauri::command]
fn discover_sources(app: AppHandle) -> Vec<discover::SourceInfo> {
    discover::describe_sources(|source| source_key(&app, source).is_some())
}

/// Searches a provider, honouring the 24-hour cache and the rate limiter.
#[tauri::command]
async fn discover_search(
    app: AppHandle,
    query: String,
    source: Source,
    category: String,
    page: u32,
    options: Option<SearchOptions>,
) -> Result<DiscoverPage, String> {
    let page = page.max(1);
    let options = options.unwrap_or_default().for_source(source);
    let cache_key = discover::cache_key(source, &query, &category, page, options);

    if let Some(hit) = app
        .state::<Mutex<Discover>>()
        .lock()
        .unwrap()
        .cache
        .get(&cache_key)
    {
        return Ok(hit);
    }

    // Building the request first means a missing key is reported before any
    // throttling, and never burns rate-limit budget.
    let api_key = source_key(&app, source);
    let request = discover::build_request(
        source,
        &query,
        &category,
        page,
        options,
        api_key.as_deref(),
        discover::today_days(),
    )?;

    let wait = app
        .state::<Mutex<Discover>>()
        .lock()
        .unwrap()
        .limiter(source)
        .wait_time();
    if wait > discover::MAX_RATE_WAIT {
        // Sleeping for minutes would look like a frozen app; say so instead.
        return Err(discover::rate_limit_message(source, wait));
    }
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
    // Count the request when it is issued, so overlapping searches cannot
    // both slip under the limit.
    app.state::<Mutex<Discover>>().lock().unwrap().mark(source);

    let body = http_get_text(&request, source).await?;
    let parsed = discover::parse_page(source, &body, page)?;

    app.state::<Mutex<Discover>>()
        .lock()
        .unwrap()
        .cache
        .put(&cache_key, &parsed);

    Ok(parsed)
}

/// Opens an https link in the default browser (credits, key sign-up pages).
/// Only https URLs are accepted.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.contains(char::is_whitespace) {
        return Err("Only https links can be opened.".to_string());
    }
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let opener = "xdg-open";

    std::process::Command::new(opener)
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Streams a remote asset into the library directory, reporting progress over
/// `on_progress`. Bytes go to `<uuid>.part` and are atomically renamed once the
/// transfer succeeds; the webview then probes and thumbnails it.
#[tauri::command]
async fn discover_download(
    app: AppHandle,
    downloads: State<'_, Downloads>,
    on_progress: Channel<DownloadProgress>,
    id: String,
    url: String,
    kind: DiscoverKind,
    title: String,
    source: Source,
    source_url: Option<String>,
    author: Option<String>,
) -> Result<DownloadedFile, String> {
    let emit = |progress: DownloadProgress| {
        let _ = on_progress.send(progress);
    };

    if !url.starts_with("https://") {
        let message = "Only https downloads are allowed.".to_string();
        emit(DownloadProgress {
            id: id.clone(),
            bytes_done: 0,
            bytes_total: None,
            speed_bps: 0.0,
            phase: Phase::Error,
            error: Some(message.clone()),
        });
        return Err(message);
    }

    emit(DownloadProgress::new(&id, Phase::Queued));

    // Register before waiting for a slot so the download can be cancelled while
    // it is still queued.
    let token = downloads.register(&id);
    let permit = downloads
        .permits()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;

    let dir = app_data_dir(&app)?.join("wallpapers");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let file_id = uuid::Uuid::new_v4().to_string();
    let ext = discover::extension_for(&url, kind);
    let dest = dir.join(format!("{file_id}.{ext}"));
    let part = dir.join(format!("{file_id}.part"));

    let mut last_emit = Instant::now() - download::PROGRESS_INTERVAL;
    let result = download::download_to_part(
        http_client(),
        &url,
        &part,
        &token,
        &mut |done, total, speed| {
            let now = Instant::now();
            if now.duration_since(last_emit) >= download::PROGRESS_INTERVAL {
                last_emit = now;
                emit(DownloadProgress {
                    id: id.clone(),
                    bytes_done: done,
                    bytes_total: total,
                    speed_bps: speed,
                    phase: Phase::Downloading,
                    error: None,
                });
            }
        },
    )
    .await;

    let finished = |phase: Phase, bytes: u64, error: Option<String>| DownloadProgress {
        id: id.clone(),
        bytes_done: bytes,
        bytes_total: (bytes > 0).then_some(bytes),
        speed_bps: 0.0,
        phase,
        error,
    };

    match result {
        Ok(bytes) => {
            emit(finished(Phase::Processing, bytes, None));
            if let Err(error) = fs::rename(&part, &dest) {
                let _ = fs::remove_file(&part);
                downloads.finish(&id);
                drop(permit);
                let message = format!("Could not finalise the file: {error}");
                emit(DownloadProgress {
                    id: id.clone(),
                    bytes_done: 0,
                    bytes_total: None,
                    speed_bps: 0.0,
                    phase: Phase::Error,
                    error: Some(message.clone()),
                });
                return Err(message);
            }
            emit(finished(Phase::Done, bytes, None));
            downloads.finish(&id);
            drop(permit);
            Ok(DownloadedFile {
                id: file_id,
                file_path: dest.to_string_lossy().to_string(),
                kind,
                title,
                source,
                source_url,
                author,
            })
        }
        Err(error) => {
            let message = error.message();
            emit(DownloadProgress {
                id: id.clone(),
                bytes_done: 0,
                bytes_total: None,
                speed_bps: 0.0,
                phase: Phase::Error,
                error: Some(message.clone()),
            });
            downloads.finish(&id);
            drop(permit);
            Err(message)
        }
    }
}

/// Cancels an in-flight or queued download.
#[tauri::command]
fn discover_cancel(downloads: State<'_, Downloads>, id: String) -> bool {
    downloads.cancel(&id)
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
            discover_sources,
            discover_search,
            discover_download,
            discover_cancel,
            open_external,
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
            app.manage(Downloads::new());

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
