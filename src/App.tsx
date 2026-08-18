import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { AppSidebar, type View } from '@/components/layout/app-sidebar';
import { TitleBar } from '@/components/layout/title-bar';
import { NowPlayingBar } from '@/components/player/now-playing-bar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { HomeView } from '@/views/home-view';
import { LibraryView } from '@/views/library-view';

function App() {
  // A cursor into a history list rather than a single value, so Back and
  // Forward behave the way they do everywhere else: going back then navigating
  // somewhere new discards the forward entries.
  const [history, setHistory] = useState<View[]>(['home']);
  const [cursor, setCursor] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const view = history[cursor];

  const navigate = useCallback(
    (next: View) => {
      setHistory((previous) => {
        if (previous[cursor] === next) return previous;
        const kept = previous.slice(0, cursor + 1);
        return [...kept, next];
      });
      setCursor((c) => (history[c] === next ? c : c + 1));
    },
    [cursor, history],
  );

  return (
    <>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <TitleBar
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onSearch={() => navigate('search')}
          onBack={() => setCursor((c) => Math.max(0, c - 1))}
          onForward={() =>
            setCursor((c) => Math.min(history.length - 1, c + 1))
          }
          canGoBack={cursor > 0}
          canGoForward={cursor < history.length - 1}
        />

        <div className="flex min-h-0 flex-1">
          {/* Width, not conditional mounting: the sidebar keeps its scroll
              position and internal state across a collapse. */}
          <div
            className={cn(
              'overflow-hidden transition-[width] duration-200 ease-out',
              sidebarOpen ? 'w-64' : 'w-0',
            )}
          >
            <AppSidebar view={view} onViewChange={navigate} />
          </div>

          <main className="min-w-0 flex-1">
            <ScrollArea className="h-full">
              {/* `mode="wait"` lets the outgoing view finish before the next
                  one enters, so the two never overlap and shift layout. */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  {view === 'home' && <HomeView />}
                  {view === 'search' && <Placeholder title="Search" />}
                  {view === 'library' && <LibraryView />}
                </motion.div>
              </AnimatePresence>
            </ScrollArea>
          </main>
        </div>

        <NowPlayingBar />
      </div>

      <Toaster />
    </>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Not designed yet — next up.
      </p>
    </div>
  );
}

export default App;
