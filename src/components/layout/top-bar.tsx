import { useEffect, useRef, useState } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Command,
  Home,
  Library,
  Mic,
  Plus,
  Search,
  Settings,
  X,
} from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { SearchSuggestions } from '@/components/layout/search-suggestions';
import {
  listenOnce,
  voiceSearchAvailable,
  type VoiceSession,
} from '@/lib/voice-search';
import { toast } from 'sonner';
import { AccountMenu } from '@/components/auth/account-menu';
import { WindowControls } from '@/components/layout/window-controls';
import type { Tab } from '@/lib/routes';
import { Kbd } from '@/components/ui/kbd';
import { isNative } from '@/lib/platform';
import { cn } from '@/lib/utils';

/**
 * One bar across the whole window.
 *
 * It began as two stacked strips — a 36px title bar holding the word
 * "MadMusic" and three window buttons, and a 56px toolbar under it. Ninety-two
 * pixels of chrome, most of it empty.
 *
 * Now 44px. It does not carry a sidebar toggle: the library panel collapses
 * from its own header and expands from its rail, and a second control with the
 * same label in the chrome above it is one control too many — ambiguous to
 * announce, and ambiguous to aim at. Ctrl+B still works from anywhere.
 *
 * **The search field is centred on the window, not on the space left over.**
 * A three-column grid with equal outer tracks does that; a flex row cannot,
 * because the left and right groups are different widths and the middle would
 * drift with them. The field is the one control people aim at without looking,
 * so it stays put no matter what appears beside it.
 *
 * The whole bar is a drag region except where a control sits — that is what
 * `data-tauri-drag-region` on the background elements buys, and why every
 * button has to sit *above* it rather than carry it.
 */
export function TopBar({
  view,
  query,
  onQueryChange,
  onNavigate,
  onSubmit,
  onCommand,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
}: {
  view: Tab | null;
  query: string;
  onQueryChange: (value: string) => void;
  onNavigate: (view: Tab) => void;
  onSubmit: () => void;
  onCommand: () => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<VoiceSession | null>(null);

  // Stopped on unmount. A recogniser left running holds the microphone open
  // after the window it belonged to has gone.
  useEffect(() => () => sessionRef.current?.stop(), []);
  const native = isNative();

  // Ctrl+F navigates to search and focuses here, so the field has to be
  // reachable from outside this component.
  useEffect(() => {
    function focus() {
      input.current?.focus();
      input.current?.select();
    }
    window.addEventListener('madmusic:focus-search', focus);
    return () => window.removeEventListener('madmusic:focus-search', focus);
  }, []);

  return (
    <header
      aria-label="Title bar"
      data-tauri-drag-region
      className="grid h-11 shrink-0 grid-cols-[1fr_minmax(0,26rem)_1fr] items-center gap-2 pl-1.5 select-none"
    >
      {/* Left: where you have been, then where you can go.

          Carries the drag region so the gaps between buttons still move the
          window; the buttons sit above it and take their own clicks. */}
      <div data-tauri-drag-region className="flex items-center gap-0.5">
        <IconButton
          label="Back"
          size="sm"
          onClick={onBack}
          disabled={!canGoBack}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Forward"
          size="sm"
          onClick={onForward}
          disabled={!canGoForward}
        >
          <ArrowRight />
        </IconButton>

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        {/* Home and Library are destinations, not tools, so they carry the
            current-page state the tools never do. */}
        <IconButton
          label="Home"
          size="sm"
          current={view === 'home'}
          onClick={() => onNavigate('home')}
        >
          <Home />
        </IconButton>
        <IconButton
          label="Your Library"
          size="sm"
          current={view === 'library'}
          onClick={() => onNavigate('library')}
        >
          <Library />
        </IconButton>
      </div>

      {/* Centre: the search field, and nothing else. */}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className={cn(
          'relative flex h-8 items-center rounded-full border transition-colors duration-fast',
          focused || view === 'search'
            ? 'border-ring bg-background'
            : 'border-transparent bg-card hover:bg-accent/40',
        )}
      >
        <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => {
            setFocused(true);
            onSubmit();
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            // Escape closes the suggestions without clearing the query, which
            // is what a reader expects from a dropdown they did not ask for.
            if (event.key === 'Escape') setFocused(false);
          }}
          aria-label="Search music"
          placeholder="What do you want to play?"
          className="h-full w-full rounded-full bg-transparent pr-16 pl-8 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {/* Only where the engine exists. A microphone button that always
            fails is worse than no button. */}
        {voiceSearchAvailable() && !query && (
          <IconButton
            label={listening ? 'Stop listening' : 'Search by voice'}
            size="sm"
            active={listening}
            onClick={() => {
              if (listening) {
                sessionRef.current?.stop();
                setListening(false);
                return;
              }

              setListening(true);
              sessionRef.current = listenOnce({
                onPartial: onQueryChange,
                onFinal: (text) => {
                  setListening(false);
                  onQueryChange(text);
                  onSubmit();
                },
                onError: (message) => {
                  setListening(false);
                  toast(message);
                },
              });
              if (!sessionRef.current) setListening(false);
            }}
            className="absolute right-8"
          >
            <Mic className={cn('size-3.5', listening && 'text-primary')} />
          </IconButton>
        )}

        {query ? (
          <IconButton
            label="Clear search"
            size="sm"
            onClick={() => {
              onQueryChange('');
              input.current?.focus();
            }}
            className="absolute right-0.5"
          >
            <X className="size-3.5" />
          </IconButton>
        ) : (
          // Hidden on narrow windows: the hint is the first thing worth losing
          // when the field gets tight, well before the placeholder.
          <Kbd className="pointer-events-none absolute right-2.5 hidden lg:block">
            Ctrl F
          </Kbd>
        )}

        {/* Only while the field has focus. A suggestion list that outlives the
            cursor is a panel covering the page for no reason. */}
        {focused && (
          <SearchSuggestions
            query={query}
            onPick={(value) => {
              onQueryChange(value);
              onSubmit();
            }}
            onClose={() => setFocused(false)}
          />
        )}
      </form>

      {/* Right: creating things, then the app itself.

          `self-stretch` rather than centred: the caption buttons below want the
          bar's full height so the close button reaches the top-right corner,
          and a centred track would leave a dead strip above and below it. */}
      <div
        data-tauri-drag-region
        className="flex h-full items-center justify-end gap-0.5 self-stretch"
      >
        <IconButton label="Create playlist" size="sm">
          <Plus />
        </IconButton>
        <IconButton label="Command palette" size="sm" onClick={onCommand}>
          <Command />
        </IconButton>
        <IconButton
          label="Settings"
          size="sm"
          current={view === 'settings'}
          onClick={() => onNavigate('settings')}
        >
          <Settings />
        </IconButton>
        <AccountMenu />

        {/* Window controls are flush to the corner — a gap beside them turns
            the infinitely-deep screen-edge target into a finite one. */}
        {native ? <WindowControls /> : <div className="w-1.5" />}
      </div>
    </header>
  );
}
