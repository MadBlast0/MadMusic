/**
 * How a volume slider at 50% should actually sound, and when two tracks may be
 * blended into each other.
 *
 * Grouped because both are the same kind of thing: arithmetic about
 * *perception* rather than about samples. Neither touches an element, so both
 * are testable without an audio context — which is the point, because both are
 * the sort of code that is subtly wrong for months if nothing checks it.
 */

/* ── the volume curve ────────────────────────────────────────────────── */

export type VolumeCurve = 'logarithmic' | 'linear';

/**
 * How far above silence a slider sits before it is worth hearing.
 *
 * Below roughly -60 dB is inaudible against any room, so the curve bottoms out
 * there rather than at true zero. Without a floor, the bottom third of the
 * slider is a dead zone that all reads as "off".
 */
const FLOOR_DB = -60;

/**
 * Converts a slider position into an element volume.
 *
 * `HTMLMediaElement.volume` is *amplitude*, and loudness is roughly the
 * logarithm of amplitude — so a linear slider spends its top half making
 * changes nobody can hear and its bottom half dropping off a cliff. Halfway
 * along a linear slider is about 0.5 amplitude, which is perceived as roughly
 * three-quarters as loud, not half.
 *
 * The logarithmic curve maps the slider onto decibels instead, so halfway is
 * perceptually halfway. It is the right default and the reason this function
 * exists.
 *
 * `linear` is kept because it is what every other player does, and somebody
 * matching levels against another application by ear needs the same curve that
 * application uses.
 */
export function applyCurve(position: number, curve: VolumeCurve): number {
  const clamped = Math.min(1, Math.max(0, position));
  if (curve === 'linear') return clamped;
  // Silence is a special case: the formula approaches the floor's amplitude
  // rather than zero, and a slider at the bottom must be *off*.
  if (clamped === 0) return 0;

  const db = FLOOR_DB * (1 - clamped);
  return Math.min(1, 10 ** (db / 20));
}

/**
 * The inverse, for putting a stored amplitude back on the slider.
 *
 * Needed because the volume is persisted as what the element was given, and
 * restoring it onto a logarithmic slider without inverting the curve moves the
 * handle somewhere the user never put it.
 */
export function removeCurve(volume: number, curve: VolumeCurve): number {
  const clamped = Math.min(1, Math.max(0, volume));
  if (curve === 'linear') return clamped;
  if (clamped === 0) return 0;

  const db = 20 * Math.log10(clamped);
  return Math.min(1, Math.max(0, 1 - db / FLOOR_DB));
}

/* ── smart crossfade ─────────────────────────────────────────────────── */

/** What a crossfade decision needs to know about a track. */
export type FadeCandidate = {
  /** Beats per minute, or zero when unknown. */
  bpm: number;
  /** The album key, so a record is not cut apart. */
  albumKey: string;
  /** Whether the track runs straight into the next one on its album. */
  gapless: boolean;
};

/** How far apart two tempos may be and still be blended, as a ratio. */
const TEMPO_TOLERANCE = 0.12;

/**
 * Whether two tracks should actually be crossfaded.
 *
 * A fixed crossfade applied to everything is the setting people turn on once
 * and switch off a week later, because it ruins the two cases it must not
 * touch: consecutive tracks of one album, which were mastered to run together,
 * and a pair whose tempos are far enough apart that overlapping them is just
 * two songs playing at once.
 *
 * So the rule is conservative: fade only when the tracks are unrelated *and*
 * near enough in tempo to sit on top of each other, and never across a gapless
 * seam. An unknown tempo is treated as fadeable — most libraries have no BPM
 * tags at all, and refusing to fade anything untagged would disable the feature
 * for almost everyone.
 */
export function shouldCrossfade(
  from: FadeCandidate,
  to: FadeCandidate,
): boolean {
  // The album mastered these to touch. Anything else is vandalism.
  if (from.gapless) return false;
  if (from.albumKey && from.albumKey === to.albumKey) return false;

  if (from.bpm > 0 && to.bpm > 0) {
    const ratio = Math.abs(from.bpm - to.bpm) / Math.max(from.bpm, to.bpm);
    if (ratio > TEMPO_TOLERANCE) return false;
  }

  return true;
}

/* ── beat matching ───────────────────────────────────────────────────── */

/**
 * The playback rate that would put `to` in step with `from`.
 *
 * Beat matching is a rate change, not an effect: nudging the incoming track's
 * speed until its beats land on the outgoing one's. Returns 1 when the two are
 * already close enough, when either tempo is unknown, or when the correction
 * would be large enough to hear as a pitch shift.
 *
 * The cap is the important part. Beyond a few per cent the correction is more
 * audible than the mismatch it fixes, and a DJ transition that makes the
 * incoming track sound wrong has failed at the only thing it was for.
 */
export function matchRate(from: FadeCandidate, to: FadeCandidate): number {
  if (from.bpm <= 0 || to.bpm <= 0) return 1;

  const wanted = from.bpm / to.bpm;
  if (wanted < 1 - MAX_NUDGE || wanted > 1 + MAX_NUDGE) return 1;
  return wanted;
}

/** The largest rate change that stays inaudible, as a ratio. */
const MAX_NUDGE = 0.06;
