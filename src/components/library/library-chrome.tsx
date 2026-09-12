import type { ReactNode } from 'react';
import { LayoutGrid, List, ListFilter } from 'lucide-react';

import { Search, SortAsc, X } from '@/components/icons';
import { IconButton } from '@/components/icons/icon-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  activeFilterCount,
  NO_FILTERS,
  type ArtworkFilter,
  type FilterOption,
  type LibraryFilters,
} from '@/lib/library-model';
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

type FilterGroup = 'genres' | 'decades' | 'formats';

/**
 * Narrowing the library by genre, decade, format and cover.
 *
 * One button with a submenu per group, rather than a row of chips: a library
 * can have forty genres, and a toolbar that grows with the collection pushes the
 * filter box off the edge. The count on the button says how many groups are
 * narrowing the list, so a filter left on is never invisible.
 *
 * Choosing a value keeps the menu open — picking Rock and then Jazz is one
 * gesture, not two trips to the toolbar.
 */
export function FilterMenu({
  filters,
  options,
  onChange,
}: {
  filters: LibraryFilters;
  options: {
    genres: FilterOption<string>[];
    decades: FilterOption<number>[];
    formats: FilterOption<string>[];
  };
  onChange: (filters: LibraryFilters) => void;
}) {
  const active = activeFilterCount(filters);

  const toggle = (key: FilterGroup, value: string | number) => {
    const current = filters[key] as (string | number)[];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next });
  };

  const group = (
    key: FilterGroup,
    label: string,
    items: FilterOption<string | number>[],
  ) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={items.length === 0}>
        {label}
        {filters[key].length > 0 && (
          <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
            {filters[key].length}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
        {items.map((item) => (
          <DropdownMenuCheckboxItem
            key={String(item.value)}
            checked={(filters[key] as (string | number)[]).includes(item.value)}
            onCheckedChange={() => toggle(key, item.value)}
            onSelect={(event) => event.preventDefault()}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="pl-3 text-xs text-muted-foreground tabular-nums">
              {item.count}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          animate
          variant={active > 0 ? 'secondary' : 'outline'}
          size="sm"
          aria-label={
            active > 0
              ? `Filters, ${active} active`
              : 'Filter by genre, decade, format or cover'
          }
        >
          <ListFilter className="size-4" />
          Filters
          {active > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[11px] leading-4 font-semibold text-primary-foreground tabular-nums">
              {active}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Filter by</DropdownMenuLabel>
        {group('genres', 'Genre', options.genres)}
        {group('decades', 'Decade', options.decades)}
        {group('formats', 'Format', options.formats)}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Cover art</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={filters.artwork}
              onValueChange={(value) =>
                onChange({ ...filters, artwork: value as ArtworkFilter })
              }
            >
              <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="with">
                Has a cover
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="without">
                Missing a cover
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={active === 0}
          onSelect={() => onChange(NO_FILTERS)}
        >
          Clear filters
        </DropdownMenuItem>
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
