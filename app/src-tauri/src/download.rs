//! Discover download engine.
//!
//! Downloads stream straight to a `<uuid>.part` file inside the app data
//! directory and are atomically renamed on success, so a partial or failed
//! transfer never leaves a usable-looking file behind. Progress is reported
//! through a Tauri channel roughly every 100 ms, transfers are retried with a
//! `Range` resume when the server supports it, and at most
//! [`MAX_CONCURRENT`] downloads run at once.
//!
//! The core (`download_to_part`) deliberately depends only on `reqwest`/`tokio`
//! and a plain callback so it can be exercised against a local test server.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use tokio::time::timeout;

/// Connection establishment timeout.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Abort a transfer when no bytes arrive for this long.
pub const STALL_TIMEOUT: Duration = Duration::from_secs(20);
/// Total attempts per download (initial try + retries).
pub const MAX_ATTEMPTS: u32 = 3;
/// Maximum simultaneous downloads.
pub const MAX_CONCURRENT: usize = 2;
/// Minimum gap between progress events.
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Lifecycle phase reported to the UI.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Waiting for a free download slot.
    Queued,
    /// Transferring bytes.
    Downloading,
    /// Bytes are complete; probing/thumbnailing is in progress.
    Processing,
    /// Finished and usable.
    Done,
    /// Failed (see `error`).
    Error,
}

/// A progress snapshot sent over the download channel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DownloadProgress {
    /// Frontend item id (stable across the whole flow).
    pub id: String,
    pub bytes_done: u64,
    /// `Content-Length` total when the server provides it.
    pub bytes_total: Option<u64>,
    /// Estimate in bytes/second.
    pub speed_bps: f64,
    pub phase: Phase,
    #[serde(default)]
    pub error: Option<String>,
}

impl DownloadProgress {
    pub fn new(id: &str, phase: Phase) -> Self {
        Self {
            id: id.to_string(),
            bytes_done: 0,
            bytes_total: None,
            speed_bps: 0.0,
            phase,
            error: None,
        }
    }
}

/// Why a download ended unsuccessfully.
#[derive(Debug, PartialEq)]
pub enum DownloadError {
    /// The user cancelled it.
    Cancelled,
    /// Transport/timeout failure.
    Network(String),
    /// A non-success HTTP status.
    Http(u16),
    /// A local filesystem failure.
    Io(String),
}

impl DownloadError {
    /// User-facing message.
    pub fn message(&self) -> String {
        match self {
            DownloadError::Cancelled => "Download cancelled.".to_string(),
            DownloadError::Network(m) => format!("Network error: {m}"),
            DownloadError::Http(code) => format!("Server returned status {code}."),
            DownloadError::Io(m) => format!("Could not write the file: {m}"),
        }
    }
}

/// A shared cancellation flag.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Sliding-window transfer-speed estimator (bytes/second).
pub struct SpeedTracker {
    window: Duration,
    samples: Vec<(Instant, u64)>,
}

impl SpeedTracker {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            samples: Vec::new(),
        }
    }

    /// Records the cumulative byte count at `now`.
    pub fn record(&mut self, now: Instant, bytes_done: u64) {
        self.samples.push((now, bytes_done));
        if let Some(cutoff) = now.checked_sub(self.window) {
            // Keep one sample just before the window so the estimate has a
            // baseline, then everything inside it.
            let mut keep_from = 0;
            for (i, (t, _)) in self.samples.iter().enumerate() {
                if *t >= cutoff {
                    keep_from = i.saturating_sub(1);
                    break;
                }
            }
            if keep_from > 0 {
                self.samples.drain(0..keep_from);
            }
        }
    }

    /// Current estimate in bytes/second (0 until two samples exist).
    pub fn speed_bps(&self) -> f64 {
        match (self.samples.first(), self.samples.last()) {
            (Some((t0, b0)), Some((t1, b1))) if t1 > t0 => {
                let secs = t1.duration_since(*t0).as_secs_f64();
                if secs <= 0.0 {
                    0.0
                } else {
                    (b1.saturating_sub(*b0)) as f64 / secs
                }
            }
            _ => 0.0,
        }
    }
}

/// Removes a `.part` file, ignoring errors (best-effort cleanup).
fn cleanup(part: &Path) {
    let _ = fs::remove_file(part);
}

/// Total size from `Content-Range`/`Content-Length`, accounting for a resume.
fn total_from(response: &reqwest::Response, start_offset: u64) -> Option<u64> {
    if let Some(value) = response.headers().get(reqwest::header::CONTENT_RANGE) {
        if let Ok(text) = value.to_str() {
            if let Some((_, total)) = text.rsplit_once('/') {
                if let Ok(total) = total.trim().parse::<u64>() {
                    return Some(total);
                }
            }
        }
    }
    response.content_length().map(|len| len + start_offset)
}

/// Exponential backoff before retry `attempt` (1-based), capped at 4s.
async fn backoff(attempt: u32) {
    let millis = 400u64.saturating_mul(1u64 << (attempt.saturating_sub(1).min(4)));
    tokio::time::sleep(Duration::from_millis(millis.min(4000))).await;
}

/// Streams a response body to `part`, reporting progress.
#[allow(clippy::too_many_arguments)]
async fn stream_body(
    response: &mut reqwest::Response,
    file: &mut fs::File,
    done: &mut u64,
    total: Option<u64>,
    cancel: &CancelToken,
    tracker: &mut SpeedTracker,
    last_emit: &mut Instant,
    on_progress: &mut (dyn FnMut(u64, Option<u64>, f64) + Send),
) -> Result<(), DownloadError> {
    loop {
        if cancel.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let next = timeout(STALL_TIMEOUT, response.chunk()).await;
        let chunk = match next {
            Ok(Ok(Some(chunk))) => chunk,
            Ok(Ok(None)) => return Ok(()),
            Ok(Err(e)) => return Err(DownloadError::Network(e.to_string())),
            Err(_) => return Err(DownloadError::Network("transfer stalled".to_string())),
        };
        file.write_all(&chunk)
            .map_err(|e| DownloadError::Io(e.to_string()))?;
        *done += chunk.len() as u64;
        let now = Instant::now();
        tracker.record(now, *done);
        if now.duration_since(*last_emit) >= PROGRESS_INTERVAL {
            on_progress(*done, total, tracker.speed_bps());
            *last_emit = now;
        }
    }
}

/// Downloads `url` into `part`, retrying with a `Range` resume on failure.
///
/// On success the caller is responsible for renaming `part` into place; on any
/// error (including cancellation) the `.part` file is removed.
pub async fn download_to_part(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    cancel: &CancelToken,
    on_progress: &mut (dyn FnMut(u64, Option<u64>, f64) + Send),
) -> Result<u64, DownloadError> {
    let mut tracker = SpeedTracker::new(Duration::from_secs(3));
    // Emit immediately on the first chunk rather than after the interval.
    let mut last_emit = Instant::now() - PROGRESS_INTERVAL;
    let mut attempt: u32 = 0;

    loop {
        attempt += 1;
        if cancel.is_cancelled() {
            cleanup(part);
            return Err(DownloadError::Cancelled);
        }

        let existing = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                if attempt >= MAX_ATTEMPTS {
                    cleanup(part);
                    return Err(DownloadError::Network(error.to_string()));
                }
                backoff(attempt).await;
                continue;
            }
        };

        let status = response.status();
        if !status.is_success() {
            cleanup(part);
            return Err(DownloadError::Http(status.as_u16()));
        }

        let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
        let start_offset = if resumed { existing } else { 0 };
        let total = total_from(&response, start_offset);

        let mut file = if resumed {
            fs::OpenOptions::new().append(true).open(part)
        } else {
            fs::File::create(part)
        }
        .map_err(|e| {
            cleanup(part);
            DownloadError::Io(e.to_string())
        })?;

        let mut response = response;
        let mut done = start_offset;
        on_progress(done, total, 0.0);

        match stream_body(
            &mut response,
            &mut file,
            &mut done,
            total,
            cancel,
            &mut tracker,
            &mut last_emit,
            on_progress,
        )
        .await
        {
            Ok(()) => {
                let _ = file.sync_all();
                return Ok(done);
            }
            Err(DownloadError::Cancelled) => {
                drop(file);
                cleanup(part);
                return Err(DownloadError::Cancelled);
            }
            Err(error) => {
                drop(file);
                if attempt >= MAX_ATTEMPTS {
                    cleanup(part);
                    return Err(error);
                }
                backoff(attempt).await;
            }
        }
    }
}

/// In-flight download registry: limits concurrency and tracks cancel tokens.
pub struct Downloads {
    permits: Arc<Semaphore>,
    tokens: Mutex<HashMap<String, CancelToken>>,
}

impl Default for Downloads {
    fn default() -> Self {
        Self::new()
    }
}

impl Downloads {
    pub fn new() -> Self {
        Self {
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT)),
            tokens: Mutex::new(HashMap::new()),
        }
    }

    /// Registers a download and returns its cancellation token.
    pub fn register(&self, id: &str) -> CancelToken {
        let token = CancelToken::new();
        self.tokens
            .lock()
            .unwrap()
            .insert(id.to_string(), token.clone());
        token
    }

    /// Forgets a finished download.
    pub fn finish(&self, id: &str) {
        self.tokens.lock().unwrap().remove(id);
    }

    /// Cancels a download. Returns false when the id is not active.
    pub fn cancel(&self, id: &str) -> bool {
        match self.tokens.lock().unwrap().get(id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    /// Clones the semaphore so a permit can be held across the transfer.
    pub fn permits(&self) -> Arc<Semaphore> {
        self.permits.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .unwrap()
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("driftwall-dl-{tag}-{nanos}"))
    }

    fn read_request(stream: &mut TcpStream) -> String {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 1024];
        loop {
            match stream.read(&mut tmp) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    buf.extend_from_slice(&tmp[..n]);
                    if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
            }
        }
        String::from_utf8_lossy(&buf).to_string()
    }

    fn write_response(
        stream: &mut TcpStream,
        status: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) {
        let mut head = format!("HTTP/1.1 {status}\r\n");
        for (key, value) in headers {
            head.push_str(&format!("{key}: {value}\r\n"));
        }
        head.push_str("\r\n");
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(body);
        let _ = stream.flush();
    }

    /// Starts a blocking single-purpose HTTP server for `connections` requests.
    fn start_server<F>(connections: usize, handler: F) -> (String, thread::JoinHandle<()>)
    where
        F: Fn(&mut TcpStream, &str) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            for _ in 0..connections {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let request = read_request(&mut stream);
                        handler(&mut stream, &request);
                    }
                    Err(_) => break,
                }
            }
        });
        (format!("http://{addr}"), handle)
    }

    #[test]
    fn speed_tracker_reports_bytes_per_second() {
        let mut tracker = SpeedTracker::new(Duration::from_secs(10));
        let start = Instant::now();
        tracker.record(start, 0);
        tracker.record(start + Duration::from_millis(500), 1000);
        assert!((tracker.speed_bps() - 2000.0).abs() < 1.0);
    }

    #[test]
    fn speed_tracker_is_zero_until_it_has_two_samples() {
        let mut tracker = SpeedTracker::new(Duration::from_secs(10));
        assert_eq!(tracker.speed_bps(), 0.0);
        tracker.record(Instant::now(), 500);
        assert_eq!(tracker.speed_bps(), 0.0);
    }

    #[test]
    fn speed_tracker_windows_out_old_samples() {
        let mut tracker = SpeedTracker::new(Duration::from_millis(100));
        let start = Instant::now();
        tracker.record(start, 0);
        tracker.record(start + Duration::from_millis(10), 10);
        // Far in the future: the old samples are dropped, baseline is the last.
        tracker.record(start + Duration::from_secs(5), 20);
        // Window only holds the final two samples at most, so speed is finite
        // and non-negative rather than exploding over the 5s gap.
        assert!(tracker.speed_bps() >= 0.0);
        assert!(tracker.speed_bps().is_finite());
    }

    #[tokio::test]
    async fn downloads_file_and_reports_progress() {
        let payload: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let body = payload.clone();
        let len = body.len().to_string();
        let (base, server) = start_server(1, move |stream, _req| {
            write_response(
                stream,
                "200 OK",
                &[("Content-Length", &len), ("Connection", "close")],
                &body,
            );
        });

        let dir = temp_dir("ok");
        fs::create_dir_all(&dir).unwrap();
        let part = dir.join("file.bin");

        let mut samples: Vec<(u64, Option<u64>)> = Vec::new();
        let total = download_to_part(
            &test_client(),
            &format!("{base}/file.bin"),
            &part,
            &CancelToken::new(),
            &mut |done, total, _speed| samples.push((done, total)),
        )
        .await
        .unwrap();

        assert_eq!(total, payload.len() as u64);
        assert_eq!(fs::read(&part).unwrap(), payload);
        assert!(!samples.is_empty());
        assert_eq!(samples.last().unwrap().1, Some(payload.len() as u64));
        server.join().unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn removes_part_when_the_transfer_fails() {
        // Pretend to send 1000 bytes but drop the connection after 10.
        let (base, server) = start_server(MAX_ATTEMPTS as usize, |stream, _req| {
            write_response(
                stream,
                "200 OK",
                &[("Content-Length", "1000"), ("Connection", "close")],
                &[0u8; 10],
            );
        });

        let dir = temp_dir("fail");
        fs::create_dir_all(&dir).unwrap();
        let part = dir.join("file.bin");

        let error = download_to_part(
            &test_client(),
            &format!("{base}/file.bin"),
            &part,
            &CancelToken::new(),
            &mut |_, _, _| {},
        )
        .await
        .unwrap_err();

        assert!(matches!(error, DownloadError::Network(_)));
        assert!(!part.exists(), ".part must be removed after a failure");
        server.join().unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn resumes_with_a_range_request() {
        let payload: Vec<u8> = (0..2000u32).map(|i| (i % 256) as u8).collect();
        let whole = payload.clone();
        let total = payload.len();
        let half = total / 2;
        let flag = Arc::new(AtomicBool::new(false));
        let seen = flag.clone();

        let (base, server) = start_server(2, move |stream, request| {
            let ranged = request
                .lines()
                .any(|line| line.to_ascii_lowercase().starts_with("range:"));
            if ranged {
                seen.store(true, Ordering::SeqCst);
                let body = &whole[half..];
                let len = body.len().to_string();
                let range = format!("bytes {half}-{}/{total}", total - 1);
                write_response(
                    stream,
                    "206 Partial Content",
                    &[
                        ("Content-Length", &len),
                        ("Content-Range", &range),
                        ("Connection", "close"),
                    ],
                    body,
                );
            } else {
                // Announce the full length but only deliver the first half.
                let announced = total.to_string();
                write_response(
                    stream,
                    "200 OK",
                    &[("Content-Length", &announced), ("Connection", "close")],
                    &whole[..half],
                );
            }
        });

        let dir = temp_dir("range");
        fs::create_dir_all(&dir).unwrap();
        let part = dir.join("file.bin");
        let written = download_to_part(
            &test_client(),
            &format!("{base}/file.bin"),
            &part,
            &CancelToken::new(),
            &mut |_, _, _| {},
        )
        .await
        .unwrap();

        assert!(flag.load(Ordering::SeqCst), "expected a Range request on retry");
        assert_eq!(written, total as u64);
        assert_eq!(fs::read(&part).unwrap(), payload);
        server.join().unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn cancel_stops_the_transfer_and_removes_the_part() {
        let (base, server) = start_server(1, |stream, _req| {
            let head = "HTTP/1.1 200 OK\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(head.as_bytes());
            for _ in 0..60 {
                if stream.write_all(&[0u8]).is_err() {
                    break;
                }
                let _ = stream.flush();
                thread::sleep(Duration::from_millis(15));
            }
        });

        let dir = temp_dir("cancel");
        fs::create_dir_all(&dir).unwrap();
        let part = dir.join("file.bin");

        let token = CancelToken::new();
        let trigger = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(70)).await;
            trigger.cancel();
        });

        let error = download_to_part(
            &test_client(),
            &format!("{base}/file.bin"),
            &part,
            &token,
            &mut |_, _, _| {},
        )
        .await
        .unwrap_err();

        assert_eq!(error, DownloadError::Cancelled);
        assert!(!part.exists(), ".part must be removed after a cancel");
        server.join().unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn downloads_registry_tracks_and_cancels() {
        let downloads = Downloads::new();
        let token = downloads.register("pixabay-1");
        assert!(!token.is_cancelled());
        assert!(downloads.cancel("pixabay-1"));
        assert!(token.is_cancelled());
        assert!(!downloads.cancel("missing"));
        downloads.finish("pixabay-1");
        assert!(!downloads.cancel("pixabay-1"));
    }
}
