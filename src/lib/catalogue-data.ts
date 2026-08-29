/**
 * The bundled preview catalogue.
 *
 * Placeholder content, and labelled as such wherever it reaches the screen. Its
 * job is to give the home screen real structure — shelves of the right shapes,
 * with the right density and the right edge cases — so the layout can be built
 * and judged before the Rust extractor described in `docs/music-sources.md`
 * exists.
 *
 * Deliberately includes awkward cases the neat ones would hide: a very long
 * title, a single-word artist, a collection with only three tracks, and an
 * entry with no album. Every one of those has broken a music UI at some point.
 *
 * Cover art is a pair of gradient stops rather than an image URL, so the screen
 * renders identically offline and no network request is needed to judge a
 * layout.
 */

import type { CatalogueTrack, Collection, HomeFeed } from '@/lib/catalogue';

type Seed = [
  id: string,
  title: string,
  artist: string,
  album: string | undefined,
  duration: number,
  cover: [string, string],
];

const SEEDS: Seed[] = [
  [
    'c1',
    'Neon Arcadia',
    'Violet Static',
    'Afterglow',
    254,
    ['#6366f1', '#a855f7'],
  ],
  [
    'c2',
    'Paper Lanterns',
    'Hollow Coast',
    'Tidewater',
    198,
    ['#0ea5e9', '#22d3ee'],
  ],
  [
    'c3',
    'Midnight Transit',
    'The Long Way Down',
    'Terminal',
    312,
    ['#f59e0b', '#ef4444'],
  ],
  [
    'c4',
    'Glass Houses',
    'Ivory Lane',
    'Shatterproof',
    227,
    ['#10b981', '#84cc16'],
  ],
  ['c5', 'Slow Dissolve', 'Marrow', 'Undertow', 341, ['#8b5cf6', '#ec4899']],
  [
    'c6',
    'Cassette Sunrise',
    'Bright Parade',
    'Analog Heart',
    186,
    ['#f43f5e', '#fb923c'],
  ],
  [
    'c7',
    'Static Bloom',
    'Violet Static',
    'Afterglow',
    273,
    ['#3b82f6', '#6366f1'],
  ],
  [
    'c8',
    'Harbour Lights',
    'Hollow Coast',
    'Tidewater',
    205,
    ['#14b8a6', '#0ea5e9'],
  ],
  [
    'c9',
    'Everything We Never Said Out Loud',
    'Quiet Company',
    'Long Division',
    401,
    ['#a78bfa', '#60a5fa'],
  ],
  ['c10', 'Ferrous', 'Kite', undefined, 164, ['#eab308', '#f97316']],
  ['c11', 'Low Tide', 'Marrow', 'Undertow', 288, ['#0891b2', '#65a30d']],
  [
    'c12',
    'Cold Open',
    'The Long Way Down',
    'Terminal',
    231,
    ['#64748b', '#334155'],
  ],
  [
    'c13',
    'Aurora Compact',
    'Bright Parade',
    'Analog Heart',
    209,
    ['#f472b6', '#c084fc'],
  ],
  [
    'c14',
    'Signal Fade',
    'Ivory Lane',
    'Shatterproof',
    244,
    ['#22c55e', '#15803d'],
  ],
  ['c15', 'Nightjar', 'Kite', 'Field Notes', 176, ['#fb7185', '#f59e0b']],
  [
    'c16',
    'Second Person',
    'Quiet Company',
    'Long Division',
    262,
    ['#38bdf8', '#818cf8'],
  ],
  [
    'c17',
    'Ultraviolet Hours',
    'Violet Static',
    'Afterglow',
    297,
    ['#7c3aed', '#db2777'],
  ],
  [
    'c18',
    'Driftwood',
    'Hollow Coast',
    'Tidewater',
    219,
    ['#06b6d4', '#3b82f6'],
  ],
];

export const PREVIEW_TRACKS: CatalogueTrack[] = SEEDS.map(
  ([id, title, artist, album, duration, cover]) => ({
    id,
    title,
    artist,
    album,
    duration,
    cover,
  }),
);

const track = (id: string) => PREVIEW_TRACKS.find((t) => t.id === id)!;

/**
 * Preview collections carry their track list; the shared `Collection` type does
 * not, because a live source cannot produce one without a request per card.
 */
type PreviewCollection = Collection & { trackIds: string[] };

const COLLECTION_SEEDS: Omit<PreviewCollection, 'trackCount'>[] = [
  {
    id: 'p1',
    title: 'Late Night Drive',
    subtitle: 'Low light, long roads',
    cover: ['#4338ca', '#7e22ce'],
    trackIds: ['c1', 'c3', 'c5', 'c7', 'c12', 'c17'],
  },
  {
    id: 'p2',
    title: 'Morning Slow Start',
    subtitle: 'Ease into it',
    cover: ['#0891b2', '#65a30d'],
    trackIds: ['c2', 'c6', 'c8', 'c13'],
  },
  {
    id: 'p3',
    title: 'Focus Deep',
    subtitle: 'No words, no interruptions',
    cover: ['#57534e', '#1c1917'],
    trackIds: ['c4', 'c11', 'c14'],
  },
  {
    id: 'p4',
    title: 'Weekend Rewind',
    subtitle: 'Everything on repeat',
    cover: ['#be123c', '#ea580c'],
    trackIds: ['c6', 'c1', 'c3', 'c15', 'c18'],
  },
  {
    id: 'p5',
    title: 'After Hours',
    subtitle: 'Slower, warmer, later',
    cover: ['#1e293b', '#475569'],
    trackIds: ['c5', 'c9', 'c11', 'c16'],
  },
  {
    id: 'p6',
    title: 'New This Week',
    subtitle: 'Fresh in the catalogue',
    cover: ['#0f766e', '#0ea5e9'],
    trackIds: ['c10', 'c13', 'c15', 'c17', 'c18'],
  },
  {
    id: 'p7',
    title: 'Bright Corners',
    subtitle: 'Loud, fast, cheerful',
    cover: ['#f59e0b', '#dc2626'],
    trackIds: ['c6', 'c13', 'c10', 'c2'],
  },
  {
    id: 'p8',
    title: 'Long Players',
    subtitle: 'Nothing under four minutes',
    cover: ['#312e81', '#0e7490'],
    trackIds: ['c9', 'c5', 'c3', 'c17'],
  },
];

const COLLECTIONS: PreviewCollection[] = COLLECTION_SEEDS.map((seed) => ({
  ...seed,
  trackCount: seed.trackIds.length,
}));

const FEED: HomeFeed = {
  featured: [COLLECTIONS[0], COLLECTIONS[5], COLLECTIONS[4], COLLECTIONS[1]],
  shelves: [
    {
      id: 'trending',
      title: 'Trending now',
      blurb: 'What everyone is playing today',
      kind: 'tracks',
      tracks: ['c1', 'c6', 'c3', 'c13', 'c9', 'c17', 'c2', 'c15'].map(track),
    },
    {
      id: 'made-for-you',
      title: 'Made for you',
      blurb: 'Built from what you have been listening to',
      kind: 'collections',
      collections: [
        COLLECTIONS[2],
        COLLECTIONS[4],
        COLLECTIONS[7],
        COLLECTIONS[1],
        COLLECTIONS[6],
      ],
    },
    {
      id: 'new-releases',
      title: 'New releases',
      kind: 'tracks',
      tracks: ['c10', 'c15', 'c18', 'c14', 'c16', 'c11', 'c12', 'c4'].map(
        track,
      ),
    },
    {
      id: 'editors',
      title: "Editor's picks",
      blurb: 'Hand-assembled, not generated',
      kind: 'collections',
      collections: [
        COLLECTIONS[0],
        COLLECTIONS[3],
        COLLECTIONS[6],
        COLLECTIONS[5],
      ],
    },
    {
      id: 'deep-cuts',
      title: 'Deep cuts',
      blurb: 'Further down the same records',
      kind: 'tracks',
      tracks: ['c7', 'c12', 'c11', 'c16', 'c8', 'c5'].map(track),
    },
  ],
};

export const CATALOGUE_PREVIEW = {
  tracks: PREVIEW_TRACKS,
  collections: COLLECTIONS,
  feed: FEED,
};
