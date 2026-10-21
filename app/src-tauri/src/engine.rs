//! Wallpaper engine: sets the desktop background, plays live (video)
//! wallpapers in a borderless window at the bottom of the window stack, rotates
//! playlists on a timer and pauses live playback to save battery.
//!
//! * Static images use the system desktop picture (AppleScript, macOS).
//! * Live videos play in a click-through "wallpaper" window rendering
//!   `<video>` (see `LivePlayer.tsx`). Rust is the single owner of the pause
//!   decision (`power.rs`) and tells the player via `live-state` events.
//! * Rotation is a single tokio task; it costs nothing between ticks.

use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::power::{self, PowerPolicy, PowerStatus};
use crate::store::{Library, Wallpaper, WallpaperType};

const LIVE_LABEL_PREFIX: &str = "wallpaper-";
const MIN_INTERVAL_SECS: u64 = 15;

/// Runtime engine state (the persisted parts live in library settings).
pub struct Engine {
    generation: AtomicU64,
    current: Mutex<Option<String>>,
    paused: Mutex<Option<String>>,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            current: Mutex::new(None),
            paused: Mutex::new(None),
        }
    }
}

/// A rotation over several wallpapers.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Playlist {
    #[serde(default)]
    pub ids: Vec<String>,
    #[serde(default = "default_interval")]
    pub interval_secs: u64,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default)]
    pub enabled: bool,
}

fn default_interval() -> u64 {
    30 * 60
}

impl Default for Playlist {
    fn default() -> Self {
        Self { ids: vec![], interval_secs: default_interval(), shuffle: false, enabled: false }
    }
}

#[derive(Serialize)]
pub struct EngineStatus {
    current_id: Option<String>,
    live_active: bool,
    paused_reason: Option<String>,
    on_battery: bool,
    battery_percent: Option<u8>,
    low_power: bool,
}

/* ----------------------------------------------------------------- helpers */

fn setting(app: &AppHandle, key: &str) -> Option<Value> {
    app.state::<Mutex<Library>>().lock().unwrap().settings.get(key).cloned()
}

fn put_setting(app: &AppHandle, key: &str, value: Value) -> Result<(), String> {
    let snapshot = {
        let state = app.state::<Mutex<Library>>();
        let mut lib = state.lock().unwrap();
        lib.settings.insert(key.to_string(), value);
        lib.clone()
    };
    crate::persist(app, &snapshot)
}

fn find_wallpaper(app: &AppHandle, id: &str) -> Option<Wallpaper> {
    app.state::<Mutex<Library>>()
        .lock()
        .unwrap()
        .wallpapers
        .iter()
        .find(|w| w.id == id)
        .cloned()
}

fn read_playlist(app: &AppHandle) -> Playlist {
    setting(app, "playlist")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn read_policy(app: &AppHandle) -> PowerPolicy {
    let mut policy = PowerPolicy::default();
    if let Some(v) = setting(app, "power") {
        if let Some(b) = v.get("pause_on_battery").and_then(Value::as_bool) {
            policy.pause_on_battery = b;
        }
        if let Some(b) = v.get("pause_on_low_power").and_then(Value::as_bool) {
            policy.pause_on_low_power = b;
        }
        if let Some(n) = v.get("battery_threshold").and_then(Value::as_u64) {
            policy.battery_threshold = n.min(100) as u8;
        }
    }
    policy
}

fn script(source: &str) -> Result<String, String> {
    if !cfg!(target_os = "macos") {
        return Err("Setting the desktop background is only supported on macOS.".into());
    }
    let out = Command::new("osascript")
        .args(["-e", source])
        .output()
        .map_err(|e| format!("Could not run osascript: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Sets the picture on every desktop/Space. Falls back to Finder, which works
/// on setups where System Events refuses.
fn set_desktop_picture(path: &str) -> Result<(), String> {
    let q = power::applescript_quote(path);
    let primary = format!(
        "tell application \"System Events\" to tell every desktop to set picture to POSIX file {q}"
    );
    match script(&primary) {
        Ok(_) => Ok(()),
        Err(first) => {
            let fallback =
                format!("tell application \"Finder\" to set desktop picture to POSIX file {q}");
            script(&fallback).map(|_| ()).map_err(|second| {
                format!(
                    "Could not set the desktop picture. Allow Driftwall under System Settings → \
                     Privacy & Security → Automation. ({first}; {second})"
                )
            })
        }
    }
}

/// Remembers the user's original wallpaper once, so it can be restored.
fn remember_original(app: &AppHandle) {
    if setting(app, "original_wallpaper").is_some() {
        return;
    }
    if let Ok(path) = script("tell application \"System Events\" to get picture of desktop 1") {
        if !path.is_empty() {
            let _ = put_setting(app, "original_wallpaper", json!(path));
        }
    }
}

/// Labels of every live wallpaper window currently open (one per display).
fn live_labels(app: &AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter(|label| label.starts_with(LIVE_LABEL_PREFIX))
        .cloned()
        .collect()
}

fn live_window_exists(app: &AppHandle) -> bool {
    !live_labels(app).is_empty()
}

fn close_live_window(app: &AppHandle) {
    for label in live_labels(app) {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
    }
    *app.state::<Engine>().paused.lock().unwrap() = None;
}

/// Makes sure there is exactly one borderless, click-through window per
/// connected display. If the display count changed since the windows were
/// built, they are all closed and rebuilt.
fn ensure_live_windows(app: &AppHandle) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let existing = live_labels(app);
    if !existing.is_empty() && existing.len() != monitors.len() {
        for label in existing {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.destroy();
            }
        }
    }

    // No monitor info at all: fall back to a single default-sized window.
    let count = monitors.len().max(1);
    for i in 0..count {
        let label = format!("{LIVE_LABEL_PREFIX}{i}");
        if app.get_webview_window(&label).is_some() {
            continue;
        }
        let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Driftwall Wallpaper")
            .decorations(false)
            .resizable(false)
            .shadow(false)
            .skip_taskbar(true)
            .focused(false)
            .always_on_bottom(true)
            .visible_on_all_workspaces(true);

        if let Some(monitor) = monitors.get(i) {
            let scale = monitor.scale_factor().max(1.0);
            let size = monitor.size();
            let pos = monitor.position();
            builder = builder
                .inner_size(size.width as f64 / scale, size.height as f64 / scale)
                .position(pos.x as f64 / scale, pos.y as f64 / scale);
        }

        let window = builder.build().map_err(|e| e.to_string())?;
        // Clicks must reach the desktop (icons, Finder), not the video.
        let _ = window.set_ignore_cursor_events(true);
        pin_to_desktop(&window);
    }
    Ok(())
}

/// Moves the window to the real desktop window level and marks it stationary
/// on every Space. Plain "always on bottom" windows are hidden by Mission
/// Control (three-finger swipe up) and Space switches; desktop-level windows
/// stay visible, just like the system wallpaper. Icons sit one level above.
#[cfg(target_os = "macos")]
fn pin_to_desktop(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    // kCGDesktopWindowLevel = CGWindowLevelForKey(kCGDesktopWindowLevelKey).
    const DESKTOP_LEVEL: isize = -2_147_483_623;
    // CanJoinAllSpaces (1) | Stationary (16) | IgnoresCycle (64) | FullScreenAuxiliary (256).
    const BEHAVIOR: usize = 1 | (1 << 4) | (1 << 6) | (1 << 8);

    let Ok(ptr) = window.ns_window() else { return };
    let addr = ptr as usize;
    let _ = window.run_on_main_thread(move || unsafe {
        let ns = addr as *mut AnyObject;
        if ns.is_null() {
            return;
        }
        let _: () = msg_send![ns, setLevel: DESKTOP_LEVEL];
        let _: () = msg_send![ns, setCollectionBehavior: BEHAVIOR];
    });
}

#[cfg(not(target_os = "macos"))]
fn pin_to_desktop(_window: &tauri::WebviewWindow) {}

/// Sets the video's thumbnail as the still desktop picture. macOS tints the
/// menu bar from the desktop picture, so this keeps the bar matching the video
/// and gives a sensible fallback if the live window is ever hidden.
fn set_poster_picture(app: &AppHandle, wallpaper: &Wallpaper) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let thumb = dir.join("thumbnails").join(format!("{}.thumb.png", wallpaper.id));
    if !thumb.exists() {
        return;
    }
    remember_original(app);
    let _ = set_desktop_picture(&thumb.to_string_lossy());
}

fn emit_state(app: &AppHandle) {
    let reason = app.state::<Engine>().paused.lock().unwrap().clone();
    let _ = app.emit(
        "live-state",
        json!({ "playing": reason.is_none(), "reason": reason }),
    );
}

/// Re-evaluates the power policy and tells the player if the answer changed.
fn evaluate_power(app: &AppHandle) {
    if !live_window_exists(app) {
        return;
    }
    let reason = power::pause_reason(&power::read_status(), &read_policy(app)).map(String::from);
    let changed = {
        let engine = app.state::<Engine>();
        let mut paused = engine.paused.lock().unwrap();
        if *paused != reason {
            *paused = reason;
            true
        } else {
            false
        }
    };
    if changed {
        emit_state(app);
    }
}

/// Applies a wallpaper: still -> desktop picture, video -> live window.
async fn apply(app: &AppHandle, wallpaper: &Wallpaper) -> Result<(), String> {
    if !std::path::Path::new(&wallpaper.file_path).exists() {
        return Err(format!("“{}” is missing on disk.", wallpaper.title));
    }
    match wallpaper.kind {
        WallpaperType::Static => {
            let app2 = app.clone();
            let path = wallpaper.file_path.clone();
            tauri::async_runtime::spawn_blocking(move || {
                remember_original(&app2);
                set_desktop_picture(&path)
            })
            .await
            .map_err(|e| e.to_string())??;
            close_live_window(app);
        }
        WallpaperType::Video => {
            let app2 = app.clone();
            let video = wallpaper.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || set_poster_picture(&app2, &video))
                .await;
            ensure_live_windows(app)?;
            let _ = app.emit("live-load", json!({ "path": wallpaper.file_path }));
        }
    }
    *app.state::<Engine>().current.lock().unwrap() = Some(wallpaper.id.clone());
    let _ = put_setting(app, "engine_current", json!(wallpaper.id));
    // Lets every window (main, menu-bar panel) refresh its "now playing" state.
    let _ = app.emit("driftwall:wallpaper-changed", json!({ "from": "rust" }));
    if wallpaper.kind == WallpaperType::Video {
        let app2 = app.clone();
        tauri::async_runtime::spawn_blocking(move || evaluate_power(&app2));
    }
    Ok(())
}

async fn advance(app: &AppHandle) -> Result<(), String> {
    let playlist = read_playlist(app);
    let ids: Vec<String> =
        playlist.ids.iter().filter(|id| find_wallpaper(app, id).is_some()).cloned().collect();
    if ids.is_empty() {
        return Err("The rotation has no wallpapers left.".into());
    }
    let current = app.state::<Engine>().current.lock().unwrap().clone();
    let current_idx = current.and_then(|c| ids.iter().position(|id| *id == c));
    let rand = uuid::Uuid::new_v4().as_u128() as u64;
    let next = power::pick_next(ids.len(), current_idx, playlist.shuffle, rand);
    match find_wallpaper(app, &ids[next]) {
        Some(w) => apply(app, &w).await,
        None => Err("Wallpaper not found.".into()),
    }
}

fn restart_scheduler(app: &AppHandle) {
    let generation = app.state::<Engine>().generation.fetch_add(1, Ordering::SeqCst) + 1;
    let playlist = read_playlist(app);
    if !playlist.enabled || playlist.ids.len() < 2 {
        return;
    }
    let interval = Duration::from_secs(playlist.interval_secs.max(MIN_INTERVAL_SECS));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(interval).await;
            if app.state::<Engine>().generation.load(Ordering::SeqCst) != generation {
                break;
            }
            let _ = advance(&app).await;
        }
    });
}

/* ----------------------------------------------------------------- startup */

/// Called once from `setup`: resumes the last live wallpaper, the rotation and
/// the battery watcher.
pub fn start(app: &AppHandle) {
    if let Some(id) = setting(app, "engine_current").and_then(|v| v.as_str().map(String::from)) {
        if let Some(w) = find_wallpaper(app, &id) {
            *app.state::<Engine>().current.lock().unwrap() = Some(id);
            if w.kind == WallpaperType::Video {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = apply(&app2, &w).await;
                });
            }
        }
    }
    restart_scheduler(app);

    // Battery watcher: only does work while a live wallpaper is on screen.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(20)).await;
            if live_window_exists(&app2) {
                let app3 = app2.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || evaluate_power(&app3)).await;
            }
        }
    });
}

/* ---------------------------------------------------------------- commands */

#[tauri::command]
pub async fn wallpaper_apply(app: AppHandle, id: String) -> Result<(), String> {
    let wallpaper = find_wallpaper(&app, &id).ok_or("Wallpaper not found.")?;
    apply(&app, &wallpaper).await
}

/// Stops live playback (the last still stays as the desktop picture).
#[tauri::command]
pub fn wallpaper_stop(app: AppHandle) {
    close_live_window(&app);
    *app.state::<Engine>().current.lock().unwrap() = None;
    let _ = put_setting(&app, "engine_current", Value::Null);
}

#[tauri::command]
pub async fn wallpaper_restore_original(app: AppHandle) -> Result<(), String> {
    let path = setting(&app, "original_wallpaper")
        .and_then(|v| v.as_str().map(String::from))
        .ok_or("No original wallpaper was recorded yet.")?;
    close_live_window(&app);
    *app.state::<Engine>().current.lock().unwrap() = None;
    let _ = put_setting(&app, "engine_current", Value::Null);
    tauri::async_runtime::spawn_blocking(move || set_desktop_picture(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn playlist_get(app: AppHandle) -> Playlist {
    read_playlist(&app)
}

#[tauri::command]
pub async fn playlist_set(app: AppHandle, playlist: Playlist, apply_now: bool) -> Result<Playlist, String> {
    let mut playlist = playlist;
    playlist.interval_secs = playlist.interval_secs.max(MIN_INTERVAL_SECS);
    playlist.ids.retain(|id| find_wallpaper(&app, id).is_some());
    if playlist.enabled && playlist.ids.len() < 2 {
        return Err("Pick at least two wallpapers for a rotation.".into());
    }
    put_setting(&app, "playlist", serde_json::to_value(&playlist).map_err(|e| e.to_string())?)?;
    restart_scheduler(&app);
    if playlist.enabled && apply_now {
        advance(&app).await?;
    }
    Ok(playlist)
}

/// Skips to the next wallpaper in the rotation right now.
#[tauri::command]
pub async fn playlist_next(app: AppHandle) -> Result<(), String> {
    advance(&app).await
}

#[tauri::command]
pub async fn engine_status(app: AppHandle) -> Result<EngineStatus, String> {
    let status: PowerStatus =
        tauri::async_runtime::spawn_blocking(power::read_status).await.map_err(|e| e.to_string())?;
    let engine: State<'_, Engine> = app.state();
    let current_id = engine.current.lock().unwrap().clone();
    let paused_reason = engine.paused.lock().unwrap().clone();
    Ok(EngineStatus {
        current_id,
        live_active: live_window_exists(&app),
        paused_reason,
        on_battery: status.on_battery,
        battery_percent: status.percent,
        low_power: status.low_power,
    })
}

/// Called by the live window on mount: what to play and whether it is paused.
#[tauri::command]
pub fn live_current(app: AppHandle) -> Option<Value> {
    let id = app.state::<Engine>().current.lock().unwrap().clone()?;
    let w = find_wallpaper(&app, &id)?;
    if w.kind != WallpaperType::Video {
        return None;
    }
    let reason = app.state::<Engine>().paused.lock().unwrap().clone();
    Some(json!({ "path": w.file_path, "playing": reason.is_none(), "reason": reason }))
}

/// Re-checks power right away (used after the user changes the battery policy).
#[tauri::command]
pub async fn power_refresh(app: AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || evaluate_power(&app)).await;
}
