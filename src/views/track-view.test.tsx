import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_TRACK, type Lyrics, type TrackRow } from '@/lib/store/types';

/**
 * The song page.
 *
 * What is worth pinning here is not the layout but the two decisions behind
 * it: that opening a song does not go to the network for its lyrics, and that
 * a field nobody filled in is left out rather than shown empty.
 */

let rows: TrackRow[] = [];
let stored: Lyrics | null = null;

const TRACKS = vi.fn(async () => rows);
const LYRICS_GET = vi.fn(async () => stored);

// The banner reads the density setting, which is the only thing on this page
// that wants a provider. Mocking the hook keeps the test to the view rather
// than standing the whole app up around it.
vi.mock('@/hooks/use-density', () => ({ useDensity: () => ({}) }));

vi.mock('@/components/player/player-context', () => ({
  usePlayer: () => ({ play: vi.fn(), addToQueue: vi.fn() }),
}));

vi.mock('@/lib/store', () => ({
  store: {
    tracks: (...args: unknown[]) => TRACKS(...(args as [])),
    lyricsGet: (...args: unknown[]) => LYRICS_GET(...(args as [])),
    likeToggle: vi.fn(),
  },
}));

const { TrackView } = await import('@/views/track-view');

function row(over: Partial<TrackRow> = {}): TrackRow {
  return {
    ...EMPTY_TRACK,
    id: 't1',
    kind: 'local',
    title: 'Yesterday',
    artist: 'The Beatles',
    album: 'Help!',
    albumKey: 'the beatleshelp!',
    duration: 125,
    ...over,
  };
}

function lyrics(over: Partial<Lyrics> = {}): Lyrics {
  return {
    trackId: 't1',
    synced: '',
    plain: '',
    translation: '',
    romanised: '',
    background: '',
    voices: '',
    source: '',
    found: true,
    fetchedAt: 0,
    ...over,
  };
}

function show() {
  return render(
    <TrackView id="t1" title="Yesterday" onOpen={vi.fn()} onBack={vi.fn()} />,
  );
}

beforeEach(() => {
  rows = [row()];
  stored = null;
  TRACKS.mockClear();
  LYRICS_GET.mockClear();
});

describe('the song page', () => {
  it('shows the song and where it came from', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Yesterday')).toBeTruthy());
    expect(screen.getByText('The Beatles')).toBeTruthy();
    expect(screen.getByText('Help!')).toBeTruthy();
  });

  it('never goes to the network for lyrics', async () => {
    // Opening a song is a request to look at it. Asking four providers a
    // question the reader did not ask is not what that should cost.
    stored = null;
    show();
    await waitFor(() => expect(LYRICS_GET).toHaveBeenCalled());
    expect(screen.queryByText('Lyrics')).toBeNull();
  });

  it('shows lyrics the app already had, and credits them', async () => {
    stored = lyrics({
      plain: 'Yesterday\nAll my troubles',
      source: 'lrclib:5',
    });
    show();
    await waitFor(() =>
      expect(screen.getByText(/All my troubles/)).toBeTruthy(),
    );
    expect(screen.getByText(/via LRCLIB/)).toBeTruthy();
  });

  it('reads the words out of a timed sheet when there is no plain copy', async () => {
    stored = lyrics({
      synced: '[00:01.00]Yesterday\n[00:02.00]All my troubles',
    });
    show();
    await waitFor(() =>
      expect(screen.getByText(/All my troubles/)).toBeTruthy(),
    );
    // The timings are the player's business, not this page's.
    expect(screen.queryByText(/00:01/)).toBeNull();
  });

  it('leaves out the facts nobody filled in', async () => {
    // A grid of twenty rows, fifteen of them empty, says less than five that
    // all say something.
    rows = [row({ genre: '', composer: '', bpm: 0, year: 0 })];
    show();
    await waitFor(() => expect(screen.getByText('Yesterday')).toBeTruthy());
    expect(screen.queryByText('Genre')).toBeNull();
    expect(screen.queryByText('Composer')).toBeNull();
    expect(screen.queryByText('Tempo')).toBeNull();
  });

  it('shows the facts that were filled in', async () => {
    rows = [row({ genre: 'Rock', composer: 'Paul McCartney', year: 1965 })];
    show();
    await waitFor(() => expect(screen.getByText('Genre')).toBeTruthy());
    expect(screen.getByText('Rock')).toBeTruthy();
    expect(screen.getByText('Paul McCartney')).toBeTruthy();
  });

  it('lists the rest of the album without repeating this song', async () => {
    rows = [
      row(),
      row({ id: 't2', title: 'Help!', trackNo: 1 }),
      row({ id: 't3', title: 'Ticket to Ride', trackNo: 2 }),
    ];
    show();
    await waitFor(() =>
      expect(screen.getByText('Ticket to Ride')).toBeTruthy(),
    );
    // Once in the header, and not again in the list below it.
    expect(screen.getAllByText('Yesterday')).toHaveLength(1);
  });
});
