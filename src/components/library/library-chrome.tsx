import type { ReactNode } from 'react';

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
import { SORT_LABELS, type SortKey } from '@/lib/library-model';
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

export function SortMenu({
  sort,
  descending,
  onSort,
  onDirection,
}: {
  sort: SortKey;
  descending: boolean;
  onSort: (key: SortKey) => void;
  onDirection: (descending: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <SortAsc className="size-4" />
          {SORT_LABELS[sort]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => onSort(value as SortKey)}
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {SORT_LABELS[key]}
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
