import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OfflineContext,
  type OfflineState,
} from '@/components/common/offline-context';
import {
  LibraryContext,
  type LibraryState,
} from '@/components/library/library-context';
import type { LocalFolder } from '@/lib/local-source';
import { useDownload } from '@/hooks/use-download';

const setDownloadsFolder = vi.hoisted(() =>
  vi.fn<(path: string | null) => Promise<string | null>>(),
);
vi.mock('@/lib/desktop', () => ({ setDownloadsFolder }));

/**
 * One download action, and the question every place offering it must answer
 * the same way: where does it go when no folder has been chosen?
 *
 * Without a Local folder, a download lands in the app's cache directory —
 * somewhere real and invisible, not where anybody looks for a file they meant
 * to save. So the first download opens the folder picker and follows once a
 * folder exists. That is a small state machine with two ways to go quietly
 * wrong, and both are pinned here: downloading into the hidden cache because it
 * started before Rust had heard about the new folder, and firing a download
 * nobody remembers asking for an hour after they cancelled the picker.
 */

const TRACK = { handle: 'h1', title: 'Song', artist: 'Band' };
const FOLDER = { path: 'C:\\Music', name: 'Music' } as LocalFolder;

let offline: OfflineState;
let library: LibraryState;

function makeOffline(over: Partial<OfflineState> = {}): OfflineState {
  return {
    supported: true,
    entries: [],
    cached: 0,
    downloaded: 0,
    isDownloaded: () => false,
    isOnDisk: () => false,
    progressOf: () => null,
    download: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    clearCache: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

function makeLibrary(over: Partial<LibraryState> = {}): LibraryState {
  return {
    root: null,
    sourceKind: 'native',
    picking: false,
    scanning: false,
    restoring: false,
    error: null,
    chooseFolder: vi.fn(),
    clearFolder: vi.fn(),
    rescan: vi.fn(),
    ...over,
  };
}

/** Renders the hook against contexts the test can change and re-render. */
function render() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OfflineContext.Provider value={offline}>
      <LibraryContext.Provider value={library}>
        {children}
      </LibraryContext.Provider>
    </OfflineContext.Provider>
  );
  return renderHook(() => useDownload(), { wrapper });
}

beforeEach(() => {
  setDownloadsFolder.mockReset();
  setDownloadsFolder.mockResolvedValue('C:\\Music');
  offline = makeOffline();
  library = makeLibrary();
});

describe('downloading with a folder already chosen', () => {
  it('downloads straight away', () => {
    library = makeLibrary({ root: FOLDER });
    const { result } = render();

    act(() => result.current.toggle(TRACK));

    expect(offline.download).toHaveBeenCalledWith(TRACK);
    expect(library.chooseFolder).not.toHaveBeenCalled();
  });

  /** The same button, pressed again on a downloaded track, takes it back. */
  it('removes a track that is already downloaded', () => {
    library = makeLibrary({ root: FOLDER });
    offline = makeOffline({ isDownloaded: () => true });
    const { result } = render();

    act(() => result.current.toggle(TRACK));

    expect(offline.remove).toHaveBeenCalledWith('h1');
    expect(offline.download).not.toHaveBeenCalled();
  });

  it('ignores a second press while it is still downloading', () => {
    library = makeLibrary({ root: FOLDER });
    offline = makeOffline({ progressOf: () => ({ state: 'downloading' }) });
    const { result } = render();

    act(() => result.current.toggle(TRACK));

    expect(offline.download).not.toHaveBeenCalled();
    expect(offline.remove).not.toHaveBeenCalled();
  });

  /** A local file is already on disk; there is nothing to download. */
  it('does nothing for a track with no catalogue handle', () => {
    library = makeLibrary({ root: FOLDER });
    const { result } = render();

    act(() => result.current.toggle({ title: 'Local', artist: 'Band' }));

    expect(offline.download).not.toHaveBeenCalled();
  });
});

describe('downloading with no folder yet', () => {
  it('asks for a folder instead of saving somewhere invisible', () => {
    const { result } = render();

    act(() => result.current.toggle(TRACK));

    expect(library.chooseFolder).toHaveBeenCalledOnce();
    expect(offline.download).not.toHaveBeenCalled();
  });

  /**
   * The download follows the folder, and waits for Rust to hear about it.
   *
   * Choosing a folder sets the root and tells Rust the new downloads directory
   * without awaiting it, so a download fired on the same render could reach
   * Rust first and land in the hidden cache after all.
   */
  it('downloads into the chosen folder once one is picked', async () => {
    const { result, rerender } = render();
    act(() => result.current.toggle(TRACK));

    // The picker opens, the folder is read, then the root arrives.
    library = makeLibrary({ picking: true });
    rerender();
    library = makeLibrary({ scanning: true });
    rerender();
    library = makeLibrary({ root: FOLDER });
    await act(async () => {
      rerender();
    });

    expect(setDownloadsFolder).toHaveBeenCalledWith('C:\\Music');
    expect(offline.download).toHaveBeenCalledWith(TRACK);
    // And in that order: the destination before the download.
    expect(setDownloadsFolder.mock.invocationCallOrder[0]).toBeLessThan(
      (offline.download as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    );
  });

  /**
   * Reading the chosen folder is not a cancel.
   *
   * The picker closes *before* the folder is scanned, so there is a render with
   * the picker gone and no root yet. Treating that as "cancelled" dropped the
   * download for every user who actually chose a folder.
   */
  it('does not mistake the scan after choosing for a cancel', async () => {
    const { result, rerender } = render();
    act(() => result.current.toggle(TRACK));

    library = makeLibrary({ picking: true });
    rerender();
    library = makeLibrary({ picking: false, scanning: true, root: null });
    rerender();
    library = makeLibrary({ root: FOLDER });
    await act(async () => {
      rerender();
    });

    expect(offline.download).toHaveBeenCalledOnce();
  });

  /**
   * Cancelling the picker cancels the download.
   *
   * Otherwise it would sit waiting and fire whenever a folder was next set —
   * possibly an hour later, from Settings — saving a file nobody remembers
   * asking for.
   */
  it('drops the download when the picker is closed without a folder', async () => {
    const { result, rerender } = render();
    act(() => result.current.toggle(TRACK));

    library = makeLibrary({ picking: true });
    rerender();
    library = makeLibrary({ picking: false, root: null });
    rerender();

    // Much later, a folder is set some other way.
    library = makeLibrary({ root: FOLDER });
    await act(async () => {
      rerender();
    });

    expect(offline.download).not.toHaveBeenCalled();
  });
});

describe('what a button should show', () => {
  it('reports each state', () => {
    offline = makeOffline({
      progressOf: (handle) =>
        handle === 'busy'
          ? { state: 'downloading' }
          : handle === 'broken'
            ? { state: 'failed', message: 'no network' }
            : null,
      isDownloaded: (handle) => handle === 'saved',
    });
    const { result } = render();

    expect(result.current.statusOf('busy')).toBe('downloading');
    expect(result.current.statusOf('broken')).toBe('failed');
    expect(result.current.statusOf('saved')).toBe('downloaded');
    expect(result.current.statusOf('fresh')).toBe('none');
    expect(result.current.statusOf(undefined)).toBe('none');
  });
});
