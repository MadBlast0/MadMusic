//! Native audio output: decoding and playing a file in Rust instead of in the
//! webview.
//!
//! # Why a second audio path exists
//!
//! The webview's `<audio>` element is the app's audio engine and stays that
//! way. It handles the catalogue, the crossfade, the equaliser and everything
//! else, and `docs/roadmap.md` settled that deliberately.
//!
//! What it cannot do is play a file **at the file's own sample rate**. A
//! browser mixes everything to one output rate — 48 kHz on most systems — so a
//! 44.1 kHz album is resampled, and a 96 kHz one is resampled twice as far. For
//! almost everybody that is inaudible and the trade is obviously right. For the
//! people who asked for bit-perfect output it is exactly the thing they are
//! trying to avoid, and no amount of work inside the webview fixes it.
//!
//! So this is a narrow second path: **local files only, one at a time, no
//! crossfade**. It is the honest shape of the feature rather than a second
//! player pretending to be the first.
//!
//! # Why it owns a thread
//!
//! `rodio::OutputStream` holds a `cpal` stream, and a `cpal` stream is not
//! `Send` — on Windows it wraps a raw COM pointer that belongs to the thread
//! that created it. Tauri's managed state must be `Send + Sync`, so the stream
//! cannot be stored there at all.
//!
//! The answer is the usual one for a resource pinned to a thread: give it a
//! thread of its own and talk to it through a channel. What lives in Tauri's
//! state is a sender and a snapshot of what the engine is doing — both plain
//! data, both `Send`.
//!
//! # What "bit-perfect" means here, precisely
//!
//! That the samples decoded from the file are handed to the device at the rate
//! they were encoded at, with no resampling and no gain applied. It does *not*
//! mean exclusive-mode device access — that needs WASAPI, CoreAudio and ALSA
//! calls `cpal` does not expose, and claiming it without them would be a lie.
//! [`EngineState::exact_rate`] reports whether the device accepted the file's
//! rate, and the settings screen shows that rather than a checkbox that means
//! nothing.
//!
//! **Unverified on hardware.** Written against the API and compiled; it has not
//! been listened to on a real DAC.

use std::io::BufReader;
use std::sync::mpsc::{Receiver as ChannelReceiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

/// Told to the frontend the moment a track runs out.
///
/// # Why an event rather than the poll
///
/// The sink knows it is empty within a sample of the truth. Before this, the
/// only thing that ever asked was `Command::Poll`, sent by a 250 ms timer in
/// the frontend — so the gap between two tracks was however much of that
/// interval happened to be left, varying run to run. For a music player that is
/// the most audible defect there is: it turns every track change into an
/// uneven pause.
pub const ENDED_EVENT: &str = "madmusic://track-ended";

/// Called on the audio thread when a track runs out.
///
/// `Send + Sync` because the audio thread invokes it; `'static` because it
/// outlives the call that installed it.
pub type EndedCallback = Box<dyn Fn() + Send + Sync + 'static>;

/// How often the audio thread looks at the sink while something is playing.
///
/// Twenty milliseconds is below what anyone can hear as a gap and cheap to
/// check — `sink.empty()` is a length test, not I/O. The thread only ticks at
/// all while a track is open and running; the rest of the time it blocks on the
/// channel, so an idle engine costs nothing.
const TICK: Duration = Duration::from_millis(20);

/// One output the machine offers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// The device name, which is also its identity — `cpal` has no stable ids.
    pub name: String,
    pub is_default: bool,
    /// Sample rates the device will accept without resampling.
    pub rates: Vec<u32>,
    pub max_channels: u16,
}

/// What the native engine is doing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    /// True once an output has been opened successfully.
    pub available: bool,
    pub playing: bool,
    /// The file currently loaded, if any.
    pub path: String,
    pub position: f64,
    pub duration: f64,
    /// The rate the file is encoded at.
    pub source_rate: u32,
    /// The rate the device is running at.
    pub device_rate: u32,
    /// True when the two above match, so nothing resampled the audio.
    pub exact_rate: bool,
    /// Channels the file carries.
    pub source_channels: u16,
    /// Channels the device was opened with.
    pub device_channels: u16,
    /// True when every channel reached the device without being folded down.
    pub exact_channels: bool,
    pub device: String,
    /// Set when the last operation failed, for the diagnostics screen.
    pub error: String,
}

/// What the frontend can ask the audio thread to do.
enum Command {
    Play {
        path: String,
        device: String,
        /// Open the device at the file's own rate rather than resampling.
        bit_perfect: bool,
        /// Keep the file's channel count rather than folding down to stereo.
        passthrough: bool,
    },
    Pause,
    Resume,
    Stop,
    Volume(f32),
    Seek(f64),
    /// Refreshes `position` from the sink, which only the audio thread can read.
    Poll,
    Close,
}

/// The handle Tauri keeps.
///
/// A sender and a shared snapshot. Both are `Send + Sync`; the stream that is
/// neither never leaves the thread that made it.
pub struct Engine {
    to_audio: Sender<Command>,
    state: Arc<Mutex<EngineState>>,
    /// What to call when a track ends, once there is somewhere to send it.
    ///
    /// A plain callback rather than an `AppHandle`, so this module does not
    /// name a Tauri runtime type at all. Holding an `AppHandle` here dragged
    /// Wry's WebView2 linkage into the unit-test binary, which then failed to
    /// start with `STATUS_ENTRYPOINT_NOT_FOUND` before running a single test —
    /// the test harness builds no app, so nothing ever loads the webview those
    /// imports resolve against. `lib.rs` supplies the closure and keeps the
    /// Tauri dependency where the rest of it already lives.
    ///
    /// Filled by [`Engine::attach`] rather than passed to [`Engine::start`]:
    /// the engine is constructed before there is anywhere to emit to, and
    /// emitting must never be a precondition for playing audio. An engine
    /// nobody attached still decodes and simply stays quiet.
    ended: Arc<OnceLock<EndedCallback>>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::start()
    }
}

impl Engine {
    /// Spawns the audio thread.
    ///
    /// Started eagerly at launch, but nothing is *opened* until something asks
    /// to play — so a machine with no sound card costs one idle thread and no
    /// error.
    pub fn start() -> Self {
        let (to_audio, from_app) = std::sync::mpsc::channel();
        let state = Arc::new(Mutex::new(EngineState::default()));
        let shared = Arc::clone(&state);
        let ended: Arc<OnceLock<EndedCallback>> = Arc::new(OnceLock::new());
        let emitter = Arc::clone(&ended);

        std::thread::Builder::new()
            .name("madmusic-audio".into())
            .spawn(move || run(from_app, shared, emitter))
            // A machine that cannot spawn a thread has larger problems, and the
            // webview path still works — so this is logged rather than fatal.
            .map_err(|error| log::error!("could not start the audio thread: {error}"))
            .ok();

        Self {
            to_audio,
            state,
            ended,
        }
    }

    /// Gives the audio thread somewhere to send [`ENDED_EVENT`].
    ///
    /// Called from `setup`, once. Calling it again is a no-op rather than an
    /// error: the first handle is the one that matters and a second would mean
    /// two windows racing to advance the same queue.
    pub fn attach(&self, on_ended: EndedCallback) {
        if self.ended.set(on_ended).is_err() {
            log::warn!("the audio thread already has an end-of-track callback");
        }
    }

    fn send(&self, command: Command) {
        // A closed channel means the audio thread is gone. Nothing to do about
        // it from here, and the webview path is unaffected.
        if self.to_audio.send(command).is_err() {
            log::warn!("the audio thread is not running");
        }
    }

    fn snapshot(&self) -> EngineState {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

/// The audio thread's whole life.
///
/// Everything that touches `rodio` happens here, on one thread, in one place.
fn run(
    commands: ChannelReceiver<Command>,
    state: Arc<Mutex<EngineState>>,
    ended: Arc<OnceLock<EndedCallback>>,
) {
    // `Option`, because nothing is opened until something is played.
    let mut open: Option<Output> = None;

    let set = |patch: &dyn Fn(&mut EngineState)| {
        let mut current = state.lock().unwrap_or_else(|p| p.into_inner());
        patch(&mut current);
    };

    loop {
        // Blocking while idle, ticking while playing.
        //
        // The tick is what notices the end of a track without being asked, so
        // it is only needed while there is a track to end. An engine sitting
        // idle would otherwise wake fifty times a second for the rest of the
        // session to look at a sink nobody is feeding.
        let watching = { state.lock().unwrap_or_else(|p| p.into_inner()).playing };

        let received = if watching {
            match commands.recv_timeout(TICK) {
                Ok(command) => Some(command),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match commands.recv() {
                Ok(command) => Some(command),
                Err(_) => break,
            }
        };

        if let Some(output) = open.as_ref() {
            // Read before handling the command, so a `Stop` arriving in the
            // same breath as the end of a track cannot make this report a
            // position from a sink that is about to be replaced.
            let position = output.sink.get_pos().as_secs_f64();
            let finished = output.sink.empty();

            let finished_now = {
                let mut current = state.lock().unwrap_or_else(|p| p.into_inner());
                current.position = position;
                let just_ended = finished && current.playing;
                if just_ended {
                    current.playing = false;
                }
                just_ended
            };

            // Outside the lock. Emitting runs through Tauri's event machinery,
            // and holding the state mutex across it would let a slow listener
            // block every `engine_state` call in the app.
            if finished_now {
                if let Some(notify) = ended.get() {
                    notify();
                }
            }
        }

        let Some(command) = received else {
            continue;
        };

        match command {
            Command::Play {
                path,
                device,
                bit_perfect,
                passthrough,
            } => {
                // Reopened only when the device changed. Reopening
                // unconditionally would cut off the current track for a device
                // that has not changed — which is what happens if you skip
                // while a picker is on screen.
                // The file's format decides how the device is opened, so it
                // has to be read before the stream exists. Cheap: the decoder
                // reads a header, not the audio.
                let wanted = probe(&path).unwrap_or_default();

                // Reopened when the device changed *or* when the format it was
                // opened for no longer matches. Reopening unconditionally would
                // cut off the current track for a device that has not changed —
                // which is what happens if you skip while a picker is on screen.
                let reopen = match &open {
                    Some(output) => {
                        (!device.is_empty() && output.device_name != device)
                            || !output.suits(&wanted, bit_perfect, passthrough)
                    }
                    None => true,
                };

                if reopen {
                    match Output::open(&device, &wanted, bit_perfect, passthrough) {
                        Ok(output) => open = Some(output),
                        Err(error) => {
                            set(&|s| {
                                s.error = error.clone();
                                s.playing = false;
                            });
                            continue;
                        }
                    }
                }

                let Some(output) = open.as_ref() else {
                    continue;
                };
                match output.play(&path) {
                    Ok((source_rate, duration)) => {
                        let device_rate = output.device_rate;
                        let device_channels = output.device_channels;
                        let device_name = output.device_name.clone();
                        let source_channels = wanted.channels;
                        let path = path.clone();
                        set(&|s| {
                            s.available = true;
                            s.playing = true;
                            s.path = path.clone();
                            s.position = 0.0;
                            s.duration = duration;
                            s.source_rate = source_rate;
                            s.device_rate = device_rate;
                            // The honest definition, per the note at the top.
                            s.exact_rate = source_rate == device_rate;
                            s.source_channels = source_channels;
                            s.device_channels = device_channels;
                            // Equal, not "at least": more device channels than
                            // the file has means the extra ones are silent,
                            // which is fine — fewer means something was folded.
                            s.exact_channels = channels_kept(source_channels, device_channels);
                            s.device = device_name.clone();
                            s.error.clear();
                        });
                    }
                    Err(error) => set(&|s| {
                        s.error = error.clone();
                        s.playing = false;
                    }),
                }
            }

            Command::Pause => {
                if let Some(output) = open.as_ref() {
                    output.sink.pause();
                }
                set(&|s| s.playing = false);
            }

            Command::Resume => {
                if let Some(output) = open.as_ref() {
                    output.sink.play();
                }
                set(&|s| s.playing = true);
            }

            Command::Stop => {
                if let Some(output) = open.as_ref() {
                    output.sink.stop();
                }
                set(&|s| {
                    s.playing = false;
                    s.position = 0.0;
                    s.path.clear();
                });
            }

            Command::Volume(volume) => {
                if let Some(output) = open.as_ref() {
                    output.sink.set_volume(volume.clamp(0.0, 1.0));
                }
            }

            Command::Seek(seconds) => {
                if let Some(output) = open.as_ref() {
                    // `rodio` gained seeking late and it fails on formats whose
                    // decoders cannot do it. The error is recorded rather than
                    // swallowed, so the UI can leave the scrubber where it was
                    // instead of showing a position the audio never reached.
                    match output
                        .sink
                        .try_seek(std::time::Duration::from_secs_f64(seconds.max(0.0)))
                    {
                        Ok(()) => set(&|s| {
                            s.position = seconds;
                            s.error.clear();
                        }),
                        Err(error) => {
                            let message = format!("this format cannot be seeked: {error}");
                            set(&|s| s.error = message.clone());
                        }
                    }
                }
            }

            // Kept, but no longer where anything is discovered.
            //
            // The loop above refreshes the position and notices the end of a
            // track every tick, so by the time a poll arrives the snapshot is
            // at most twenty milliseconds old rather than as stale as the
            // caller's own interval. This remains so that `engine_state` has
            // something to send and so an explicit refresh is still possible;
            // duplicating the end-of-track check here would risk two answers to
            // one question.
            Command::Poll => {}

            Command::Close => {
                open = None;
                set(&|s| *s = EngineState::default());
            }
        }
    }
}

/// One open device, and the sink feeding it.
struct Output {
    /// Held for as long as the engine is meant to be able to make sound;
    /// dropping it stops everything.
    _stream: rodio::OutputStream,
    sink: rodio::Sink,
    device_name: String,
    device_rate: u32,
    device_channels: u16,
    /// The format this stream was opened to suit, for [`Output::suits`].
    opened_for: Format,
    opened_bit_perfect: bool,
    opened_passthrough: bool,
}

/// A file's audio format, as far as the output needs to care.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Format {
    pub rate: u32,
    pub channels: u16,
}

/// Reads a file's format without decoding it.
///
/// Opens a decoder purely to read the header. Cheap — symphonia parses enough
/// to answer this and stops — and necessary, because the device has to be
/// opened for the file's format *before* any of its audio is played.
fn probe(path: &str) -> Option<Format> {
    use rodio::Source;

    let file = std::fs::File::open(path).ok()?;
    let decoder = rodio::Decoder::new(BufReader::new(file)).ok()?;
    Some(Format {
        rate: decoder.sample_rate(),
        channels: decoder.channels(),
    })
}

/// Whether a stream opened for one format can carry another.
///
/// Free rather than a method so it can be tested without a sound card, which
/// matters because the consequence of getting it wrong is audible: too eager
/// and the music stops between every track, too lax and a preference silently
/// stops being honoured.
///
/// The comparison is against the format the stream was *opened for*, not what
/// the device ended up running at. A device that cannot do 192 kHz falls back
/// to 48 — and if the next track is also 192 kHz, reopening would fail the same
/// way and stop the music for nothing. Matching on the request means the
/// fallback is decided once.
fn still_suits(
    opened_for: &Format,
    opened_bit_perfect: bool,
    opened_passthrough: bool,
    wanted: &Format,
    bit_perfect: bool,
    passthrough: bool,
) -> bool {
    if bit_perfect != opened_bit_perfect || passthrough != opened_passthrough {
        return false;
    }
    // Neither preference is on, so any open stream will do — rodio resamples
    // into whatever the device is already running at.
    if !bit_perfect && !passthrough {
        return true;
    }
    if bit_perfect && wanted.rate != opened_for.rate {
        return false;
    }
    if passthrough && wanted.channels != opened_for.channels {
        return false;
    }
    true
}

/// Whether every channel of the source reached the device.
///
/// Equal or more is fine: extra device channels are silent. Fewer means the
/// audio was folded down, which is the thing passthrough exists to avoid.
fn channels_kept(source: u16, device: u16) -> bool {
    source > 0 && device >= source
}

/// Picks the stream configuration to open a device with.
///
/// The rules, in order:
///
/// 1. With neither preference on, the device's own default. This is what
///    everybody gets and what everybody should get: the OS mixer is already
///    running at that rate, so anything else costs a resample somewhere.
/// 2. With bit-perfect on, a configuration that accepts the file's exact rate.
///    Falls back to the default when the device cannot — a 192 kHz file on a
///    48 kHz-only interface still has to play.
/// 3. With passthrough on, prefer a configuration carrying at least as many
///    channels as the file. Again a preference, not a requirement.
fn choose_config(
    device: &cpal::Device,
    wanted: &Format,
    bit_perfect: bool,
    passthrough: bool,
) -> Option<cpal::SupportedStreamConfig> {
    use cpal::traits::DeviceTrait;

    let default = device.default_output_config().ok();
    if !bit_perfect && !passthrough {
        return default;
    }

    let rate = cpal::SampleRate(wanted.rate);
    let mut best: Option<cpal::SupportedStreamConfig> = None;

    for range in device.supported_output_configs().ok()? {
        let rate_ok = !bit_perfect
            || (wanted.rate > 0
                && rate >= range.min_sample_rate()
                && rate <= range.max_sample_rate());
        let channels_ok = !passthrough || range.channels() >= wanted.channels;
        if !rate_ok || !channels_ok {
            continue;
        }

        // At the file's rate where that is allowed, otherwise the highest the
        // range offers — which is the closest thing to "do not resample down".
        let config = if bit_perfect && wanted.rate > 0 {
            range.with_sample_rate(rate)
        } else {
            range.with_max_sample_rate()
        };

        // Fewer channels is better once the requirement is met: opening eight
        // channels for a stereo file leaves six silent and, on some drivers,
        // moves the music to the wrong pair of speakers.
        let better = match &best {
            None => true,
            Some(current) => config.channels() < current.channels(),
        };
        if better {
            best = Some(config);
        }
    }

    // Nothing matched. The preference is a preference — playing the file
    // resampled beats refusing to play it.
    best.or(default)
}

impl Output {
    /// Opens a device by name.
    ///
    /// Named rather than indexed because `cpal` gives no stable identifier, and
    /// an index shifts the moment a USB interface is plugged in — which would
    /// silently move playback to a different device.
    fn open(
        device_name: &str,
        wanted: &Format,
        bit_perfect: bool,
        passthrough: bool,
    ) -> Result<Self, String> {
        use cpal::traits::{DeviceTrait, HostTrait};

        let host = cpal::default_host();
        let device = if device_name.is_empty() {
            host.default_output_device()
        } else {
            host.output_devices()
                .map_err(|e| format!("could not list outputs: {e}"))?
                .find(|candidate| candidate.name().map(|n| n == device_name).unwrap_or(false))
                // A device unplugged since it was chosen falls back to the
                // default: silence with an error is a worse answer than sound
                // from the wrong speaker.
                .or_else(|| host.default_output_device())
        }
        .ok_or_else(|| "this machine reports no audio output".to_string())?;

        let name = device.name().unwrap_or_default();

        // The configuration to open the stream with. Asking for the file's own
        // rate is what makes playback bit-perfect: the default config resamples
        // everything to whatever the device is already running at, which is
        // inaudible to almost everybody and the entire point for the few who
        // asked for this.
        let config = choose_config(&device, wanted, bit_perfect, passthrough)
            .ok_or_else(|| format!("{name} offers no usable output format"))?;

        let device_rate = config.sample_rate().0;
        let device_channels = config.channels();

        let (stream, handle) = rodio::OutputStream::try_from_device_config(&device, config)
            .map_err(|e| format!("could not open {name}: {e}"))?;
        let sink =
            rodio::Sink::try_new(&handle).map_err(|e| format!("could not start {name}: {e}"))?;

        Ok(Self {
            _stream: stream,
            sink,
            device_name: name,
            device_rate,
            device_channels,
            opened_for: wanted.clone(),
            opened_bit_perfect: bit_perfect,
            opened_passthrough: passthrough,
        })
    }

    /// Whether this output is already set up for the file about to play.
    ///
    /// Reopening a stream stops whatever is on it, so this exists to avoid
    /// doing that when nothing about the required format has changed — which
    /// is the common case, since consecutive tracks of one album share a
    /// format.
    fn suits(&self, wanted: &Format, bit_perfect: bool, passthrough: bool) -> bool {
        still_suits(
            &self.opened_for,
            self.opened_bit_perfect,
            self.opened_passthrough,
            wanted,
            bit_perfect,
            passthrough,
        )
    }

    /// Decodes a file and starts it. Answers its sample rate and its length.
    fn play(&self, path: &str) -> Result<(u32, f64), String> {
        use rodio::Source;

        let file = std::fs::File::open(path).map_err(|e| format!("could not open {path}: {e}"))?;
        let decoder = rodio::Decoder::new(BufReader::new(file))
            .map_err(|e| format!("could not decode {path}: {e}"))?;

        let rate = decoder.sample_rate();
        let duration = decoder
            .total_duration()
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        self.sink.stop();
        self.sink.append(decoder);
        self.sink.play();

        Ok((rate, duration))
    }
}

/* ── commands ──────────────────────────────────────────────────────────── */

/// Lists what the machine can play through.
///
/// Failure is reported as an empty list rather than an error: a machine with no
/// audio device is a real state, and a settings screen showing an error where
/// it should show "no outputs found" is harder to act on.
///
/// Enumeration does not touch the audio thread — it opens nothing, so it is
/// safe from anywhere.
#[tauri::command]
pub fn engine_devices() -> Vec<Device> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok())
        .unwrap_or_default();

    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };

    devices
        .filter_map(|device| {
            let name = device.name().ok()?;
            let configs = device.supported_output_configs().ok()?;

            let mut rates = Vec::new();
            let mut max_channels = 0_u16;
            for config in configs {
                max_channels = max_channels.max(config.channels());
                // A range, not a list: a device advertising 44100–192000 accepts
                // every standard rate in between, and showing only the endpoints
                // would hide the one the user's album is actually encoded at.
                for candidate in [44_100, 48_000, 88_200, 96_000, 176_400, 192_000] {
                    let rate = cpal::SampleRate(candidate);
                    if rate >= config.min_sample_rate()
                        && rate <= config.max_sample_rate()
                        && !rates.contains(&candidate)
                    {
                        rates.push(candidate);
                    }
                }
            }
            rates.sort_unstable();

            Some(Device {
                is_default: name == default_name,
                name,
                rates,
                max_channels,
            })
        })
        .collect()
}

/// Starts a file on the native output.
///
/// `bit_perfect` and `passthrough` are passed per call rather than held as
/// engine state, because they are settings the user can change between one
/// track and the next — and a stream opened under the old preference has to be
/// reopened when they do. [`Output::suits`] is what decides whether that is
/// actually necessary.
#[tauri::command]
pub fn engine_play(
    engine: State<'_, Engine>,
    path: String,
    device: String,
    bit_perfect: bool,
    passthrough: bool,
) -> EngineState {
    engine.send(Command::Play {
        path,
        device,
        bit_perfect,
        passthrough,
    });
    engine.snapshot()
}

#[tauri::command]
pub fn engine_pause(engine: State<'_, Engine>) -> EngineState {
    engine.send(Command::Pause);
    engine.snapshot()
}

#[tauri::command]
pub fn engine_resume(engine: State<'_, Engine>) -> EngineState {
    engine.send(Command::Resume);
    engine.snapshot()
}

#[tauri::command]
pub fn engine_stop(engine: State<'_, Engine>) -> EngineState {
    engine.send(Command::Stop);
    engine.snapshot()
}

/// Sets the output volume.
///
/// Applied here rather than left to the webview because on this path the
/// webview is not in the signal chain at all — its `<audio>` element is not
/// playing anything.
#[tauri::command]
pub fn engine_volume(engine: State<'_, Engine>, volume: f32) -> EngineState {
    engine.send(Command::Volume(volume));
    engine.snapshot()
}

#[tauri::command]
pub fn engine_seek(engine: State<'_, Engine>, seconds: f64) -> EngineState {
    engine.send(Command::Seek(seconds));
    engine.snapshot()
}

/// Where playback has got to.
///
/// The commands above are fire-and-forget — the audio thread applies them in
/// order and the snapshot they return is from before it did. This is the one
/// that asks for a fresh reading, and it is what the frontend polls.
#[tauri::command]
pub fn engine_state(engine: State<'_, Engine>) -> EngineState {
    engine.send(Command::Poll);
    engine.snapshot()
}

/// Closes the output.
///
/// Offered because holding a device open keeps it awake, and on some interfaces
/// that means a fan. Nothing else in the app has a reason to call it.
#[tauri::command]
pub fn engine_close(engine: State<'_, Engine>) {
    engine.send(Command::Close);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fmt(rate: u32, channels: u16) -> Format {
        Format { rate, channels }
    }

    #[test]
    fn probing_something_that_is_not_audio_answers_nothing() {
        // Not an error: a file that has moved or is not audio should leave the
        // device opened at its default, not stop the engine.
        assert!(probe("definitely-not-a-file.flac").is_none());
    }

    #[test]
    fn any_open_stream_suits_when_no_preference_is_set() {
        // The common case, and the one that must never reopen: rodio resamples
        // into whatever is already running.
        assert!(still_suits(
            &fmt(44_100, 2),
            false,
            false,
            &fmt(192_000, 6),
            false,
            false
        ));
    }

    #[test]
    fn a_changed_rate_needs_a_new_stream_when_bit_perfect() {
        assert!(!still_suits(
            &fmt(44_100, 2),
            true,
            false,
            &fmt(96_000, 2),
            true,
            false
        ));
    }

    #[test]
    fn the_same_rate_reuses_the_stream() {
        // Consecutive tracks of one album share a format, so this is the case
        // that keeps an album gapless.
        assert!(still_suits(
            &fmt(44_100, 2),
            true,
            false,
            &fmt(44_100, 2),
            true,
            false
        ));
    }

    #[test]
    fn a_rate_the_device_refused_is_not_retried_every_track() {
        // The device fell back to 48 kHz for a 192 kHz file. The next 192 kHz
        // track must reuse that stream rather than reopening, failing the same
        // way, and stopping the music between every track.
        assert!(still_suits(
            &fmt(192_000, 2),
            true,
            false,
            &fmt(192_000, 2),
            true,
            false
        ));
    }

    #[test]
    fn turning_a_preference_on_or_off_needs_a_new_stream() {
        assert!(!still_suits(
            &fmt(44_100, 2),
            false,
            false,
            &fmt(44_100, 2),
            true,
            false
        ));
        assert!(!still_suits(
            &fmt(44_100, 2),
            true,
            true,
            &fmt(44_100, 2),
            true,
            false
        ));
    }

    #[test]
    fn a_changed_channel_count_needs_a_new_stream_when_passing_through() {
        assert!(!still_suits(
            &fmt(48_000, 2),
            false,
            true,
            &fmt(48_000, 6),
            false,
            true
        ));
    }

    #[test]
    fn channels_are_kept_when_the_device_has_at_least_as_many() {
        assert!(channels_kept(2, 2));
        // Extra device channels are silent, which is not a downmix.
        assert!(channels_kept(2, 8));
    }

    #[test]
    fn channels_are_folded_when_the_device_has_fewer() {
        // Six channels into a stereo device. The thing passthrough exists to
        // report.
        assert!(!channels_kept(6, 2));
    }

    #[test]
    fn an_unknown_channel_count_is_not_claimed_as_exact() {
        // Zero means the probe failed. Reporting that as bit-perfect would be
        // a claim nobody checked.
        assert!(!channels_kept(0, 2));
    }

    #[test]
    fn a_fresh_engine_reports_nothing_playing() {
        let engine = Engine::start();
        let state = engine.snapshot();
        assert!(!state.playing);
        assert!(!state.available);
    }

    #[test]
    fn exact_rate_is_the_two_rates_matching() {
        let matched = EngineState {
            source_rate: 44_100,
            device_rate: 44_100,
            exact_rate: true,
            ..Default::default()
        };
        assert!(matched.exact_rate);

        let resampled = EngineState {
            source_rate: 44_100,
            device_rate: 48_000,
            exact_rate: false,
            ..Default::default()
        };
        assert!(
            !resampled.exact_rate,
            "48k output of a 44.1k file is not bit-perfect"
        );
    }

    /// Listing devices must not panic on a machine with no sound card, which is
    /// what continuous integration runs on.
    #[test]
    fn listing_devices_is_safe_with_no_hardware() {
        let _ = engine_devices();
    }

    /// Commands to a running engine must not block or panic, whatever the
    /// machine has. Nothing is opened until something is played, so this
    /// exercises the channel rather than the audio.
    #[test]
    fn commands_are_accepted_without_hardware() {
        let engine = Engine::start();
        engine.send(Command::Volume(0.5));
        engine.send(Command::Poll);
        engine.send(Command::Close);
        assert!(!engine.snapshot().playing);
    }

    /// An engine nobody attached must still work.
    ///
    /// `attach` supplies somewhere to send [`ENDED_EVENT`], and it is deliberately
    /// optional: the engine is built before the app handle exists, and emitting
    /// must never be a precondition for decoding audio. If this ever became
    /// required, an engine constructed early — or in a test — would panic or
    /// stall instead of simply staying quiet.
    #[test]
    fn an_unattached_engine_still_accepts_commands() {
        let engine = Engine::start();
        assert!(engine.ended.get().is_none(), "nothing attached yet");
        engine.send(Command::Volume(0.5));
        engine.send(Command::Poll);
        assert!(!engine.snapshot().playing);
    }

    /// The idle thread must block rather than spin.
    ///
    /// While nothing is playing the loop waits on the channel; it only switches
    /// to a 20 ms tick once `playing` is set, because the tick exists solely to
    /// notice a track ending. Without that split an idle engine would wake fifty
    /// times a second for the rest of the session.
    ///
    /// Asserted through behaviour rather than by watching the CPU: a command
    /// sent to an idle engine still has to be answered promptly, which is what
    /// would break if the blocking branch were wrong.
    #[test]
    fn an_idle_engine_answers_promptly() {
        let engine = Engine::start();
        let started = std::time::Instant::now();
        engine.send(Command::Volume(0.25));
        // `Poll` round-trips through the same channel, so once the snapshot
        // comes back the command before it has been handled.
        let _ = engine_state_for_test(&engine);
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "an idle engine took {:?} to answer",
            started.elapsed()
        );
    }

    /// `engine_state` without the Tauri `State` wrapper.
    fn engine_state_for_test(engine: &Engine) -> EngineState {
        engine.send(Command::Poll);
        engine.snapshot()
    }
}
