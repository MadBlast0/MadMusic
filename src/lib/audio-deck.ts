/**
 * Two audio elements, so one track can overlap the next.
 *
 * # Why two
 *
 * Crossfade and gapless are the same problem: at the end of a track the next
 * one has to be **already decoding**. A single `<audio>` cannot do that — it
 * has one `src`, and assigning a new one tears down the current decode. So
 * neither feature is a flag on top of the old player; both need this, which is
 * why `docs/roadmap.md` listed them together as a rework rather than a feature.
 *
 * The two elements are interchangeable. One is "active" — the one you are
 * hearing and the one whose events mean anything — and the other is idle,
 * holding whatever comes next. A transition swaps the labels. Nothing is
 * created or destroyed per track, so there is no allocation on the path that
 * has to stay smooth.
 *
 * # Why the fade is on a frame loop
 *
 * `HTMLMediaElement.volume` has no scheduling. Web Audio does, but routing
 * through an `AudioContext` means `createMediaElementSource`, which taints the
 * element and needs CORS on every stream — a large cost for a volume ramp. A
 * rAF loop writing `volume` is a handful of assignments per frame and is
 * accurate enough for something whose whole point is to be unnoticeable.
 *
 * # Equal power, not linear
 *
 * Two tracks fading linearly dip in perceived loudness at the midpoint, because
 * power goes as the square of amplitude and two half-amplitude signals are
 * quieter than one full one. `equalPower` uses the sine/cosine pair, which
 * keeps the sum of powers constant and makes the seam inaudible — the one thing
 * a crossfade is for.
 */

import { prepare } from '@/lib/audio/cors';

/** How loud each side should be, `t` from 0 (all outgoing) to 1 (all incoming). */
export function equalPower(t: number): { out: number; in: number } {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    out: Math.cos((clamped * Math.PI) / 2),
    in: Math.sin((clamped * Math.PI) / 2),
  };
}

/**
 * Should the next track start now?
 *
 * Split out as a pure function because it is the part with the edge cases: a
 * duration that is not known yet, a track shorter than the crossfade, and the
 * difference between crossfading and simply not leaving a gap.
 *
 * `fade` of 0 means gapless — hand over as late as possible, which is one
 * frame's worth of lead rather than none. Starting exactly at the end is too
 * late: the element needs a moment to begin, and that moment is the gap.
 */
export function shouldHandOver(
  currentTime: number,
  duration: number,
  fade: number,
): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;

  // A four-second track cannot give up eight seconds to a fade. Half the track
  // is the most that can overlap before the fade is longer than the music.
  const lead = fade > 0 ? Math.min(fade, duration / 2) : GAPLESS_LEAD;
  return currentTime >= duration - lead;
}

/** Seconds of lead time for a gapless hand-over. */
const GAPLESS_LEAD = 0.12;

/** How often the fade loop writes a volume, in milliseconds. */
const FADE_STEP_MS = 16;

/**
 * Shorter than this, a fade is not a fade.
 *
 * Two frames. Under it the ramp finishes before the ear resolves it, so the
 * honest thing is to cut and skip the timer entirely.
 */
const MIN_AUDIBLE_FADE = 0.03;

export type DeckSide = 0 | 1;

export class AudioDeck {
  private readonly elements: [HTMLAudioElement, HTMLAudioElement];
  private side: DeckSide = 0;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  /** The user's volume, 0–1, already accounting for mute. */
  volume = 1;
  /** Loudness normalisation for the active track. */
  gain = 1;
  /** Loudness normalisation for whatever is staged. */
  stagedGain = 1;
  /** What is loaded into the idle element, if anything. */
  staged: string | null = null;

  constructor(make: () => HTMLAudioElement = () => new Audio()) {
    const a = make();
    const b = make();
    // `metadata` on both: neither should pull a whole track down before it is
    // wanted. `stage` raises the idle one to `auto` when it actually is.
    a.preload = 'metadata';
    b.preload = 'metadata';
    this.elements = [a, b];
  }

  get active(): HTMLAudioElement {
    return this.elements[this.side];
  }

  get idle(): HTMLAudioElement {
    return this.elements[this.side === 0 ? 1 : 0];
  }

  /** Is this element the one being listened to? Events from the other lie. */
  isActive(element: EventTarget | null): boolean {
    return element === this.active;
  }

  /** Every element, for attaching listeners once at startup. */
  get both(): readonly HTMLAudioElement[] {
    return this.elements;
  }

  /** Pushes the current volume to both elements, respecting a running fade. */
  applyVolume() {
    if (this.fadeTimer) return; // The fade owns the volumes while it runs.
    this.active.volume = clamp(this.volume * this.gain);
    this.idle.volume = 0;
  }

  /**
   * Loads a track into the active element, discarding anything staged.
   *
   * This is the hard cut: pressing play, skipping, choosing a track. Nothing
   * fades, because the user asked for a different track *now* and easing into
   * it would feel like lag.
   */
  load(url: string, gain: number) {
    this.cancelFade();
    this.clearStaged();

    this.gain = gain;
    const { active, idle } = this;
    idle.pause();
    idle.removeAttribute('src');

    // Before `src`, always: the attribute is read at load time and setting it
    // afterwards is silently too late. See `analyser.ts`.
    prepare(active, url);
    active.src = url;
    this.applyVolume();
  }

  /** Puts the next track in the idle element so it can begin decoding. */
  stage(url: string, gain: number) {
    if (this.staged === url) return;
    this.staged = url;
    this.stagedGain = gain;

    const { idle } = this;
    idle.preload = 'auto';
    idle.volume = 0;
    prepare(idle, url);
    idle.src = url;
    idle.load();
  }

  clearStaged() {
    this.staged = null;
    this.stagedGain = 1;
  }

  /**
   * Starts the staged track and hands over to it.
   *
   * Returns false when there is nothing staged, so the caller can fall back to
   * loading the next track the ordinary way rather than assuming this worked.
   *
   * The swap of `side` happens **immediately**, not when the fade finishes:
   * from the moment the next track is audible it is the one the UI should be
   * describing, and the outgoing element's `pause` and `ended` events must
   * stop counting. `isActive` is what makes that work.
   */
  handOver(fadeSeconds: number): boolean {
    if (!this.staged) return false;

    const outgoing = this.active;
    const incoming = this.idle;

    this.side = this.side === 0 ? 1 : 0;
    this.gain = this.stagedGain;
    this.clearStaged();

    incoming.currentTime = 0;
    incoming.volume = 0;
    void incoming.play().catch(() => {
      // Autoplay was refused, or the source is bad. Either way the outgoing
      // track is still playing and the caller will hear about it through the
      // ordinary `error`/`ended` path.
    });

    if (fadeSeconds <= 0) {
      outgoing.pause();
      outgoing.removeAttribute('src');
      this.applyVolume();
      return true;
    }

    this.runFade(outgoing, incoming, fadeSeconds);
    return true;
  }

  private runFade(
    outgoing: HTMLAudioElement,
    incoming: HTMLAudioElement,
    seconds: number,
  ) {
    this.cancelFade();

    const started = Date.now();
    const target = this.volume * this.gain;
    const from = outgoing.volume;

    this.fadeTimer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / (seconds * 1000));
      const curve = equalPower(t);

      outgoing.volume = clamp(from * curve.out);
      incoming.volume = clamp(target * curve.in);

      if (t >= 1) {
        this.cancelFade();
        outgoing.pause();
        outgoing.removeAttribute('src');
        this.applyVolume();
      }
    }, FADE_STEP_MS);
  }

  /**
   * Starts the audible track, easing the volume up from silence.
   *
   * The ease matters more than it sounds. A hard start clips the leading edge
   * of a waveform, which on headphones is an audible click; and resuming a
   * loud passage at full volume the instant the key is pressed is startling in
   * a way that fading over a tenth of a second simply is not. Below ~30ms
   * there is nothing to hear, so a shorter setting is treated as "off" rather
   * than scheduling a timer that cannot be perceived.
   */
  async resume(fadeSeconds = 0) {
    this.cancelFade();
    const { active } = this;
    const target = clamp(this.volume * this.gain);

    if (fadeSeconds < MIN_AUDIBLE_FADE) {
      active.volume = target;
      await active.play();
      return;
    }

    active.volume = 0;
    await active.play();
    // Only ramp once playback is really under way. Awaiting `play` first means
    // a rejected promise — autoplay policy, a missing source — leaves the
    // volume at zero rather than fading up silence.
    this.rampTo(target, fadeSeconds, false);
  }

  /**
   * Stops the audible track, easing the volume down first.
   *
   * The element is paused at the *end* of the ramp, not the start, so this is
   * genuinely a fade rather than a cut with a decoration on it. `applyVolume`
   * restores the real volume afterwards, which is what makes the next `resume`
   * start from a sane number.
   */
  suspend(fadeSeconds = 0) {
    this.cancelFade();
    const { active } = this;

    if (fadeSeconds < MIN_AUDIBLE_FADE) {
      active.pause();
      return;
    }

    this.rampTo(0, fadeSeconds, true);
  }

  /**
   * Walks the active element's volume to a target over `seconds`.
   *
   * Shares `fadeTimer` with the crossfade deliberately: both own the volumes
   * while they run, and `applyVolume` already stands aside for whichever holds
   * it. Two independent timers writing `volume` would fight.
   */
  private rampTo(target: number, seconds: number, pauseAtEnd: boolean) {
    const element = this.active;
    const started = Date.now();
    const from = element.volume;

    this.fadeTimer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / (seconds * 1000));
      element.volume = clamp(from + (target - from) * t);

      if (t >= 1) {
        this.cancelFade();
        if (pauseAtEnd) element.pause();
        this.applyVolume();
      }
    }, FADE_STEP_MS);
  }

  /**
   * Moves the playhead of whatever is audible.
   *
   * A method rather than letting callers write `deck.active.currentTime`. Two
   * elements make "the current time" ambiguous, and reaching through the deck
   * to mutate an element it owns is exactly the pattern that leaves the idle
   * one holding a stale position after a hand-over.
   */
  seek(seconds: number) {
    const { active } = this;
    if (Number.isFinite(active.duration)) active.currentTime = seconds;
  }

  /** Back to the start of the current track. */
  restart() {
    this.active.currentTime = 0;
  }

  /** Where the audible track is, in seconds. */
  get position(): number {
    return this.active.currentTime;
  }

  cancelFade() {
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  /** True while two tracks are overlapping. */
  get fading(): boolean {
    return this.fadeTimer !== null;
  }

  /**
   * Silences both elements without tearing the deck down.
   *
   * For when playback moves somewhere the deck does not own — the native
   * engine, or a cast receiver. Pausing is not enough on its own: an element
   * left with a `src` keeps buffering, and on a metered connection that is
   * bandwidth spent on audio nobody will hear.
   */
  stopAll() {
    this.cancelFade();
    this.clearStaged();
    for (const element of this.elements) {
      element.pause();
      element.removeAttribute('src');
    }
  }

  destroy() {
    this.cancelFade();
    for (const element of this.elements) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
