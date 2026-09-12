import { m } from 'motion/react';

import { Art } from '@/components/home/shelves';
import { StaticPlay } from '@/components/icons';
import type { Mix } from '@/lib/recommend';

/**
 * One generated mix, as a card.
 *
 * Deliberately shows the *reason* under the title rather than a track count.
 * A shelf of mixes with no explanation is indistinguishable from a shelf of
 * randomly chosen songs, and the reason is the only thing that makes it worth
 * more than shuffle.
 */
export function MixCard({
  mix,
  artworkUrl,
  mosaicCss,
  onPlay,
}: {
  mix: Mix;
  /** Remote art, where there is any. Otherwise the seeded gradient shows. */
  artworkUrl?: string;
  /**
   * Four covers as one, for a mix of many records.
   *
   * Takes precedence over `artworkUrl`. A mix is by definition several records,
   * so any single sleeve on its card is a claim about one of them — the mosaic
   * says what is actually inside. See `mosaic` in `lib/playlist-io.ts`.
   */
  mosaicCss?: string | null;
  onPlay: () => void;
}) {
  const count = mix.tracks.length;

  return (
    <m.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 },
      }}
      className="group/card relative w-[168px] shrink-0 snap-start"
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={
          count > 0
            ? `Play ${mix.title}, ${count} ${count === 1 ? 'track' : 'tracks'}`
            : `Play ${mix.title}`
        }
        className="block w-full rounded-lg p-2 text-left transition-colors duration-fast hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {mosaicCss ? (
          <span
            aria-hidden
            className="block aspect-square w-full rounded-xl bg-muted shadow-sm"
            style={{
              // The gradient underneath, so the moment before four remote
              // images have loaded is the mix's own colour rather than grey.
              background: `${mosaicCss}, linear-gradient(135deg, ${mix.coverA}, ${mix.coverB})`,
            }}
          />
        ) : (
          <Art
            seedCover={[mix.coverA, mix.coverB]}
            src={artworkUrl}
            alt=""
            className="aspect-square w-full rounded-xl shadow-sm"
          />
        )}
        <div className="mt-2.5 min-w-0">
          <p className="truncate text-sm font-medium">{mix.title}</p>
          <p className="truncate text-xs text-muted-foreground">{mix.reason}</p>
        </div>
      </button>

      <span className="pointer-events-none absolute inset-x-2 top-2 aspect-square">
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${mix.title}`}
          className="pointer-events-auto absolute right-2 bottom-2 flex size-10 translate-y-1 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition-all duration-base group-hover/card:translate-y-0 group-hover/card:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <StaticPlay className="size-4" />
        </button>
      </span>
    </m.div>
  );
}
