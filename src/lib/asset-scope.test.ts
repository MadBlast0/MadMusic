import { describe, expect, it } from 'vitest';

/**
 * The asset protocol's scope, against the directory it is supposed to cover.
 *
 * # Why this is a test and not a comment
 *
 * Because these two facts live in different languages, in different files, and
 * neither compiler can see the other. `artwork.rs` builds the thumbnail
 * directory; `tauri.conf.json` says which paths the webview may read. If they
 * disagree, **nothing fails** — `artwork_thumbnail` still writes its JPEG and
 * still returns the path, the webview is simply refused when it tries to load
 * it, and every cover quietly falls back to the two-megabyte base64 route the
 * whole cache exists to avoid.
 *
 * That is exactly how this feature came to be dead in the first place. The
 * cache, the size cap, the sweep and the modification-time key were all written
 * and tested, and `scope` was an empty list — which denies every path — so the
 * paths it handed back were never loadable and nothing ever called it.
 *
 * A silent, total fallback is the worst kind of regression: everything still
 * works, just slowly, and no test goes red. So this one does.
 *
 * # Why it reads the files through Vite
 *
 * Same reason as `components/icons/animation.test.ts`: this is a browser
 * project whose tsconfig carries no Node types, and adding them to satisfy one
 * test would loosen every other file's idea of what exists at runtime.
 * `import.meta.glob` is the bundler's own file access and needs nothing
 * installed.
 */

const FILES = import.meta.glob('/src-tauri/**/{tauri.conf.json,artwork.rs}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const conf = JSON.parse(FILES['/src-tauri/tauri.conf.json'] ?? '{}') as {
  app: {
    security: {
      csp: string;
      assetProtocol: { enable: boolean; scope: string[] };
    };
  };
};

const artwork = FILES['/src-tauri/src/artwork.rs'] ?? '';

describe('the asset protocol and the thumbnail cache', () => {
  it('is enabled, because the cache serves files rather than bytes', () => {
    expect(conf.app.security.assetProtocol.enable).toBe(true);
  });

  /** An empty scope denies everything, which is where this started. */
  it('grants at least one path', () => {
    expect(conf.app.security.assetProtocol.scope.length).toBeGreaterThan(0);
  });

  /**
   * The directory in the scope has to be the directory Rust writes to.
   *
   * `cache_dir` joins this name onto the app cache directory, and `$APPCACHE`
   * is Tauri's variable for the same place — so the two halves meet on this
   * one string.
   */
  it('covers the directory `artwork.rs` actually writes to', () => {
    const joined = artwork.match(
      /app_cache_dir\(\)[\s\S]{0,200}?\.join\("([^"]+)"\)/,
    );
    expect(
      joined,
      'artwork.rs still builds its cache dir with .join()',
    ).not.toBeNull();

    const directory = joined![1];
    expect(directory).toBe('artwork');
    expect(conf.app.security.assetProtocol.scope).toContain(
      `$APPCACHE/${directory}/*`,
    );
  });

  /**
   * And nothing wider.
   *
   * The music library is deliberately not reachable this way: files are played
   * through `stream:`, which is scoped at runtime to the folder the user
   * granted. A scope of `**` or a home directory here would hand every page the
   * webview loads the ability to read all of it, which is a far larger change
   * than making covers fast.
   */
  it('grants nothing beyond that one directory', () => {
    for (const entry of conf.app.security.assetProtocol.scope) {
      expect(entry.startsWith('$APPCACHE/'), `too broad: ${entry}`).toBe(true);
      expect(entry).not.toContain('**');
    }
  });

  /** The webview also has to be allowed to render what it fetches. */
  it('permits asset images in the content security policy', () => {
    const images = conf.app.security.csp
      .split(';')
      .find((directive) => directive.trim().startsWith('img-src'));

    expect(images).toBeDefined();
    expect(images).toContain('asset:');
    // Windows serves the protocol over this origin rather than `asset://`.
    expect(images).toContain('http://asset.localhost');
  });
});
