import { describe, expect, it } from 'vitest';

import { shoulderAt, silhouette } from '@/lib/search-morph';

/**
 * The search field's outline.
 *
 * A path is a string, and a string is awkward to assert about — so these test
 * the properties that would actually break the shape rather than the exact
 * characters. A malformed path does not throw; it renders as nothing, or as
 * something wrong. `NaN` in particular is silent: the browser drops the whole
 * `d` attribute and the field loses its background entirely, which is the
 * failure most worth a test.
 */

const FIELD = 32;

/** Every number in a path, for the assertions that care about the numbers. */
function numbers(path: string): number[] {
  return (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe('the silhouette', () => {
  it('is a closed path', () => {
    const path = silhouette({
      width: 400,
      height: FIELD,
      field: FIELD,
      shoulder: 0,
    });

    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('is an exact pill at rest', () => {
    const path = silhouette({
      width: 400,
      height: FIELD,
      field: FIELD,
      shoulder: 0,
    });

    // The caps are semicircles of half the field height, so the straight top
    // runs from x=16 to x=384 and the arcs have radius 16.
    expect(path).toContain('M16 0');
    expect(path).toContain('H384');
    expect(path).toContain('A16 16 0 0 1 16 0');
  });

  it('never produces NaN, at any point in the animation', () => {
    // The one failure that is completely silent: the browser discards a `d`
    // containing NaN, and the field simply has no background any more.
    for (let step = 0; step <= 20; step += 1) {
      const shoulder = step / 20;
      const path = silhouette({
        width: 400,
        height: FIELD + 260 * shoulder,
        field: FIELD,
        shoulder,
      });

      expect(path).not.toContain('NaN');
      for (const value of numbers(path))
        expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('keeps the panel inside the field it hangs from', () => {
    const path = silhouette({
      width: 400,
      height: 300,
      field: FIELD,
      shoulder: 1,
    });

    // Nothing may sit outside the shape's own box. A control point that
    // escaped would bulge the shoulder past the edge and then dent back in,
    // which is the artefact the clamp in `along` exists to prevent.
    for (const value of numbers(path)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(400);
    }
  });

  it('pinches the panel in from the field on both sides equally', () => {
    const path = silhouette({
      width: 400,
      height: 300,
      field: FIELD,
      shoulder: 1,
    });

    // 16/58 of a 32px field is 8.83. The panel's sides sit there and at its
    // mirror, so the shape is symmetric about its centre.
    expect(path).toContain('8.83');
    expect(path).toContain('391.17');
  });

  it('never drops a shoulder below the floor it has to meet', () => {
    // The invariant behind the legs. The shoulder lands at `landY` and the
    // panel's side runs from there down to `height - floor`; if the first is
    // below the second the side runs *backwards* and the outline crosses
    // itself. Swept across every panel height between nothing and plenty,
    // because the artefact lived in the shallow middle as well as at zero.
    for (let panel = 0; panel <= 80; panel += 1) {
      const path = silhouette({
        width: 400,
        height: FIELD + panel,
        field: FIELD,
        shoulder: 1,
      });

      // `C … x landY` is the shoulder's arrival; the `V y` straight after it
      // is the side that leaves it. Read both back off the path rather than
      // recomputing the geometry, so this tests the shape that actually ships.
      const commands = path.match(/[A-Z][^A-Z]*/g) ?? [];
      const curve = commands.find((c) => c.startsWith('C')) ?? '';
      const side = commands.find((c) => c.startsWith('V')) ?? '';

      const landY = Number(curve.trim().split(/\s+/).at(-1));
      const sideY = Number(side.slice(1).trim());

      expect(Number.isFinite(landY)).toBe(true);
      expect(Number.isFinite(sideY)).toBe(true);
      expect(landY).toBeLessThanOrEqual(sideY + 0.01);
    }
  });

  it('grows no shoulders when there is no panel to grow them around', () => {
    // The state this misses is the ordinary one: focus the field before the
    // suggestions have loaded. The spring drives `shoulder` to 1 on focus, but
    // the height is still exactly the pill — so a shoulder would run on past
    // the cap's widest point, drop below the shape's own floor, and double
    // back up to meet it. That renders as two legs hanging off the bottom.
    //
    // With no room to form in, the shape must be indistinguishable from the
    // one at rest.
    const open = silhouette({
      width: 400,
      height: FIELD,
      field: FIELD,
      shoulder: 1,
    });
    const rest = silhouette({
      width: 400,
      height: FIELD,
      field: FIELD,
      shoulder: 0,
    });

    expect(open).toBe(rest);
  });

  it('forms the shoulders in proportion to the room they have', () => {
    // Half the room a fully formed shoulder needs should give a shoulder that
    // is under way but not finished — not one clipped to nothing, and not one
    // hanging past the floor.
    const half = silhouette({
      width: 400,
      height: FIELD + 15,
      field: FIELD,
      shoulder: 1,
    });

    expect(half).not.toBe(
      silhouette({ width: 400, height: FIELD + 15, field: FIELD, shoulder: 0 }),
    );
    expect(half).not.toContain('NaN');
  });

  it('survives being measured before it has been laid out', () => {
    // A width of zero is what `clientWidth` reports for an element that has
    // not been through layout yet, and an arc wider than its shape is a path
    // the renderer refuses outright.
    const path = silhouette({
      width: 0,
      height: FIELD,
      field: FIELD,
      shoulder: 0,
    });

    expect(path).not.toContain('NaN');
    for (const value of numbers(path))
      expect(Number.isFinite(value)).toBe(true);
  });
});

describe('the shoulder lag', () => {
  it('has not started while the panel is first opening', () => {
    // The body extends downward at full width before the sides pinch in. Both
    // on one clock is what made the old version read as a panel sliding out
    // from under a bar.
    expect(shoulderAt(0)).toBe(0);
    expect(shoulderAt(0.05)).toBe(0);
  });

  it('catches up by the time the shape is open', () => {
    expect(shoulderAt(1)).toBe(1);
  });

  it('runs behind the height through the opening half', () => {
    // Only the opening half, and deliberately so. The lag exists to let the
    // body extend downward at full width before the sides pinch in, which is a
    // claim about the *start* of the move. Past the midpoint smoothstep's own
    // acceleration lets the shoulders catch up, so that by the time the shape
    // has stopped growing it is fully formed rather than still settling.
    for (const progress of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      expect(shoulderAt(progress)).toBeLessThan(progress);
    }
  });

  it('eases at both ends rather than starting with a corner', () => {
    const early = shoulderAt(0.2) - shoulderAt(0.15);
    const middle = shoulderAt(0.55) - shoulderAt(0.5);

    expect(early).toBeLessThan(middle);
  });

  it('stays inside 0 and 1 however far it is pushed', () => {
    expect(shoulderAt(-3)).toBe(0);
    expect(shoulderAt(9)).toBe(1);
  });
});
