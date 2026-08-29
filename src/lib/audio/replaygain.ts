/**
 * Volume normalisation: making the next track as loud as this one.
 *
 * # Two mechanisms, one answer
 *
 * **ReplayGain** is a number stored in the file's tags saying how far from a
 * reference loudness the track sits. It is exact, it costs nothing to apply,
 * and roughly half of any real library has it. Where a track carries it, it is
 * the right answer and nothing else is needed.
 *
 * **A fallback** is needed for the rest, and for catalogue tracks, which carry
 * no gain tags at all. The honest fallback is "do nothing" — guessing a
 * loudness from metadata produces a normaliser that is wrong in an unpredictable
 * direction, which is worse than a library that is simply uneven.
 *
 * # Why the peak matters
 *
 * A track mastered loud gets a *negative* gain, which is always safe. A quiet
 * one gets a positive gain, and applying it can push samples past full scale,
 * where they clip — a harsh, obvious distortion that is much worse than the
 * quietness it was fixing. `track_peak` is what makes that avoidable: the gain
 * is reduced to whatever leaves the loudest sample at unity.
 *
 * This is why the schema stores gain and peak as separate columns and why zero
 * gain is not the same as "no gain data": a genuinely 0 dB adjustment has a
 * non-zero peak, and a track with no data at all has neither.
 */

/** How the user wants the normaliser to behave. Mirrors Spotify's three. */
export type Profile = 'quiet' | 'normal' | 'loud';

/**
 * The reference level each profile targets, in dB relative to the tag's own.
 *
 * ReplayGain 2.0 targets -18 LUFS. `normal` accepts that. `quiet` is for a
 * still room where dynamics are wanted; `loud` is for a bus, where the quiet
 * passages of a well-mastered record are inaudible and a listener would rather
 * lose some dynamic range than miss half the song.
 */
export const PROFILE_OFFSET_DB: Record<Profile, number> = {
  quiet: -5,
  normal: 0,
  loud: 5,
};

/** What a track carries about its own loudness. */
export type GainInfo = {
  /** dB adjustment for this track alone. */
  trackGain: number;
  /** Highest sample, 1.0 being full scale. Zero means "not measured". */
  trackPeak: number;
  /** dB adjustment that keeps a whole album's relative levels intact. */
  albumGain: number;
  albumPeak: number;
};

/** dB to a linear multiplier. */
export function fromDb(db: number): number {
  return 10 ** (db / 20);
}

/** A linear multiplier back to dB. */
export function toDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-6, gain));
}

/** Does this track carry usable loudness data at all? */
export function hasGain(info: GainInfo, albumMode: boolean): boolean {
  return albumMode
    ? info.albumPeak > 0 || info.albumGain !== 0
    : info.trackPeak > 0 || info.trackGain !== 0;
}

/**
 * The multiplier to apply to a track, 0–1 and never above.
 *
 * Never above one, and that deserves stating plainly: a normaliser that
 * *amplifies* has to have headroom it cannot know it has, because the media
 * element's own volume is already at the user's setting. Everything here is
 * attenuation — quiet tracks are left alone and loud ones are pulled down to
 * meet them. That is how Spotify's normaliser behaves too, and it is why
 * turning it on makes a library quieter rather than louder.
 */
export function gainFor(
  info: GainInfo,
  options: { albumMode?: boolean; profile?: Profile; enabled?: boolean } = {},
): number {
  const { albumMode = false, profile = 'normal', enabled = true } = options;
  if (!enabled) return 1;
  if (!hasGain(info, albumMode)) return 1;

  const gainDb = albumMode ? info.albumGain : info.trackGain;
  const peak = albumMode ? info.albumPeak : info.trackPeak;
  const wanted = gainDb + PROFILE_OFFSET_DB[profile];

  // Only attenuation. See the note above.
  let linear = Math.min(1, fromDb(wanted));

  // Clipping guard. With a peak of 0.98 and a gain that would take it to 1.4,
  // this pulls back to exactly 1.0 rather than letting it distort. A peak of
  // zero means unmeasured, and there is nothing to guard against.
  if (peak > 0) {
    linear = Math.min(linear, 1 / peak);
  }

  return Math.max(0.05, Math.min(1, linear));
}

/**
 * A gain that makes two adjacent tracks meet in the middle.
 *
 * Used by the crossfade, where the interesting failure is not loudness but
 * *change* in loudness: a quiet track fading into a loud one draws attention to
 * the seam, which is the one thing a crossfade exists to hide. Averaging the
 * two targets across the overlap costs a little accuracy on both and makes the
 * transition disappear.
 */
export function blendGain(
  outgoing: number,
  incoming: number,
  t: number,
): number {
  const clamped = Math.min(1, Math.max(0, t));
  return outgoing * (1 - clamped) + incoming * clamped;
}

/**
 * Reads gain tags out of whatever a scanner produced.
 *
 * Tag names vary by format and by tagger: Vorbis comments and ID3 `TXXX`
 * frames use `REPLAYGAIN_TRACK_GAIN`, iTunes uses `iTunNORM` (which this does
 * not attempt), and the values arrive as strings like `"-7.06 dB"`. Parsing is
 * forgiving because the alternative is discarding real data over a space.
 */
export function parseGainTags(
  tags: Record<string, string | undefined>,
): GainInfo {
  const number = (value: string | undefined): number => {
    if (!value) return 0;
    // "-7.06 dB", "-7.06dB", "-7.06" — all the same number.
    const parsed = Number.parseFloat(value.replace(/\s*dB\s*$/i, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const lookup = (...names: string[]): string | undefined => {
    for (const name of names) {
      const found =
        tags[name] ?? tags[name.toLowerCase()] ?? tags[name.toUpperCase()];
      if (found !== undefined) return found;
    }
    return undefined;
  };

  return {
    trackGain: number(lookup('REPLAYGAIN_TRACK_GAIN', 'replaygain_track_gain')),
    trackPeak: number(lookup('REPLAYGAIN_TRACK_PEAK', 'replaygain_track_peak')),
    albumGain: number(lookup('REPLAYGAIN_ALBUM_GAIN', 'replaygain_album_gain')),
    albumPeak: number(lookup('REPLAYGAIN_ALBUM_PEAK', 'replaygain_album_peak')),
  };
}
