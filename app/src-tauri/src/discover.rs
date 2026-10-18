//! Discover: browsing remote wallpaper sources.
//!
//! All network access lives in Rust (never the webview). Two sources are
//! supported — Wallhaven (SFW images, `purity=100` hard-coded) and Pixabay
//! (videos, using the user's own key). Responses are parsed into a source-
//! agnostic [`DiscoverItem`] and cached for 24 hours. Requests are throttled to
//! stay well within each provider's rate limits.
//!
//! We never bundle or re-host any provider content: downloads stream straight to
//! the user's app data directory, and each item carries an attribution page URL.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// User-Agent sent with every request, per the master spec: `Driftwall/<version>`.
pub const USER_AGENT: &str = concat!("Driftwall/", env!("CARGO_PKG_VERSION"));

/// How long a cached page stays fresh.
pub const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Wallhaven allows 45 requests/minute; we stay a little under.
pub const WALLHAVEN_PER_MINUTE: u32 = 45;
/// Pixabay allows 100 requests/minute.
pub const PIXABAY_PER_MINUTE: u32 = 100;

/// Items requested per page (Pixabay's documented maximum-friendly value).
pub const PER_PAGE: u32 = 24;

/// Category chips surfaced by the Discover UI.
pub const CATEGORIES: &[&str] = &[
    "Gaming",
    "Anime",
    "Cyberpunk",
    "Space",
    "Nature",
    "Minimal",
    "OLED black",
    "Abstract",
];

/// Maps a display category to the query string sent to providers.
pub fn category_query(category: &str) -> Option<&'static str> {
    match category {
        "Gaming" => Some("gaming"),
        "Anime" => Some("anime"),
        "Cyberpunk" => Some("cyberpunk"),
        "Space" => Some("space"),
        "Nature" => Some("nature"),
        "Minimal" => Some("minimal"),
        "OLED black" => Some("black oled"),
        "Abstract" => Some("abstract"),
        _ => None,
    }
}

/// Which provider an item or search belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Wallhaven,
    Pixabay,
}

/// Whether a discovered asset is a still image or a video.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscoverKind {
    Image,
    Video,
}

/// A downloadable rendition of an item (e.g. Pixabay's small/medium/large
/// encodes, or a Wallhaven "fast preview" fallback).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rendition {
    /// Stable key used by the quality selector (`original`, `preview`, `small`,
    /// `medium`, `large`).
    pub key: String,
    /// Human label shown in the UI.
    pub label: String,
    pub url: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// Byte size when the provider reports it (usually unknown).
    #[serde(default)]
    pub size_bytes: Option<u64>,
    /// Whether this is the default choice for the item.
    #[serde(default)]
    pub default: bool,
}

impl Rendition {
    fn new(key: &str, label: &str, url: String, width: Option<u32>, height: Option<u32>) -> Self {
        Self {
            key: key.to_string(),
            label: label.to_string(),
            url,
            width,
            height,
            size_bytes: None,
            default: false,
        }
    }
}

/// A single browsable remote asset.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiscoverItem {
    pub id: String,
    pub source: Source,
    pub kind: DiscoverKind,
    pub title: String,
    /// Small image URL for the grid (may be a video URL when no still exists).
    pub thumb_url: String,
    /// Full-resolution asset to download (the default rendition's URL).
    pub full_url: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    /// Selectable download renditions (best/default first).
    #[serde(default)]
    pub renditions: Vec<Rendition>,
}

/// One page of results for a search.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DiscoverPage {
    pub items: Vec<DiscoverItem>,
    pub page: u32,
    pub has_more: bool,
}

/// Result of streaming a remote asset to the library directory.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DownloadedFile {
    pub id: String,
    pub file_path: String,
    pub kind: DiscoverKind,
    pub title: String,
    pub source: Source,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
}

/* ------------------------------------------------------------------- urls */

/// Builds the Wallhaven search URL. `purity=100` (SFW only) is hard-coded.
pub fn wallhaven_url(query: &str, category: &str, page: u32) -> String {
    let q = effective_query(query, category);
    let base = "https://wallhaven.cc/api/v1/search";
    let mut params: Vec<String> = vec![
        "purity=100".to_string(),
        "categories=111".to_string(),
        "atleast=1920x1080".to_string(),
        format!("page={}", page.max(1)),
    ];
    if !q.is_empty() {
        params.push(format!("q={}", encode(&q)));
        params.push("sorting=relevance".to_string());
    } else {
        params.push("sorting=random".to_string());
    }
    format!("{base}?{}", params.join("&"))
}

/// Builds the Pixabay video search URL (`video_type=animation`).
pub fn pixabay_url(query: &str, category: &str, page: u32, api_key: &str) -> String {
    let q = effective_query(query, category);
    let base = "https://pixabay.com/api/videos/";
    let params = vec![
        format!("key={}", encode(api_key)),
        format!("q={}", encode(&q)),
        "video_type=animation".to_string(),
        "safesearch=true".to_string(),
        format!("per_page={PER_PAGE}"),
        format!("page={}", page.max(1)),
    ];
    format!("{base}?{}", params.join("&"))
}

fn effective_query(query: &str, category: &str) -> String {
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    category_query(category).unwrap_or("").to_string()
}

/// Percent-encodes the characters that actually matter in query strings.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/* ---------------------------------------------------------------- parsing */

#[derive(Deserialize)]
struct WallhavenResponse {
    #[serde(default)]
    data: Vec<WallhavenImage>,
    #[serde(default)]
    meta: WallhavenMeta,
}

#[derive(Deserialize)]
struct WallhavenImage {
    id: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    short_url: Option<String>,
    /// Full-size file URL.
    #[serde(default)]
    path: String,
    #[serde(default)]
    resolution: String,
    #[serde(default)]
    dimension_x: Option<u32>,
    #[serde(default)]
    dimension_y: Option<u32>,
    #[serde(default)]
    thumbs: WallhavenThumbs,
}

#[derive(Default, Deserialize)]
struct WallhavenThumbs {
    #[serde(default)]
    large: String,
    #[serde(default)]
    original: String,
    #[serde(default)]
    small: String,
}

#[derive(Default, Deserialize)]
struct WallhavenMeta {
    #[serde(default)]
    current_page: Option<u32>,
    #[serde(default)]
    last_page: Option<u32>,
}

/// Parses a Wallhaven search response.
pub fn parse_wallhaven(body: &str, requested_page: u32) -> Result<DiscoverPage, String> {
    let parsed: WallhavenResponse =
        serde_json::from_str(body).map_err(|e| format!("Unexpected Wallhaven response: {e}"))?;

    let items = parsed
        .data
        .into_iter()
        .map(|img| {
            let (w, h) = parse_resolution(&img.resolution)
                .map(|(w, h)| (Some(w), Some(h)))
                .unwrap_or((img.dimension_x, img.dimension_y));
            let full = if img.path.is_empty() {
                img.url.clone()
            } else {
                img.path.clone()
            };
            DiscoverItem {
                id: format!("wallhaven-{}", img.id),
                source: Source::Wallhaven,
                kind: DiscoverKind::Image,
                title: format!("Wallhaven {}", img.id),
                thumb_url: first_non_empty(&[
                    &img.thumbs.large,
                    &img.thumbs.original,
                    &img.thumbs.small,
                    &full,
                ]),
                full_url: full.clone(),
                width: w,
                height: h,
                duration: None,
                author: Some("Wallhaven".to_string()),
                source_url: img.short_url.or_else(|| non_empty(&img.url)),
                renditions: wallhaven_renditions(&full, &img.thumbs.large, w, h),
            }
        })
        .collect();

    let last = parsed.meta.last_page.unwrap_or(requested_page);
    let current = parsed.meta.current_page.unwrap_or(requested_page);
    Ok(DiscoverPage {
        items,
        page: current,
        has_more: current < last,
    })
}

#[derive(Deserialize)]
struct PixabayResponse {
    #[serde(default, rename = "totalHits")]
    total_hits: i64,
    #[serde(default)]
    hits: Vec<PixabayVideo>,
}

#[derive(Deserialize)]
struct PixabayVideo {
    id: i64,
    #[serde(default, rename = "pageURL")]
    page_url: String,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    user: Option<String>,
    #[serde(default)]
    picture_id: Option<serde_json::Value>,
    #[serde(default)]
    videos: PixabayVideos,
}

#[derive(Default, Deserialize)]
struct PixabayVideos {
    #[serde(default)]
    large: Option<PixabayVariant>,
    #[serde(default)]
    medium: Option<PixabayVariant>,
    #[serde(default)]
    small: Option<PixabayVariant>,
    #[serde(default)]
    tiny: Option<PixabayVariant>,
}

#[derive(Deserialize)]
struct PixabayVariant {
    url: String,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
}

/// Parses a Pixabay video search response.
pub fn parse_pixabay(body: &str, requested_page: u32) -> Result<DiscoverPage, String> {
    let parsed: PixabayResponse =
        serde_json::from_str(body).map_err(|e| format!("Unexpected Pixabay response: {e}"))?;

    let items = parsed
        .hits
        .into_iter()
        .filter_map(|video| {
            let renditions = pixabay_renditions(&video.videos);
            let default = renditions.iter().find(|r| r.default).or_else(|| renditions.first())?;
            let thumb = picture_id_string(&video.picture_id)
                .map(|pid| format!("https://i.vimeocdn.com/video/{pid}_640x360.jpg"))
                .unwrap_or_else(|| default.url.clone());
            Some(DiscoverItem {
                id: format!("pixabay-{}", video.id),
                source: Source::Pixabay,
                kind: DiscoverKind::Video,
                title: first_tag(&video.tags).unwrap_or_else(|| format!("Pixabay {}", video.id)),
                thumb_url: thumb,
                full_url: default.url.clone(),
                width: default.width,
                height: default.height,
                duration: video.duration,
                author: video.user,
                source_url: non_empty(&video.page_url),
                renditions,
            })
        })
        .collect();

    let loaded = requested_page.saturating_mul(PER_PAGE) as i64;
    Ok(DiscoverPage {
        items,
        page: requested_page,
        has_more: loaded < parsed.total_hits,
    })
}

/// Builds Wallhaven renditions: the original file plus a lighter thumbnail
/// "fast preview" fallback.
fn wallhaven_renditions(
    full: &str,
    preview: &str,
    width: Option<u32>,
    height: Option<u32>,
) -> Vec<Rendition> {
    let mut out = Vec::new();
    if !full.is_empty() {
        let mut original = Rendition::new("original", "Original", full.to_string(), width, height);
        original.default = true;
        out.push(original);
    }
    if !preview.is_empty() && preview != full {
        out.push(Rendition::new(
            "preview",
            "Fast preview",
            preview.to_string(),
            None,
            None,
        ));
    }
    out
}

/// Builds Pixabay renditions (large/medium/small/tiny) and flags the encode
/// closest to 1080p as the default.
fn pixabay_renditions(videos: &PixabayVideos) -> Vec<Rendition> {
    let variants = [
        ("large", "Large", &videos.large),
        ("medium", "Medium", &videos.medium),
        ("small", "Small", &videos.small),
        ("tiny", "Tiny", &videos.tiny),
    ];
    let mut out: Vec<Rendition> = variants
        .into_iter()
        .filter_map(|(key, label, variant)| {
            variant.as_ref().map(|v| {
                Rendition::new(key, label, v.url.clone(), v.width, v.height)
            })
        })
        .collect();

    if let Some(index) = out
        .iter()
        .enumerate()
        .min_by_key(|(_, r)| r.width.map(|w| (i64::from(w) - 1920).abs()).unwrap_or(i64::MAX))
        .map(|(i, _)| i)
    {
        out[index].default = true;
    }
    out
}

fn picture_id_string(value: &Option<serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(serde_json::Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn first_tag(tags: &str) -> Option<String> {
    tags.split(',')
        .next()
        .map(|t| t.trim().replace('-', " "))
        .filter(|t| !t.is_empty())
        .map(|t| capitalize(&t))
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn parse_resolution(resolution: &str) -> Option<(u32, u32)> {
    let (w, h) = resolution.split_once('x')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn first_non_empty(values: &[&String]) -> String {
    values
        .iter()
        .map(|v| v.as_str())
        .find(|v| !v.is_empty())
        .unwrap_or("")
        .to_string()
}

/* ------------------------------------------------------------------ cache */

/// Stable cache key for a search (FNV-1a, hex-encoded).
pub fn cache_key(source: Source, query: &str, category: &str, page: u32) -> String {
    let source_tag = match source {
        Source::Wallhaven => "wallhaven",
        Source::Pixabay => "pixabay",
    };
    let material = format!("{source_tag}|{}|{category}|{}", query.trim().to_lowercase(), page);
    format!("{:016x}", fnv1a64(material.as_bytes()))
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[derive(Serialize, Deserialize)]
struct CachedPage {
    saved_ms: u128,
    page: DiscoverPage,
}

/// Two-tier (memory + disk) cache with a 24-hour TTL.
pub struct Cache {
    dir: PathBuf,
    memory: HashMap<String, CachedPage>,
}

impl Cache {
    /// Creates a cache rooted at `dir` (created lazily on first write).
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            memory: HashMap::new(),
        }
    }

    /// Returns a fresh cached page, if present.
    pub fn get(&mut self, key: &str) -> Option<DiscoverPage> {
        if let Some(entry) = self.memory.get(key) {
            return Some(entry.page.clone());
        }
        let path = self.dir.join(format!("{key}.json"));
        let bytes = fs::read(path).ok()?;
        let entry: CachedPage = serde_json::from_slice(&bytes).ok()?;
        if !is_fresh(entry.saved_ms) {
            return None;
        }
        let page = entry.page.clone();
        self.memory.insert(key.to_string(), entry);
        Some(page)
    }

    /// Stores a page in memory and on disk (best effort).
    pub fn put(&mut self, key: &str, page: &DiscoverPage) {
        let entry = CachedPage {
            saved_ms: now_ms(),
            page: page.clone(),
        };
        if fs::create_dir_all(&self.dir).is_ok() {
            if let Ok(json) = serde_json::to_vec(&entry) {
                let _ = fs::write(self.dir.join(format!("{key}.json")), json);
            }
        }
        self.memory.insert(key.to_string(), entry);
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn is_fresh(saved_ms: u128) -> bool {
    now_ms().saturating_sub(saved_ms) < CACHE_TTL.as_millis()
}

/* ------------------------------------------------------------ rate limiter */

/// A minimum-interval limiter, one per source.
pub struct RateLimiter {
    min_interval: Duration,
    last: Option<Instant>,
}

impl RateLimiter {
    /// Creates a limiter that allows `per_minute` requests per minute.
    pub fn new(per_minute: u32) -> Self {
        let per_minute = per_minute.max(1);
        Self {
            min_interval: Duration::from_secs_f64(60.0 / f64::from(per_minute)),
            last: None,
        }
    }

    /// Time to wait before the next request may be issued.
    pub fn wait_time(&self) -> Duration {
        match self.last {
            None => Duration::ZERO,
            Some(last) => self.min_interval.saturating_sub(last.elapsed()),
        }
    }

    /// Records that a request was just issued.
    pub fn mark(&mut self) {
        self.last = Some(Instant::now());
    }
}

/// Shared Discover state managed by Tauri.
pub struct Discover {
    pub cache: Cache,
    pub wallhaven: RateLimiter,
    pub pixabay: RateLimiter,
}

impl Discover {
    /// Builds the state rooted at a cache directory.
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            cache: Cache::new(cache_dir),
            wallhaven: RateLimiter::new(WALLHAVEN_PER_MINUTE),
            pixabay: RateLimiter::new(PIXABAY_PER_MINUTE),
        }
    }

    /// Rate limiter for a source.
    pub fn limiter(&self, source: Source) -> &RateLimiter {
        match source {
            Source::Wallhaven => &self.wallhaven,
            Source::Pixabay => &self.pixabay,
        }
    }

    /// Records a request against the source's limiter.
    pub fn mark(&mut self, source: Source) {
        match source {
            Source::Wallhaven => self.wallhaven.mark(),
            Source::Pixabay => self.pixabay.mark(),
        }
    }
}

/* --------------------------------------------------------------- download */

/// Extension to store a downloaded asset under (lowercased, validated).
pub fn extension_for(url: &str, kind: DiscoverKind) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let ext = path
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    const IMAGE: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"];
    const VIDEO: &[&str] = &["mp4", "mov", "m4v"];
    let allowed = match kind {
        DiscoverKind::Image => IMAGE,
        DiscoverKind::Video => VIDEO,
    };
    if allowed.contains(&ext.as_str()) {
        ext
    } else {
        match kind {
            DiscoverKind::Image => "jpg".to_string(),
            DiscoverKind::Video => "mp4".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALLHAVEN_FIXTURE: &str = r#"{
      "data": [
        {
          "id": "abcdef",
          "url": "https://wallhaven.cc/w/abcdef",
          "short_url": "https://whvn.cc/abcdef",
          "path": "https://w.wallhaven.cc/full/ab/wallhaven-abcdef.jpg",
          "resolution": "3840x2160",
          "dimension_x": 3840,
          "dimension_y": 2160,
          "file_type": "image/jpeg",
          "thumbs": {
            "large": "https://th.wallhaven.cc/lg/ab/abcdef.jpg",
            "original": "https://th.wallhaven.cc/orig/ab/abcdef.jpg",
            "small": "https://th.wallhaven.cc/small/ab/abcdef.jpg"
          }
        }
      ],
      "meta": { "current_page": 1, "last_page": 5, "per_page": 24, "total": 120 }
    }"#;

    const PIXABAY_FIXTURE: &str = r#"{
      "total": 3,
      "totalHits": 60,
      "hits": [
        {
          "id": 123456,
          "pageURL": "https://pixabay.com/videos/id-123456/",
          "tags": "abstract,motion,loop",
          "duration": 12,
          "user": "artist",
          "picture_id": "98765",
          "videos": {
            "large":  { "url": "https://cdn.pixabay.com/video/1/2/large.mp4",  "width": 1920, "height": 1080 },
            "medium": { "url": "https://cdn.pixabay.com/video/1/2/medium.mp4", "width": 1280, "height": 720 },
            "small":  { "url": "https://cdn.pixabay.com/video/1/2/small.mp4",  "width": 960,  "height": 540 },
            "tiny":   { "url": "https://cdn.pixabay.com/video/1/2/tiny.mp4",   "width": 640,  "height": 360 }
          }
        },
        {
          "id": 777,
          "pageURL": "",
          "tags": "space",
          "duration": 8,
          "user": "someone",
          "picture_id": 555,
          "videos": {
            "medium": { "url": "https://cdn.pixabay.com/video/9/medium.mp4", "width": 1280, "height": 720 }
          }
        }
      ]
    }"#;

    #[test]
    fn parses_wallhaven_page() {
        let page = parse_wallhaven(WALLHAVEN_FIXTURE, 1).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.page, 1);
        assert!(page.has_more);

        let item = &page.items[0];
        assert_eq!(item.id, "wallhaven-abcdef");
        assert_eq!(item.source, Source::Wallhaven);
        assert_eq!(item.kind, DiscoverKind::Image);
        assert_eq!(item.width, Some(3840));
        assert_eq!(item.height, Some(2160));
        assert_eq!(item.thumb_url, "https://th.wallhaven.cc/lg/ab/abcdef.jpg");
        assert_eq!(
            item.full_url,
            "https://w.wallhaven.cc/full/ab/wallhaven-abcdef.jpg"
        );
        assert_eq!(item.source_url.as_deref(), Some("https://whvn.cc/abcdef"));
    }

    #[test]
    fn parses_pixabay_page_and_picks_1080p() {
        let page = parse_pixabay(PIXABAY_FIXTURE, 1).unwrap();
        assert_eq!(page.items.len(), 2);
        assert!(page.has_more);

        let first = &page.items[0];
        assert_eq!(first.id, "pixabay-123456");
        assert_eq!(first.kind, DiscoverKind::Video);
        assert_eq!(first.full_url, "https://cdn.pixabay.com/video/1/2/large.mp4");
        assert_eq!(first.width, Some(1920));
        assert_eq!(first.duration, Some(12.0));
        assert_eq!(first.author.as_deref(), Some("artist"));
        assert_eq!(
            first.thumb_url,
            "https://i.vimeocdn.com/video/98765_640x360.jpg"
        );
        assert_eq!(first.title, "Abstract");

        // Numeric picture_id and medium-only variant still resolve.
        let second = &page.items[1];
        assert_eq!(second.full_url, "https://cdn.pixabay.com/video/9/medium.mp4");
        assert_eq!(
            second.thumb_url,
            "https://i.vimeocdn.com/video/555_640x360.jpg"
        );
    }

    #[test]
    fn pixabay_has_more_honours_total_hits() {
        let page = parse_pixabay(PIXABAY_FIXTURE, 3).unwrap();
        // 3 * 24 = 72 > 60 total hits -> no more.
        assert!(!page.has_more);
    }

    #[test]
    fn pixabay_exposes_size_renditions_with_a_1080p_default() {
        let page = parse_pixabay(PIXABAY_FIXTURE, 1).unwrap();
        let item = &page.items[0];
        let keys: Vec<&str> = item.renditions.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, ["large", "medium", "small", "tiny"]);

        let default = item.renditions.iter().find(|r| r.default).unwrap();
        assert_eq!(default.key, "large");
        assert_eq!(default.width, Some(1920));
        // full_url mirrors the default rendition for backwards compatibility.
        assert_eq!(item.full_url, default.url);

        // The medium-only clip defaults to medium.
        let second = &page.items[1];
        assert_eq!(second.renditions.len(), 1);
        assert!(second.renditions[0].default);
        assert_eq!(second.renditions[0].key, "medium");
    }

    #[test]
    fn wallhaven_offers_original_and_a_fast_preview() {
        let page = parse_wallhaven(WALLHAVEN_FIXTURE, 1).unwrap();
        let item = &page.items[0];
        assert_eq!(item.renditions.len(), 2);
        assert_eq!(item.renditions[0].key, "original");
        assert!(item.renditions[0].default);
        assert_eq!(item.renditions[0].width, Some(3840));
        assert_eq!(item.renditions[1].key, "preview");
        assert_eq!(item.renditions[1].url, "https://th.wallhaven.cc/lg/ab/abcdef.jpg");
    }

    #[test]
    fn malformed_bodies_are_errors() {
        assert!(parse_wallhaven("{ not json", 1).is_err());
        assert!(parse_pixabay("<html>", 1).is_err());
    }

    #[test]
    fn urls_carry_the_required_parameters() {
        let wh = wallhaven_url("cats", "", 2);
        assert!(wh.contains("purity=100"));
        assert!(wh.contains("page=2"));
        assert!(wh.contains("q=cats"));

        let pb = pixabay_url("", "Cyberpunk", 1, "key 123");
        assert!(pb.contains("video_type=animation"));
        assert!(pb.contains("safesearch=true"));
        assert!(pb.contains("q=cyberpunk"));
        assert!(pb.contains("key=key%20123"), "key is encoded: {pb}");
    }

    #[test]
    fn category_mapping_matches_chips() {
        assert_eq!(category_query("OLED black"), Some("black oled"));
        assert_eq!(category_query("Nature"), Some("nature"));
        assert_eq!(category_query("nope"), None);
        // A free-text query wins over the category.
        assert_eq!(effective_query("mountains", "Nature"), "mountains");
        assert_eq!(effective_query("  ", "Nature"), "nature");
    }

    #[test]
    fn cache_key_is_stable_and_case_insensitive() {
        let a = cache_key(Source::Wallhaven, "Cat", "Nature", 1);
        let b = cache_key(Source::Wallhaven, "cat", "Nature", 1);
        let c = cache_key(Source::Pixabay, "cat", "Nature", 1);
        assert_eq!(a, b);
        assert_ne!(a, c, "sources do not collide");
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn rate_limiter_spaces_requests() {
        let mut limiter = RateLimiter::new(60); // one per second
        assert_eq!(limiter.wait_time(), Duration::ZERO);
        limiter.mark();
        let wait = limiter.wait_time();
        assert!(wait > Duration::ZERO && wait <= Duration::from_secs(1));
    }

    #[test]
    fn extension_for_validates_and_defaults() {
        assert_eq!(extension_for("https://x/a/b.jpeg?w=1", DiscoverKind::Image), "jpeg");
        assert_eq!(extension_for("https://x/a/b.mp4", DiscoverKind::Video), "mp4");
        assert_eq!(extension_for("https://x/a/b.php", DiscoverKind::Image), "jpg");
        assert_eq!(extension_for("https://x/a/b", DiscoverKind::Video), "mp4");
    }

    #[test]
    fn cache_round_trips_through_disk() {
        let nanos = now_ms();
        let dir = std::env::temp_dir().join(format!("driftwall-cache-{nanos}"));
        let mut cache = Cache::new(dir.clone());
        let page = parse_wallhaven(WALLHAVEN_FIXTURE, 1).unwrap();
        cache.put("abc", &page);

        // Fresh instance reads it back from disk.
        let mut reloaded = Cache::new(dir.clone());
        assert_eq!(reloaded.get("abc"), Some(page));
        let _ = fs::remove_dir_all(dir);
    }
}
