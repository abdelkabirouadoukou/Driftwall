//! Driftwall's library store.
//!
//! The whole library lives in a single JSON document (`library.json`) under the
//! app data directory, owned by Rust and guarded by one `Mutex<Library>`. This
//! mirrors the original app's approach — UUID media files plus a small metadata
//! file — and avoids the SQLite locking problems that come from the frontend
//! opening multiple connections.
//!
//! Saves are atomic: we write `library.json.tmp`, fsync it, keep the previous
//! `library.json` as `library.json.bak`, then rename the temp file over the real
//! one. On load, a corrupt `library.json` falls back to `.bak`; if that is also
//! unusable the corrupt file is moved aside as `library.json.corrupt-<ts>` and
//! an empty library is returned.

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Version of the on-disk library format.
pub const LIBRARY_VERSION: u32 = 1;

const MAIN_FILE: &str = "library.json";
const BACKUP_FILE: &str = "library.json.bak";
const TEMP_FILE: &str = "library.json.tmp";

/// Whether a wallpaper is a still image or a looping video.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WallpaperType {
    Static,
    Video,
}

/// A single wallpaper entry in the library.
///
/// Fields match the frontend `WallpaperRecord` exactly; `tags` is a plain array
/// of strings (not a nested JSON string).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Wallpaper {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: WallpaperType,
    pub file_path: String,
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub duration: Option<f64>,
    /// Origin of the wallpaper when it came from Discover (`wallhaven`/`pixabay`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Human-facing page for the original asset, for attribution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Original author/uploader, for attribution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub created_at: String,
}

/// The persisted library document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Library {
    pub version: u32,
    #[serde(default)]
    pub wallpapers: Vec<Wallpaper>,
    #[serde(default)]
    pub settings: BTreeMap<String, Value>,
}

impl Default for Library {
    fn default() -> Self {
        Self {
            version: LIBRARY_VERSION,
            wallpapers: Vec::new(),
            settings: BTreeMap::new(),
        }
    }
}

impl Library {
    /// Inserts a wallpaper, replacing any existing entry with the same id.
    pub fn add(&mut self, wallpaper: Wallpaper) {
        if let Some(existing) = self.wallpapers.iter_mut().find(|w| w.id == wallpaper.id) {
            *existing = wallpaper;
        } else {
            self.wallpapers.push(wallpaper);
        }
    }

    /// Renames a wallpaper. Returns `false` if no entry has that id.
    pub fn rename(&mut self, id: &str, title: &str) -> bool {
        match self.wallpapers.iter_mut().find(|w| w.id == id) {
            Some(wallpaper) => {
                wallpaper.title = title.to_string();
                true
            }
            None => false,
        }
    }

    /// Removes and returns the wallpaper with the given id, if present.
    pub fn remove(&mut self, id: &str) -> Option<Wallpaper> {
        let index = self.wallpapers.iter().position(|w| w.id == id)?;
        Some(self.wallpapers.remove(index))
    }
}

/// Path to the live library file.
pub fn main_path(dir: &Path) -> PathBuf {
    dir.join(MAIN_FILE)
}

/// Path to the backup library file.
pub fn backup_path(dir: &Path) -> PathBuf {
    dir.join(BACKUP_FILE)
}

/// Path to the temporary file used during atomic saves.
pub fn temp_path(dir: &Path) -> PathBuf {
    dir.join(TEMP_FILE)
}

/// Persists the library atomically.
pub fn save(dir: &Path, library: &Library) -> io::Result<()> {
    fs::create_dir_all(dir)?;

    let json = serde_json::to_vec_pretty(library)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let tmp = temp_path(dir);
    let main = main_path(dir);
    let backup = backup_path(dir);

    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&json)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }

    // Preserve the previous good document as the backup before overwriting.
    if main.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&main, &backup)?;
    }

    fs::rename(&tmp, &main)?;

    // Best-effort directory fsync so the rename is durable. Ignored on platforms
    // that disallow fsync on a directory handle (e.g. some macOS setups).
    if let Ok(handle) = fs::File::open(dir) {
        let _ = handle.sync_all();
    }

    Ok(())
}

/// Loads the library, recovering from a corrupt main file when possible.
pub fn load(dir: &Path) -> Library {
    match read_library(&main_path(dir)) {
        Ok(library) => library,
        // No main file: recover from a backup if one exists (crash mid-save),
        // otherwise treat this as a fresh install.
        Err(LoadError::Missing) => read_library(&backup_path(dir)).unwrap_or_default(),
        Err(LoadError::Corrupt) => match read_library(&backup_path(dir)) {
            Ok(library) => library,
            Err(_) => {
                quarantine(&main_path(dir));
                Library::default()
            }
        },
    }
}

enum LoadError {
    Missing,
    Corrupt,
}

fn read_library(path: &Path) -> Result<Library, LoadError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| LoadError::Corrupt),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(LoadError::Missing),
        Err(_) => Err(LoadError::Corrupt),
    }
}

/// Moves a corrupt library file aside so it does not block startup.
fn quarantine(path: &Path) {
    if !path.exists() {
        return;
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = path.with_file_name(format!("library.json.corrupt-{stamp}"));
    let _ = fs::rename(path, dest);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process;
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// Minimal self-cleaning temp directory (avoids a `tempfile` dependency).
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("driftwall-{tag}-{}-{nanos}", process::id()));
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn wallpaper(id: &str) -> Wallpaper {
        Wallpaper {
            id: id.to_string(),
            kind: WallpaperType::Video,
            file_path: format!("/tmp/{id}.mp4"),
            title: format!("Wallpaper {id}"),
            tags: vec!["nature".to_string()],
            width: Some(1920),
            height: Some(1080),
            duration: Some(12.5),
            source: None,
            source_url: None,
            author: None,
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = TempDir::new("roundtrip");
        let mut library = Library::default();
        library.add(wallpaper("a"));
        library
            .settings
            .insert("show_in_dock".to_string(), Value::Bool(true));
        save(dir.path(), &library).unwrap();

        let loaded = load(dir.path());
        assert_eq!(loaded, library);
        assert_eq!(loaded.version, LIBRARY_VERSION);
        assert_eq!(loaded.wallpapers[0].kind, WallpaperType::Video);
    }

    #[test]
    fn missing_file_loads_empty_default() {
        let dir = TempDir::new("missing");
        assert_eq!(load(dir.path()), Library::default());
    }

    #[test]
    fn atomic_write_keeps_backup_and_leaves_no_temp() {
        let dir = TempDir::new("atomic");
        let mut first = Library::default();
        first.add(wallpaper("first"));
        save(dir.path(), &first).unwrap();

        let mut second = Library::default();
        second.add(wallpaper("first"));
        second.add(wallpaper("second"));
        save(dir.path(), &second).unwrap();

        assert!(
            !temp_path(dir.path()).exists(),
            "temp file must be renamed away"
        );
        assert_eq!(load(dir.path()), second, "main file holds the latest data");

        let backup: Library =
            serde_json::from_slice(&fs::read(backup_path(dir.path())).unwrap()).unwrap();
        assert_eq!(backup, first, "backup holds the previous version");
    }

    #[test]
    fn recovers_from_backup_when_main_is_corrupt() {
        let dir = TempDir::new("recover");
        let mut good = Library::default();
        good.add(wallpaper("good"));
        fs::write(
            backup_path(dir.path()),
            serde_json::to_vec_pretty(&good).unwrap(),
        )
        .unwrap();
        fs::write(main_path(dir.path()), b"{ this is not json").unwrap();

        assert_eq!(load(dir.path()), good);
    }

    #[test]
    fn quarantines_corrupt_file_when_no_backup() {
        let dir = TempDir::new("quarantine");
        fs::write(main_path(dir.path()), b"garbage").unwrap();

        assert_eq!(load(dir.path()), Library::default());
        assert!(
            !main_path(dir.path()).exists(),
            "corrupt main file is moved aside"
        );

        let quarantined = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("library.json.corrupt-")
            });
        assert!(quarantined, "a quarantined copy exists");
    }

    #[test]
    fn add_replaces_duplicate_id() {
        let mut library = Library::default();
        library.add(wallpaper("dup"));
        let mut updated = wallpaper("dup");
        updated.title = "Renamed".to_string();
        library.add(updated);

        assert_eq!(library.wallpapers.len(), 1);
        assert_eq!(library.wallpapers[0].title, "Renamed");
    }

    #[test]
    fn rename_and_remove_target_by_id() {
        let mut library = Library::default();
        library.add(wallpaper("a"));
        library.add(wallpaper("b"));

        assert!(library.rename("a", "New title"));
        assert_eq!(library.wallpapers[0].title, "New title");
        assert!(!library.rename("missing", "x"));

        let removed = library.remove("b").unwrap();
        assert_eq!(removed.id, "b");
        assert_eq!(library.wallpapers.len(), 1);
        assert!(library.remove("b").is_none());
    }

    #[test]
    fn concurrent_adds_through_mutex_are_serialised() {
        let store = Arc::new(Mutex::new(Library::default()));
        let mut handles = Vec::new();

        for i in 0..64 {
            let store = Arc::clone(&store);
            handles.push(thread::spawn(move || {
                let mut library = store.lock().unwrap();
                library.add(wallpaper(&format!("w{i}")));
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }

        let dir = TempDir::new("concurrent");
        let library = store.lock().unwrap();
        assert_eq!(library.wallpapers.len(), 64);

        save(dir.path(), &library).unwrap();
        assert_eq!(load(dir.path()).wallpapers.len(), 64);
    }
}
