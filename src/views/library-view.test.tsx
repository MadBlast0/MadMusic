import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalFolder, LocalSource, LocalTrack } from '@/lib/local-source';
import type { Route } from '@/lib/routes';
import * as localSource from '@/lib/local-source';
import { LibraryView } from '@/views/library-view';
import { renderWithProviders } from '@/test/utils';

function track(
  partial: Partial<LocalTrack> & { title: string; folder?: string },
): LocalTrack {
  const folder = partial.folder ?? 'Discovery';
  return {
    id: `C:\\Music\\${folder}\\${partial.title}.mp3`,
    path: `C:\\Music\\${folder}\\${partial.title}.mp3`,
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
    duration: 0,
    hasArtwork: false,
    ...partial,
  };
}

const scanned: LocalFolder = {
  name: 'Music',
  path: 'C:\\Music',
  folders: [],
  tracks: [
    track({
      title: 'One More Time',
      artist: 'Daft Punk',
      album: 'Discovery',
      trackNo: 1,
      year: 2001,
      duration: 320,
    }),
    track({
      title: 'Aerodynamic',
      artist: 'Daft Punk',
      album: 'Discovery',
      trackNo: 2,
      year: 2001,
      duration: 212,
    }),
    // No tags at all — the folder name has to carry it.
    track({ title: 'voice-memo-004', folder: 'Voice Memos', duration: 65 }),
  ],
  truncated: false,
};

const fake: LocalSource = {
  kind: 'native',
  pickFolder: async () => scanned,
  playableUrl: async () => 'asset://song',
  artwork: async () => null,
  release: () => {},
};

/**
 * Mounts the library at its own route.
 *
 * Detail pages are app routes now rather than local state, so the view needs
 * one — `route` is what decides whether a grid or an album page is on screen.
 * The helper keeps that here rather than in every test.
 */
async function openLibrary(route: Route = { name: 'library' }) {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  renderWithProviders(
    <LibraryView route={route} onOpen={onOpen} onBack={vi.fn()} />,
  );
  await user.click(
    screen.getByRole('button', { name: /choose music folder/i }),
  );
  await screen.findByRole('heading', { name: 'Music' });
  return { user, onOpen };
}

describe('library view', () => {
  beforeEach(() => {
    vi.spyOn(localSource, 'getLocalSource').mockReturnValue(fake);
  });

  it('summarises the library from the tags, not the file names', async () => {
    await openLibrary();
    // Discovery plus the untagged file's folder-derived album.
    expect(screen.getByText(/2 albums · 3 songs · 10 min/)).toBeInTheDocument();
  });

  it('groups tagged tracks into an album card', async () => {
    await openLibrary();

    const album = screen.getByRole('button', { name: 'Open Discovery' });
    const card = album.parentElement as HTMLElement;
    expect(within(card).getByText('Daft Punk')).toBeInTheDocument();
    expect(within(card).getByText(/2001 · 2 songs/)).toBeInTheDocument();
  });

  it('asks the app to navigate rather than opening the album itself', async () => {
    // The detail page is an app route now. That is what makes the title-bar
    // Back button go back one page instead of leaving the library entirely,
    // and it is only true if the view *routes* rather than setting its own
    // state.
    const { user, onOpen } = await openLibrary();

    await user.click(screen.getByRole('button', { name: 'Open Discovery' }));

    expect(onOpen).toHaveBeenCalledWith({
      name: 'local-album',
      key: expect.any(String),
      title: 'Discovery',
    });
  });

  it('lists an album’s tracks in tag order with real durations', async () => {
    const { user } = await openLibrary();
    await user.click(screen.getByRole('button', { name: 'Open Discovery' }));

    // Re-rendered at the route the click asked for, which is what the app does.
    const key = (
      screen
        .getByRole('button', { name: 'Open Discovery' })
        .closest('[data-album-key]') as HTMLElement | null
    )?.dataset.albumKey;

    cleanup();
    renderWithProviders(
      <LibraryView
        route={{ name: 'local-album', key: key ?? '', title: 'Discovery' }}
        onOpen={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole('button', { name: /choose music folder/i }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Discovery' }),
    ).toBeInTheDocument();
    expect(screen.getByText('5:20')).toBeInTheDocument();
    expect(screen.getByText('3:32')).toBeInTheDocument();

    // Track 1 before track 2, which is tag order rather than alphabetical.
    const titles = screen
      .getAllByText(/One More Time|Aerodynamic/)
      .map((node) => node.textContent);
    expect(titles).toEqual(['One More Time', 'Aerodynamic']);
  });

  it('falls back to the containing folder for a file with no tags', async () => {
    await openLibrary();
    // No album tag, so the folder it sits in names it rather than it
    // vanishing into an "unknown" bucket with everything else.
    expect(
      screen.getByRole('button', { name: 'Open Voice Memos' }),
    ).toBeInTheDocument();
  });

  it('filters across title, artist and album', async () => {
    const { user } = await openLibrary();

    await user.click(screen.getByRole('tab', { name: 'Songs' }));
    expect(screen.getByText('voice-memo-004')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: /filter/i }), 'daft');

    expect(screen.getByText('One More Time')).toBeInTheDocument();
    expect(screen.queryByText('voice-memo-004')).not.toBeInTheDocument();
  });
});
