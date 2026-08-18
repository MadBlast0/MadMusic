/**
 * Placeholder catalogue used while the UI is being designed.
 *
 * Nothing here talks to a source adapter yet — see `docs/music-sources.md` for
 * where the real data will come from. Cover art is expressed as a pair of
 * colour stops rather than an image URL so the interface renders identically
 * offline and no network request is needed to judge a layout.
 */

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Duration in seconds. */
  duration: number;
  /** Two colour stops used to synthesise placeholder cover art. */
  cover: [string, string];
};

export type Playlist = {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  cover: [string, string];
};

export const tracks: Track[] = [
  {
    id: 't1',
    title: 'Neon Arcadia',
    artist: 'Violet Static',
    album: 'Afterglow',
    duration: 254,
    cover: ['#6366f1', '#a855f7'],
  },
  {
    id: 't2',
    title: 'Paper Lanterns',
    artist: 'Hollow Coast',
    album: 'Tidewater',
    duration: 198,
    cover: ['#0ea5e9', '#22d3ee'],
  },
  {
    id: 't3',
    title: 'Midnight Transit',
    artist: 'The Long Way Down',
    album: 'Terminal',
    duration: 312,
    cover: ['#f59e0b', '#ef4444'],
  },
  {
    id: 't4',
    title: 'Glass Houses',
    artist: 'Ivory Lane',
    album: 'Shatterproof',
    duration: 227,
    cover: ['#10b981', '#84cc16'],
  },
  {
    id: 't5',
    title: 'Slow Dissolve',
    artist: 'Marrow',
    album: 'Undertow',
    duration: 341,
    cover: ['#8b5cf6', '#ec4899'],
  },
  {
    id: 't6',
    title: 'Cassette Sunrise',
    artist: 'Bright Parade',
    album: 'Analog Heart',
    duration: 186,
    cover: ['#f43f5e', '#fb923c'],
  },
  {
    id: 't7',
    title: 'Static Bloom',
    artist: 'Violet Static',
    album: 'Afterglow',
    duration: 273,
    cover: ['#3b82f6', '#6366f1'],
  },
  {
    id: 't8',
    title: 'Harbour Lights',
    artist: 'Hollow Coast',
    album: 'Tidewater',
    duration: 205,
    cover: ['#14b8a6', '#0ea5e9'],
  },
];

export const playlists: Playlist[] = [
  {
    id: 'p1',
    name: 'Late Night Drive',
    description: 'Low light, long roads',
    trackIds: ['t1', 't3', 't5', 't7'],
    cover: ['#4338ca', '#7e22ce'],
  },
  {
    id: 'p2',
    name: 'Morning Slow Start',
    description: 'Ease into it',
    trackIds: ['t2', 't6', 't8'],
    cover: ['#0891b2', '#65a30d'],
  },
  {
    id: 'p3',
    name: 'Focus Deep',
    description: 'No words, no interruptions',
    trackIds: ['t4', 't5', 't2'],
    cover: ['#57534e', '#1c1917'],
  },
  {
    id: 'p4',
    name: 'Weekend Rewind',
    description: 'Everything on repeat',
    trackIds: ['t6', 't1', 't3'],
    cover: ['#be123c', '#ea580c'],
  },
];

export function trackById(id: string): Track | undefined {
  return tracks.find((t) => t.id === id);
}

/** `254` → `4:14`. */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Gradient string for synthesised cover art. */
export function coverGradient([from, to]: [string, string]): string {
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}
