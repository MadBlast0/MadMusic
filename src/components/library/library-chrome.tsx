import type { ReactNode } from 'react';
import { LayoutGrid, List } from 'lucide-react';

import { Search, SortAsc, X } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * The library browser's own chrome.
 *
 * Split out of `library-view.tsx` when that file passed 780 lines. These are
 * the pieces with no knowledge of what is being browsed — a message, a sort
 * menu, a filter box — so they were the cleanest seam to cut along.
 */

export function Notice({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-card text-muted-foreground',
      )}
    >
      {children}
    </p>
  );
}

/**
 * How a list is ordered, and which way.
 *
 * Generic over the keys, because the Songs, Albums and Artists tabs each sort by
 * different things — and a copy of this menu per tab is three menus that drift
 * apart in wording and order. The labels are passed in, so the menu reads as
 * the tab it is on.
 */
export function SortMenu<K extends string>({
  sort,
  descending,
  labels,
  onSort,
  onDirection,
}: {
  sort: K;
  descending: boolean;
  labels: Record<K, string>;
  onSort: (key: K) => void;
  onDirection: (descending: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          animate
          variant="outline"
          size="sm"
          aria-label={`Sort by ${labels[sort]}, ${descending ? 'descending' : 'ascending'}`}
        >
          <SortAsc className="size-4" />
          {labels[sort]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => onSort(value as K)}
        >
          {(Object.keys(labels) as K[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {labels[key]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={descending ? 'desc' : 'asc'}
          onValueChange={(value) => onDirection(value === 'desc')}
        >
          <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Whether a tab shows its items as cards or as rows. */
export type ViewMode = 'grid' | 'list';

/**
 * Cards or rows.
 *
 * Two buttons rather than a menu: there are exactly two answers, the current one
 * should be visible without opening anything, and switching is something people
 * do repeatedly while looking for something. A grid is for recognising covers; a
 * list is for reading — years, lengths and counts line up in columns a grid
 * scatters across a card.
 */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Show as"
      className="flex items-center rounded-md border border-border p-0.5"
    >
      <IconButton
        label="Show as a grid"
        size="sm"
        active={value === 'grid'}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid className="size-4" />
      </IconButton>
      <IconButton
        label="Show as a list"
        size="sm"
        active={value === 'list'}
        onClick={() => onChange('list')}
      >
        <List className="size-4" />
      </IconButton>
    </div>
  );
}

export function FilterBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Filter library"
        placeholder="Filter by title, artist, album…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-9"
      />
      {value && (
        <IconButton
          label="Clear filter"
          size="sm"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1 -translate-y-1/2"
        >
          <X className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

/** Memoised: the grid re-renders on every keystroke otherwise, and each card
 *  holds a `CoverArt` that subscribes to the artwork cache. */
