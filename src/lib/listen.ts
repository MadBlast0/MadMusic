/**
 * Working out what is playing in the room.
 *
 * # What actually leaves this machine
 *
 * Not the recording. `acoustid_listen` writes the audio to a temporary file,
 * runs `fpcalc` over it locally to produce a **fingerprint** — a compact hash
 * of the audio's shape, which cannot be turned back into sound — sends only
 * that to AcoustID, and deletes the file on both the success and the failure
 * path. Its own comment says why: a recording of somebody's room is the most
 * sensitive thing this app ever touches.
 *
 * This side holds to the same rule. The microphone is released in a `finally`,
 * so an error, a rejection or a timeout cannot leave it open; the samples live
 * in one array that goes out of scope when this returns; and nothing is written
 * to disk here at all.
 *
 * # Why the audio is re-encoded rather than sent as recorded
 *
 * `MediaRecorder` produces WebM/Opus, and `fpcalc` wants a WAV. So the recording
 * is decoded to PCM and written out as one — which is also the moment to make it
 * far smaller.
 *
 * # Why 11,025 Hz and mono
 *
 * Because chromaprint fingerprints the low end of the spectrum and does not
 * benefit from more. Eight seconds of stereo 48 kHz is about 1.5 MB and crosses
 * the IPC bridge as a JSON array of numbers; the same eight seconds mono at
 * 11,025 Hz is 176 kB and fingerprints identically. The decimation is crude —
 * nearest sample, no filter — and that is deliberate: a proper resampler would
 * be several hundred lines to produce a fingerprint that is already the same.
 */

import { invoke } from '@/lib/native';

/** What AcoustID thinks it heard. */
export type Recognition = {
  mbid: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** 0–1, AcoustID's own confidence. Rust has already dropped the weak ones. */
  score: number;
};

/** What `fpcalc` is handed. Anything above this buys nothing. */
export const LISTEN_RATE = 11_025;

/** How long to listen for, in seconds. */
export const LISTEN_SECONDS = 8;

/**
 * Mixes to mono and drops the sample rate, in one pass.
 *
 * Exported for its own tests: this is the part where an off-by-one produces
 * audio that is subtly wrong, fingerprints against nothing, and looks like
 * "recognition does not work".
 */
export function toMono(
  channels: Float32Array[],
  from: number,
  to = LISTEN_RATE,
): Float32Array {
  if (channels.length === 0 || from <= 0) return new Float32Array(0);

  const ratio = from / to;
  // Never upsample: a source already below the target is used as it is, because
  // inventing samples cannot add information a fingerprint could use.
  const step = ratio > 1 ? ratio : 1;
  const length = Math.floor(channels[0].length / step);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const source = Math.floor(i * step);
    let sum = 0;
    for (const channel of channels) sum += channel[source] ?? 0;
    out[i] = sum / channels.length;
  }

  return out;
}

/**
 * Writes mono float samples as a 16-bit PCM WAV.
 *
 * Hand-rolled because the alternative is a dependency to produce 44 bytes of
 * header. The clamp matters: a float outside −1…1 wraps rather than clipping
 * when it is cast, which turns a loud passage into noise — and noise is exactly
 * what a fingerprint cannot match.
 */
export function toWav(samples: Float32Array, rate = LISTEN_RATE): Uint8Array {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);

  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(at + i, value.charCodeAt(i));
    }
  };

  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // the size of this chunk
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric on purpose: 16-bit PCM runs −32768…32767, and scaling both
    // directions by 32768 would overflow the positive end by one.
    view.setInt16(44 + i * 2, clamped * (clamped < 0 ? 0x8000 : 0x7fff), true);
  }

  return new Uint8Array(bytes);
}

/** Whether this build can even ask for a microphone. */
export function canListen(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.AudioContext === 'function'
  );
}

/**
 * Records from the microphone and asks what it was.
 *
 * Throws with something worth showing: a refused permission, a machine with no
 * input, or a recording nothing recognised are three different answers and the
 * caller should be able to say which.
 */
export async function identifyFromTheRoom(
  seconds = LISTEN_SECONDS,
): Promise<Recognition[]> {
  if (!canListen()) {
    throw new Error('This build cannot reach a microphone.');
  }

  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;

  try {
    stream = await navigator.mediaDevices
      .getUserMedia({ audio: true })
      .catch(() => {
        throw new Error(
          'MadMusic needs permission to use the microphone to do this.',
        );
      });

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const finished = new Promise<void>((done) => {
      recorder.onstop = () => done();
    });
    recorder.start();
    await new Promise((wait) => setTimeout(wait, seconds * 1000));
    recorder.stop();
    await finished;

    if (chunks.length === 0) {
      throw new Error('Nothing was recorded. The microphone may be muted.');
    }

    const blob = new Blob(chunks, { type: chunks[0].type });
    context = new AudioContext();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());

    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
      decoded.getChannelData(i),
    );
    const wav = toWav(toMono(channels, decoded.sampleRate));

    // `Array.from` because the bridge serialises a typed array as an object
    // rather than a list, and Rust is expecting `Vec<u8>`.
    return await invoke<Recognition[]>('acoustid_listen', {
      wav: Array.from(wav),
    });
  } finally {
    // The microphone light going out is part of the contract. In `finally`
    // rather than after the call, because a refused lookup must not leave it
    // on — and on most machines that light is the only thing telling the user
    // whether they are being listened to.
    for (const track of stream?.getTracks() ?? []) track.stop();
    void context?.close().catch(() => {});
  }
}
