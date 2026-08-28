import { useEffect, useRef, useState } from 'react';

import {
  usePlayer,
  usePlayerProgress,
} from '@/components/player/player-context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { transcriptFor } from '@/lib/podcasts';
import { formatTime } from '@/lib/library-model';
import { cn } from '@/lib/utils';

/**
 * An episode's transcript, following along.
 *
 * # Why this is where the lyrics go
 *
 * Because it is the same thing. Timed text scrolling with the audio, tappable
 * to jump — a listener does not experience "lyrics" and "transcript" as
 * different features, and giving them separate tabs would mean one of the two
 * tabs is always empty.
 *
 * # Why it is not only an accessibility feature
 *
 * It is filed under accessibility in the backlog and that is where the case is
 * strongest: a deaf or hard-of-hearing listener cannot use a podcast at all
 * without one. But a transcript is also how anybody finds the bit they half
 * remember in a two-hour episode, and building it as "the accessible version"
 * rather than as a feature is how it ends up worse than the main path.
 *
 * # Coverage, stated
 *
 * Most feeds publish no transcript. The panel says nothing at all in that case
 * rather than explaining itself on every episode — see `podcast_transcript` in
 * `meta/podcast.rs` for why nothing is fetched speculatively.
 */
type Cue = { start: number; text: string };

export function TranscriptPanel() {
  const { current, seek } = usePlayer();
  const { progress } = usePlayerProgress();
  const [loaded, setLoaded] = useState<{ url?: string; cues: Cue[] }>({
    cues: [],
  });
  const container = useRef<HTMLDivElement | null>(null);
  const active = useRef<HTMLButtonElement | null>(null);

  const url = current?.transcriptUrl;

  useEffect(() => {
    if (!url) return;

    let live = true;
    void transcriptFor(url).then((cues) => {
      if (live) setLoaded({ url, cues });
    });
    return () => {
      live = false;
    };
  }, [url]);

  const cues = loaded.url === url ? loaded.cues : [];

  // Which line is being spoken. A linear scan, because a transcript is a few
  // hundred lines and this runs when `progress` changes rather than per frame —
  // the lyrics panel needs a binary search on a frame loop; this does not.
  let here = -1;
  for (const [at, cue] of cues.entries()) {
    if (cue.start <= progress) here = at;
    else break;
  }

  useEffect(() => {
    const scroller = container.current;
    const line = active.current;
    if (!scroller || !line) return;

    // `scrollTop` against a measured offset rather than `scrollIntoView`: the
    // latter queues an animation per call, and on a fast exchange they fight
    // each other. The lyrics panel learned the same lesson.
    scroller.scrollTop =
      line.offsetTop - scroller.clientHeight / 2 + line.clientHeight / 2;
  }, [here]);

  if (!url || cues.length === 0) return null;

  // A single cue at zero is an unsynchronised transcript — plain text with no
  // timings. Shown as prose rather than as one enormous clickable line.
  if (cues.length === 1 && cues[0].start === 0) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <p className="p-4 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
          {cues[0].text}
        </p>
      </ScrollArea>
    );
  }

  return (
    <div ref={container} className="min-h-0 flex-1 overflow-y-auto p-3">
      <ul className="flex flex-col gap-1">
        {cues.map((cue, at) => (
          <li key={`${cue.start}-${at}`}>
            <button
              ref={at === here ? active : undefined}
              type="button"
              onClick={() => seek(cue.start)}
              aria-current={at === here ? 'true' : undefined}
              className={cn(
                'flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-fast',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                at === here
                  ? 'bg-accent/50 text-foreground'
                  : 'text-muted-foreground hover:bg-accent/30',
              )}
            >
              <span className="shrink-0 text-xs tabular-nums opacity-60">
                {formatTime(cue.start)}
              </span>
              <span className="min-w-0 flex-1">{cue.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
