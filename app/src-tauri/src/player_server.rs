//! A tiny, loopback-only HTTP server that hosts the YouTube player page.
//!
//! Why this exists: the app window is served from `tauri://localhost`, which
//! YouTube does not accept as an embedding origin, so videos fail with
//! "error 153" (missing referrer). The player page therefore has to be served
//! from a real `http://localhost` origin. This server does exactly that and
//! nothing else: two static files and a health check, bound to 127.0.0.1 on a
//! random free port, with a Host-header check against DNS rebinding.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const PLAYER_HTML: &str = include_str!("../player/player.html");
const PLAYER_JS: &str = include_str!("../player/player.js");

/// Largest request head we are willing to read.
const MAX_HEAD: usize = 8 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Handle kept in Tauri's managed state.
pub struct PlayerServer {
    port: Option<u16>,
}

impl PlayerServer {
    pub fn unavailable() -> Self {
        Self { port: None }
    }

    /// URL of the player page, or `None` when the server could not start.
    pub fn url(&self) -> Option<String> {
        self.port
            .map(|port| format!("http://localhost:{port}/player.html"))
    }
}

/// Binds to a random free loopback port and serves requests in the background.
pub async fn start() -> std::io::Result<PlayerServer> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    tauri::async_runtime::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tauri::async_runtime::spawn(async move {
                        let _ = tokio::time::timeout(READ_TIMEOUT, serve(stream, port)).await;
                    });
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
    });
    Ok(PlayerServer { port: Some(port) })
}

async fn serve(mut stream: TcpStream, port: u16) {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > MAX_HEAD {
            let _ = stream.write_all(&respond(431, "text/plain", "", false)).await;
            return;
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let response = handle(&head, port);
    let _ = stream.write_all(&response).await;
    let _ = stream.shutdown().await;
}

/// Pure request handling (everything but the socket), so it can be unit-tested.
fn handle(head: &str, port: u16) -> Vec<u8> {
    let mut lines = head.lines();
    let mut request_line = lines.next().unwrap_or("").split_whitespace();
    let method = request_line.next().unwrap_or("");
    let target = request_line.next().unwrap_or("");
    let host = lines
        .by_ref()
        .take_while(|line| !line.is_empty())
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("host").then(|| value.trim().to_string())
        });

    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        return respond(405, "text/plain", "method not allowed", false);
    }
    // Refuse anything addressed to another hostname (DNS-rebinding defence).
    let host_ok = host.as_deref().is_some_and(|h| {
        h == format!("localhost:{port}") || h == format!("127.0.0.1:{port}")
    });
    if !host_ok {
        return respond(403, "text/plain", "forbidden", false);
    }

    let path = target.split(['?', '#']).next().unwrap_or("");
    match path {
        "/" | "/player.html" => respond(200, "text/html; charset=utf-8", PLAYER_HTML, head_only),
        "/player.js" => respond(200, "text/javascript; charset=utf-8", PLAYER_JS, head_only),
        "/health" => respond(200, "text/plain", "ok", head_only),
        _ => respond(404, "text/plain", "not found", head_only),
    }
}

fn respond(status: u16, content_type: &str, body: &str, head_only: bool) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    };
    // The page may load YouTube and nothing else; only the app may frame it.
    let csp = "default-src 'none'; script-src 'self' https://www.youtube.com; \
               frame-src https://www.youtube.com https://www.youtube-nocookie.com; \
               style-src 'unsafe-inline'; img-src https://i.ytimg.com data:; \
               connect-src https://www.youtube.com";
    let mut out = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\n\
         Content-Length: {}\r\nCache-Control: no-store\r\n\
         X-Content-Type-Options: nosniff\r\nReferrer-Policy: strict-origin-when-cross-origin\r\n\
         Content-Security-Policy: {csp}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    if !head_only {
        out.extend_from_slice(body.as_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: Vec<u8>) -> String {
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn serves_the_player_page_and_script() {
        let html = text(handle("GET /player.html?x=1 HTTP/1.1\r\nHost: localhost:4000\r\n\r\n", 4000));
        assert!(html.starts_with("HTTP/1.1 200 OK"));
        assert!(html.contains("/player.js"));
        let js = text(handle("GET /player.js HTTP/1.1\r\nHost: 127.0.0.1:4000\r\n\r\n", 4000));
        assert!(js.contains("onYouTubeIframeAPIReady"));
    }

    #[test]
    fn rejects_foreign_hosts_and_unknown_paths() {
        let rebinding = text(handle("GET / HTTP/1.1\r\nHost: evil.example:4000\r\n\r\n", 4000));
        assert!(rebinding.starts_with("HTTP/1.1 403"));
        let missing = text(handle("GET /etc/passwd HTTP/1.1\r\nHost: localhost:4000\r\n\r\n", 4000));
        assert!(missing.starts_with("HTTP/1.1 404"));
        let post = text(handle("POST / HTTP/1.1\r\nHost: localhost:4000\r\n\r\n", 4000));
        assert!(post.starts_with("HTTP/1.1 405"));
    }

    #[test]
    fn head_requests_have_no_body() {
        let res = text(handle("HEAD /health HTTP/1.1\r\nHost: localhost:4000\r\n\r\n", 4000));
        assert!(res.contains("Content-Length: 2"));
        assert!(res.ends_with("\r\n\r\n"));
    }
}
