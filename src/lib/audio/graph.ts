/**
 * The audio processing chain: everything between the decoded track and the
 * speakers.
 *
 * # Why there is exactly one of these
 *
 * `createMediaElementSource` may be called **once** per element, ever. Call it
 * twice and it throws; and once called, the element's audio no longer reaches
 * the speakers on its own — it only comes out of whatever the graph is
 * connected to. That single fact decides the architecture:
 *
 * - There is one graph for the app, not one per feature. The equaliser, the
 *   analyser bars, mono, balance, loudness compensation and the output gain all
 *   hang off the same source node, because a second consumer is not possible.
 * - `analyser.ts` is now a facade over this. It used to own the context; it
 *   could not keep doing that once anything else needed the same element.
 *
 * # The tainting constraint, restated
 *
 * A cross-origin source with no CORS headers taints the graph, and a tainted
 * graph outputs **silence with no way back**. So this attaches only to sources
 * the app serves itself — the `stream:` protocol, which `src-tauri/src/stream.rs`
 * gives `Access-Control-Allow-Origin`. Local files come through `asset:` or
 * `blob:` and are left alone.
 *
 * That is why every control here reports whether it actually applied. A ten-band
 * equaliser that silently does nothing for local files would be worse than no
 * equaliser: the user would move a slider, hear no change, and conclude the app
 * is broken. `active` is what the settings screen reads to say so plainly.
 */

import { isOwnStream } from '@/lib/audio/cors';
import { bandLevels, waveform } from '@/lib/audio/spectrum';

/** The ten band centres, in hertz. */
export const BANDS = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

/** How far a band may be pushed, in decibels. */
export const BAND_LIMIT_DB = 12;

/** Everything the graph applies, as one value. */
export type GraphSettings = {
  /** Per-band gain in dB, one per [`BANDS`] entry. Zero is flat. */
  bands: number[];
  /** Overall trim in dB, applied before the bands. */
  preamp: number;
  /** Extra low-shelf gain in dB. Separate from band 1 so a preset survives it. */
  bassBoost: number;
  /** Fold both channels together. An accessibility control, not an effect. */
  mono: boolean;
  /** -1 fully left, 0 centred, +1 fully right. */
  balance: number;
  /**
   * Compensate for the ear's loss of bass and treble at low volume.
   *
   * Off by default and deliberately so: it changes the mix, and a "make it
   * sound better" default is a decision made on the listener's behalf.
   */
  loudness: boolean;
};

export const FLAT: GraphSettings = {
  bands: BANDS.map(() => 0),
  preamp: 0,
  bassBoost: 0,
  mono: false,
  balance: 0,
  loudness: false,
};

/** dB to a linear gain multiplier. */
function fromDb(db: number): number {
  return 10 ** (db / 20);
}

/**
 * How much shelf boost loudness compensation applies at a given volume.
 *
 * A simplification of the equal-loudness contours: the quieter the playback,
 * the more the extremes need lifting for the balance to sound the same. Zero at
 * full volume, because at full volume there is nothing to compensate for — and
 * because boosting a signal that is already at unity is how you get clipping.
 */
function loudnessBoostDb(volume: number): number {
  const quiet = 1 - Math.min(1, Math.max(0, volume));
  return quiet * quiet * 9;
}

/** One element's nodes, kept so settings can be re-applied to each of them. */
type Chain = {
  source: MediaElementAudioSourceNode;
  splitter: ChannelSplitterNode | null;
  merger: ChannelMergerNode | null;
  monoGain: [GainNode, GainNode] | null;
  panner: StereoPannerNode;
  bands: BiquadFilterNode[];
  bass: BiquadFilterNode;
  loudLow: BiquadFilterNode;
  loudHigh: BiquadFilterNode;
  preamp: GainNode;
};

class AudioGraph {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly chains = new Map<HTMLAudioElement, Chain>();
  private settings: GraphSettings = { ...FLAT, bands: [...FLAT.bands] };
  /** The volume the compensation curve is computed against. */
  private volume = 1;
  /**
   * Amplification above unity, as a multiplier of the preamp.
   *
   * The one place in the web build where a volume over 100% can actually
   * happen: `HTMLMediaElement.volume` is clamped to 1 by the specification, so
   * the deck cannot deliver a boost however it is asked. A gain node can.
   */
  private boost = 1;
  /** Set once anything throws, so a broken environment is tried only once. */
  private broken = false;
  private data = new Uint8Array(new ArrayBuffer(0));
  /** Time-domain samples, for the oscilloscope. Allocated once, reused. */
  private wave = new Uint8Array(new ArrayBuffer(0));

  /** True when at least one element is routed through the chain. */
  get active(): boolean {
    return this.chains.size > 0;
  }

  /** True when the environment refused to build a graph at all. */
  get unavailable(): boolean {
    return this.broken;
  }

  /**
   * Routes an element through the chain.
   *
   * Returns false when it did not happen — a local file, an unsupported
   * browser, or an element already attached somewhere else. Callers treat
   * false as "keep whatever you were doing", never as an error.
   */
  attach(element: HTMLAudioElement, url: string): boolean {
    if (this.broken) return false;
    if (this.chains.has(element)) return true;
    // The constraint above. Attaching to a source with no CORS headers is not
    // a degraded experience, it is silence.
    if (!isOwnStream(url)) return false;

    try {
      const context = this.ensureContext();
      if (!context) return false;

      const source = context.createMediaElementSource(element);
      const chain = this.build(context, source);
      this.chains.set(element, chain);
      this.applyTo(chain);
      return true;
    } catch {
      this.broken = true;
      return false;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;

    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return null;

    this.context = new Context();
    this.analyser = this.context.createAnalyser();
    // 1024 bins rather than the 64 this started with. Sixty-four is plenty for
    // the four bars beside a track name, and useless for a spectrum: a
    // thirty-two-band display would have half a bin per band. The extra cost is
    // one FFT of a larger size per frame, which is measured in microseconds.
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;
    this.analyser.connect(this.context.destination);
    this.data = new Uint8Array(
      new ArrayBuffer(this.analyser.frequencyBinCount),
    );
    this.wave = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    return this.context;
  }

  /**
   * Builds one element's chain, in order.
   *
   * `mono → balance → equaliser → bass → loudness → preamp → analyser`. The
   * order is not arbitrary: channel work has to happen before anything that
   * measures level, the preamp sits last so it trims the result of everything
   * rather than feeding it, and the analyser is last of all so the bars show
   * what is actually being heard.
   */
  private build(
    context: AudioContext,
    source: MediaElementAudioSourceNode,
  ): Chain {
    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    const monoGain: [GainNode, GainNode] = [
      context.createGain(),
      context.createGain(),
    ];
    const panner = context.createStereoPanner();

    // Mono is built as a real downmix rather than a `pan` trick: panning fully
    // one way silences a channel, it does not fold it in, and somebody using
    // mono for a hearing difference needs both channels' content.
    source.connect(splitter);
    splitter.connect(monoGain[0], 0);
    splitter.connect(monoGain[1], 1);
    monoGain[0].connect(merger, 0, 0);
    monoGain[0].connect(merger, 0, 1);
    monoGain[1].connect(merger, 0, 0);
    monoGain[1].connect(merger, 0, 1);
    merger.connect(panner);

    const bands = BANDS.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      // Shelves at the ends, peaks in between. A peaking filter at 31 Hz leaves
      // everything below it untouched, which is not what a "31 Hz" slider is
      // expected to do.
      filter.type =
        index === 0
          ? 'lowshelf'
          : index === BANDS.length - 1
            ? 'highshelf'
            : 'peaking';
      filter.frequency.value = frequency;
      // ~1 octave per band, which is what ten bands across the audible range
      // works out to. Narrower makes each slider inaudible.
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });

    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 120;
    bass.gain.value = 0;

    const loudLow = context.createBiquadFilter();
    loudLow.type = 'lowshelf';
    loudLow.frequency.value = 200;
    loudLow.gain.value = 0;

    const loudHigh = context.createBiquadFilter();
    loudHigh.type = 'highshelf';
    loudHigh.frequency.value = 6000;
    loudHigh.gain.value = 0;

    const preamp = context.createGain();

    let node: AudioNode = panner;
    for (const band of bands) {
      node.connect(band);
      node = band;
    }
    node.connect(bass);
    bass.connect(loudLow);
    loudLow.connect(loudHigh);
    loudHigh.connect(preamp);
    if (this.analyser) preamp.connect(this.analyser);
    else preamp.connect(context.destination);

    return {
      source,
      splitter,
      merger,
      monoGain,
      panner,
      bands,
      bass,
      loudLow,
      loudHigh,
      preamp,
    };
  }

  /** Replaces the settings and pushes them to every attached element. */
  apply(settings: Partial<GraphSettings>): void {
    this.settings = {
      ...this.settings,
      ...settings,
      bands: settings.bands ? [...settings.bands] : this.settings.bands,
    };
    for (const chain of this.chains.values()) this.applyTo(chain);
  }

  /**
   * Tells the graph what the user's volume is.
   *
   * Only loudness compensation cares — the actual volume is still set on the
   * media elements, because the deck's crossfade owns those and a second place
   * writing gain would fight it.
   */
  setVolume(volume: number): void {
    this.volume = volume;
    if (this.settings.loudness) {
      for (const chain of this.chains.values()) this.applyTo(chain);
    }
  }

  /**
   * Sets the amplification above unity, 1 being none.
   *
   * Separate from `setVolume` because the two are different questions: that one
   * describes how loud playback is, so the compensation curve can be computed
   * against it, and this one actually changes the level.
   */
  setBoost(boost: number): void {
    const next = Math.max(1, boost);
    if (next === this.boost) return;
    this.boost = next;
    for (const chain of this.chains.values()) this.applyTo(chain);
  }

  private applyTo(chain: Chain): void {
    const { bands, preamp, bassBoost, mono, balance, loudness } = this.settings;

    for (const [index, filter] of chain.bands.entries()) {
      const value = bands[index] ?? 0;
      filter.gain.value = Math.max(
        -BAND_LIMIT_DB,
        Math.min(BAND_LIMIT_DB, value),
      );
    }
    chain.bass.gain.value = Math.max(
      -BAND_LIMIT_DB,
      Math.min(BAND_LIMIT_DB, bassBoost),
    );

    const boost = loudness ? loudnessBoostDb(this.volume) : 0;
    chain.loudLow.gain.value = boost;
    // Treble needs less than bass — the ear loses more at the bottom — and
    // lifting the top as hard as the bottom turns quiet listening harsh.
    chain.loudHigh.gain.value = boost * 0.6;

    if (chain.monoGain) {
      // 0.5 each so folding two channels together does not double the level and
      // clip everything that was already near full scale.
      const [left, right] = chain.monoGain;
      left.gain.value = mono ? 0.5 : 1;
      right.gain.value = mono ? 0.5 : 1;
      // In stereo the cross-connections must be silent, which is done by
      // disconnecting them rather than by gain — a gain of zero still costs a
      // node's worth of work per sample.
      this.wireMono(chain, mono);
    }

    chain.panner.pan.value = Math.max(-1, Math.min(1, balance));

    // The preamp trims the whole chain. Boosting ten bands by 12 dB and then
    // not trimming is how an equaliser turns into a distortion pedal, so a
    // positive band average pulls the preamp down automatically unless the user
    // has already asked for a trim of their own.
    const highest = Math.max(0, ...bands, bassBoost);
    const automatic = highest > 0 ? -highest * 0.5 : 0;
    // The boost multiplies the trim rather than being added to it in decibels,
    // because it is the user asking for more level and the trim is the chain
    // protecting itself from its own equaliser. Both still apply.
    chain.preamp.gain.value = fromDb(preamp + automatic) * this.boost;
  }

  /**
   * Connects or disconnects the channel-crossing links.
   *
   * Kept separate because it is the one part of `applyTo` that changes the
   * graph's shape rather than a parameter, and doing it every time a slider
   * moves would rebuild connections on every frame of a drag.
   */
  private wireMono(chain: Chain, mono: boolean): void {
    const { splitter, monoGain, merger } = chain;
    if (!splitter || !monoGain || !merger) return;

    try {
      monoGain[0].disconnect();
      monoGain[1].disconnect();
    } catch {
      // Disconnecting something already disconnected throws in some engines and
      // is a no-op in others. Either way there is nothing to do about it.
    }

    if (mono) {
      monoGain[0].connect(merger, 0, 0);
      monoGain[0].connect(merger, 0, 1);
      monoGain[1].connect(merger, 0, 0);
      monoGain[1].connect(merger, 0, 1);
    } else {
      monoGain[0].connect(merger, 0, 0);
      monoGain[1].connect(merger, 0, 1);
    }
  }

  /** Browsers start the context suspended until a user gesture. */
  resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume();
  }

  /**
   * Current level per band, 0–1.
   *
   * Unchanged in behaviour from the analyser this replaced: the spectrum is
   * sampled across the low part of the range, because almost all the energy in
   * music sits low and an even spread gives bars that never move.
   */
  read(count: number): number[] {
    if (!this.analyser || this.data.length === 0) return [];
    this.analyser.getByteFrequencyData(this.data);

    const usable = Math.floor(this.data.length * 0.6);
    const width = Math.max(1, Math.floor(usable / count));

    return Array.from({ length: count }, (_, band) => {
      let total = 0;
      const from = band * width;
      for (let i = from; i < from + width; i += 1) total += this.data[i] ?? 0;
      const mean = total / width / 255;
      return Math.max(0.15, Math.min(1, mean * 1.4));
    });
  }

  /**
   * Logarithmic band levels, 0–1, for a visualiser.
   *
   * Distinct from [`read`], which is deliberately crude: four bars beside a
   * track name want a heavy floor and a linear sweep of the bass, and a
   * spectrum display wants neither. Keeping them apart means improving one
   * cannot make the other look wrong.
   */
  spectrum(count: number): number[] {
    if (!this.analyser || this.data.length === 0) return [];
    this.analyser.getByteFrequencyData(this.data);
    return bandLevels(this.data, count);
  }

  /** The current waveform, -1 to 1, as `count` points. */
  waveform(count: number): number[] {
    if (!this.analyser || this.wave.length === 0) return [];
    this.analyser.getByteTimeDomainData(this.wave);
    return waveform(this.wave, count);
  }

  /**
   * Sends output to a specific device.
   *
   * `AudioContext.setSinkId` is newer than the rest of this file and missing in
   * several engines, so it is feature-detected rather than typed as present.
   * Returns false when the environment cannot do it, which the device picker
   * shows as "this build cannot change the output device" rather than silently
   * doing nothing.
   */
  async setSink(deviceId: string): Promise<boolean> {
    const context = this.context as
      (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!context?.setSinkId) return false;
    try {
      await context.setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    for (const chain of this.chains.values()) {
      try {
        chain.source.disconnect();
      } catch {
        // Already gone. Nothing to do.
      }
    }
    this.chains.clear();
    this.analyser?.disconnect();
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }
}

/**
 * The app's graph.
 *
 * A module singleton for the reason at the top of the file: there is one audio
 * context, one source node per element, and no way to have a second.
 */
export const audioGraph = new AudioGraph();
