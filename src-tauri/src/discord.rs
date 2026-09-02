//! Discord Rich Presence: showing what you are listening to on your profile.
//!
//! # Why this is hand-written
//!
//! Discord's official crate pulls in a large dependency tree for a protocol
//! that is genuinely small: connect to a local socket, send a JSON handshake,
//! send a JSON activity. Four message types, one length-prefixed frame format,
//! no encryption because it never leaves the machine.
//!
//! # It is a local socket, not a network call
//!
//! Rich Presence talks to the Discord client already running on the same
//! machine — a named pipe on Windows, a Unix socket elsewhere. Nothing is sent
//! to Discord's servers by this app; the local client does that, and only when
//! the user has Discord open and has not turned activity sharing off in it.
//!
//! # What is shared, and the honest caveat
//!
//! The track title and artist, and nothing else — no listening history, no
//! account link, no library. It is off by default.
//!
//! The caveat worth stating in the UI: **anyone who can see your Discord
//! profile can see what you are playing.** That is the entire point of the
//! feature and it is still a thing people forget they turned on.
//!
//! **Unverified.** Written against the protocol; no Discord client has been on
//! the other end of it.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

/// The application id Discord shows the presence under.
///
/// From the build environment, because registering one requires a Discord
/// developer account and a fork should not inherit this project's. Without it
/// the feature reports itself unavailable rather than failing at connect time.
fn application_id() -> &'static str {
    option_env!("DISCORD_APP_ID").unwrap_or("")
}

/// What to show on the profile.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds into the track, so Discord can show a progress bar.
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
}

/// The connection, if one is open.
#[derive(Default)]
pub struct Discord(pub Mutex<Option<Connection>>);

/// One open socket to the local Discord client.
pub struct Connection {
    stream: Socket,
    /// Incremented per frame; Discord echoes it back and ignores it otherwise.
    nonce: u64,
}

/// The platform's local socket, behind one name.
///
/// A named pipe on Windows and a Unix socket elsewhere. Both are byte streams
/// with the same framing, so everything above this is shared.
enum Socket {
    #[cfg(windows)]
    Pipe(std::fs::File),
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixStream),
}

impl Socket {
    fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        match self {
            #[cfg(windows)]
            Socket::Pipe(file) => file.write_all(bytes),
            #[cfg(unix)]
            Socket::Unix(stream) => stream.write_all(bytes),
        }
    }
}

/// Opens the socket Discord is listening on.
///
/// Discord numbers its sockets 0–9 and uses the first free one, so a machine
/// with the stable client and a beta build side by side has two. Trying each in
/// turn is what the protocol expects — there is no discovery mechanism.
fn connect() -> Result<Socket, String> {
    for index in 0..10 {
        #[cfg(windows)]
        {
            use std::fs::OpenOptions;
            let path = format!(r"\\.\pipe\discord-ipc-{index}");
            if let Ok(file) = OpenOptions::new().read(true).write(true).open(&path) {
                return Ok(Socket::Pipe(file));
            }
        }

        #[cfg(unix)]
        {
            use std::os::unix::net::UnixStream;
            // Discord follows the XDG convention, and Flatpak and Snap builds
            // each add a directory of their own. All four are checked because
            // a user on any of them would otherwise see the feature silently
            // do nothing.
            let base = std::env::var("XDG_RUNTIME_DIR")
                .or_else(|_| std::env::var("TMPDIR"))
                .unwrap_or_else(|_| "/tmp".to_string());

            for prefix in ["", "app/com.discordapp.Discord/", "snap.discord/"] {
                let path = format!("{base}/{prefix}discord-ipc-{index}");
                if let Ok(stream) = UnixStream::connect(&path) {
                    return Ok(Socket::Unix(stream));
                }
            }
        }
    }

    Err("Discord does not appear to be running on this machine.".into())
}

/// Sends one frame.
///
/// The framing is a four-byte little-endian opcode, a four-byte little-endian
/// length, then the JSON. Little-endian regardless of platform: it is what the
/// protocol specifies, not what the host happens to be.
fn send(socket: &mut Socket, opcode: u32, payload: &serde_json::Value) -> Result<(), String> {
    let body = serde_json::to_vec(payload).map_err(|e| format!("could not encode: {e}"))?;

    let mut frame = Vec::with_capacity(8 + body.len());
    frame.extend_from_slice(&opcode.to_le_bytes());
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(&body);

    socket
        .write_all(&frame)
        .map_err(|e| format!("Discord closed the connection: {e}"))
}

/// Whether the feature can work in this build.
#[tauri::command]
pub fn discord_available() -> crate::meta::Availability {
    if application_id().is_empty() {
        crate::meta::Availability::no(
            "This build has no Discord application id, so Rich Presence is off.",
        )
    } else {
        crate::meta::Availability::yes()
    }
}

/// Opens the connection.
///
/// Opcode 0 is the handshake and must be the first frame; anything else on a
/// fresh socket is rejected and the socket closed.
#[tauri::command]
pub fn discord_connect(discord: State<'_, Discord>) -> Result<(), String> {
    if application_id().is_empty() {
        return Err("This build has no Discord application id.".into());
    }

    let mut slot = discord.0.lock().unwrap_or_else(|p| p.into_inner());
    if slot.is_some() {
        return Ok(());
    }

    let mut socket = connect()?;
    send(
        &mut socket,
        0,
        &json!({ "v": 1, "client_id": application_id() }),
    )?;

    *slot = Some(Connection {
        stream: socket,
        nonce: 1,
    });
    Ok(())
}

/// Publishes what is playing.
///
/// A failure closes the connection rather than being reported: Discord being
/// closed mid-session is the ordinary case, not a fault, and the next call
/// reconnects.
#[tauri::command]
pub fn discord_set(discord: State<'_, Discord>, presence: Presence) -> Result<(), String> {
    let mut slot = discord.0.lock().unwrap_or_else(|p| p.into_inner());
    let Some(connection) = slot.as_mut() else {
        return Ok(());
    };

    connection.nonce += 1;

    // Timestamps rather than a position, which is what Discord's progress bar
    // reads. `end` is derived so the bar counts down; sending only `start`
    // gives an elapsed timer, which is wrong for a track with a known length.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut timestamps = json!({});
    if presence.playing && presence.duration > 0.0 {
        timestamps = json!({
            "start": now - presence.position as i64,
            "end": now + (presence.duration - presence.position).max(0.0) as i64,
        });
    }

    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "nonce": connection.nonce.to_string(),
        "args": {
            // The Discord client wants the process id so it can clear the
            // presence if this process dies without saying goodbye.
            "pid": std::process::id(),
            "activity": {
                // Type 2 is "Listening to", which is what makes the profile say
                // "Listening to MadMusic" rather than "Playing MadMusic".
                "type": 2,
                "details": presence.title,
                "state": if presence.artist.is_empty() { presence.album.clone() } else { presence.artist.clone() },
                "timestamps": timestamps,
                "assets": {
                    // Named assets uploaded to the Discord application, not
                    // URLs: Discord will not fetch arbitrary artwork, so album
                    // art cannot be shown and the app's own icon is used.
                    "large_image": "madmusic",
                    "large_text": "MadMusic",
                },
                "instance": false,
            }
        }
    });

    if let Err(error) = send(&mut connection.stream, 1, &payload) {
        // Dropped, so the next call reconnects rather than writing into a dead
        // socket forever.
        *slot = None;
        return Err(error);
    }

    Ok(())
}

/// Clears the presence and closes the socket.
#[tauri::command]
pub fn discord_clear(discord: State<'_, Discord>) {
    let mut slot = discord.0.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(connection) = slot.as_mut() {
        connection.nonce += 1;
        let _ = send(
            &mut connection.stream,
            1,
            &json!({
                "cmd": "SET_ACTIVITY",
                "nonce": connection.nonce.to_string(),
                // No activity at all, which is how the protocol says "clear".
                "args": { "pid": std::process::id() }
            }),
        );
    }
    *slot = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_is_two_little_endian_headers_then_json() {
        let payload = json!({ "v": 1 });
        let body = serde_json::to_vec(&payload).expect("encode");

        let mut frame = Vec::new();
        frame.extend_from_slice(&0_u32.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(&body);

        assert_eq!(&frame[0..4], &[0, 0, 0, 0], "opcode 0 is the handshake");
        assert_eq!(
            u32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]) as usize,
            body.len()
        );
    }

    #[test]
    fn nothing_is_connected_to_begin_with() {
        let discord = Discord::default();
        assert!(discord.0.lock().unwrap().is_none());
    }

    #[test]
    fn a_build_with_no_id_reports_itself_off() {
        if application_id().is_empty() {
            assert!(!discord_available().available);
        }
    }
}
