import { Search, X } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Narrowing a list you are already looking at.
 *
 * Distinct from the search field in the title bar, and the distinction is the
 * point: that one *goes somewhere* — it leaves this page and shows results from
 * the whole library and the catalogue. This one never navigates. It filters
 * what is already on screen, which is what somebody looking at a 200-track
 * album or a long playlist actually wants when they type.
 *
 * Conflating the two is a common mistake and an annoying one: typing into the
 * global field to find a track on the page you are on throws you off that page.
 */
export function FilterBox({
  value,
  onChange,
  placeholder = 'Filter this list',
  count,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** How many rows survive the filter, announced for screen readers. */
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'relative flex h-8 w-56 items-center rounded-full border border-transparent bg-card transition-colors duration-fast',
          'focus-within:border-ring focus-within:bg-background',
        )}
      >
        <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onChange('');
          }}
          aria-label={placeholder}
          placeholder={placeholder}
          className="h-full w-full rounded-full bg-transparent pr-7 pl-7 text-xs outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => onChange('')}
            className="absolute right-1.5 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {value && count !== undefined && (
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {count} {count === 1 ? 'match' : 'matches'}
        </span>
      )}
    </div>
  );
}
