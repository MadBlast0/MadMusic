import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AnimatePresence, m } from 'motion/react';
import { toast } from 'sonner';

import { CommandPalette } from '@/components/common/command-palette';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { DesktopShell } from '@/components/common/desktop-shell';
import { useSettings } from '@/components/common/settings-context';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { NowPlayingBar } from '@/components/player/now-playing-bar';
import { ResizeHandle } from '@/components/layout/resize-handle';
import { RightSidebar } from '@/components/layout/right-sidebar';
import { usePlayer } from '@/components/player/player-context';
import { Toaster } from '@/components/ui/sonner';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { useWindowWidth } from '@/hooks/use-window-width';
import { duration, ease } from '@/lib/motion';
import {
  RIGHT_DEFAULT,
  RIGHT_LIMITS,
  SIDEBAR_DEFAULT,
  SIDEBAR_LIMITS,
  clampWidth,
} from '@/lib/panes';
import { tabFor, viewKey, type Route, type Tab } from '@/lib/routes';
import {
  activeNav,
  activeRoute,
  closeTab,
  cycleTab,
  firstTabs,
  navigateTo,
  openInNewTab,
  withNav,
  MAX_TABS,
} from '@/lib/tabs';
import { ViewTabs } from '@/components/layout/view-tabs';
import { cn } from '@/lib/utils';
import { AlbumView } from '@/views/album-view';
import { ArtistView } from '@/views/artist-view';
import { HomeView } from '@/views/home-view';
import { PlaylistView } from '@/views/playlist-view';
import { SavedView } from '@/views/saved-view';
import { LibraryView } from '@/views/library-view';
import { SearchView } from '@/views/search-view';

/**
 * The screens that are not on the way to anything.
 *
 * Home, search, the library and a detail page are what an ordinary session is
 * made of, so they stay in the main chunk. Everything below is a destination
 * somebody chooses — and most people never choose most of them. Loading them on
 * demand keeps the initial bundle about what it was before they existed, which
 * is the trade `providers.tsx` already makes for Motion's feature bundle.
 *
 * `lazy` rather than a manual chunk configuration: the boundary is the import,
 * which is legible here rather than in the build config.
 */
const SettingsView = lazy(() =>
  import('@/views/settings-view').then((m) => ({ default: m.SettingsView })),
);
const LegalView = lazy(() =>
  import('@/views/legal-view').then((m) => ({ default: m.LegalView })),
);
const DiagnosticsView = lazy(() =>
  import('@/views/diagnostics-view').then((m) => ({
    default: m.DiagnosticsView,
  })),
);
const DownloadsView = lazy(() =>
  import('@/views/downloads-view').then((m) => ({ default: m.DownloadsView })),
);
const SmartPlaylistsView = lazy(() =>
  import('@/views/smart-playlists-view').then((m) => ({
    default: m.SmartPlaylistsView,
  })),
);
const FeedView = lazy(() =>
  import('@/views/feed-view').then((m) => ({ default: m.FeedView })),
);
const PodcastsView = lazy(() =>
  import('@/views/podcasts-view').then((m) => ({ default: m.PodcastsView })),
);
const PodcastView = lazy(() =>
  import('@/views/podcasts-view').then((m) => ({ default: m.PodcastView })),
);
const ProfileView = lazy(() =>
  import('@/views/profile-view').then((m) => ({ default: m.ProfileView })),
);
const RadioView = lazy(() =>
  import('@/views/radio-view').then((m) => ({ default: m.RadioView })),
);
const StatisticsView = lazy(() =>
  import('@/views/statistics-view').then((m) => ({
    default: m.StatisticsView,
  })),
);
const UploadsView = lazy(() =>
  import('@/views/uploads-view').then((m) => ({ default: m.UploadsView })),
);

/** The full-screen and mini players, which are modes rather than destinations. */
const ImmersivePlayer = lazy(() =>
  import('@/components/player/immersive-player').then((m) => ({
    default: m.ImmersivePlayer,
  })),
);
const MiniPlayer = lazy(() =>
  import('@/components/player/mini-player').then((m) => ({
    default: m.MiniPlayer,
  })),
);
const PipPlayer = lazy(() =>
  import('@/components/player/pip-player').then((m) => ({
    default: m.PipPlayer,
  })),
);
const BigScreen = lazy(() =>
  import('@/components/common/big-screen').then((m) => ({
    default: m.BigScreen,
  })),
);
const Onboarding = lazy(() =>
  import('@/components/common/onboarding').then((m) => ({
    default: m.Onboarding,
  })),
);
import { migrateLegacyStorage, describeMigration } from '@/lib/store/migrate';
import { needsOnboarding } from '@/lib/profiles';
import { onShellEvent, signalReady } from '@/lib/desktop';
import { EVENTS } from '@/lib/native';
import { parseShareLink } from '@/lib/share-link';
import { openPaths } from '@/lib/open-files';
import { toPlayerTrack } from '@/lib/player-track';
import { DropTarget } from '@/components/common/drop-target';
import { watchForCrashes } from '@/lib/telemetry';
import { mark, record as recordStartup } from '@/lib/startup';
import type { Podcast } from '@/lib/store/types';

function App() {
  const { settings } = useSettings();

  /**
   * Every open view.
   *
   * One tab at first, and the strip stays hidden until there is a second — see
   * `components/layout/view-tabs.tsx`. Each tab carries its own history, which
   * is what makes Back mean "back in *this* tab" rather than stepping through
   * pages somebody visited somewhere else.
   */
  const [tabs, setTabs] = useState(() =>
    firstTabs(
      settings.startupView === 'library'
        ? { name: 'library' }
        : { name: 'home' },
    ),
  );
  const [sidebarOpen, setSidebarOpen] = usePersistedState(
    'madmusic-sidebar-open',
    true,
  );
  const [queueOpen, setQueueOpen] = usePersistedState(
    'madmusic-queue-open',
    false,
  );
  /**
   * Pane widths.
   *
   * Persisted, and clamped again on every render rather than only on save: a
   * width chosen on a large monitor must not swallow the window when the same
   * profile is opened on a laptop.
   */
  const [sidebarWidth, setSidebarWidth] = usePersistedState(
    'madmusic-sidebar-width',
    SIDEBAR_DEFAULT,
  );
  const [rightWidth, setRightWidth] = usePersistedState(
    'madmusic-right-width',
    RIGHT_DEFAULT,
  );
  const [resizing, setResizing] = useState(false);
  const windowWidth = useWindowWidth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Full screen and the mini player are overlays, not routes. */
  const [immersive, setImmersive] = useState(false);
  const [mini, setMini] = useState(false);
  /** The floating window. A mode, like the two above it. */
  const [pip, setPip] = useState(false);
  /** The ten-foot interface, for a television and a remote. */
  const [bigScreen, setBigScreen] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  /**
   * The show whose episodes are open.
   *
   * Held here rather than in the route because a route carries an id and this
   * needs the whole record — and fetching it again on every render of a screen
   * the user just navigated from would be a query for something already in
   * hand.
   */
  const [openShow, setOpenShow] = useState<Podcast | null>(null);

  const nav = activeNav(tabs);
  const route = activeRoute(tabs);
  const tab = tabFor(route);
  const canGoBack = nav.cursor > 0;
  const canGoForward = nav.cursor < nav.stack.length - 1;

  const go = useCallback(
    (next: Route) =>
      setTabs((previous) =>
        withNav(previous, navigateTo(activeNav(previous), next)),
      ),
    [],
  );

  /**
   * Opens a route beside the current tab.
   *
   * Reports the cap rather than failing quietly: a ctrl-click that appears to
   * do nothing is indistinguishable from a broken control.
   */
  const goInNewTab = useCallback((next: Route) => {
    setTabs((previous) => {
      const opened = openInNewTab(previous, next);
      if (opened === previous) {
        toast(`That is ${MAX_TABS} tabs — close one first.`);
      }
      return opened;
    });
  }, []);
  /** The nav and palette only ever move between tabs. */
  const navigate = useCallback(
    (next: Tab) => go({ name: next } as Route),
    [go],
  );
  /**
   * Stable, because `PipPlayer` uses it as an effect dependency — an inline
   * arrow would tear the window down and open a new one on every render.
   */
  const closePip = useCallback(() => setPip(false), []);

  const back = useCallback(
    () =>
      setTabs((previous) => {
        const current = activeNav(previous);
        return withNav(previous, {
          ...current,
          cursor: Math.max(0, current.cursor - 1),
        });
      }),
    [],
  );
  const forward = useCallback(
    () =>
      setTabs((previous) => {
        const current = activeNav(previous);
        return withNav(previous, {
          ...current,
          cursor: Math.min(current.stack.length - 1, current.cursor + 1),
        });
      }),
    [],
  );

  const focusSearch = useCallback(() => {
    navigate('search');
    // The field lives in the top bar, which is a sibling rather than a child,
    // so focus is requested by event rather than by threading a ref through
    // the tree.
    window.dispatchEvent(new Event('madmusic:focus-search'));
  }, [navigate]);

  const player = usePlayer();

  /**
   * Plays files handed over from outside the window.
   *
   * Shared by the file association, the command line and the drop target,
   * because all three are the same request. Replaces the queue rather than
   * appending: somebody who double-clicks a song in Explorer is asking to hear
   * that song now, not after whatever was already queued.
   */
  const playPaths = useCallback(
    async (paths: string[]) => {
      const opened = await openPaths(paths);
      if (opened.length === 0) return;

      const queue = opened.map(toPlayerTrack);
      player.play(queue[0], queue, 'Opened files');

      if (opened.length > 1) {
        toast.success(`Playing ${opened.length} tracks`);
      }
    },
    [player],
  );

  /**
   * Opens a `madmusic://` link handed over by the OS.
   *
   * The protocol has been registered since the deep-link work and the arguments
   * were reaching the window; nothing acted on them, so every shared link
   * raised the window and then did nothing. This is the missing half.
   *
   * Anything that is not one of ours is ignored rather than reported: the same
   * event carries file paths and whatever else a second launch was given, and
   * most of it is not a link at all.
   */
  /**
   * Reveals the window, once React has committed a frame.
   *
   * The shell creates it hidden so launch does not flash an empty undecorated
   * rectangle. An effect in `App` is the earliest point at which there is
   * genuinely something painted — earlier, in `main.tsx`, would only mean the
   * render was *scheduled*.
   *
   * Fire-and-forget: `signalReady` swallows its own failures, and the shell
   * shows the window on a timer if this never arrives.
   */
  useEffect(() => {
    void signalReady();
  }, []);

  useEffect(() => {
    return onShellEvent<string[]>(EVENTS.opened, (argv) => {
      for (const argument of argv) {
        const target = parseShareLink(argument);
        if (!target) continue;

        switch (target.kind) {
          case 'track':
          case 'album':
            go({ name: 'album', id: target.id, title: target.title ?? '' });
            return;
          case 'artist':
            go({
              name: 'artist',
              id: target.id,
              artistName: target.title ?? '',
            });
            return;
          case 'playlist':
            go({ name: 'playlist', id: target.id });
            return;
          case 'profile':
            go({ name: 'profile', handle: target.id });
            return;
        }
      }

      // Not a link, so it may be a file. This is the other half of the file
      // association: the bundle has declared the extensions since the shell
      // work, the OS has been handing the paths over, and nothing played them.
      void playPaths(argv);
    });
  }, [go, playPaths]);

  /**
   * The one-time import of the old `localStorage` library.
   *
   * After mount rather than before the first paint: it reads a key, may write a
   * few hundred rows, and none of that should stand between the user and a
   * window. A failure leaves the flag unwritten, so the next launch tries again.
   */
  useEffect(() => {
    void migrateLegacyStorage()
      .then((report) => {
        const message = describeMigration(report);
        if (message) toast.success(message);
      })
      .catch(() => {
        toast.error(
          'Could not import your old library. It is still there; this will retry.',
        );
      });
  }, []);

  /**
   * The launch is over: the first screen has rendered with real content.
   *
   * In an effect rather than in the render body, because an effect runs after
   * the browser has committed the DOM — which is the moment clicking something
   * starts working, and therefore the thing worth measuring.
   *
   * `record` writes to the store, so it goes after the mark rather than with
   * it: the write is not part of what is being timed.
   */
  useEffect(() => {
    mark('interactive');
    void recordStartup();
  }, []);

  /** The first run, for somebody with no library and no history. */
  useEffect(() => {
    void needsOnboarding().then(setOnboarding);
  }, []);

  /**
   * Records errors locally so the diagnostics screen has something to show.
   *
   * Recording is local and unconditional; the telemetry setting governs
   * *sending*, and there is nowhere to send to anyway. A user filing a bug
   * should be able to find the report either way.
   */
  useEffect(() => watchForCrashes(() => route.name), [route.name]);

  // A decode failure used to be written to state and rendered nowhere at all,
  // so a file that would not play simply did nothing. `<Toaster />` has been
  // mounted since the shell was built and had no callers.
  useEffect(() => {
    if (!player.error) return;
    toast.error(player.error);
    player.dismissError();
  }, [player]);

  useHotkeys(
    useMemo(
      () => [
        { key: ' ', run: player.toggle },
        { key: 'k', ctrl: true, run: () => setPaletteOpen(true) },
        { key: 'f', ctrl: true, run: focusSearch },
        { key: 'b', ctrl: true, run: () => setSidebarOpen((open) => !open) },
        { key: 'q', ctrl: true, run: () => setQueueOpen((open) => !open) },
        { key: ',', ctrl: true, run: () => navigate('settings') },
        { key: 'f', run: () => setImmersive((on) => !on) },
        { key: 'm', ctrl: true, run: () => setMini((on) => !on) },
        { key: 't', ctrl: true, run: () => goInNewTab(route) },
        // Shift+F rather than a bare key: this covers the whole screen and
        // takes over the arrow keys, so it should not be one stray press away.
        { key: 'F', shift: true, run: () => setBigScreen((on) => !on) },
        {
          key: 'w',
          ctrl: true,
          run: () =>
            setTabs((now) => closeTab(now, now.activeId, { name: 'home' })),
        },
        {
          key: 'Tab',
          ctrl: true,
          run: () => setTabs((now) => cycleTab(now, 1)),
        },
        {
          key: 'Tab',
          ctrl: true,
          shift: true,
          run: () => setTabs((now) => cycleTab(now, -1)),
        },
        { key: 'l', run: () => setImmersive(true) },
        { key: 'm', run: player.toggleMute },
        { key: 's', run: player.toggleShuffle },
        { key: 'r', run: player.cycleRepeat },
        { key: 'ArrowRight', ctrl: true, run: player.next },
        { key: 'ArrowLeft', ctrl: true, run: player.previous },
        {
          key: 'ArrowRight',
          run: () => player.seek(player.progressNow() + settings.seekStep),
        },
        {
          key: 'ArrowLeft',
          run: () =>
            player.seek(Math.max(0, player.progressNow() - settings.seekStep)),
        },
        { key: 'ArrowLeft', alt: true, run: back },
        { key: 'ArrowRight', alt: true, run: forward },
      ],
      [
        player,
        navigate,
        focusSearch,
        setSidebarOpen,
        setQueueOpen,
        back,
        forward,
        settings.seekStep,
        goInNewTab,
        route,
      ],
    ),
  );

  return (
    <>
      {/* h-screen, not h-svh: `svh` is a mobile viewport unit and in a
          frameless desktop window it can leave a hairline gap at the bottom.

          The window ground is `background`; the panels below float on it as
          rounded cards. That is what makes the app read as one body with
          regions rather than as columns divided by hairlines — and it means
          the gaps do the grouping work that a dozen 1px borders used to. */}
      <div className="flex h-screen flex-col bg-background text-foreground">
        <TopBar
          view={tab}
          route={route}
          onOpenRoute={go}
          query={query}
          onQueryChange={setQuery}
          onBrowse={() => {
            setQuery('');
            navigate('search');
          }}
          onNavigate={navigate}
          onSubmit={() => navigate('search')}
          onCommand={() => setPaletteOpen(true)}
          onBack={back}
          onForward={forward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
        />

        <div className="flex min-h-0 flex-1 gap-2 px-2">
          {/* Width, not conditional mounting: the panel keeps its scroll
              position and internal state across a collapse. It collapses to a
              rail rather than to zero, so the library never disappears. */}
          <div
            className={cn(
              'shrink-0 overflow-hidden',
              // The transition is what animates the collapse — and is turned
              // off while a handle is held, because a width that eases towards
              // the pointer instead of following it reads as lag.
              !resizing && 'transition-[width] duration-slow ease-move',
            )}
            style={{
              width: sidebarOpen
                ? clampWidth(sidebarWidth, windowWidth, SIDEBAR_LIMITS)
                : 68,
            }}
          >
            <AppSidebar
              onViewChange={navigate}
              onOpen={go}
              collapsed={!sidebarOpen}
              onToggleCollapsed={() => setSidebarOpen((open) => !open)}
            />
          </div>

          {/* Only while the panel is a panel. A collapsed rail is a fixed
              width by definition, and a handle that resizes nothing is a
              handle that teaches people not to trust handles. */}
          {sidebarOpen && (
            <ResizeHandle
              label="Resize the library panel"
              width={sidebarWidth}
              limits={SIDEBAR_LIMITS}
              edge="right"
              onResize={setSidebarWidth}
              onDragging={setResizing}
            />
          )}

          <main
            className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card"
            /*
             * Ctrl-click and middle-click open a new tab.
             *
             * Caught here rather than threaded through every card, grid and
             * list that can open something. A card marks itself with
             * `data-route`; this reads the nearest one from the event's path
             * and opens it. One listener, one attribute, and a component that
             * never has to know tabs exist.
             */
            onClickCapture={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              const route = routeFromEvent(event.target);
              if (!route) return;
              event.preventDefault();
              event.stopPropagation();
              goInNewTab(route);
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              const route = routeFromEvent(event.target);
              if (!route) return;
              event.preventDefault();
              goInNewTab(route);
            }}
          >
            <ViewTabs
              tabs={tabs}
              onSelect={(id) => setTabs((now) => ({ ...now, activeId: id }))}
              onClose={(id) =>
                setTabs((now) => closeTab(now, id, { name: 'home' }))
              }
              onNew={() => goInNewTab(route)}
            />

            {/* `mode="wait"` lets the outgoing view finish before the next
                one enters, so the two never overlap and shift layout. Each
                view owns its own scroll container, which is what keeps a
                pinned header pinned. */}
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={viewKey(route)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: duration.base, ease: ease.enter }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/*
                  The fallback is deliberately empty rather than a spinner. A
                  chunk from local disk resolves in a few milliseconds, and a
                  spinner that flashes for one frame reads as a glitch — the
                  cross-fade the view transition is already doing covers it.
                */}
                {/*
                  Keyed on the route, so navigating away from a screen that
                  threw clears the error rather than showing the fallback
                  forever. Without the key, one broken album page would make
                  every later page look broken too.
                */}
                <ErrorBoundary key={viewKey(route)} what="This screen">
                  <Suspense fallback={null}>
                    {route.name === 'home' && (
                      <HomeView onBrowse={navigate} onOpen={go} />
                    )}
                    {/* One screen for both. `browse` stays a route so existing
                        links keep working, and it lands on the same view —
                        which with nothing typed *is* the browse page. */}
                    {(route.name === 'search' || route.name === 'browse') && (
                      <SearchView query={query} onOpen={go} />
                    )}
                    {(route.name === 'library' ||
                      route.name === 'local-album' ||
                      route.name === 'local-artist') && (
                      // One component for all three, because a local album page is
                      // the library with a detail open rather than a different
                      // screen. Mounting a separate view would throw away the
                      // browser's tab, filter and scroll on every visit.
                      <LibraryView route={route} onOpen={go} onBack={back} />
                    )}
                    {route.name === 'settings' && (
                      <SettingsView onOpenLegal={() => go({ name: 'legal' })} />
                    )}
                    {route.name === 'album' && (
                      <AlbumView
                        id={route.id}
                        title={route.title}
                        onOpen={go}
                        onBack={back}
                      />
                    )}
                    {route.name === 'saved' && <SavedView kind={route.kind} />}
                    {route.name === 'playlist' && (
                      <PlaylistView id={route.id} onBack={back} />
                    )}
                    {route.name === 'artist' && (
                      <ArtistView
                        id={route.id}
                        name={route.artistName}
                        onOpen={go}
                        onBack={back}
                      />
                    )}
                    {route.name === 'downloads' && <DownloadsView />}
                    {route.name === 'statistics' && <StatisticsView />}
                    {route.name === 'radio' && <RadioView />}
                    {route.name === 'uploads' && <UploadsView />}
                    {route.name === 'diagnostics' && <DiagnosticsView />}
                    {route.name === 'legal' && <LegalView />}
                    {route.name === 'smart' && <SmartPlaylistsView />}

                    {route.name === 'feed' && (
                      <FeedView
                        onOpenProfile={(handle) =>
                          go({ name: 'profile', handle })
                        }
                      />
                    )}
                    {route.name === 'profile' && (
                      <ProfileView handle={route.handle} onBack={back} />
                    )}
                    {/* One component for both, because a show's episode list is the
                    podcasts screen with a detail open — the same arrangement a
                    local album has with the library. */}
                    {(route.name === 'podcasts' || route.name === 'podcast') &&
                      (openShow && route.name === 'podcast' ? (
                        <PodcastView
                          podcast={openShow}
                          onBack={() => {
                            setOpenShow(null);
                            back();
                          }}
                        />
                      ) : (
                        <PodcastsView
                          onOpenShow={(podcast) => {
                            setOpenShow(podcast);
                            go({
                              name: 'podcast',
                              id: podcast.id,
                              title: podcast.title,
                            });
                          }}
                        />
                      ))}
                  </Suspense>
                </ErrorBoundary>
              </m.div>
            </AnimatePresence>
          </main>

          <RightSidebar
            open={queueOpen}
            width={clampWidth(rightWidth, windowWidth, RIGHT_LIMITS)}
            onWidthChange={setRightWidth}
            onClose={() => setQueueOpen(false)}
          />
        </div>

        <NowPlayingBar
          queueOpen={queueOpen}
          onToggleQueue={() => setQueueOpen((open) => !open)}
          pipOn={pip}
          onTogglePip={() => setPip((on) => !on)}
        />
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={navigate}
        onOpen={go}
        onBigScreen={() => setBigScreen(true)}
      />
      {/* Overlays rather than routes: both are *modes* of looking at what is
          already playing, and neither is somewhere you can navigate back to. */}
      <Suspense fallback={null}>
        {immersive && <ImmersivePlayer onClose={() => setImmersive(false)} />}
        {mini && <MiniPlayer onClose={() => setMini(false)} />}
        {pip && <PipPlayer onClose={closePip} />}
        {bigScreen && <BigScreen onClose={() => setBigScreen(false)} />}
        {onboarding && <Onboarding onDone={() => setOnboarding(false)} />}
      </Suspense>
      {/* Files dropped anywhere on the window. Mounted at the top level
          because the whole window is the target — a drop zone that is only
          part of the window is one people miss. */}
      <DropTarget onFiles={playPaths} />
      <DesktopShell />
      <Toaster />
    </>
  );
}

export default App;

/**
 * The route a card was carrying, from a click's target.
 *
 * `data-route` holds the route as JSON. A malformed one is ignored rather than
 * thrown: a stray attribute somewhere should not make ctrl-click stop working
 * everywhere.
 */
function routeFromEvent(target: EventTarget | null): Route | null {
  if (!(target instanceof Element)) return null;

  const carrier = target.closest('[data-route]');
  const encoded = carrier?.getAttribute('data-route');
  if (!encoded) return null;

  try {
    const parsed: unknown = JSON.parse(encoded);
    return parsed && typeof parsed === 'object' && 'name' in parsed
      ? (parsed as Route)
      : null;
  } catch {
    return null;
  }
}
