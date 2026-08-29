import { describe, expect, it } from 'vitest';

/**
 * Every animated icon sits under something that can drive it.
 *
 * # Why this is a test and not a review note
 *
 * The icons animate by Motion's variant propagation: an ancestor declaring
 * `whileHover="hover"` drives the `hover` variants beneath it. Nothing warns
 * when that ancestor is missing. A plain `<button>` renders the glyph at the
 * right size, in the right place, fully functional — and simply still. So the
 * failure is invisible in review, invisible in the type checker, and invisible
 * in every other test.
 *
 * It is also not hypothetical: twenty-nine usages across eighteen files had
 * drifted into exactly that state before this existed. One at a time, each an
 * entirely reasonable-looking line.
 *
 * # What it actually checks
 *
 * That an animated icon is never rendered inside a bare `<Button>`. The two
 * things that *can* drive it are `IconButton`, which always does, and
 * `<Button animate>`, which opts in. Anywhere else — a menu item, a card, plain
 * layout — is fine and deliberate: not every glyph is meant to move.
 *
 * # Why it reads source through Vite rather than `node:fs`
 *
 * This is a browser project; its tsconfig carries no Node types, and adding
 * them to satisfy one test would loosen every other file's idea of what exists
 * at runtime. `import.meta.glob` is the bundler's own file access and needs
 * nothing installed.
 */

const SOURCES = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Icons that declare a `hover` variant, read from the source rather than listed. */
function animatedIcons(): string[] {
  const source = SOURCES['/src/components/icons/index.tsx'] ?? '';
  const names: string[] = [];
  const exports = [
    ...source.matchAll(/export function ([A-Z][A-Za-z0-9]*)\(/g),
  ];

  exports.forEach((match, index) => {
    const start = match.index;
    const end = exports[index + 1]?.index ?? source.length;
    const body = source.slice(start, end);
    if (body.includes('variants=') || body.includes('whileHover')) {
      names.push(match[1]);
    }
  });

  return names;
}

/**
 * Every `<Button …>` in a file, with its attributes and its children.
 *
 * A regular expression cannot do this. The obvious `<Button[^>]*>` stops at the
 * first `>` it sees, and these buttons are full of arrow functions — so
 * `onClick={() => …}` truncates the attribute list, and everything after it,
 * including an `animate` that is already there, becomes invisible. That is not
 * hypothetical either: the first version of this scan read those buttons as
 * unmarked and a codemod duly marked them twice, which the type checker caught
 * and the test did not.
 *
 * So it scans, tracking brace depth and string quotes, and ends the tag at the
 * first `>` that is genuinely outside both.
 */
function buttons(source: string): { attributes: string; body: string }[] {
  const found: { attributes: string; body: string }[] = [];

  for (const open of source.matchAll(/<Button(?=[\s/>])/g)) {
    const from = open.index + '<Button'.length;
    let i = from;
    let depth = 0;
    let quote: string | null = null;

    while (i < source.length) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      i += 1;
    }

    const attributes = source.slice(from, i);
    if (source[i - 1] === '/') {
      found.push({ attributes, body: '' });
      continue;
    }
    const close = source.indexOf('</Button>', i);
    found.push({
      attributes,
      body: source.slice(i + 1, close < 0 ? source.length : close),
    });
  }

  return found;
}

/**
 * Whether an attribute list carries a bare flag.
 *
 * Quoted values are removed first: `data-x="animate"` contains the word but
 * does not set the prop, and a scan that counted it would read a button as
 * already marked and skip it. The lookarounds then keep `animated` and
 * `animateOnHover` from matching `animate`.
 */
function has(attributes: string, word: string): boolean {
  const bare = attributes.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '');
  // Split into identifier tokens rather than escaping a pattern: this file
  // is read back by tooling that has mangled backslashes more than once.
  return bare.split(/[^A-Za-z0-9_]+/).includes(word);
}

describe('icons that are meant to animate', () => {
  const animated = animatedIcons();

  it('finds the animated icons at all', () => {
    // Guards the guard. If the parser stopped matching, every assertion below
    // would pass over an empty list and report success for no work done —
    // which is worse than the bug, because it looks like coverage.
    expect(animated.length).toBeGreaterThan(15);
    expect(animated).toContain('Shuffle');
  });

  it('are never rendered inside a button that cannot drive them', () => {
    const offenders: string[] = [];

    for (const [file, source] of Object.entries(SOURCES)) {
      if (file.includes('/components/icons/') || file.includes('.test.')) {
        continue;
      }

      for (const button of source.matchAll(
        /<Button\b([^>]*?)>(.*?)<\/Button>/gs,
      )) {
        const [, attributes, body] = button;
        // `asChild` renders the child instead, so this element is not the one
        // that would animate — the child is free to be a motion component.
        if (/\banimate\b/.test(attributes) || /\basChild\b/.test(attributes)) {
          continue;
        }
        for (const icon of animated) {
          if (body.includes(`<${icon}`)) {
            offenders.push(`${icon} in ${file}`);
          }
        }
      }
    }

    // Named rather than counted, so a failure says which glyph went still.
    expect(offenders).toEqual([]);
  });

  it('reads a tag whose attributes contain an arrow function', () => {
    // The blind spot that caused the bug. `<Button[^>]*>` ends the tag at the
    // `>` of `=>`, so `animate` after the handler is never seen and the button
    // reads as unmarked. Both of these are correctly marked and must produce
    // no offenders.
    const sample = `
      <Button onClick={() => go('a > b')} animate>
        <Shuffle />
      </Button>
      <Button
        animate
        onClick={() => {
          if (a > b) run();
        }}
      >
        <Refresh />
      </Button>
    `;

    const seen = buttons(sample);
    expect(seen).toHaveLength(2);
    for (const { attributes } of seen) {
      expect(has(attributes, 'animate')).toBe(true);
    }
  });

  it('does not mistake a longer word for the flag', () => {
    // `animated` is not `animate`, and neither is `animate` inside a string.
    const [only] = buttons(
      `<Button className="animated" data-x="animate"><Shuffle /></Button>`,
    );
    expect(has(only.attributes, 'animate')).toBe(false);
  });
});
