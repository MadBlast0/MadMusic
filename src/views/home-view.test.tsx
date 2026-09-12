import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LibraryContext } from '@/components/library/library-context';
import type { LibraryState } from '@/components/library/library-context';
import type { LocalFolder, LocalTrack } from '@/lib/local-source';
import { HomeView } from '@/views/home-view';
import { renderWithProviders } from '@/test/utils';

/**
 * What belongs in the block at the top of Home, and what does not.
 *
 * The rule is about *provenance* rather than about any one tile: the block is
 * the things you chose — the two lists everybody has, the playlists you keep,
 * and what the catalogue is offering. A directory on this machine is none of
 * those, and it reached the block through a path that is easy to reintroduce
 * because it looks so reasonable in isolation: local albums were simply the
 * next thing to fill it with once the playlists ran out.
 */

function track(partial: Partial<LocalTrack> & { title: string }): LocalTrack {
  return {
    id: `C:\\Users\\Someone\\Music\\${partial.title}.mp3`,
    path: `C:\\Users\\Someone\\Music\\${partial.title}.mp3`,
    extension: 'mp3',
    size: 4096,
    artist: null,
    album: null,
    albumArtist: null,
    trackNo: null,
    discNo: null,
    year: null,
    genre: null,
    trackGain: 0,
    trackPeak: 0,
    albumGain: 0,
    albumPeak: 0,
    duration: 180,
    hasArtwork: false,
    ...partial,
  };
}

/**
 * One untagged file in a folder called `Music`.
 *
 * Deliberately untagged, because that is what produces the tile: with no album
 * tag `groupAlbums` falls back to the parent directory's name, so the record is
 * titled after the folder. On the library this was reported from, that folder
 * was `C:\Users\…\Music` — and the block showed a tile called "Music" sitting
 * among Liked Songs and the catalogue, looking for all the world like a
 * playlist somebody had made.
 */
const root: LocalFolder = {
  name: 'Music',
  path: 'C:\\Users\\Someone\\Music',
  folders: [],
  truncated: false,
  tracks: [track({ title: 'Waade Saare', artist: 'Someone' })],
};

const library: LibraryState = {
  root,
  sourceKind: 'native',
  picking: false,
  scanning: false,
  restoring: false,
  error: null,
  chooseFolder: () => {},
  clearFolder: () => {},
  rescan: () => {},
};

function renderHome() {
  return renderWithProviders(
    // Inside `Providers`, so the real player and store are in place, but with
    // the library overridden: the provider in `Providers` reads from disk
    // through Rust, and there is neither here.
    <LibraryContext.Provider value={library}>
      <HomeView onBrowse={() => {}} onOpen={() => {}} />
    </LibraryContext.Provider>,
  );
}

const quickPicks = () => screen.getByRole('region', { name: 'Quick picks' });

describe('the block at the top of Home', () => {
  it('leaves local folders out of it', async () => {
    renderHome();
    await screen.findByRole('region', { name: 'Quick picks' });

    expect(within(quickPicks()).queryByText('Music')).not.toBeInTheDocument();
  });

  /**
   * The other half of the claim, and the reason this is two assertions rather
   * than one: the fix must be "not *here*", not "not anywhere". Deleting the
   * tile everywhere would lose the records, and this page is where somebody
   * with a folder full of music expects to find them.
   */
  it('still shows those albums further down the page', async () => {
    renderHome();
    const shelf = await screen.findByText('From your library');

    expect(shelf).toBeInTheDocument();
    expect(screen.getByText('Music')).toBeInTheDocument();
  });
});
