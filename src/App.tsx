import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { AppSidebar, type View } from '@/components/layout/app-sidebar';
import { NowPlayingBar } from '@/components/player/now-playing-bar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import { HomeView } from '@/views/home-view';
import { LibraryView } from '@/views/library-view';

function App() {
  const [view, setView] = useState<View>('home');

  return (
    <>
      <div className="flex h-svh flex-col bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <AppSidebar view={view} onViewChange={setView} />

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
