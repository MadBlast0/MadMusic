import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A row of tabs, with the keyboard behaviour tabs are supposed to have.
 *
 * # Why this exists rather than five hand-rolled rows
 *
 * There were already four: the settings categories, the library browser, the
 * full-screen player's side panel and the podcast screen. Each got the visual
 * treatment right and the keyboard wrong in a different way — arrow keys did
 * nothing, so a tab list of six was six presses of Tab away from the content.
 *
 * The pattern is fixed: arrows move between tabs, Home and End jump to the
 * ends, and only the selected tab is in the tab order, so one press of Tab
 * leaves the strip entirely. That last part is what makes a tab list better
 * than a row of buttons rather than worse.
 */
export type TabDefinition<Id extends string> = {
  id: Id;
  label: string;
  /** Shown after the label — a count, usually. Omit rather than pass zero. */
  badge?: number;
  /**
   * Shown before the label.
   *
   * Decorative: the label is always present, so the icon adds recognition
   * rather than meaning. An icon-only tab would need its own accessible name,
   * which is a different component.
   */
  icon?: (props: { className?: string }) => React.ReactNode;
};

export function TabStrip<Id extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: readonly TabDefinition<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** What this strip is choosing between, for a screen reader. */
  label: string;
  className?: string;
}) {
  const move = (by: number) => {
    const at = tabs.findIndex((tab) => tab.id === value);
    if (at === -1) return;
    // Wraps, which is what the pattern specifies and what makes a strip of
    // three navigable without looking.
    const next = tabs[(at + by + tabs.length) % tabs.length];
    onChange(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowRight':
            event.preventDefault();
            move(1);
            break;
          case 'ArrowLeft':
            event.preventDefault();
            move(-1);
            break;
          case 'Home':
            event.preventDefault();
            onChange(tabs[0].id);
            break;
          case 'End':
            event.preventDefault();
            onChange(tabs[tabs.length - 1].id);
            break;
        }
      }}
      className={cn(
        '-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            // Only the selected tab is reachable with Tab; the arrows move
            // within the strip. Without this, a six-tab strip is six presses
            // of Tab between the header and the page.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            )}
          >
            {tab.icon && <tab.icon className="size-4" />}
            {tab.label}
            {tab.badge !== undefined && (
              <span
                className={cn(
                  'text-xs tabular-nums',
                  active ? 'opacity-80' : 'opacity-60',
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
