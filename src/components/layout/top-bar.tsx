import { useEffect, useRef, useState } from 'react';

import { ArrowLeft, ArrowRight, Disc, Search, X } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { TopNav } from '@/components/layout/top-nav';
import { NAV_ICONS } from '@/components/layout/nav-icons';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SearchMorph } from '@/components/layout/search-morph';
import { SearchSuggestions } from '@/components/layout/search-suggestions';
import { AccountMenu } from '@/components/auth/account-menu';
import { WindowControls } from '@/components/layout/window-controls';
import type { Route, Tab } from '@/lib/routes';
import { isNative } from '@/lib/platform';

/**
 * One bar across the whole window.
 *
 * It began as two stacked strips — a 36px title bar holding the word
 * "MadMusic" and three window buttons, and a 56px toolbar under it. Ninety-two
 * pixels of chrome, most of it empty.
 *
 * Now 56px. It does not carry a sidebar toggle: the library panel collapses
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
  onBrowse,
  onNavigate,
  route,
  onOpenRoute,
  onSubmit,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
}: {
  view: Tab | null;
  /** The whole route, so the destinations can say which one you are on. */
  route: Route;
  /** Opens a destination. Separate from `onNavigate`, which takes a tab. */
  onOpenRoute: (route: Route) => void;
  query: string;
  onQueryChange: (value: string) => void;
  /** Clears the query and shows the browse page, which is search with no query. */
  onBrowse: () => void;
  onNavigate: (view: Tab) => void;
  onSubmit: () => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Which suggestion the keyboard is on, and how many there are to move
  // through. The count comes back from the list because only the list knows
  // how many results arrived; the field owns the position because the field is
  // what keeps focus and what receives the arrow keys.
  // -1 is "nothing highlighted", which is where every new query starts. Enter
  // then means the results page; an arrow key is what opts into a row.
  const [active, setActive] = useState(-1);
  const [count, setCount] = useState(0);
  // What Enter would search for: the highlighted row's words, which for row 0
  // are simply what was typed.
  const [chosen, setChosen] = useState<string | null>(null);
  const open = focused && query.trim().length > 0;
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
      className="grid h-14 shrink-0 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-3 pl-2 select-none"
    >
      {/* Left: where you have been, then where you can go, then home.

          Carries the drag region so the gaps between buttons still move the
          window; the buttons sit above it and take their own clicks.

          Home is pushed to the far end of this track rather than placed in the
          middle one. It reads as sitting against the search field either way,
          but the centre track is what holds the field on the window's centre
          line — put anything else in there and the field drifts off it. */}
      <div data-tauri-drag-region className="flex w-full items-center gap-0.5">
        <IconButton
          label="Back"
          size="lg"
          onClick={onBack}
          disabled={!canGoBack}
        >
          <ArrowLeft className="size-[1.125rem]" />
        </IconButton>
        <IconButton
          label="Forward"
          size="lg"
          onClick={onForward}
          disabled={!canGoForward}
        >
          <ArrowRight className="size-[1.125rem]" />
        </IconButton>

        {/* Every destination, not the two that used to be hard-coded here.
            They were duplicated in the sidebar, which meant two lists that had
            to agree about which was current — see `top-nav.tsx`. */}
        <TopNav route={route} onOpen={onOpenRoute} />

        <span className="flex-1" data-tauri-drag-region aria-hidden />

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              label="Home"
              size="lg"
              // The tooltip below is the label; the native one as well shows
              // both, a second apart, saying the same word.
              title={undefined}
              current={route.name === 'home'}
              onClick={() => onNavigate('home')}
            >
              <NAV_ICONS.home className="size-[1.125rem]" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">Home</TooltipContent>
        </Tooltip>
      </div>

      {/* Centre: the search field, and nothing else.

          The pill and the suggestions under it are one silhouette rather than
          a field with a dropdown — see `search-morph.tsx`. The form keeps its
          own height so the bar does not grow; the shape is absolutely
          positioned inside it and is free to extend over the page. */}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          // Enter takes the highlighted suggestion when there is one, and the
          // typed query otherwise. Row 0 *is* the typed query, so the ordinary
          // case falls through to the same place it always did.
          // Enter goes to the results page. When a row is highlighted it is
          // that row's words that get searched — picking a suggestion has
          // always meant "search for this", which is one string and needs no
          // machinery beyond the one below.
          if (open && chosen) onQueryChange(chosen);
          onSubmit();
        }}
        className="relative h-10"
      >
        <SearchMorph
          open={open}
          height={40}
          field={
            <div className="flex w-full items-center gap-2.5 pr-2 pl-4">
              <Search className="size-[1.125rem] shrink-0 text-muted-foreground" />
              <input
                ref={input}
                type="search"
                value={query}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                  // Back to the query row. Leaving the highlight where it was
                  // would point at whichever result happened to land in that
                  // slot for the new word.
                  setActive(-1);
                  setChosen(null);
                  // Typing is what takes you to the results, and it used to be
                  // focus that did it — so the navigation has to move here
                  // rather than just be removed above, or a query would only
                  // reach the search view on Enter. `navigateTo` compares
                  // routes by key, so the keystrokes after the first cost
                  // nothing and Back still has one entry to go back to.
                  if (event.target.value.trim()) onSubmit();
                }}
                onFocus={() => {
                  setFocused(true);
                  // Taking the field is not a search.
                  //
                  // This submitted unconditionally, and `onSubmit` navigates
                  // to the search view — which with an empty field *is* the
                  // browse page. So clicking into the box, tabbing to it, or
                  // clearing a query (the clear button hands focus back) moved
                  // you off whatever page you were reading, without you having
                  // typed a character or pressed Browse.
                  //
                  // With a query already in it, focusing still shows that
                  // query's results: coming back to a field with text in it is
                  // a request to see what it found.
                  if (query.trim()) onSubmit();
                }}
                onBlur={() => setFocused(false)}
                onKeyDown={(event) => {
                  // Escape closes the suggestions without clearing the query,
                  // which is what a reader expects from a dropdown they did
                  // not ask for.
                  if (event.key === 'Escape') {
                    setFocused(false);
                    return;
                  }
                  if (!open || count === 0) return;

                  // Wrapping, because a list this short is faster to reach
                  // from the far end than to walk back through.
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActive((at) => (at + 1 >= count ? 0 : at + 1));
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    // From "nothing highlighted", up goes to the last row.
                    setActive((at) => (at <= 0 ? count - 1 : at - 1));
                  }
                }}
                // No `role="combobox"` here, tempting as the pattern is: an
                // explicit role replaces the implicit one, and this input
                // stops being a `searchbox` to everything that looks for one —
                // assistive tech included. `type="search"` plus the properties
                // below describes the same thing without giving that up.
                // Only while the list is actually there. A reference to an id
                // that is not in the document is a critical `aria-valid-attr-
                // value` failure, and the list unmounts whenever the field is
                // empty or blurred.
                aria-controls={open ? 'search-suggestions' : undefined}
                // The field never gives up focus, so the highlighted row is
                // announced from here rather than by moving the cursor into a
                // list the user would then have to escape from.
                aria-activedescendant={
                  open && active >= 0
                    ? `search-suggestion-${active}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-label="Search music"
                placeholder="What do you want to play?"
                className="h-10 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
              />

              {/* Browse lives in the field because browsing *is* the empty
                  state of searching — the search view with nothing typed is
                  the browse page. Labelled rather than a bare glyph: it is the
                  one control here that goes somewhere, and a disc icon alone
                  reads as "album", not "browse everything".

                  Hidden once there is a query, where the clear button takes
                  the space and browsing is not what you are doing. */}
              {!query && (
                <button
                  type="button"
                  onClick={onBrowse}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-fast hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Disc className="size-4" />
                  Browse
                </button>
              )}

              {query && (
                <IconButton
                  label="Clear search"
                  size="md"
                  onClick={() => {
                    onQueryChange('');
                    input.current?.focus();
                  }}
                >
                  <X className="size-4" />
                </IconButton>
              )}
            </div>
          }
          // Mounted only while the field has focus. A suggestion list that
          // outlives the cursor is a panel covering the page for no reason —
          // and unmounted it measures zero, so the shape stays an exact pill.
          panel={
            // Only with something typed. An empty field has nothing to show
            // results for, and opening on a bare click changed the shape under
            // a reader who had not asked for anything yet.
            open ? (
              <SearchSuggestions
                query={query}
                active={active}
                onActiveChange={setActive}
                onCountChange={setCount}
                onChoose={(value) => {
                  onQueryChange(value);
                  onSubmit();
                  setFocused(false);
                }}
                onActiveValueChange={setChosen}
              />
            ) : null
          }
        />
      </form>

      {/* Right: creating things, then the app itself.

          `self-stretch` rather than centred: the caption buttons below want the
          bar's full height so the close button reaches the top-right corner,
          and a centred track would leave a dead strip above and below it. */}
      <div
        data-tauri-drag-region
        className="flex h-full items-center justify-end gap-0.5 self-stretch"
      >
        {/* No "create playlist" here. It had no handler at all — a button that
            looked like the primary action and did nothing — and the library
            panel already carries a working, *labelled* one, which is the right
            place for it: creating a playlist is what that panel is for.

            No settings gear either, and no command palette. Settings is a row
            in the account menu now — it is opened rarely, and a permanent
            unlabelled glyph beside the avatar was two app-level controls where
            one will do. `top-nav.tsx` still leaves it out of the destinations
            menu, so the menu below is the one click-path to it. */}
        <AccountMenu
          onOpenSettings={() => onNavigate('settings')}
          onOpenDiagnostics={() => onOpenRoute({ name: 'diagnostics' })}
          settingsCurrent={view === 'settings'}
          diagnosticsCurrent={route.name === 'diagnostics'}
        />

        {/* Window controls are flush to the corner — a gap beside them turns
            the infinitely-deep screen-edge target into a finite one. */}
        {native ? <WindowControls /> : <div className="w-1.5" />}
      </div>
    </header>
  );
}
