//! Discover: browsing remote wallpaper sources.
//!
//! All network access lives in Rust (never the webview). Six sources are
//! supported:
//!
//! | Source          | Kind  | Key                         |
//! |-----------------|-------|-----------------------------|
//! | Wallhaven       | image | none (SFW only, hard-coded) |
//! | Pexels          | image | your own free key           |
//! | Bing Daily      | image | none (unofficial endpoint)  |
//! | NASA APOD       | image | optional (`DEMO_KEY` works) |
//! | Pixabay Videos  | video | your own free key           |
//! | Pexels Videos   | video | your own free key           |
//!
//! [`build_request`] turns a search into a URL plus headers and [`parse_page`]
//! turns the response into a source-agnostic [`DiscoverPage`], so `main.rs`
//! stays a thin shell around one tested code path. Responses are cached for
//! 24 hours and requests are throttled to stay inside each provider's limits.
//!
//! We never bundle or re-host any provider content: downloads stream straight
//! to the user's app data directory, and each item carries attribution.

use std::collections::{HashMap, VecDeque};
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
/// Pexels allows 200 requests/hour (and 20,000/month); we stay under.
pub const PEXELS_PER_HOUR: u32 = 190;
/// Bing has no published limit; stay polite.
pub const BING_PER_MINUTE: u32 = 20;
/// NASA's shared `DEMO_KEY` allows 30 requests/hour per IP.
pub const NASA_PER_HOUR: u32 = 25;

/// Longest we will sleep for a rate limiter before reporting instead.
pub const MAX_RATE_WAIT: Duration = Duration::from_secs(15);

/// Items requested per page.
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
    "Dark",
    "Sci-fi",
    "Fantasy",
    "City",
    "Pixel art",
    "Retro",
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
        "Dark" => Some("dark moody"),
        "Sci-fi" => Some("sci-fi"),
        "Fantasy" => Some("fantasy"),
        "City" => Some("city night"),
        "Pixel art" => Some("pixel art"),
        "Retro" => Some("retrowave"),
        _ => None,
    }
}

/// Wallhaven's `categories` bitmask (general / anime / people).
pub fn wallhaven_categories(category: &str) -> &'static str {
    match category {
        "Anime" => "010",
        "Gaming" => "100",
        _ => "111",
    }
}

/// Which provider an item or search belongs to.
///
/// The serialized names are stable: they are stored on library entries as
/// attribution and sent over the wire to the UI. `pixabay` is accepted as an
/// alias of `pixabay-videos` so entries saved by earlier builds still parse.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Source {
    #[serde(rename = "wallhaven")]
    Wallhaven,
    #[serde(rename = "pexels")]
    Pexels,
    #[serde(rename = "bing")]
    Bing,
    #[serde(rename = "nasa")]
    Nasa,
    #[serde(rename = "pixabay-videos", alias = "pixabay")]
    PixabayVideos,
    #[serde(rename = "pexels-videos")]
    PexelsVideos,
}

impl Source {
    /// Every source, in the order the UI lists them.
    pub const ALL: [Source; 6] = [
        Source::Wallhaven,
        Source::Pexels,
        Source::Bing,
        Source::Nasa,
        Source::PixabayVideos,
        Source::PexelsVideos,
    ];

    /// Stable wire/cache tag.
    pub fn tag(self) -> &'static str {
        match self {
            Source::Wallhaven => "wallhaven",
            Source::Pexels => "pexels",
            Source::Bing => "bing",
            Source::Nasa => "nasa",
            Source::PixabayVideos => "pixabay-videos",
            Source::PexelsVideos => "pexels-videos",
        }
    }

    /// Provider name for messages.
    pub fn provider(self) -> &'static str {
        match self {
            Source::Wallhaven => "Wallhaven",
            Source::Pexels | Source::PexelsVideos => "Pexels",
            Source::Bing => "Bing",
            Source::Nasa => "NASA",
            Source::PixabayVideos => "Pixabay",
        }
    }

    /// Still image or video.
    pub fn kind(self) -> DiscoverKind {
        match self {
            Source::PixabayVideos | Source::PexelsVideos => DiscoverKind::Video,
            _ => DiscoverKind::Image,
        }
    }

    /// Name of the settings entry holding the user's API key, if the source
    /// uses one.
    pub fn key_setting(self) -> Option<&'static str> {
        match self {
            Source::Pexels | Source::PexelsVideos => Some("pexels_api_key"),
            Source::PixabayVideos => Some("pixabay_api_key"),
            Source::Nasa => Some("nasa_api_key"),
            Source::Wallhaven | Source::Bing => None,
        }
    }

    /// Whether browsing needs a key (NASA works without one via `DEMO_KEY`).
    pub fn key_required(self) -> bool {
        matches!(
            self,
            Source::Pexels | Source::PexelsVideos | Source::PixabayVideos
        )
    }

    /// Whether the provider honours free-text search.
    pub fn supports_search(self) -> bool {
        !matches!(self, Source::Bing | Source::Nasa)
    }

    /// Whether the provider honours the sort option.
    pub fn supports_sort(self) -> bool {
        matches!(self, Source::Wallhaven | Source::PixabayVideos)
    }

    /// Group of sources sharing one rate limit (Pexels photos and videos
    /// draw from the same quota).
    fn limit_group(self) -> &'static str {
        match self {
            Source::Pexels | Source::PexelsVideos => "pexels",
            other => other.tag(),
        }
    }
}

/// Capabilities of a source, for the UI. Rust is the source of truth for
/// behaviour (what needs a key, what supports search or sorting); the UI only
/// adds presentation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceInfo {
    pub id: Source,
    pub provider: String,
    pub kind: DiscoverKind,
    /// Settings entry that stores this source's API key, if it has one.
    pub key_setting: Option<String>,
    /// Browsing fails without a key (NASA works keyless via `DEMO_KEY`).
    pub key_required: bool,
    /// A key is currently saved.
    pub has_key: bool,
    pub supports_search: bool,
    pub supports_sort: bool,
}

impl SourceInfo {
    /// Describes `source`; `has_key` says whether the user saved a key for it.
    pub fn new(source: Source, has_key: bool) -> Self {
        Self {
            id: source,
            provider: source.provider().to_string(),
            kind: source.kind(),
            key_setting: source.key_setting().map(str::to_string),
            key_required: source.key_required(),
            has_key,
            supports_search: source.supports_search(),
            supports_sort: source.supports_sort(),
        }
    }
}

/// Describes every source in UI order.
pub fn describe_sources(has_key: impl Fn(Source) -> bool) -> Vec<SourceInfo> {
    Source::ALL
        .iter()
        .map(|source| SourceInfo::new(*source, has_key(*source)))
        .collect()
}

/// Whether a discovered asset is a still image or a video.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscoverKind {
    Image,
    Video,
}

/// Result ordering requested by the UI.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sort {
    #[default]
    Relevance,
    Popular,
    Latest,
    Random,
}

impl Sort {
    fn tag(self) -> &'static str {
        match self {
            Sort::Relevance => "relevance",
            Sort::Popular => "popular",
            Sort::Latest => "latest",
            Sort::Random => "random",
        }
    }
}

/// Optional search refinements chosen in the Discover toolbar.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchOptions {
    #[serde(default)]
    pub sort: Sort,
    /// Prefer dark imagery (great for OLED screens).
    #[serde(default)]
    pub dark: bool,
}

impl SearchOptions {
    /// Drops options a source cannot honour, so cache entries are not
    /// fragmented by settings that change nothing.
    pub fn for_source(self, source: Source) -> SearchOptions {
        SearchOptions {
            sort: if source.supports_sort() { self.sort } else { Sort::Relevance },
            dark: if matches!(source, Source::Bing | Source::Nasa) { false } else { self.dark },
        }
    }
}

/// A downloadable rendition of an item (e.g. Pixabay's small/medium/large
/// encodes, or a Wallhaven "fast preview" fallback).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rendition {
    /// Stable key used by the quality selector (`original`, `preview`, `small`,
    /// `medium`, `large`, ...).
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
    /// Small clip used for hover previews of videos (never the full file).
    #[serde(default)]
    pub preview_url: Option<String>,
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

/* --------------------------------------------------------------- requests */

/// A fully-built provider request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
}

impl Request {
    fn get(url: String) -> Self {
        Self { url, headers: Vec::new() }
    }
}

/// Builds the request for one page of a search. `key` is the user's stored key
/// for the source (if any); `today_days` is the current day count since the
/// Unix epoch (used by NASA's date-ranged API).
pub fn build_request(
    source: Source,
    query: &str,
    category: &str,
    page: u32,
    options: SearchOptions,
    key: Option<&str>,
    today_days: i64,
) -> Result<Request, String> {
    let page = page.max(1);
    let options = options.for_source(source);
    let key = key.map(str::trim).filter(|k| !k.is_empty());

    let need_key = || {
        let noun = match source.kind() {
            DiscoverKind::Image => "photos",
            DiscoverKind::Video => "videos",
        };
        format!(
            "Add a {} API key in Settings to browse {noun}.",
            source.provider()
        )
    };

    Ok(match source {
        Source::Wallhaven => Request::get(wallhaven_url(query, category, page, options)),
        Source::Pexels => Request {
            url: pexels_photos_url(query, category, page, options),
            headers: vec![("Authorization", key.ok_or_else(need_key)?.to_string())],
        },
        Source::PexelsVideos => Request {
            url: pexels_videos_url(query, category, page, options),
            headers: vec![("Authorization", key.ok_or_else(need_key)?.to_string())],
        },
        Source::PixabayVideos => Request::get(pixabay_url(
            query,
            category,
            page,
            options,
            key.ok_or_else(need_key)?,
        )),
        Source::Bing => Request::get(bing_url(page)),
        Source::Nasa => Request::get(nasa_url(page, key.unwrap_or("DEMO_KEY"), today_days)),
    })
}

/// Parses a provider response for `source`.
pub fn parse_page(source: Source, body: &str, requested_page: u32) -> Result<DiscoverPage, String> {
    match source {
        Source::Wallhaven => parse_wallhaven(body, requested_page),
        Source::Pexels => parse_pexels_photos(body, requested_page),
        Source::PexelsVideos => parse_pexels_videos(body, requested_page),
        Source::PixabayVideos => parse_pixabay(body, requested_page),
        Source::Bing => parse_bing(body, requested_page),
        Source::Nasa => parse_nasa(body, requested_page),
    }
}

/// Builds the Wallhaven search URL. `purity=100` (SFW only) is hard-coded.
pub fn wallhaven_url(query: &str, category: &str, page: u32, options: SearchOptions) -> String {
    let user_query = query.trim();
    // Browsing "Anime" with no query is best served by Wallhaven's own
    // category filter rather than a text match on the word "anime".
    let q = if !user_query.is_empty() {
        user_query.to_string()
    } else if category == "Anime" {
        String::new()
    } else {
        category_query(category).unwrap_or("").to_string()
    };

    let mut params: Vec<String> = vec![
        "purity=100".to_string(),
        format!("categories={}", wallhaven_categories(category)),
        "atleast=1920x1080".to_string(),
        "ratios=landscape".to_string(),
        format!("page={}", page.max(1)),
    ];
    if !q.is_empty() {
        params.push(format!("q={}", encode(&q)));
    }
    if options.dark {
        params.push("colors=000000".to_string());
    }
    match options.sort {
        Sort::Random => params.push("sorting=random".to_string()),
        Sort::Latest => params.push("sorting=date_added".to_string()),
        Sort::Popular => {
            params.push("sorting=toplist".to_string());
            params.push("topRange=1M".to_string());
        }
        Sort::Relevance => {
            if q.is_empty() {
                params.push("sorting=toplist".to_string());
                params.push("topRange=1M".to_string());
            } else {
                params.push("sorting=relevance".to_string());
            }
        }
    }
    format!("https://wallhaven.cc/api/v1/search?{}", params.join("&"))
}

/// Builds the Pixabay video search URL (`video_type=animation`).
pub fn pixabay_url(
    query: &str,
    category: &str,
    page: u32,
    options: SearchOptions,
    api_key: &str,
) -> String {
    let q = with_dark(&effective_query(query, category), options.dark);
    let mut params = vec![
        format!("key={}", encode(api_key)),
        format!("q={}", encode(&q)),
        "video_type=animation".to_string(),
        "safesearch=true".to_string(),
        format!("per_page={PER_PAGE}"),
        format!("page={}", page.max(1)),
    ];
    if options.sort == Sort::Latest {
        params.push("order=latest".to_string());
    }
    format!("https://pixabay.com/api/videos/?{}", params.join("&"))
}

/// Builds the Pexels photo search URL (landscape, large). With no query and
/// no category the curated feed is used instead.
pub fn pexels_photos_url(query: &str, category: &str, page: u32, options: SearchOptions) -> String {
    let q = with_dark(&effective_query(query, category), options.dark);
    if q.is_empty() {
        return format!(
            "https://api.pexels.com/v1/curated?per_page={PER_PAGE}&page={}",
            page.max(1)
        );
    }
    format!(
        "https://api.pexels.com/v1/search?query={}&orientation=landscape&size=large&per_page={PER_PAGE}&page={}",
        encode(&q),
        page.max(1)
    )
}

/// Builds the Pexels video search URL (landscape). With no query and no
/// category the popular feed is used, limited to Full HD and up.
pub fn pexels_videos_url(query: &str, category: &str, page: u32, options: SearchOptions) -> String {
    let q = with_dark(&effective_query(query, category), options.dark);
    if q.is_empty() {
        return format!(
            "https://api.pexels.com/v1/videos/popular?min_width=1920&per_page={PER_PAGE}&page={}",
            page.max(1)
        );
    }
    format!(
        "https://api.pexels.com/v1/videos/search?query={}&orientation=landscape&size=large&per_page={PER_PAGE}&page={}",
        encode(&q),
        page.max(1)
    )
}

/// Bing's market list. Each market serves its own last-eight-days set, so one
/// market per page gives an effectively endless daily feed.
pub const BING_MARKETS: &[&str] = &[
    "en-US", "en-GB", "ja-JP", "de-DE", "fr-FR", "en-AU", "en-IN", "zh-CN", "pt-BR", "es-ES",
    "it-IT", "en-CA",
];

/// Builds the Bing daily-image URL for a page (one market per page).
pub fn bing_url(page: u32) -> String {
    let index = (page.max(1) as usize - 1).min(BING_MARKETS.len() - 1);
    format!(
        "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt={}&uhd=1&uhdwidth=3840&uhdheight=2160",
        BING_MARKETS[index]
    )
}

/// First day NASA's APOD archive covers (1995-06-16), as a Unix day count.
pub fn apod_first_day() -> i64 {
    days_from_civil(1995, 6, 16)
}

/// Inclusive `(start, end)` day range for an APOD page (newest page first).
/// The end is yesterday, because "today's" picture is not always published yet
/// in NASA's timezone.
pub fn apod_range(page: u32, today_days: i64) -> (i64, i64) {
    let end = today_days - 1 - i64::from(page.saturating_sub(1)) * i64::from(PER_PAGE);
    let start = end - (i64::from(PER_PAGE) - 1);
    (start.max(apod_first_day()), end)
}

/// Builds the NASA APOD URL for a page.
pub fn nasa_url(page: u32, api_key: &str, today_days: i64) -> String {
    let (start, end) = apod_range(page, today_days);
    format!(
        "https://api.nasa.gov/planetary/apod?api_key={}&start_date={}&end_date={}",
        encode(api_key),
        format_date(start),
        format_date(end)
    )
}

fn effective_query(query: &str, category: &str) -> String {
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    category_query(category).unwrap_or("").to_string()
}

/// Appends "dark" to a query when the dark option is on and it is not there.
fn with_dark(query: &str, dark: bool) -> String {
    if !dark || query.to_lowercase().contains("dark") {
        return query.to_string();
    }
    if query.is_empty() {
        "dark".to_string()
    } else {
        format!("{query} dark")
    }
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

/* -------------------------------------------------------------- calendar */

/// Days since 1970-01-01 for a proleptic Gregorian date.
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of [`days_from_civil`].
pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn format_date(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Current day count since the Unix epoch (UTC).
pub fn today_days() -> i64 {
    (now_ms() / 86_400_000) as i64
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
                preview_url: None,
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
            // Hover previews use the lightest encode, never the full file.
            let preview = video
                .videos
                .tiny
                .as_ref()
                .or(video.videos.small.as_ref())
                .map(|v| v.url.clone());
            Some(DiscoverItem {
                id: format!("pixabay-{}", video.id),
                source: Source::PixabayVideos,
                kind: DiscoverKind::Video,
                title: first_tag(&video.tags).unwrap_or_else(|| format!("Pixabay {}", video.id)),
                thumb_url: thumb,
                full_url: default.url.clone(),
                preview_url: preview,
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

#[derive(Deserialize)]
struct PexelsPhotosResponse {
    #[serde(default)]
    photos: Vec<PexelsPhoto>,
    #[serde(default)]
    next_page: Option<String>,
}

#[derive(Deserialize)]
struct PexelsPhoto {
    id: i64,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    url: String,
    #[serde(default)]
    photographer: String,
    #[serde(default)]
    alt: String,
    #[serde(default)]
    src: PexelsSrc,
}

#[derive(Default, Deserialize)]
struct PexelsSrc {
    #[serde(default)]
    original: String,
    #[serde(default)]
    large2x: String,
    #[serde(default)]
    large: String,
    #[serde(default)]
    medium: String,
    #[serde(default)]
    landscape: String,
}

/// Parses a Pexels photo search (or curated) response.
pub fn parse_pexels_photos(body: &str, requested_page: u32) -> Result<DiscoverPage, String> {
    let parsed: PexelsPhotosResponse =
        serde_json::from_str(body).map_err(|e| format!("Unexpected Pexels response: {e}"))?;

    let items = parsed
        .photos
        .into_iter()
        .filter_map(|photo| {
            let full = if photo.src.original.is_empty() {
                photo.src.large2x.clone()
            } else {
                photo.src.original.clone()
            };
            if full.is_empty() {
                return None;
            }
            let mut renditions = Vec::new();
            let mut original = Rendition::new("original", "Original", full.clone(), photo.width, photo.height);
            original.default = true;
            renditions.push(original);
            if !photo.src.large2x.is_empty() && photo.src.large2x != full {
                renditions.push(Rendition::new(
                    "preview",
                    "Fast (2K)",
                    photo.src.large2x.clone(),
                    None,
                    None,
                ));
            }
            let title = shorten(photo.alt.trim(), 60);
            Some(DiscoverItem {
                id: format!("pexels-{}", photo.id),
                source: Source::Pexels,
                kind: DiscoverKind::Image,
                title: if title.is_empty() {
                    format!("Pexels photo {}", photo.id)
                } else {
                    title
                },
                thumb_url: first_non_empty(&[
                    &photo.src.medium,
                    &photo.src.landscape,
                    &photo.src.large,
                    &full,
                ]),
                full_url: full,
                preview_url: None,
                width: photo.width,
                height: photo.height,
                duration: None,
                author: non_empty(photo.photographer.trim()),
                source_url: non_empty(&photo.url),
                renditions,
            })
        })
        .collect();

    Ok(DiscoverPage {
        items,
        page: requested_page,
        has_more: parsed.next_page.is_some(),
    })
}

#[derive(Deserialize)]
struct PexelsVideosResponse {
    #[serde(default)]
    videos: Vec<PexelsVideo>,
    #[serde(default)]
    next_page: Option<String>,
}

#[derive(Deserialize)]
struct PexelsVideo {
    id: i64,
    #[serde(default)]
    url: String,
    #[serde(default)]
    image: String,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    user: Option<PexelsUser>,
    #[serde(default)]
    video_files: Vec<PexelsVideoFile>,
}

#[derive(Deserialize)]
struct PexelsUser {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct PexelsVideoFile {
    #[serde(default)]
    file_type: String,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    link: String,
}

/// Parses a Pexels video search (or popular) response.
pub fn parse_pexels_videos(body: &str, requested_page: u32) -> Result<DiscoverPage, String> {
    let parsed: PexelsVideosResponse =
        serde_json::from_str(body).map_err(|e| format!("Unexpected Pexels response: {e}"))?;

    let items = parsed
        .videos
        .into_iter()
        .filter_map(|video| {
            let renditions = pexels_video_renditions(&video.video_files);
            let default = renditions.iter().find(|r| r.default)?.clone();
            // Smallest encode drives the hover preview.
            let preview = renditions
                .iter()
                .min_by_key(|r| r.width.unwrap_or(u32::MAX))
                .map(|r| r.url.clone())
                .filter(|url| *url != default.url);
            Some(DiscoverItem {
                id: format!("pexels-video-{}", video.id),
                source: Source::PexelsVideos,
                kind: DiscoverKind::Video,
                title: title_from_slug(&video.url)
                    .unwrap_or_else(|| format!("Pexels video {}", video.id)),
                thumb_url: if video.image.is_empty() {
                    default.url.clone()
                } else {
                    video.image.clone()
                },
                full_url: default.url.clone(),
                preview_url: preview,
                width: default.width,
                height: default.height,
                duration: video.duration,
                author: video
                    .user
                    .as_ref()
                    .and_then(|u| non_empty(u.name.trim())),
                source_url: non_empty(&video.url),
                renditions,
            })
        })
        .collect();

    Ok(DiscoverPage {
        items,
        page: requested_page,
        has_more: parsed.next_page.is_some(),
    })
}

/// Landscape MP4 files of a Pexels video, widest first; the encode closest to
/// 1080p is the default.
fn pexels_video_renditions(files: &[PexelsVideoFile]) -> Vec<Rendition> {
    let mut usable: Vec<(u32, u32, &PexelsVideoFile)> = files
        .iter()
        .filter(|f| !f.link.is_empty() && (f.file_type == "video/mp4" || f.link.contains(".mp4")))
        .filter_map(|f| match (f.width, f.height) {
            (Some(w), Some(h)) if w >= h && w > 0 => Some((w, h, f)),
            _ => None,
        })
        .collect();
    usable.sort_by(|a, b| b.0.cmp(&a.0));
    usable.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);

    let mut out: Vec<Rendition> = usable
        .into_iter()
        .map(|(w, h, f)| {
            let label = if h >= 2000 { "4K".to_string() } else { format!("{h}p") };
            Rendition::new(&format!("{h}p"), &label, f.link.clone(), Some(w), Some(h))
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

#[derive(Deserialize)]
struct BingResponse {
    #[serde(default)]
    images: Vec<BingImage>,
}

#[derive(Deserialize)]
struct BingImage {
    #[serde(default)]
    urlbase: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    copyright: String,
    #[serde(default)]
    copyrightlink: String,
    #[serde(default)]
    hsh: String,
    #[serde(default)]
    startdate: String,
}

/// Parses Bing's daily-image response (one market per page).
pub fn parse_bing(body: &str, requested_page: u32) -> Result<DiscoverPage, String> {
    let parsed: BingResponse =
        serde_json::from_str(body).map_err(|e| format!("Unexpected Bing response: {e}"))?;

    let items = parsed
        .images
        .into_iter()
        .filter(|img| !img.urlbase.is_empty())
        .map(|img| {
            let base = if img.urlbase.starts_with("http") {
                img.urlbase.clone()
            } else {
                format!("https://www.bing.com{}", img.urlbase)
            };
            let id = if img.hsh.is_empty() {
                format!("bing-{}-{:08x}", img.startdate, fnv1a64(img.urlbase.as_bytes()) as u32)
            } else {
                format!("bing-{}", img.hsh)
            };
            let copyright = img.copyright.trim().to_string();
            let title = if img.title.trim().is_empty() {
                copyright.split(" (").next().unwrap_or("Bing daily").to_string()
            } else {
                img.title.trim().to_string()
            };
            let uhd = format!("{base}_UHD.jpg");
            let fhd = format!("{base}_1920x1080.jpg");
            let mut best = Rendition::new("uhd", "4K", uhd.clone(), Some(3840), Some(2160));
            best.default = true;
            DiscoverItem {
                id,
                source: Source::Bing,
                kind: DiscoverKind::Image,
                title,
                thumb_url: format!("{base}_1280x720.jpg"),
                full_url: uhd,
                preview_url: None,
                width: Some(3840),
                height: Some(2160),
                duration: None,
                author: bing_credit(&copyright),
                source_url: non_empty(&img.copyrightlink),
                renditions: vec![
                    best,
                    Rendition::new("fhd", "1080p", fhd, Some(1920), Some(1080)),
                ],
            }
        })
        .collect();

    Ok(DiscoverPage {
        items,
        page: requested_page,
        has_more: (requested_page as usize) < BING_MARKETS.len(),
    })
}

/// "Place (© Photographer/Agency)" -> "Photographer/Agency".
fn bing_credit(copyright: &str) -> Option<String> {
    if copyright.is_empty() {
        return None;
    }
    if let Some(start) = copyright.find("(©") {
        let rest = &copyright[start + "(©".len()..];
        let credit = rest.split(')').next().unwrap_or(rest).trim();
        if !credit.is_empty() {
            return Some(credit.to_string());
        }
    }
    Some(copyright.to_string())
}

#[derive(Deserialize)]
struct NasaEntry {
    #[serde(default)]
    date: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    media_type: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    hdurl: Option<String>,
    #[serde(default)]
    copyright: Option<String>,
}

/// Parses a NASA Astronomy Picture of the Day response. Videos are skipped.
pub fn parse_nasa(body: &str, requested_page: u32) -> Result<DiscoverPage, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("Unexpected NASA response: {e}"))?;

    // NASA reports problems as `{"error": {"message": ...}}` or `{"msg": ...}`.
    let problem = value
        .get("error")
        .and_then(|e| e.get("message"))
        .or_else(|| value.get("msg"))
        .and_then(|m| m.as_str());
    if let Some(message) = problem {
        return Err(format!("NASA: {message}"));
    }

    let entries: Vec<NasaEntry> = match value {
        serde_json::Value::Array(_) => serde_json::from_value(value),
        serde_json::Value::Object(_) => serde_json::from_value(value).map(|e| vec![e]),
        _ => return Err("Unexpected NASA response".to_string()),
    }
    .map_err(|e| format!("Unexpected NASA response: {e}"))?;

    let returned = entries.len();
    let mut images: Vec<NasaEntry> = entries
        .into_iter()
        .filter(|e| e.media_type == "image" && !e.url.is_empty())
        .collect();
    images.sort_by(|a, b| b.date.cmp(&a.date)); // newest first

    let items = images
        .into_iter()
        .map(|e| {
            let hd = e.hdurl.clone().filter(|u| !u.is_empty());
            let full = hd.clone().unwrap_or_else(|| e.url.clone());
            let mut renditions = vec![{
                let mut r = Rendition::new(
                    "hd",
                    if hd.is_some() { "HD" } else { "Standard" },
                    full.clone(),
                    None,
                    None,
                );
                r.default = true;
                r
            }];
            if hd.is_some() && e.url != full {
                renditions.push(Rendition::new("standard", "Standard", e.url.clone(), None, None));
            }
            DiscoverItem {
                id: format!("nasa-{}", e.date),
                source: Source::Nasa,
                kind: DiscoverKind::Image,
                title: e.title.trim().to_string(),
                thumb_url: e.url.clone(),
                full_url: full,
                preview_url: None,
                width: None,
                height: None,
                duration: None,
                author: Some(
                    e.copyright
                        .as_deref()
                        .map(collapse_whitespace)
                        .filter(|c| !c.is_empty())
                        .unwrap_or_else(|| "NASA APOD".to_string()),
                ),
                source_url: apod_page_url(&e.date),
                renditions,
            }
        })
        .collect();

    Ok(DiscoverPage {
        items,
        page: requested_page,
        // A full window means older pictures exist; the last page is short.
        has_more: returned >= PER_PAGE as usize,
    })
}

/// "2026-10-17" -> "https://apod.nasa.gov/apod/ap261017.html".
fn apod_page_url(date: &str) -> Option<String> {
    let mut parts = date.split('-');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    Some(format!("https://apod.nasa.gov/apod/ap{}{m}{d}.html", &y[2..]))
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
            variant
                .as_ref()
                .filter(|v| !v.url.is_empty())
                .map(|v| Rendition::new(key, label, v.url.clone(), v.width, v.height))
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

/// "https://www.pexels.com/video/calm-sea-at-dusk-123456/" -> "Calm sea at dusk".
fn title_from_slug(url: &str) -> Option<String> {
    let slug = url.trim_end_matches('/').rsplit('/').next()?;
    let words: Vec<&str> = slug.split('-').collect();
    let trimmed: Vec<&str> = match words.split_last() {
        Some((last, rest)) if !rest.is_empty() && last.chars().all(|c| c.is_ascii_digit()) => {
            rest.to_vec()
        }
        _ => words,
    };
    let title = trimmed.join(" ");
    if title.trim().is_empty() {
        None
    } else {
        Some(capitalize(title.trim()))
    }
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn shorten(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let cut: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
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

/// Stable cache key for a search (FNV-1a, hex-encoded). Options a source
/// cannot honour are dropped so they do not fragment the cache.
pub fn cache_key(
    source: Source,
    query: &str,
    category: &str,
    page: u32,
    options: SearchOptions,
) -> String {
    let options = options.for_source(source);
    let material = format!(
        "{}|{}|{category}|{page}|{}|{}",
        source.tag(),
        query.trim().to_lowercase(),
        options.sort.tag(),
        options.dark
    );
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
            if is_fresh(entry.saved_ms) {
                return Some(entry.page.clone());
            }
            self.memory.remove(key);
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

/// A sliding-window limiter: at most `max` requests inside any `window`.
pub struct RateLimiter {
    max: usize,
    window: Duration,
    hits: VecDeque<Instant>,
}

impl RateLimiter {
    /// Creates a limiter that allows `per_minute` requests per minute.
    pub fn new(per_minute: u32) -> Self {
        Self::with_window(per_minute, Duration::from_secs(60))
    }

    /// Creates a limiter allowing `max` requests per `window`.
    pub fn with_window(max: u32, window: Duration) -> Self {
        Self {
            max: max.max(1) as usize,
            window,
            hits: VecDeque::new(),
        }
    }

    /// Time to wait before the next request may be issued.
    pub fn wait_time(&self) -> Duration {
        let recent: Vec<&Instant> = self
            .hits
            .iter()
            .filter(|t| t.elapsed() < self.window)
            .collect();
        if recent.len() < self.max {
            return Duration::ZERO;
        }
        // The request that frees a slot is the `max`-th most recent one.
        let blocking = recent[recent.len() - self.max];
        self.window.saturating_sub(blocking.elapsed())
    }

    /// Records that a request was just issued.
    pub fn mark(&mut self) {
        let now = Instant::now();
        while self
            .hits
            .front()
            .map(|t| now.duration_since(*t) >= self.window)
            .unwrap_or(false)
        {
            self.hits.pop_front();
        }
        self.hits.push_back(now);
    }
}

/// Friendly message for when a limiter asks for a long wait.
pub fn rate_limit_message(source: Source, wait: Duration) -> String {
    let secs = wait.as_secs().max(1);
    let when = if secs >= 90 {
        format!("{} min", (secs + 59) / 60)
    } else {
        format!("{secs} s")
    };
    format!(
        "{} rate limit reached. Try again in about {when}.",
        source.provider()
    )
}

/// Shared Discover state managed by Tauri.
pub struct Discover {
    pub cache: Cache,
    limiters: HashMap<&'static str, RateLimiter>,
}

impl Discover {
    /// Builds the state rooted at a cache directory.
    pub fn new(cache_dir: PathBuf) -> Self {
        let hour = Duration::from_secs(3600);
        let mut limiters = HashMap::new();
        limiters.insert("wallhaven", RateLimiter::new(WALLHAVEN_PER_MINUTE));
        limiters.insert("pixabay-videos", RateLimiter::new(PIXABAY_PER_MINUTE));
        limiters.insert("pexels", RateLimiter::with_window(PEXELS_PER_HOUR, hour));
        limiters.insert("bing", RateLimiter::new(BING_PER_MINUTE));
        limiters.insert("nasa", RateLimiter::with_window(NASA_PER_HOUR, hour));
        Self {
            cache: Cache::new(cache_dir),
            limiters,
        }
    }

    /// Rate limiter for a source.
    pub fn limiter(&self, source: Source) -> &RateLimiter {
        &self.limiters[source.limit_group()]
    }

    /// Records a request against the source's limiter.
    pub fn mark(&mut self, source: Source) {
        if let Some(limiter) = self.limiters.get_mut(source.limit_group()) {
            limiter.mark();
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

    const PEXELS_PHOTOS_FIXTURE: &str = r#"{
      "page": 1, "per_page": 24, "total_results": 200,
      "next_page": "https://api.pexels.com/v1/search/?page=2&per_page=24&query=night",
      "photos": [
        {
          "id": 3573351, "width": 5472, "height": 3648,
          "url": "https://www.pexels.com/photo/city-night-3573351/",
          "photographer": "Jane Doe",
          "alt": "A neon-lit street in the city at night with light trails and reflections on wet asphalt",
          "src": {
            "original": "https://images.pexels.com/photos/3573351/pexels-photo-3573351.jpeg",
            "large2x": "https://images.pexels.com/photos/3573351/pexels-photo-3573351.jpeg?w=940&dpr=2",
            "large": "https://images.pexels.com/photos/3573351/pexels-photo-3573351.jpeg?w=940",
            "medium": "https://images.pexels.com/photos/3573351/pexels-photo-3573351.jpeg?h=350",
            "landscape": "https://images.pexels.com/photos/3573351/pexels-photo-3573351.jpeg?h=627&w=1200"
          }
        },
        { "id": 9, "width": 100, "height": 100, "url": "", "photographer": "", "alt": "", "src": {} }
      ]
    }"#;

    const PEXELS_VIDEOS_FIXTURE: &str = r#"{
      "page": 1, "per_page": 24, "total_results": 40, "next_page": null,
      "videos": [
        {
          "id": 856789, "width": 4096, "height": 2160,
          "url": "https://www.pexels.com/video/calm-sea-at-dusk-856789/",
          "image": "https://images.pexels.com/videos/856789/pictures/preview-0.jpg",
          "duration": 18,
          "user": { "id": 1, "name": "Sam Lee", "url": "https://www.pexels.com/@sam" },
          "video_files": [
            { "id": 1, "quality": "uhd", "file_type": "video/mp4", "width": 3840, "height": 2160, "link": "https://videos.pexels.com/a/uhd.mp4" },
            { "id": 2, "quality": "hd",  "file_type": "video/mp4", "width": 1920, "height": 1080, "link": "https://videos.pexels.com/a/hd.mp4" },
            { "id": 3, "quality": "sd",  "file_type": "video/mp4", "width": 960,  "height": 540,  "link": "https://videos.pexels.com/a/sd.mp4" },
            { "id": 4, "quality": "hd",  "file_type": "video/mp4", "width": 1080, "height": 1920, "link": "https://videos.pexels.com/a/portrait.mp4" },
            { "id": 5, "quality": "hls", "file_type": "application/x-mpegURL", "width": null, "height": null, "link": "https://videos.pexels.com/a/stream.m3u8" }
          ]
        },
        { "id": 2, "url": "", "image": "", "duration": 5, "user": null, "video_files": [] }
      ]
    }"#;

    const BING_FIXTURE: &str = r#"{
      "images": [
        {
          "startdate": "20261017", "hsh": "abc123",
          "url": "/th?id=OHR.Fjord_EN-US123_1920x1080.jpg&rf=x&pid=hp",
          "urlbase": "/th?id=OHR.Fjord_EN-US123",
          "copyright": "Geirangerfjord, Norway (© Jane Smith/Getty Images)",
          "copyrightlink": "https://www.bing.com/search?q=fjord",
          "title": "Silence of the fjord"
        },
        { "startdate": "20261016", "hsh": "", "urlbase": "", "title": "no base" }
      ]
    }"#;

    const NASA_FIXTURE: &str = r#"[
      { "date": "2026-10-15", "title": "A Spiral Galaxy", "media_type": "image",
        "url": "https://apod.nasa.gov/apod/image/2610/galaxy_1024.jpg",
        "hdurl": "https://apod.nasa.gov/apod/image/2610/galaxy_4k.jpg",
        "copyright": "\nAlex   Rivera\n" },
      { "date": "2026-10-16", "title": "A Launch", "media_type": "video",
        "url": "https://www.youtube.com/embed/xyz" },
      { "date": "2026-10-17", "title": "Moon over Dunes", "media_type": "image",
        "url": "https://apod.nasa.gov/apod/image/2610/moon.jpg" }
    ]"#;

    fn opts() -> SearchOptions {
        SearchOptions::default()
    }

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
        assert_eq!(first.source, Source::PixabayVideos);
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
    fn pixabay_hover_preview_uses_the_lightest_clip_not_the_full_file() {
        let page = parse_pixabay(PIXABAY_FIXTURE, 1).unwrap();
        let first = &page.items[0];
        assert_eq!(
            first.preview_url.as_deref(),
            Some("https://cdn.pixabay.com/video/1/2/tiny.mp4")
        );
        assert_ne!(first.preview_url.as_deref(), Some(first.full_url.as_str()));
        // A clip with only a medium encode has no lighter preview.
        assert_eq!(page.items[1].preview_url, None);
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
    fn parses_pexels_photos() {
        let page = parse_pexels_photos(PEXELS_PHOTOS_FIXTURE, 1).unwrap();
        assert!(page.has_more, "next_page present");
        // The entry without any image source is dropped.
        assert_eq!(page.items.len(), 1);

        let item = &page.items[0];
        assert_eq!(item.id, "pexels-3573351");
        assert_eq!(item.source, Source::Pexels);
        assert_eq!(item.kind, DiscoverKind::Image);
        assert_eq!(item.author.as_deref(), Some("Jane Doe"));
        assert_eq!(
            item.source_url.as_deref(),
            Some("https://www.pexels.com/photo/city-night-3573351/")
        );
        assert!(item.title.chars().count() <= 60, "long alt text is shortened");
        assert!(item.title.ends_with('…'));
        assert!(item.thumb_url.ends_with("?h=350"), "medium is the grid thumb");
        assert_eq!(item.width, Some(5472));

        let keys: Vec<&str> = item.renditions.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, ["original", "preview"]);
        assert!(item.renditions[0].default);
        assert_eq!(item.full_url, item.renditions[0].url);
        assert!(item.renditions[1].url.contains("dpr=2"));
    }

    #[test]
    fn pexels_photos_last_page_has_no_more() {
        let last = r#"{ "photos": [], "next_page": null }"#;
        let page = parse_pexels_photos(last, 4).unwrap();
        assert!(!page.has_more);
        assert!(page.items.is_empty());
    }

    #[test]
    fn parses_pexels_videos_with_sensible_renditions() {
        let page = parse_pexels_videos(PEXELS_VIDEOS_FIXTURE, 1).unwrap();
        // No downloadable landscape mp4 -> the second entry is dropped.
        assert_eq!(page.items.len(), 1);
        assert!(!page.has_more, "next_page is null");

        let item = &page.items[0];
        assert_eq!(item.id, "pexels-video-856789");
        assert_eq!(item.source, Source::PexelsVideos);
        assert_eq!(item.kind, DiscoverKind::Video);
        assert_eq!(item.title, "Calm sea at dusk");
        assert_eq!(item.author.as_deref(), Some("Sam Lee"));
        assert_eq!(item.duration, Some(18.0));
        assert_eq!(
            item.thumb_url,
            "https://images.pexels.com/videos/856789/pictures/preview-0.jpg"
        );

        // Portrait file and HLS stream are excluded; widest first.
        let labels: Vec<&str> = item.renditions.iter().map(|r| r.label.as_str()).collect();
        assert_eq!(labels, ["4K", "1080p", "540p"]);

        // 1080p is closest to 1920 wide, so it is the default, not 4K.
        let default = item.renditions.iter().find(|r| r.default).unwrap();
        assert_eq!(default.key, "1080p");
        assert_eq!(item.full_url, "https://videos.pexels.com/a/hd.mp4");

        // Hover preview is the smallest encode, never the full file.
        assert_eq!(item.preview_url.as_deref(), Some("https://videos.pexels.com/a/sd.mp4"));
    }

    #[test]
    fn parses_bing_daily_images() {
        let page = parse_bing(BING_FIXTURE, 1).unwrap();
        assert_eq!(page.items.len(), 1, "entry without urlbase is skipped");
        assert!(page.has_more, "more markets available");

        let item = &page.items[0];
        assert_eq!(item.id, "bing-abc123");
        assert_eq!(item.source, Source::Bing);
        assert_eq!(item.title, "Silence of the fjord");
        assert_eq!(item.author.as_deref(), Some("Jane Smith/Getty Images"));
        assert_eq!(
            item.full_url,
            "https://www.bing.com/th?id=OHR.Fjord_EN-US123_UHD.jpg"
        );
        assert_eq!(
            item.thumb_url,
            "https://www.bing.com/th?id=OHR.Fjord_EN-US123_1280x720.jpg"
        );
        let keys: Vec<&str> = item.renditions.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, ["uhd", "fhd"]);
        assert_eq!(item.renditions[1].url, "https://www.bing.com/th?id=OHR.Fjord_EN-US123_1920x1080.jpg");

        // The last market has nothing after it.
        let last = parse_bing(BING_FIXTURE, BING_MARKETS.len() as u32).unwrap();
        assert!(!last.has_more);
    }

    #[test]
    fn bing_uses_one_market_per_page_and_clamps() {
        assert!(bing_url(1).contains("mkt=en-US"));
        assert!(bing_url(2).contains("mkt=en-GB"));
        assert!(bing_url(3).contains("mkt=ja-JP"));
        assert!(bing_url(999).contains("mkt=en-CA"), "clamped to the last market");
        assert!(bing_url(0).contains("mkt=en-US"));
        assert!(bing_url(1).contains("n=8"));
    }

    #[test]
    fn bing_credit_extracts_the_photographer() {
        assert_eq!(bing_credit("Place (© Ann/Agency)").as_deref(), Some("Ann/Agency"));
        assert_eq!(bing_credit("Just a caption").as_deref(), Some("Just a caption"));
        assert_eq!(bing_credit(""), None);
    }

    #[test]
    fn parses_nasa_apod_newest_first_and_skips_videos() {
        let page = parse_nasa(NASA_FIXTURE, 1).unwrap();
        let ids: Vec<&str> = page.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["nasa-2026-10-17", "nasa-2026-10-15"], "video skipped, newest first");
        assert!(!page.has_more, "3 entries < a full 24-day window");

        let galaxy = &page.items[1];
        assert_eq!(galaxy.title, "A Spiral Galaxy");
        assert_eq!(galaxy.full_url, "https://apod.nasa.gov/apod/image/2610/galaxy_4k.jpg");
        assert_eq!(galaxy.thumb_url, "https://apod.nasa.gov/apod/image/2610/galaxy_1024.jpg");
        assert_eq!(galaxy.author.as_deref(), Some("Alex Rivera"), "whitespace collapsed");
        assert_eq!(
            galaxy.source_url.as_deref(),
            Some("https://apod.nasa.gov/apod/ap261015.html")
        );
        assert_eq!(galaxy.renditions.len(), 2);

        // No hdurl and no credit fall back sensibly.
        let moon = &page.items[0];
        assert_eq!(moon.full_url, moon.thumb_url);
        assert_eq!(moon.author.as_deref(), Some("NASA APOD"));
        assert_eq!(moon.renditions.len(), 1);
        assert_eq!(moon.renditions[0].label, "Standard");
    }

    #[test]
    fn nasa_reports_api_errors_and_a_full_window_means_more() {
        let err = parse_nasa(r#"{"error":{"code":"OVER_RATE_LIMIT","message":"Slow down"}}"#, 1)
            .unwrap_err();
        assert!(err.contains("Slow down"), "{err}");
        let err = parse_nasa(r#"{"code":400,"msg":"Date must be between"}"#, 1).unwrap_err();
        assert!(err.contains("Date must be between"));

        let entries: Vec<String> = (0..PER_PAGE)
            .map(|i| {
                format!(
                    r#"{{"date":"2026-09-{:02}","title":"t{i}","media_type":"image","url":"https://x/{i}.jpg"}}"#,
                    i + 1
                )
            })
            .collect();
        let body = format!("[{}]", entries.join(","));
        assert!(parse_nasa(&body, 1).unwrap().has_more);
    }

    #[test]
    fn calendar_math_round_trips() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        for days in [-10_000_i64, -1, 0, 1, 9_297, 11_016, 20_000, 24_000] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days, "{y}-{m}-{d}");
        }
        assert_eq!(format_date(days_from_civil(2026, 10, 7)), "2026-10-07");
    }

    #[test]
    fn apod_ranges_walk_backwards_and_stop_at_the_archive_start() {
        let today = days_from_civil(2026, 10, 18);
        let (s1, e1) = apod_range(1, today);
        assert_eq!(format_date(e1), "2026-10-17", "ends yesterday, not today");
        assert_eq!(e1 - s1 + 1, i64::from(PER_PAGE));
        let (s2, e2) = apod_range(2, today);
        assert_eq!(e2, s1 - 1, "pages are contiguous");
        assert_eq!(e2 - s2 + 1, i64::from(PER_PAGE));
        // Far past the archive start the start is clamped.
        let (start, _) = apod_range(10_000, today);
        assert_eq!(start, apod_first_day());

        let url = nasa_url(1, "DEMO_KEY", today);
        assert!(url.contains("api_key=DEMO_KEY"));
        assert!(url.contains("end_date=2026-10-17"));
        assert!(url.contains("start_date=2026-09-24"), "{url}");
    }

    #[test]
    fn malformed_bodies_are_errors() {
        assert!(parse_wallhaven("{ not json", 1).is_err());
        assert!(parse_pixabay("<html>", 1).is_err());
        assert!(parse_pexels_photos("nope", 1).is_err());
        assert!(parse_pexels_videos("", 1).is_err());
        assert!(parse_bing("<html></html>", 1).is_err());
        assert!(parse_nasa("not json", 1).is_err());
        assert!(parse_nasa("42", 1).is_err());
    }

    #[test]
    fn parse_page_dispatches_to_the_right_parser() {
        assert_eq!(
            parse_page(Source::Wallhaven, WALLHAVEN_FIXTURE, 1).unwrap().items[0].source,
            Source::Wallhaven
        );
        assert_eq!(
            parse_page(Source::PixabayVideos, PIXABAY_FIXTURE, 1).unwrap().items[0].source,
            Source::PixabayVideos
        );
        assert_eq!(
            parse_page(Source::Pexels, PEXELS_PHOTOS_FIXTURE, 1).unwrap().items[0].source,
            Source::Pexels
        );
        assert_eq!(
            parse_page(Source::PexelsVideos, PEXELS_VIDEOS_FIXTURE, 1).unwrap().items[0].source,
            Source::PexelsVideos
        );
        assert_eq!(
            parse_page(Source::Bing, BING_FIXTURE, 1).unwrap().items[0].source,
            Source::Bing
        );
        assert_eq!(
            parse_page(Source::Nasa, NASA_FIXTURE, 1).unwrap().items[0].source,
            Source::Nasa
        );
    }

    #[test]
    fn wallhaven_url_carries_safe_defaults() {
        let wh = wallhaven_url("cats", "", 2, opts());
        assert!(wh.contains("purity=100"), "SFW only");
        assert!(wh.contains("page=2"));
        assert!(wh.contains("q=cats"));
        assert!(wh.contains("sorting=relevance"));
        assert!(wh.contains("ratios=landscape"));
        assert!(wh.contains("atleast=1920x1080"));
        assert!(!wh.contains("purity=110") && !wh.contains("purity=111"));
    }

    #[test]
    fn wallhaven_categories_and_sorting() {
        // Anime with no query uses the category filter, not a text match.
        let anime = wallhaven_url("", "Anime", 1, opts());
        assert!(anime.contains("categories=010"));
        assert!(!anime.contains("q="), "{anime}");
        assert!(anime.contains("sorting=toplist") && anime.contains("topRange=1M"));

        // Gaming restricts to the "general" category and searches the word.
        let gaming = wallhaven_url("", "Gaming", 1, opts());
        assert!(gaming.contains("categories=100"));
        assert!(gaming.contains("q=gaming"));

        // Anime + a typed query keeps the query.
        assert!(wallhaven_url("blue hair", "Anime", 1, opts()).contains("q=blue%20hair"));

        let dark = SearchOptions { dark: true, ..opts() };
        assert!(wallhaven_url("", "Space", 1, dark).contains("colors=000000"));
        assert!(!wallhaven_url("", "Space", 1, opts()).contains("colors="));

        let sorted = |sort| SearchOptions { sort, ..opts() };
        assert!(wallhaven_url("x", "", 1, sorted(Sort::Random)).contains("sorting=random"));
        assert!(wallhaven_url("x", "", 1, sorted(Sort::Latest)).contains("sorting=date_added"));
        assert!(wallhaven_url("x", "", 1, sorted(Sort::Popular)).contains("sorting=toplist"));
    }

    #[test]
    fn pixabay_url_carries_the_required_parameters() {
        let pb = pixabay_url("", "Cyberpunk", 1, opts(), "key 123");
        assert!(pb.contains("video_type=animation"));
        assert!(pb.contains("safesearch=true"));
        assert!(pb.contains("q=cyberpunk"));
        assert!(pb.contains("key=key%20123"), "key is encoded: {pb}");
        assert!(!pb.contains("order="));
        let latest = SearchOptions { sort: Sort::Latest, ..opts() };
        assert!(pixabay_url("", "", 1, latest, "k").contains("order=latest"));
    }

    #[test]
    fn pexels_urls_pick_search_or_curated_feeds() {
        let photos = pexels_photos_url("neon city", "", 3, opts());
        assert!(photos.starts_with("https://api.pexels.com/v1/search?"));
        assert!(photos.contains("query=neon%20city"));
        assert!(photos.contains("orientation=landscape"));
        assert!(photos.contains("page=3"));

        assert!(pexels_photos_url("", "", 1, opts()).starts_with("https://api.pexels.com/v1/curated?"));
        let videos = pexels_videos_url("ocean", "", 1, opts());
        assert!(videos.starts_with("https://api.pexels.com/v1/videos/search?"));
        assert!(pexels_videos_url("", "", 2, opts())
            .starts_with("https://api.pexels.com/v1/videos/popular?min_width=1920"));

        // Dark is expressed through the query for providers without a filter.
        let dark = SearchOptions { dark: true, ..opts() };
        assert!(pexels_photos_url("city", "", 1, dark).contains("query=city%20dark"));
        assert!(pexels_photos_url("", "", 1, dark).contains("query=dark"));
        assert!(pexels_photos_url("dark city", "", 1, dark).contains("query=dark%20city"));
    }

    #[test]
    fn build_request_enforces_keys_and_sets_auth() {
        let today = days_from_civil(2026, 10, 18);
        let req = |source, key: Option<&str>| build_request(source, "x", "", 1, opts(), key, today);

        // Keyless sources work without a key.
        assert!(req(Source::Wallhaven, None).unwrap().headers.is_empty());
        assert!(req(Source::Bing, None).is_ok());

        // Keyed sources ask for one, in words the UI recognises.
        for source in [Source::Pexels, Source::PexelsVideos, Source::PixabayVideos] {
            let err = req(source, None).unwrap_err();
            assert!(err.contains("API key"), "{err}");
            assert!(err.contains(source.provider()), "{err}");
            assert!(req(source, Some("   ")).is_err(), "blank key counts as missing");
        }
        assert!(req(Source::Pexels, None).unwrap_err().contains("photos"));
        assert!(req(Source::PexelsVideos, None).unwrap_err().contains("videos"));

        // Pexels authenticates with a header, Pixabay with a query parameter.
        let pexels = req(Source::Pexels, Some(" abc ")).unwrap();
        assert_eq!(pexels.headers, vec![("Authorization", "abc".to_string())]);
        assert!(!pexels.url.contains("abc"), "key never lands in the URL");
        let pixabay = req(Source::PixabayVideos, Some("abc")).unwrap();
        assert!(pixabay.url.contains("key=abc") && pixabay.headers.is_empty());

        // NASA falls back to the shared demo key, or uses the user's own.
        assert!(req(Source::Nasa, None).unwrap().url.contains("api_key=DEMO_KEY"));
        assert!(req(Source::Nasa, Some("mine")).unwrap().url.contains("api_key=mine"));
    }

    #[test]
    fn sources_have_stable_names_and_metadata() {
        use std::collections::HashSet;
        let tags: HashSet<&str> = Source::ALL.iter().map(|s| s.tag()).collect();
        assert_eq!(tags.len(), Source::ALL.len(), "tags are unique");
        for source in Source::ALL {
            let json = serde_json::to_string(&source).unwrap();
            assert_eq!(json, format!("\"{}\"", source.tag()));
            assert_eq!(serde_json::from_str::<Source>(&json).unwrap(), source);
        }
        // Library entries saved by earlier builds used "pixabay".
        assert_eq!(
            serde_json::from_str::<Source>("\"pixabay\"").unwrap(),
            Source::PixabayVideos
        );

        assert_eq!(Source::Wallhaven.kind(), DiscoverKind::Image);
        assert_eq!(Source::PexelsVideos.kind(), DiscoverKind::Video);
        assert_eq!(Source::PixabayVideos.kind(), DiscoverKind::Video);
        assert_eq!(Source::Pexels.key_setting(), Some("pexels_api_key"));
        assert_eq!(Source::PexelsVideos.key_setting(), Some("pexels_api_key"));
        assert_eq!(Source::PixabayVideos.key_setting(), Some("pixabay_api_key"));
        assert_eq!(Source::Wallhaven.key_setting(), None);
        assert!(!Source::Nasa.key_required(), "DEMO_KEY fallback");
        assert!(Source::Pexels.key_required());
        assert!(!Source::Bing.supports_search() && !Source::Nasa.supports_search());
        assert!(Source::Wallhaven.supports_sort() && !Source::Pexels.supports_sort());
    }

    #[test]
    fn describe_sources_reports_keys_and_capabilities() {
        let infos = describe_sources(|s| s == Source::Pexels);
        assert_eq!(infos.len(), Source::ALL.len());
        assert_eq!(infos[0].id, Source::Wallhaven, "UI order is preserved");

        let pexels = infos.iter().find(|i| i.id == Source::Pexels).unwrap();
        assert!(pexels.has_key && pexels.key_required && pexels.supports_search);
        assert_eq!(pexels.key_setting.as_deref(), Some("pexels_api_key"));

        let videos = infos.iter().find(|i| i.id == Source::PexelsVideos).unwrap();
        assert!(!videos.has_key, "has_key is asked per source");
        assert_eq!(videos.kind, DiscoverKind::Video);

        let bing = infos.iter().find(|i| i.id == Source::Bing).unwrap();
        assert!(!bing.supports_search && !bing.key_required && bing.key_setting.is_none());
        let nasa = infos.iter().find(|i| i.id == Source::Nasa).unwrap();
        assert!(!nasa.key_required && nasa.key_setting.as_deref() == Some("nasa_api_key"));
        let wallhaven = infos.iter().find(|i| i.id == Source::Wallhaven).unwrap();
        assert!(wallhaven.supports_sort);

        // The wire format the UI relies on.
        let json = serde_json::to_value(wallhaven).unwrap();
        assert_eq!(json["id"], "wallhaven");
        assert_eq!(json["kind"], "image");
        assert_eq!(json["key_required"], false);
    }

    #[test]
    fn options_are_normalised_per_source() {
        let wanted = SearchOptions { sort: Sort::Random, dark: true };
        assert_eq!(wanted.for_source(Source::Wallhaven), wanted);
        assert_eq!(
            wanted.for_source(Source::Pexels),
            SearchOptions { sort: Sort::Relevance, dark: true }
        );
        assert_eq!(wanted.for_source(Source::Bing), SearchOptions::default());
        assert_eq!(wanted.for_source(Source::Nasa), SearchOptions::default());
    }

    #[test]
    fn category_mapping_matches_chips() {
        assert_eq!(category_query("OLED black"), Some("black oled"));
        assert_eq!(category_query("Nature"), Some("nature"));
        assert_eq!(category_query("nope"), None);
        // Every chip maps to a query.
        for chip in CATEGORIES {
            assert!(category_query(chip).is_some(), "{chip}");
        }
        // A free-text query wins over the category.
        assert_eq!(effective_query("mountains", "Nature"), "mountains");
        assert_eq!(effective_query("  ", "Nature"), "nature");
    }

    #[test]
    fn cache_key_is_stable_and_case_insensitive() {
        let a = cache_key(Source::Wallhaven, "Cat", "Nature", 1, opts());
        let b = cache_key(Source::Wallhaven, "cat", "Nature", 1, opts());
        let c = cache_key(Source::PixabayVideos, "cat", "Nature", 1, opts());
        assert_eq!(a, b);
        assert_ne!(a, c, "sources do not collide");
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn cache_key_tracks_options_that_matter_only() {
        let dark = SearchOptions { dark: true, ..opts() };
        let random = SearchOptions { sort: Sort::Random, ..opts() };
        let base = cache_key(Source::Wallhaven, "x", "", 1, opts());
        assert_ne!(base, cache_key(Source::Wallhaven, "x", "", 1, dark));
        assert_ne!(base, cache_key(Source::Wallhaven, "x", "", 1, random));
        // Pexels has no sort, Bing has neither: no wasted cache misses.
        assert_eq!(
            cache_key(Source::Pexels, "x", "", 1, opts()),
            cache_key(Source::Pexels, "x", "", 1, random)
        );
        assert_eq!(
            cache_key(Source::Bing, "", "", 1, opts()),
            cache_key(Source::Bing, "", "", 1, SearchOptions { sort: Sort::Latest, dark: true })
        );
    }

    #[test]
    fn rate_limiter_is_a_sliding_window() {
        let mut limiter = RateLimiter::with_window(2, Duration::from_millis(250));
        assert_eq!(limiter.wait_time(), Duration::ZERO);
        limiter.mark();
        assert_eq!(limiter.wait_time(), Duration::ZERO, "one of two used");
        limiter.mark();
        let wait = limiter.wait_time();
        assert!(wait > Duration::ZERO && wait <= Duration::from_millis(250), "{wait:?}");
        std::thread::sleep(Duration::from_millis(280));
        assert_eq!(limiter.wait_time(), Duration::ZERO, "window slid past");
    }

    #[test]
    fn rate_limiter_frees_one_slot_at_a_time() {
        let mut limiter = RateLimiter::with_window(2, Duration::from_millis(300));
        limiter.mark();
        std::thread::sleep(Duration::from_millis(160));
        limiter.mark();
        // Full: the oldest hit (160ms ago) decides when a slot opens.
        let wait = limiter.wait_time();
        assert!(wait <= Duration::from_millis(150), "{wait:?}");
        std::thread::sleep(wait + Duration::from_millis(20));
        assert_eq!(limiter.wait_time(), Duration::ZERO);
    }

    #[test]
    fn per_minute_limiter_allows_a_burst_then_blocks() {
        let mut limiter = RateLimiter::new(3);
        for _ in 0..3 {
            assert_eq!(limiter.wait_time(), Duration::ZERO);
            limiter.mark();
        }
        let wait = limiter.wait_time();
        assert!(wait > Duration::from_secs(50) && wait <= Duration::from_secs(60), "{wait:?}");
    }

    #[test]
    fn pexels_photos_and_videos_share_one_quota() {
        let mut discover = Discover::new(std::env::temp_dir().join("driftwall-limit-test"));
        for _ in 0..PEXELS_PER_HOUR {
            discover.mark(Source::Pexels);
        }
        assert!(discover.limiter(Source::PexelsVideos).wait_time() > Duration::ZERO);
        assert_eq!(discover.limiter(Source::Wallhaven).wait_time(), Duration::ZERO);
        assert_eq!(discover.limiter(Source::Nasa).wait_time(), Duration::ZERO);
    }

    #[test]
    fn rate_limit_message_is_readable() {
        let short = rate_limit_message(Source::Wallhaven, Duration::from_secs(12));
        assert_eq!(short, "Wallhaven rate limit reached. Try again in about 12 s.");
        let long = rate_limit_message(Source::Nasa, Duration::from_secs(1800));
        assert!(long.contains("30 min"), "{long}");
        assert!(rate_limit_message(Source::Pexels, Duration::ZERO).contains("1 s"));
    }

    #[test]
    fn with_dark_only_adds_the_word_when_needed() {
        assert_eq!(with_dark("city", false), "city");
        assert_eq!(with_dark("city", true), "city dark");
        assert_eq!(with_dark("", true), "dark");
        assert_eq!(with_dark("Dark Forest", true), "Dark Forest");
    }

    #[test]
    fn slug_titles_and_helpers() {
        assert_eq!(
            title_from_slug("https://www.pexels.com/video/neon-city-lights-123/").as_deref(),
            Some("Neon city lights")
        );
        assert_eq!(title_from_slug("https://www.pexels.com/video/123456/"), Some("123456".into()));
        assert_eq!(shorten("short", 10), "short");
        assert_eq!(collapse_whitespace(" a \n b  c "), "a b c");
        assert_eq!(apod_page_url("2026-10-15").as_deref(), Some("https://apod.nasa.gov/apod/ap261015.html"));
        assert_eq!(apod_page_url("bad"), None);
    }

    #[test]
    fn extension_for_validates_and_defaults() {
        assert_eq!(extension_for("https://x/a/b.jpeg?w=1", DiscoverKind::Image), "jpeg");
        assert_eq!(extension_for("https://x/a/b.mp4", DiscoverKind::Video), "mp4");
        assert_eq!(extension_for("https://x/a/b.php", DiscoverKind::Image), "jpg");
        assert_eq!(extension_for("https://x/a/b", DiscoverKind::Video), "mp4");
        // Bing's image URLs carry the extension before a query string.
        assert_eq!(extension_for("https://www.bing.com/th?id=OHR.X_UHD.jpg", DiscoverKind::Image), "jpg");
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

    #[test]
    fn pages_cached_by_older_builds_still_load() {
        // Entries written before `preview_url` existed lack the field.
        let old = r#"{"saved_ms": 99999999999999, "page": {"page": 1, "has_more": false, "items": [
          {"id":"pixabay-1","source":"pixabay","kind":"video","title":"T","thumb_url":"t","full_url":"f"}]}}"#;
        let entry: CachedPage = serde_json::from_str(old).unwrap();
        assert_eq!(entry.page.items[0].source, Source::PixabayVideos);
        assert_eq!(entry.page.items[0].preview_url, None);
        assert!(entry.page.items[0].renditions.is_empty());
    }
}
