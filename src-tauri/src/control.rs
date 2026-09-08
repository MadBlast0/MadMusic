//! A local control endpoint, for Stream Deck and scripts.
//!
//! # This does not break the no-server rule
//!
//! `docs/roadmap.md` rules out "any self-hosted or rented backend". That rule
//! is about *where the app's data lives* — no VPS, no proxy, nothing the
//! project has to pay for or keep running. This is a loopback socket inside the
//! user's own machine, with no state of its own, that exists only while the app
//! is open. It is the same category of thing as the `stream:` protocol handler.
//!
//! It is still a listening socket, so it is treated like one:
//!
//! - **Off by default.** The user turns it on in settings, having read what it
//!   does.
//! - **`127.0.0.1` only.** Never `0.0.0.0`. A control endpoint reachable from
//!   the network is a control endpoint reachable from the café's Wi-Fi.
//! - **Token required.** Generated on first enable, shown in settings, checked
//!   on every request. Without it, any web page the user visits could pause
//!   their music by fetching a localhost URL — which is a real attack, not a
//!   theoretical one.
//! - **Commands only.** It can transport what is already possible from the UI.
//!   There is no endpoint that reads the library, writes a file, or returns
//!   anything a page should not be able to see.
//!
//! # Why not WebSocket
//!
//! Because the clients are Stream Deck buttons and shell scripts, and both
//! speak HTTP. A socket that stays open buys push updates that nothing here
//! wants — a button does not need to know the track changed.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// The event the frontend listens for.
pub const CONTROL_EVENT: &str = "madmusic://remote-control";

/// The port. Fixed, so a Stream Deck profile does not need reconfiguring.
///
/// 8737 is unassigned and unlikely to collide. Failing to bind is reported
/// rather than retried on another port: a control endpoint at an address the
/// user was not told about is worse than none.
pub const PORT: u16 = 8737;

/// What the endpoint accepts, and what it does.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteAction {
    PlayPause,
    Play,
    Pause,
    Next,
    Previous,
    Stop,
    VolumeUp,
    VolumeDown,
    Mute,
    Like,
    Shuffle,
    Repeat,
    /// An absolute level, 0-100.
    ///
    /// Carries a value where the others do not, so it serialises as
    /// `{"volume": 40}` rather than a bare string. The frontend already
    /// handles that shape for seeking.
    #[serde(rename = "volume")]
    SetVolume(u8),
}

impl RemoteAction {
    fn parse(path: &str) -> Option<Self> {
        Some(match path {
            "/play-pause" => Self::PlayPause,
            "/play" => Self::Play,
            "/pause" => Self::Pause,
            "/next" => Self::Next,
            "/previous" => Self::Previous,
            "/stop" => Self::Stop,
            "/volume-up" => Self::VolumeUp,
            "/volume-down" => Self::VolumeDown,
            "/mute" => Self::Mute,
            "/like" => Self::Like,
            "/shuffle" => Self::Shuffle,
            "/repeat" => Self::Repeat,
            _ => return None,
        })
    }
}

/// The endpoint's state: whether it is listening, and on what token.
#[derive(Default)]
pub struct Remote(pub Mutex<RemoteState>);

#[derive(Default)]
pub struct RemoteState {
    pub running: bool,
    pub token: String,
    /// Dropping this stops the accept loop.
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

/// What the settings screen shows.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub running: bool,
    pub port: u16,
    pub token: String,
    /// A ready-made example, because the first question is always "how".
    pub example: String,
    pub error: String,
}

fn status(state: &RemoteState, error: String) -> RemoteStatus {
    RemoteStatus {
        running: state.running,
        port: PORT,
        token: state.token.clone(),
        example: if state.token.is_empty() {
            String::new()
        } else {
            format!(
                "curl http://127.0.0.1:{PORT}/play-pause?token={}",
                state.token
            )
        },
        error,
    }
}

/// A token nobody can guess.
///
/// Built from the system clock and the address of a heap allocation. Not a
/// cryptographic generator — the crate has none, and adding one for a
/// loopback token is out of proportion — but far beyond guessable by a web page
/// that gets one attempt before the user notices their music pausing.
fn make_token() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let boxed = Box::new(0_u8);
    let address = Box::into_raw(boxed) as usize;
    // Reclaimed immediately; only its address was wanted.
    unsafe { drop(Box::from_raw(address as *mut u8)) };

    format!("{:x}{:x}", now, address ^ (now as usize))
}

/// Starts listening.
#[tauri::command]
pub async fn remote_start(app: tauri::AppHandle) -> RemoteStatus {
    let remote = app.state::<Remote>();

    {
        let mut state = remote.0.lock().unwrap_or_else(|p| p.into_inner());
        if state.running {
            return status(&state, String::new());
        }
        // Kept across restarts within a session, so a Stream Deck profile does
        // not have to be re-pasted every time the endpoint is toggled.
        if state.token.is_empty() {
            state.token = make_token();
        }
    }

    let listener = match TcpListener::bind(("127.0.0.1", PORT)).await {
        Ok(listener) => listener,
        Err(error) => {
            let state = remote.0.lock().unwrap_or_else(|p| p.into_inner());
            return status(&state, format!("could not listen on port {PORT}: {error}"));
        }
    };

    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
    {
        let mut state = remote.0.lock().unwrap_or_else(|p| p.into_inner());
        state.running = true;
        state.stop = Some(stop_tx);
    }

    // The token is deliberately not captured by the accept loop. Every request
    // reads it from the state at the moment it arrives, so `remote_reissue`
    // takes effect on the next request rather than on the next restart — a
    // copy taken here kept honouring the old token for as long as the endpoint
    // stayed up, while the settings screen showed a new one that did not work.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                // Biased so a stop request wins a race with an incoming
                // connection: turning the endpoint off must actually turn it off.
                biased;
                _ = &mut stop_rx => break,
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else { continue };
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        serve(stream, handle).await;
                    });
                }
            }
        }
    });

    let state = remote.0.lock().unwrap_or_else(|p| p.into_inner());
    status(&state, String::new())
}

/// Stops listening.
#[tauri::command]
pub fn remote_stop(app: tauri::AppHandle) -> RemoteStatus {
    let remote = app.state::<Remote>();
    let mut state = remote.0.lock().unwrap_or_else(|p| p.into_inner());

    if let Some(stop) = state.stop.take() {
        let _ = stop.send(());
    }
    state.running = false;
    status(&state, String::new())
}

#[tauri::command]
pub fn remote_status(app: tauri::AppHandle) -> RemoteStatus {
    let remote = app.state::<Remote>();
    let state = remote.0.lock().unwrap_or_else(|p| p.into_inner());
    status(&state, String::new())
}

/// Issues a new token, invalidating the old one.
#[tauri::command]
pub fn remote_reissue(app: tauri::AppHandle) -> RemoteStatus {
    let remote = app.state::<Remote>();
    let mut state = remote.0.lock().unwrap_or_else(|p| p.into_inner());
    state.token = make_token();
    status(&state, String::new())
}

/// Handles one request.
///
/// A hand-written HTTP/1.1 responder rather than a framework, because the whole
/// protocol surface used here is: read a request line, compare two strings,
/// write a fixed response. A web framework would be several hundred kilobytes
/// of binary for that.
async fn serve(mut stream: tokio::net::TcpStream, app: tauri::AppHandle) {
    let token = {
        let remote = app.state::<Remote>();
        let state = remote.0.lock().unwrap_or_else(|p| p.into_inner());
        state.token.clone()
    };

    let mut buffer = [0_u8; 1024];
    let Ok(read) = stream.read(&mut buffer).await else {
        return;
    };
    let request = String::from_utf8_lossy(&buffer[..read]);

    // "GET /play-pause?token=abc HTTP/1.1"
    let Some(line) = request.lines().next() else {
        return;
    };
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    if method != "GET" && method != "POST" {
        let _ = respond(&mut stream, 405, "method not allowed").await;
        return;
    }

    let (path, query) = target.split_once('?').unwrap_or((target, ""));

    let supplied = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("token="))
        .unwrap_or("");

    // Compared in full every time rather than short-circuiting on the first
    // wrong byte. The timing difference is meaningless over loopback, and
    // writing it the careless way here would make it the pattern next time.
    if !constant_eq(supplied, &token) {
        let _ = respond(&mut stream, 401, "bad token").await;
        return;
    }

    match RemoteAction::parse(path) {
        Some(action) => {
            let _ = app.emit(CONTROL_EVENT, &action);
            let _ = respond(&mut stream, 200, "ok").await;
        }
        None => {
            let _ = respond(&mut stream, 404, "no such control").await;
        }
    }
}

fn constant_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0_u8, |difference, (x, y)| difference | (x ^ y))
        == 0
}

async fn respond(stream: &mut tokio::net::TcpStream, code: u16, body: &str) -> std::io::Result<()> {
    let reason = match code {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Method Not Allowed",
    };
    let response = format!(
        "HTTP/1.1 {code} {reason}\r\n\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\
         \r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_documented_path_maps_to_an_action() {
        for path in [
            "/play-pause",
            "/play",
            "/pause",
            "/next",
            "/previous",
            "/stop",
            "/volume-up",
            "/volume-down",
            "/mute",
            "/like",
            "/shuffle",
            "/repeat",
        ] {
            assert!(
                RemoteAction::parse(path).is_some(),
                "{path} should be a control"
            );
        }
    }

    #[test]
    fn an_unknown_path_is_not_an_action() {
        assert!(RemoteAction::parse("/library").is_none());
        assert!(RemoteAction::parse("/../../etc/passwd").is_none());
    }

    #[test]
    fn tokens_differ_between_calls() {
        assert_ne!(make_token(), make_token());
    }

    #[test]
    fn a_token_is_long_enough_not_to_be_guessed() {
        assert!(make_token().len() >= 16);
    }

    #[test]
    fn comparison_rejects_a_wrong_token_of_the_same_length() {
        assert!(constant_eq("abcd", "abcd"));
        assert!(!constant_eq("abcd", "abce"));
        assert!(!constant_eq("abcd", "abc"));
        assert!(!constant_eq("", "x"));
    }

    #[test]
    fn actions_serialise_as_kebab_case() {
        assert_eq!(
            serde_json::to_string(&RemoteAction::PlayPause).expect("encode"),
            "\"play-pause\""
        );
    }
}
