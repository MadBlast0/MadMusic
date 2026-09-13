/**
 * Splitting an artist's releases into the groups people look for.
 *
 * # Why this is not just "albums"
 *
 * Because an artist page that lists forty entries in one shelf is unusable for
 * the artist it matters most for. A prolific act has three albums and thirty
 * singles, and somebody looking for "the new record" has to read every card to
 * find it. Every music service splits these, and they split them the same way.
 *
 * # Why "appears on" is decided by the primary artist
 *
 * Not by the subtitle text, which is localised, formatted differently per
 * source and frequently just a year. The source knows which artist a release is
 * filed under; where that is somebody else, this is a guest appearance.
 *
 * Where the source does not say, the release stays in the main discography.
 * Guessing wrong in that direction hides a record on the page it belongs to,
 * which is much worse than showing a compilation one section too high.
 */

import type { Collection } from '@/lib/catalogue';

type ReleaseGroup = 'albums' | 'singles' | 'appears';

type Discography = {
  albums: Collection[];
  singles: Collection[];
  appears: Collection[];
};

/**
 * Which group a release belongs in.
 *
 * EPs count as albums. They are a record with a title and a sleeve, and a
 * "Singles and EPs" heading is what you write when you have not decided what
 * the page is for.
 */
export function groupFor(
  release: Collection,
  artistId: string | undefined,
): ReleaseGroup {
  if (
    artistId &&
    release.artistId !== undefined &&
    release.artistId !== artistId
  ) {
    return 'appears';
  }

  return release.releaseKind === 'single' ? 'singles' : 'albums';
}

/** The releases, grouped, in the order the source gave them. */
export function discography(
  releases: readonly Collection[],
  artistId: string | undefined,
): Discography {
  const grouped: Discography = { albums: [], singles: [], appears: [] };
  for (const release of releases) {
    grouped[groupFor(release, artistId)].push(release);
  }
  return grouped;
}
