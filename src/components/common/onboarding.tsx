import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { FolderOpen, Sparkle } from '@/components/icons';
import { useLibrary } from '@/components/library/library-context';
import {
  saveOnboarding,
  STARTER_GENRES,
  type Onboarding as Answers,
} from '@/lib/profiles';
import { cn } from '@/lib/utils';

/**
 * The first run.
 *
 * # What it is for, and what it must not become
 *
 * One purpose: give the home screen something to build from before there is any
 * listening history. A person's first session otherwise opens onto an empty
 * app, and "search for something" is a poor first instruction.
 *
 * It must not become a sign-up funnel. There is no account step, no email
 * capture, no permission requested that is not needed for the next screen, and
 * **skip is always available on every step**. Somebody who wants to get
 * straight to their music should be two clicks from it.
 *
 * # Why it is not shown to everybody
 *
 * `needsOnboarding` refuses when the library already has tracks. A person
 * upgrading from an earlier version has four thousand of them and does not need
 * to be asked what they like — asking would be the app announcing that it has
 * forgotten.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const library = useLibrary();
  const [step, setStep] = useState(0);
  const [genres, setGenres] = useState<string[]>([]);
  const [artistText, setArtistText] = useState('');
  const [addedFolder, setAddedFolder] = useState(false);

  const finish = async (skipped: boolean) => {
    const answers: Answers = {
      genres,
      artists: artistText
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
      addedFolder,
      completedAt: skipped ? 0 : Date.now(),
      skipped,
    };
    await saveOnboarding(answers);
    onDone();
  };

  const steps = [
    {
      title: 'What do you listen to?',
      body: 'Pick a few. It only seeds the home screen until you have played enough for it to work that out itself.',
      content: (
        <div className="flex flex-wrap gap-2">
          {STARTER_GENRES.map((genre) => {
            const chosen = genres.includes(genre);
            return (
              <Badge
                key={genre}
                variant={chosen ? 'default' : 'outline'}
                className="cursor-pointer px-3 py-1.5 text-sm"
                onClick={() =>
                  setGenres((existing) =>
                    chosen
                      ? existing.filter((entry) => entry !== genre)
                      : [...existing, genre],
                  )
                }
              >
                {genre}
              </Badge>
            );
          })}
        </div>
      ),
    },
    {
      title: 'Anybody in particular?',
      body: 'A few names, separated by commas. Leave it blank if you would rather not say.',
      content: (
        <Input
          autoFocus
          value={artistText}
          onChange={(event) => setArtistText(event.target.value)}
          placeholder="Radiohead, Miles Davis, Aphex Twin"
        />
      ),
    },
    {
      title: 'Your own music',
      body: 'Point MadMusic at a folder and it will read the tags. Nothing is copied, nothing is uploaded, and the folder is the only one it can see.',
      content: (
        <div className="space-y-3">
          <Button
            variant="outline"
            disabled={library.picking}
            onClick={() => {
              library.chooseFolder();
              // Optimistic, and corrected below by reading `library.root`: the
              // picker is a native dialog that reports through the provider
              // rather than returning, so there is nothing to await.
              setAddedFolder(true);
            }}
          >
            <FolderOpen className="size-4" />
            {library.picking ? 'Choosing…' : 'Choose a folder'}
          </Button>
          {addedFolder && library.root && (
            <p className="text-sm text-muted-foreground">
              Added {library.root.name}. It will be scanned in the background.
            </p>
          )}
        </div>
      ),
    },
  ];

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 backdrop-blur">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-2 text-primary">
          <Sparkle className="size-5" />
          <span className="text-sm font-medium">Welcome to MadMusic</span>
        </div>

        <Progress
          label={`Setup, step ${step + 1} of ${steps.length}`}
          value={((step + 1) / steps.length) * 100}
          className="h-1"
        />

        <div>
          <h1 className="font-display text-2xl font-semibold">
            {current.title}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{current.body}</p>
        </div>

        <div className={cn('min-h-24')}>{current.content}</div>

        <div className="flex items-center justify-between gap-3">
          {/* Present on every step, deliberately. See the note above. */}
          <Button variant="ghost" size="sm" onClick={() => void finish(true)}>
            Skip setup
          </Button>

          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep((at) => at - 1)}>
                Back
              </Button>
            )}
            <Button
              onClick={() =>
                last ? void finish(false) : setStep((at) => at + 1)
              }
            >
              {last ? 'Start listening' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
