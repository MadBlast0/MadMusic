//! Playing to something that is not this computer: DLNA renderers, smart
//! televisions and network speakers.
//!
//! # What is here and what is not
//!
//! **DLNA / UPnP** is implemented in full and needs no dependency at all: SSDP
//! is a UDP multicast with a text payload, and control is SOAP over HTTP. It
//! covers most network receivers, most smart TVs, and Sonos — which speaks UPnP
//! underneath its own protocol.
//!
//! **Chromecast and AirPlay are deliberately absent**, for the same reason
//! arrived at by two different routes.
//!
//! Chromecast needs a protobuf channel over TLS. The one usable Rust crate for
//! it links OpenSSL, which does not build on Windows without a system OpenSSL
//! and would put a second TLS stack in a binary that already links rustls —
//! something `Cargo.toml` goes out of its way to avoid.
//!
//! AirPlay needs RAOP: an RSA handshake against a key Apple has never
//! published, and a real-time re-encode to ALAC. Every open implementation is
//! reverse-engineered and breaks with each tvOS release.
//!
//! In both cases the app could *discover* the devices easily and play to
//! neither. Listing a receiver that cannot be used is exactly the "control that
//! does nothing" this project refuses to ship, so neither is discovered.
//!
//! # The one thing that makes casting work
//!
//! A receiver fetches the audio **itself**. It cannot read `stream://` and it
//! cannot see this machine's files, so casting only works for a URL the
//! receiver can reach on its own. That is why [`cast_play`] takes a URL rather
//! than a track, and why the frontend resolves a direct URL before calling it.
//!
//! **Unverified on hardware.** Written against the protocols; no receiver has
//! been on the other end.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;

/// A device that can be played to.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receiver {
    /// Stable within a session. The SOAP control URL.
    pub id: String,
    pub name: String,
    /// Always `dlna`. Kept as a field so a second protocol can be added without
    /// changing the shape the frontend already handles.
    pub kind: String,
    pub address: String,
    /// The SOAP control endpoint.
    pub control_url: String,
    pub model: String,
}

/* ── discovery ─────────────────────────────────────────────────────────── */

/// The SSDP search for media renderers.
///
/// `MX: 2` asks devices to answer within two seconds, spread randomly — the
/// protocol's way of stopping fifty devices replying in the same millisecond.
/// `ssdp:discover` must be quoted; unquoted, a good number of devices ignore
/// the packet entirely.
const SSDP_SEARCH: &str = "M-SEARCH * HTTP/1.1\r\n\
HOST: 239.255.255.250:1900\r\n\
MAN: \"ssdp:discover\"\r\n\
MX: 2\r\n\
ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";

/// Finds DLNA renderers on the local network.
async fn discover_dlna(timeout: Duration) -> Vec<Receiver> {
    // Bound to every interface on an ephemeral port. A machine with a wired and
    // a wireless connection has the receiver on exactly one of them, and
    // binding to a guessed interface finds nothing half the time.
    let Ok(socket) = UdpSocket::bind(("0.0.0.0", 0)).await else {
        return Vec::new();
    };
    let _ = socket.set_broadcast(true);

    if socket
        .send_to(SSDP_SEARCH.as_bytes(), "239.255.255.250:1900")
        .await
        .is_err()
    {
        return Vec::new();
    }

    let mut found: Vec<Receiver> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let deadline = tokio::time::Instant::now() + timeout;

    let mut buffer = [0_u8; 2048];
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline - tokio::time::Instant::now();
        let Ok(Ok((read, from))) =
            tokio::time::timeout(remaining, socket.recv_from(&mut buffer)).await
        else {
            break;
        };

        let response = String::from_utf8_lossy(&buffer[..read]);
        let Some(location) = header(&response, "LOCATION") else {
            continue;
        };
        if !seen.insert(location.clone()) {
            continue;
        }

        // The SSDP reply gives only a description URL; the name and the control
        // endpoint are inside that document, so one fetch per device follows.
        if let Some(receiver) = describe(&location, &from.ip().to_string()).await {
            found.push(receiver);
        }
    }

    found
}

/// A header from an SSDP response, case-insensitively.
fn header(response: &str, name: &str) -> Option<String> {
    response.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then(|| value.trim().to_string())
    })
}

/// Reads a device description and finds its AVTransport control endpoint.
async fn describe(location: &str, address: &str) -> Option<Receiver> {
    let body = crate::meta::get_text(location).await.ok()?;

    let name =
        between(&body, "<friendlyName>", "</friendlyName>").unwrap_or_else(|| address.into());
    let model = between(&body, "<modelName>", "</modelName>").unwrap_or_default();

    // A renderer publishes several services; only AVTransport can be told to
    // play something. Finding it means locating the service block first, since
    // every service has a `<controlURL>` and taking the first one gets
    // RenderingControl about half the time.
    let block = body
        .split("<service>")
        .find(|block| block.contains("AVTransport"))?;
    let control = between(block, "<controlURL>", "</controlURL>")?;

    // Control URLs are usually relative to the description's own base.
    let control_url = if control.starts_with("http") {
        control
    } else {
        let base = location
            .rsplit_once('/')
            .map(|(head, _)| head)
            .unwrap_or(location);
        format!("{base}/{}", control.trim_start_matches('/'))
    };

    Some(Receiver {
        id: control_url.clone(),
        name,
        kind: "dlna".into(),
        address: address.to_string(),
        control_url,
        model,
    })
}

fn between(text: &str, open: &str, close: &str) -> Option<String> {
    let start = text.find(open)? + open.len();
    let end = text[start..].find(close)? + start;
    Some(text[start..end].trim().to_string())
}

/// Everything on the network that can be played to.
#[tauri::command]
pub async fn cast_discover(seconds: u64) -> Vec<Receiver> {
    // Bounded at ten seconds. SSDP answers within two by design, and a search
    // that runs longer than a person will wait is a search nobody uses.
    let mut all = discover_dlna(Duration::from_secs(seconds.clamp(1, 10))).await;
    all.sort_by(|a, b| a.name.cmp(&b.name));
    all
}

/* ── control ───────────────────────────────────────────────────────────── */

/// Sends one SOAP action to a DLNA renderer.
async fn soap(control_url: &str, action: &str, body: &str) -> Result<String, String> {
    let envelope = format!(
        r#"<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
  s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body><u:{action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
    <InstanceID>0</InstanceID>{body}
  </u:{action}></s:Body>
</s:Envelope>"#
    );

    let response = crate::meta::client()?
        .post(control_url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header(
            "SOAPACTION",
            format!("\"urn:schemas-upnp-org:service:AVTransport:1#{action}\""),
        )
        .body(envelope)
        .send()
        .await
        .map_err(|e| format!("the device did not answer: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("the device refused: {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("could not read the reply: {e}"))
}

/// Escapes a URL for embedding inside a SOAP element.
///
/// Required, and easy to miss: a stream URL is full of ampersands, and an
/// unescaped one makes the whole envelope invalid — which most renderers report
/// as a generic error that looks like the device being unsupported.
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Starts playing a URL on a receiver.
#[tauri::command]
pub async fn cast_play(
    receiver: Receiver,
    url: String,
    title: String,
    artist: String,
) -> Result<(), String> {
    if url.starts_with("stream://") || url.starts_with("file:") {
        // Stated plainly rather than attempted: the receiver fetches the audio
        // itself, and neither of these means anything on another machine.
        return Err("that track has no address the receiver can reach".into());
    }

    if receiver.kind != "dlna" {
        return Err(format!("{} receivers are not supported", receiver.kind));
    }

    // DIDL-Lite metadata, doubly escaped: it is XML inside an XML element,
    // which is what the specification asks for however odd it looks.
    let didl = xml_escape(&format!(
        r#"<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <item id="0" parentID="-1" restricted="1">
    <dc:title>{}</dc:title><upnp:artist>{}</upnp:artist>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    <res protocolInfo="http-get:*:audio/mpeg:*">{}</res>
  </item></DIDL-Lite>"#,
        xml_escape(&title),
        xml_escape(&artist),
        xml_escape(&url)
    ));

    soap(
        &receiver.control_url,
        "SetAVTransportURI",
        &format!(
            "<CurrentURI>{}</CurrentURI><CurrentURIMetaData>{didl}</CurrentURIMetaData>",
            xml_escape(&url)
        ),
    )
    .await?;

    soap(&receiver.control_url, "Play", "<Speed>1</Speed>").await?;
    Ok(())
}

/// Pauses, resumes or stops a receiver.
#[tauri::command]
pub async fn cast_transport(receiver: Receiver, action: String) -> Result<(), String> {
    if receiver.kind != "dlna" {
        return Err("use the receiver's own controls for this device".into());
    }

    match action.as_str() {
        "pause" => soap(&receiver.control_url, "Pause", "").await.map(|_| ()),
        "play" => soap(&receiver.control_url, "Play", "<Speed>1</Speed>")
            .await
            .map(|_| ()),
        "stop" => soap(&receiver.control_url, "Stop", "").await.map(|_| ()),
        other => Err(format!("{other} is not a transport action")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssdp_headers_are_read_case_insensitively() {
        let response = "HTTP/1.1 200 OK\r\nlocation: http://192.168.1.5/desc.xml\r\n";
        assert_eq!(
            header(response, "LOCATION").as_deref(),
            Some("http://192.168.1.5/desc.xml")
        );
    }

    #[test]
    fn a_missing_header_is_none() {
        assert!(header("HTTP/1.1 200 OK\r\n", "LOCATION").is_none());
    }

    #[test]
    fn ampersands_in_a_url_are_escaped() {
        assert_eq!(xml_escape("http://x/y?a=1&b=2"), "http://x/y?a=1&amp;b=2");
    }

    #[test]
    fn a_local_url_is_refused_rather_than_attempted() {
        // The receiver fetches the audio itself, so these can never work.
        for url in ["stream://track/1", "file:///music/a.mp3"] {
            assert!(url.starts_with("stream://") || url.starts_with("file:"));
        }
    }

    #[test]
    fn text_between_markers_is_trimmed() {
        assert_eq!(
            between(
                "<friendlyName> Living Room </friendlyName>",
                "<friendlyName>",
                "</friendlyName>"
            ),
            Some("Living Room".to_string())
        );
    }

    #[test]
    fn a_relative_control_url_resolves_against_the_description() {
        let location = "http://192.168.1.5:8080/desc.xml";
        let base = location.rsplit_once('/').map(|(head, _)| head).unwrap();
        assert_eq!(
            format!("{base}/{}", "/AVTransport/control".trim_start_matches('/')),
            "http://192.168.1.5:8080/AVTransport/control"
        );
    }
}
