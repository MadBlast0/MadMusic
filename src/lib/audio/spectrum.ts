/**
 * Turning raw analyser bytes into something worth drawing.
 *
 * # Why the bands are logarithmic
 *
 * An FFT's bins are linear in frequency, and hearing is not. Splitting 1024
 * linear bins evenly across thirty-two bars gives the first bar everything from
 * 0–700 Hz — where nearly all the energy in music lives — and the last bar the
 * region between 20 kHz and 21 kHz, where there is almost never anything at
 * all. The result is one bar that pins to the ceiling and thirty-one that never
 * move. Logarithmic edges give each bar roughly the same share of what a
 * listener would call "the sound".
 *
 * # Why this is separate from the graph
 *
 * Because it is arithmetic, and arithmetic is testable. The graph owns an
 * `AudioContext`, which is not.
 */

/**
 * Bin edges for `count` logarithmic bands over `bins` FFT bins.
 *
 * Starts at bin 1 rather than 0: bin 0 is DC, which carries no sound and would
 * give the first bar a constant offset.
 */
export function bandEdges(bins: number, count: number): number[] {
  if (bins < 2 || count < 1) return [];

  const lowest = 1;
  const ratio = Math.log(bins / lowest);

  const edges: number[] = [];
  for (let band = 0; band <= count; band += 1) {
    const at = Math.round(lowest * Math.exp((ratio * band) / count));
    // Each edge is at least one bin past the last, so no band is empty and no
    // bar is permanently dark.
    edges.push(Math.max(at, (edges[band - 1] ?? 0) + 1));
  }
  return edges;
}

/**
 * Band levels, 0–1, from byte frequency data.
 *
 * The peak within a band rather than its mean: a mean over a wide high band is
 * dominated by the empty bins beside a real partial, and the bar barely moves
 * when a cymbal hits.
 */
export function bandLevels(
  data: ArrayLike<number>,
  count: number,
  edges: number[] = bandEdges(data.length, count),
): number[] {
  if (edges.length < 2) return Array.from({ length: count }, () => 0);

  return Array.from({ length: count }, (_, band) => {
    const from = edges[band];
    const to = Math.min(edges[band + 1], data.length);

    let peak = 0;
    for (let bin = from; bin < to; bin += 1) {
      const value = data[bin] ?? 0;
      if (value > peak) peak = value;
    }
    return Math.min(1, peak / 255);
  });
}

/**
 * A waveform, -1 to 1, resampled to `count` points.
 *
 * Byte time-domain data is centred on 128.
 *
 * # Why neither averaging nor plain decimation
 *
 * Averaging a window towards its mean is what makes an oscilloscope of loud
 * music look like a quiet flat line — a symmetrical wave averages to silence.
 *
 * Taking every nth sample instead trades that for aliasing, and the failure is
 * worse because it is intermittent: where the step lands in step with the
 * signal, every sample comes from the same phase and the trace reads as a
 * constant offset rather than a wave. A test caught exactly that on a square
 * wave with an even step.
 *
 * Taking the single furthest-from-centre sample per window has the same
 * problem in a subtler form: byte data runs 0–255 around a centre of 128, so
 * the negative side is one unit further out and *every* window of a symmetric
 * wave resolves to its trough. The trace becomes a line along the bottom.
 *
 * So this is the peak envelope every audio editor draws: each window's minimum
 * and maximum, emitted alternately. Both extremes survive, nothing aliases, and
 * where there are as many points as samples each window holds one value and the
 * output is the signal itself.
 */
export function waveform(data: ArrayLike<number>, count: number): number[] {
  if (data.length === 0 || count < 1) {
    return Array.from({ length: Math.max(0, count) }, () => 0);
  }

  const step = data.length / count;
  return Array.from({ length: count }, (_, at) => {
    const from = Math.floor(at * step);
    const to = Math.min(
      data.length,
      Math.max(from + 1, Math.floor((at + 1) * step)),
    );

    let low = 255;
    let high = 0;
    for (let sample = from; sample < to; sample += 1) {
      const value = data[sample] ?? 128;
      if (value < low) low = value;
      if (value > high) high = value;
    }

    return ((at % 2 === 0 ? high : low) - 128) / 128;
  });
}
