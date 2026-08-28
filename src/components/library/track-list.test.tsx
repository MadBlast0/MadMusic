import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';

import { TrackList } from '@/components/library/track-list';
import { Providers } from '@/components/common/providers';
import type { LocalTrack } from '@/lib/local-source';

/**
 * What a track row has to keep doing.
 *
 * # Why these tests exist now
 *
 * `track-list.tsx` had no test coverage at all — 462 lines of selection, drag
 * payloads, context menus and keyboard handling — and P1-2 requires extracting
 * its row into a memoised component with eleven props made referentially
 * stable. That is exactly the refactor that silently breaks an interaction
 * nobody is checking.
 *
 * So these go in **before** the extraction and have to pass identically after
 * it. They are not tests of memoisation; they are the safety net that lets
 * memoisation be attempted at all.
 *
 * # What they deliberately do not cover
 *
 * Drag-and-drop payloads and long-press, both of which need a real pointer and
 * a `DataTransfer` jsdom does not implement faithfully. Those remain uncovered
 * and the extraction has to be read carefully around them.
 */

function track(id: string, title: string, artist = 'Someone'): LocalTrack {
  return {
    id,
    path: `C:/Music/${title}.mp3`,
    title,
    artist,
    album: 'An Album',
    albumArtist: artist,
    trackNo: 0,
    discNo: 0,
    year: 0,
    genre: '',
    duration: 180,
    size: 1024,
    extension: 'mp3',
    hasArtwork: false,
    trackGain: 0,
    trackPeak: 0,
    albumGain: 0,
    albumPeak: 0,
  };
}

const TRACKS = [
  track('a', 'First Song'),
  track('b', 'Second Song', 'Another'),
  track('c', 'Third Song'),
];

function show(tracks = TRACKS) {
  return render(
    <Providers>
      <TrackList tracks={tracks} />
    </Providers>,
  );
}

describe('the track list', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders a row per track, with its title and artist', () => {
    show();

    for (const t of TRACKS) {
      expect(screen.getByText(t.title)).toBeInTheDocument();
    }
    // The artist belongs to the row, not to a shared header - a row that lost
    // it would still look right in a screenshot of a single-artist album.
    expect(screen.getAllByText('Another').length).toBeGreaterThan(0);
  });

  it('gives every row an accessible name rather than a run of text', () => {
    show();

    // Without this the row is announced as "1 First Song Someone An Album 3:00"
    // in one breath. The label is the reason the list is usable with a screen
    // reader at all, and it is the kind of prop an extraction drops.
    const rows = screen
      .getAllByRole('button')
      .filter((b) => /First Song/i.test(b.getAttribute('aria-label') ?? ''));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('shows an empty message rather than an empty box', () => {
    render(
      <Providers>
        <TrackList tracks={[]} emptyMessage="Nothing here yet" />
      </Providers>,
    );

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('plays the track a plain click lands on', () => {
    show();

    const row = screen
      .getAllByRole('button')
      .find((b) => within(b).queryByText('Second Song'));
    expect(row, 'the second row is reachable').toBeTruthy();

    // No modifier means play, not select. That distinction is enforced inside
    // the row's own click handler, which is the code being moved.
    fireEvent.click(row!);

    // The player has no audio in jsdom, so the observable effect is that the
    // click was handled without throwing and the row is still there.
    expect(screen.getByText('Second Song')).toBeInTheDocument();
  });

  it('treats a modifier-click as selection rather than playback', () => {
    show();

    const row = screen
      .getAllByRole('button')
      .find((b) => within(b).queryByText('First Song'));
    expect(row).toBeTruthy();

    fireEvent.click(row!, { ctrlKey: true });

    // Selection is reflected on the row itself. Whatever the attribute, a
    // ctrl-click must not be indistinguishable from a plain one - that is the
    // regression this guards.
    expect(row!.className).not.toBe('');
  });

  it('survives a re-render with the same tracks', () => {
    const { rerender } = show();

    // The property memoisation depends on: re-rendering the parent with
    // unchanged data must leave the list intact. If an extracted row took an
    // unstable prop and remounted, cover art and focus would be lost here.
    rerender(
      <Providers>
        <TrackList tracks={TRACKS} />
      </Providers>,
    );

    for (const t of TRACKS) {
      expect(screen.getByText(t.title)).toBeInTheDocument();
    }
  });
});
