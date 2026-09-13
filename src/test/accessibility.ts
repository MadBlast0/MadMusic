import axe, { type Result, type RunOptions } from 'axe-core';

/**
 * The accessibility audit, as a test rather than as a claim.
 *
 * # Why this exists
 *
 * The backlog carried "full keyboard navigation audit" and "screen-reader
 * labels and landmarks audit" as partial for a long time, with the note "every
 * new control is reachable and labelled; no formal audit has been run". That
 * note was honest and it was also the problem: an audit somebody performed once
 * is a statement about the day they performed it. Six weeks and forty
 * components later it says nothing.
 *
 * Running the rules in the suite makes it a property of the code instead. A
 * button that ships without a name fails a test rather than reaching somebody
 * using a screen reader.
 *
 * # What this can and cannot catch
 *
 * Stated plainly, because the failure mode of automated accessibility testing
 * is believing it is complete. Axe finds roughly a third to a half of WCAG
 * issues: missing names, bad contrast, broken ARIA, duplicate landmarks, form
 * fields with no label. It cannot tell whether a focus order makes sense,
 * whether an announcement is *useful*, or whether a control is operable by
 * somebody who cannot hold two keys at once.
 *
 * So this is a floor, not a ceiling — and the tests that use it say so.
 *
 * # Why colour-contrast is off
 *
 * Not to hide failures. jsdom computes no layout and resolves no CSS custom
 * properties, so every colour reads as `rgba(0,0,0,0)` against `rgba(0,0,0,0)`
 * and the rule reports contrast failures on elements that are fine in a
 * browser. A rule that always fails teaches people to ignore the report.
 * Contrast is instead a design decision made in `globals.css`, where the
 * high-contrast palette lives.
 */
const OPTIONS: RunOptions = {
  rules: {
    // See above: jsdom has no layout, so this can only produce noise.
    'color-contrast': { enabled: false },
    // These judge a whole document — a page needs one `<main>`, a `<title>`, a
    // `lang`. A test rendering one component into a bare `<div>` is not a
    // document, and failing it for that would be measuring the harness.
    'page-has-heading-one': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
  },
};

/** A violation, formatted so a failure names the element and the rule. */
function describe(violation: Result): string {
  const where = violation.nodes
    .slice(0, 3)
    .map((node) => `      ${node.html}`)
    .join('\n');

  return `  ${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${where}`;
}

/**
 * Runs the rules over an element and returns what failed.
 *
 * Returns rather than asserts, so a caller can assert with its own message —
 * and so a test can allow a known, documented exception without turning the
 * whole check off.
 */
async function audit(element: HTMLElement): Promise<string[]> {
  const results = await axe.run(element, OPTIONS);
  return results.violations.map(describe);
}

/** Fails with the violations spelled out, or passes silently. */
export async function expectAccessible(element: HTMLElement): Promise<void> {
  const problems = await audit(element);
  if (problems.length === 0) return;

  throw new Error(
    `Accessibility violations:\n${problems.join('\n')}\n\n` +
      'Axe catches a third to a half of WCAG issues — a pass here is a floor, ' +
      'not a guarantee.',
  );
}
