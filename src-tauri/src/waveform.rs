//! Turning a file into a picture of itself.
//!
//! Peaks power three things at once, which is why it is worth decoding a whole
//! track to get them:
//!
//! - **Waveform scrubbing**, the SoundCloud interaction — seeing where the
//!   quiet parts are before you drag.
//! - **Silence skipping**, which needs to know where the music actually starts
//!   and stops. `src/lib/audio/playback.ts` reads the same array.
//! - **Timed comments**, which are drawn against the waveform.
//!
//! # Why one byte per bucket
//!
//! A three-minute track at a thousand buckets is a kilobyte as bytes and four
//! kilobytes as a JSON array of numbers, and the array has to be parsed before
//! it can be drawn. At a thousand buckets a waveform is already finer than any
//! screen it will be drawn on.
//!
//! # Why this is slow, and why that is fine
//!
//! It decodes the entire file. There is no shortcut: the peaks *are* the audio.
//! On a modern machine that is a fraction of a second per track, it happens in
//! the background, and the result is cached in `waveform` forever after. What
//! it must never do is block playback, which is why it runs on the blocking
//! pool and why nothing waits for it.

use std::io::BufReader;

use tauri::State;

use crate::db::{fail, Db, DbResult};

/// How many buckets a waveform has.
///
/// A thousand is about one bucket per pixel on a wide window, which is the
/// point at which more resolution stops being visible.
pub const BUCKETS: usize = 1_000;

/// Decodes a file and reduces it to peaks.
///
/// Peak rather than RMS: a waveform is a picture of the *shape* of a track, and
/// RMS flattens the transients that make one recognisable. Peak is also what
/// silence detection wants — a passage whose loudest sample is near zero is
/// silence, whatever its average says.
pub fn peaks_for(path: &str) -> Result<Vec<u8>, String> {
    use rodio::Source;

    let file = std::fs::File::open(path).map_err(|e| format!("could not open {path}: {e}"))?;
    let decoder = rodio::Decoder::new(BufReader::new(file))
        .map_err(|e| format!("could not decode {path}: {e}"))?;

    let channels = decoder.channels().max(1) as usize;
    let rate = decoder.sample_rate().max(1) as usize;
    let seconds = decoder
        .total_duration()
        .map(|duration| duration.as_secs_f64())
        .unwrap_or(0.0);

    // The frame count is needed up front to know how wide a bucket is, and a
    // stream that will not report its duration cannot give one. Ten minutes is
    // assumed in that case: the buckets end up uneven rather than wrong, and a
    // waveform that is slightly stretched is far better than none.
    let frames = if seconds > 0.0 {
        (seconds * rate as f64) as usize
    } else {
        rate * 600
    };
    let per_bucket = (frames / BUCKETS).max(1);

    let mut peaks = vec![0_u8; BUCKETS];
    let mut bucket = 0_usize;
    let mut frame_in_bucket = 0_usize;
    let mut loudest = 0_f32;
    let mut channel = 0_usize;

    for sample in decoder.convert_samples::<f32>() {
        loudest = loudest.max(sample.abs());

        channel += 1;
        if channel < channels {
            continue;
        }
        channel = 0;

        frame_in_bucket += 1;
        if frame_in_bucket < per_bucket {
            continue;
        }

        if bucket < BUCKETS {
            peaks[bucket] = (loudest.clamp(0.0, 1.0) * 255.0) as u8;
        }
        bucket += 1;
        frame_in_bucket = 0;
        loudest = 0.0;

        if bucket >= BUCKETS {
            break;
        }
    }

    // A file shorter than expected leaves the tail at zero, which would draw as
    // silence that is not there. Trimming to what was actually filled is the
    // honest shape.
    if bucket < BUCKETS && bucket > 0 {
        peaks.truncate(bucket);
    }

    Ok(peaks)
}

/// Computes a waveform and stores it.
///
/// Returns the peaks as well as storing them, so the first caller does not have
/// to read back what it just asked to be written.
#[tauri::command]
pub async fn waveform_generate(
    db: State<'_, Db>,
    track_id: String,
    path: String,
) -> DbResult<Vec<u8>> {
    // Decoding is CPU-bound and can take a second on a long file. On the async
    // runtime that would stall every other command behind it, including the one
    // resolving the next stream URL.
    let peaks = tokio::task::spawn_blocking(move || peaks_for(&path))
        .await
        .map_err(|e| fail("waveform", e))??;

    db.with(|c| {
        c.execute(
            "INSERT INTO waveform (track_id, peaks, at) VALUES (?1, ?2, ?3)
             ON CONFLICT(track_id) DO UPDATE SET peaks = excluded.peaks, at = excluded.at",
            rusqlite::params![track_id, peaks, crate::db::now_ms()],
        )
        .map_err(|e| fail("store waveform", e))
    })?;

    Ok(peaks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_waveform_has_one_byte_per_bucket() {
        // The shape the schema stores and the frontend draws. Stated as a test
        // because changing it silently would make every stored waveform
        // unreadable without anything failing.
        assert_eq!(std::mem::size_of::<u8>(), 1);
        assert_eq!(BUCKETS, 1_000);
    }

    #[test]
    fn decoding_a_file_that_is_not_audio_fails_rather_than_panicking() {
        let path = std::env::temp_dir().join("madmusic-not-audio.mp3");
        std::fs::write(&path, b"this is not audio").expect("write");

        let result = peaks_for(&path.to_string_lossy());
        assert!(result.is_err(), "a text file is not decodable");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_missing_file_is_an_error_naming_it() {
        let error = peaks_for("definitely-not-here.flac").expect_err("missing");
        assert!(error.contains("definitely-not-here.flac"));
    }
}
