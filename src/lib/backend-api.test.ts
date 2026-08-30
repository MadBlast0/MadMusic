import { describe, expect, it } from 'vitest';

/**
 * Every function the app names actually exists in the backend.
 *
 * # Why this is needed at all
 *
 * `backend-api.ts` builds references through `anyApi` rather than importing
 * `convex/_generated/api`, so the app can build with no backend configured.
 * That trade is documented there and it is the right one — but it throws away
 * the compiler's check that a named function exists. `anyApi.devices.nowPlayng`
 * is a perfectly valid expression. It type-checks, it builds, it ships, and it
 * fails at runtime in front of somebody whose devices then silently never
 * appear.
 *
 * There is no deployment here to ask, and there does not need to be: both sides
 * are in this repository. This reads the exports out of `convex/` and the
 * references out of `backend-api.ts` and insists they agree.
 *
 * # What it does not check
 *
 * Argument shapes and return types. Those are still hand-declared and still
 * unchecked, and a test that pretended otherwise would be worse than none. This
 * catches the whole class of *naming* drift — a renamed or deleted function,
 * and a typo — which is the failure this trade actually produces.
 */

const CONVEX = import.meta.glob('/convex/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const API = import.meta.glob('/src/lib/backend-api.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The public function names a Convex module exports. */
function exportsOf(source: string): Set<string> {
  const names = new Set<string>();
  // `export const foo = query({`, and the mutation/action/internal* variants.
  for (const match of source.matchAll(
    /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

/** Every `anyApi.<module>.<fn>` the app refers to. */
function references(source: string): { module: string; fn: string }[] {
  return [...source.matchAll(/anyApi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)].map(
    (match) => ({ module: match[1], fn: match[2] }),
  );
}

describe('the names the app calls the backend by', () => {
  const api = Object.values(API)[0] ?? '';
  const refs = references(api);

  const modules = new Map<string, Set<string>>();
  for (const [path, source] of Object.entries(CONVEX)) {
    const name = path.replace('/convex/', '').replace(/\.ts$/, '');
    modules.set(name, exportsOf(source));
  }

  it('finds both sides, so a silent pass is not possible', () => {
    // Guards the guard. If either glob or either parser stopped matching, every
    // assertion below would pass over nothing at all and report success.
    expect(refs.length, 'references parsed out of backend-api').toBeGreaterThan(
      30,
    );
    expect(modules.size, 'convex modules found').toBeGreaterThan(5);
    expect(modules.get('devices')?.size ?? 0).toBeGreaterThan(4);
  });

  it('names only modules that exist', () => {
    const missing = [...new Set(refs.map((r) => r.module))].filter(
      (name) => !modules.has(name),
    );
    expect(missing, 'referenced convex modules with no file').toEqual([]);
  });

  it('names only functions those modules export', () => {
    const missing = refs
      .filter(({ module, fn }) => {
        const found = modules.get(module);
        return found ? !found.has(fn) : false;
      })
      .map(({ module, fn }) => `backend.${module}.${fn}`);

    // Named rather than counted, so a failure says exactly which call would
    // have thrown at runtime.
    expect(missing, 'referenced functions the backend does not export').toEqual(
      [],
    );
  });
});
