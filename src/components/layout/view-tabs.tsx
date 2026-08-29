import { X } from '@/components/icons';
import { routeLabel, type Route } from '@/lib/routes';
import { MAX_TABS, type Tabs } from '@/lib/tabs';
import { cn } from '@/lib/utils';

/**
 * The strip of open views.
 *
 * # Why it is hidden with one tab open
 *
 * Because a tab strip showing a single tab is a row of chrome that explains
 * nothing and costs thirty pixels on every screen, for a feature most people
 * never use. It appears the moment a second view is opened and disappears when
 * the second is closed, which is also how it teaches itself: somebody who
 * ctrl-clicks an album sees the strip arrive and understands immediately.
 *
 * # Middle click
 *
 * Closes a tab. Universal, undiscoverable, and free to support.
 */
export function ViewTabs({
  tabs,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: Tabs;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Duplicates the current view into a new tab. */
  onNew: () => void;
}) {
  if (tabs.entries.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Open views"
      className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.entries.map((entry) => {
        const route: Route = entry.nav.stack[entry.nav.cursor];
        const active = entry.id === tabs.activeId;

        return (
          <div
            key={entry.id}
            className={cn(
              'group flex min-w-0 shrink-0 items-center gap-1 rounded-t-lg border-b-2 pr-1 pl-2.5 transition-colors duration-fast',
              active
                ? 'border-primary bg-card'
                : 'border-transparent text-muted-foreground hover:bg-card/60',
            )}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              // Middle click closes, as it does everywhere else.
              event.preventDefault();
              onClose(entry.id);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(entry.id)}
              className="max-w-44 truncate py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {routeLabel(route)}
            </button>
            <button
              type="button"
              aria-label={`Close ${routeLabel(route)}`}
              onClick={() => onClose(entry.id)}
              className="rounded p-0.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        aria-label="Open this view in a new tab"
        disabled={tabs.entries.length >= MAX_TABS}
        onClick={onNew}
        className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground transition-colors duration-fast hover:text-foreground disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        +
      </button>
    </div>
  );
}
