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
});
