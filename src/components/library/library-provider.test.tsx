import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryProvider } from '@/components/library/library-provider';
import { useLibrary } from '@/components/library/library-context';
import type { LocalFolder } from '@/lib/local-source';

/**
 * Restoring the stored folder on launch.
 *
 * `library_restore` is not a read. It re-grants the folder to the asset scope
 * and runs a full scan that writes every track back to SQLite, so calling it
 * twice is real duplicated work against the database — and the provider's
 * `cancelled` flag never prevented it, because that flag guards the *result*
 * and the call has already left by then.
 *
 * These tests pin both halves of the fix: exactly one call, and a `restoring`
 * flag that still clears. The second matters more than it looks. The obvious
 * guard — a "started" boolean that makes the second pass bail — leaves the
 * first pass, already cancelled by StrictMode's cleanup, as the only one that
 * could clear the flag. It no longer will, and the library sits on "Restoring
 * your library…" forever.
 */

const ROOT_KEY = 'madmusic-library-root';

const restoreFolder = vi.fn();

// Only `getLocalSource` is replaced. Mocking the whole module strands
// `library-model`, which imports its types and helpers from here and is used by
// `adoptFolder` to flatten the tree before indexing it.
vi.mock('@/lib/local-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/local-source')>()),
  getLocalSource: () => ({
    kind: 'native',
    restoreFolder,
    pickFolder: vi.fn(),
  }),
}));

vi.mock('@/lib/store', () => ({
  store: { tracksUpsert: vi.fn(async () => undefined) },
}));

function folder(path: string): LocalFolder {
  return { path, name: 'Music', folders: [], tracks: [], truncated: false };
}

/** Surfaces the two pieces of state these tests are about. */
function Probe() {
  const { root, restoring } = useLibrary();
  return (
    <>
      <span data-testid="restoring">{String(restoring)}</span>
      <span data-testid="root">{root?.path ?? 'none'}</span>
    </>
  );
}

describe('restoring the stored folder', () => {
  beforeEach(() => {
    restoreFolder.mockReset();
    window.localStorage.setItem(ROOT_KEY, 'C:/Music');
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('asks the backend once even though StrictMode runs the effect twice', async () => {
    restoreFolder.mockResolvedValue(folder('C:/Music'));

    render(
      <StrictMode>
        <LibraryProvider>
          <Probe />
        </LibraryProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('root')).toHaveTextContent('C:/Music'),
    );

    // The assertion the fix exists for. Before it, StrictMode's second pass
    // issued a second grant and a second full scan.
    expect(restoreFolder).toHaveBeenCalledTimes(1);
  });

  it('stops restoring once the answer arrives', async () => {
    restoreFolder.mockResolvedValue(folder('C:/Music'));

    render(
      <StrictMode>
        <LibraryProvider>
          <Probe />
        </LibraryProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('restoring')).toHaveTextContent('false'),
    );
  });

  it('stops restoring when the folder can no longer be read', async () => {
    // An unplugged drive. The stored path is dropped and the app opens as
    // normal rather than hanging on the restoring state.
    restoreFolder.mockResolvedValue(null);

    render(
      <StrictMode>
        <LibraryProvider>
          <Probe />
        </LibraryProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('restoring')).toHaveTextContent('false'),
    );
    expect(screen.getByTestId('root')).toHaveTextContent('none');
    expect(window.localStorage.getItem(ROOT_KEY)).toBeNull();
  });

  it('stops restoring when the restore throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    restoreFolder.mockRejectedValue(new Error('command not registered'));

    render(
      <StrictMode>
        <LibraryProvider>
          <Probe />
        </LibraryProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('restoring')).toHaveTextContent('false'),
    );
    expect(restoreFolder).toHaveBeenCalledTimes(1);
  });
});
