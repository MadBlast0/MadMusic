import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CatalogueTrackList } from '@/components/catalogue/catalogue-track-list';
import type { CatalogueTrack } from '@/lib/catalogue';
import { renderWithProviders } from '@/test/utils';

/**
 * Covers in a list of songs.
 *
 * The rows carried none at all: a number, a title and an artist. On an artist's
 * top songs, in Liked Songs, in Recently played and in the downloads that is
 * ten or twenty rows of text with nothing to tell them apart at a glance —
 * which is the job a cover does better than either the title or the album
 * column beside it.
 *
 * The rule is not "always show one". It is **does this list span more than one
 * record**, which is the same question the album column answers, so the two
 * travel together. Forty copies of the same sleeve down an album page, under a
 * header already showing it at full size, is noise rather than information.
 */

function track(
  partial: Partial<CatalogueTrack> & { id: string },
): CatalogueTrack {
  return {
    title: `Song ${partial.id}`,
    artist: 'Violet Static',
    album: 'Neon Arcadia',
    duration: 180,
    artworkUrl: `https://example.test/${partial.id}.jpg`,
    cover: ['#111111', '#222222'],
    ...partial,
  };
}

const TRACKS = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })];

/**
 * Every cover drawn in the list.
 *
 * `alt=""` is what makes each one presentational, and that is deliberate: the
 * title is right beside it, so a screen reader announcing the artwork as well
 * would read every row twice.
 */
const covers = () => screen.queryAllByRole('presentation');

describe('covers in a list of songs', () => {
  it('gives every row its cover when the list spans albums', async () => {
    renderWithProviders(<CatalogueTrackList tracks={TRACKS} />);
    await screen.findByText('Song a');

    const images = covers();
    expect(images).toHaveLength(TRACKS.length);
    expect(images[0]).toHaveAttribute('src', 'https://example.test/a.jpg');
  });

  /**
   * An album page is the one list where they are all the same picture, and it
   * is already at the top of the page at full size.
   */
  it('leaves them off where every row is the same record', async () => {
    renderWithProviders(
      <CatalogueTrackList tracks={TRACKS} showAlbum={false} />,
    );
    await screen.findByText('Song a');

    expect(covers()).toHaveLength(0);
  });

  /** The two are separable for a caller that wants one and not the other. */
  it('can be asked for without the album column', async () => {
    renderWithProviders(
      <CatalogueTrackList tracks={TRACKS} showAlbum={false} showCover />,
    );
    await screen.findByText('Song a');

    expect(covers()).toHaveLength(TRACKS.length);
  });

  /**
   * A track with no artwork still gets its colours.
   *
   * There is no picture to draw, so no image element — the gradient underneath
   * is the cover, which is the whole point of painting it rather than showing a
   * grey box.
   */
  it('falls back to the track’s own colours rather than a grey box', async () => {
    renderWithProviders(
      <CatalogueTrackList
        tracks={[track({ id: 'd', artworkUrl: undefined })]}
      />,
    );
    await screen.findByText('Song d');

    expect(covers()).toHaveLength(0);
    // The row is still there, and still playable.
    expect(
      screen.getByRole('button', { name: /Play Song d/ }),
    ).toBeInTheDocument();
  });
});
