import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, X } from '@/components/icons';
import { store } from '@/lib/store';
import type {
  Rule,
  RuleField,
  RuleOp,
  RuleSet,
  SmartPlaylist,
  TrackRow,
} from '@/lib/store/types';
import { fallbackCover } from '@/lib/library-model';

/**
 * The rule editor for a smart playlist.
 *
 * # Why the preview is live
 *
 * Because a rule set is only comprehensible through what it selects. "Rated
 * four or more, added in the last year, not live" is three clauses nobody can
 * evaluate in their head against four thousand tracks — but the count updating
 * as each clause is added answers it immediately, and shows the moment a clause
 * takes the list to zero.
 *
 * # Why the field list is closed
 *
 * These names become part of a SQL statement in `db::smart`. The dropdown is not
 * a convenience over a free-text box; it is the boundary that makes building
 * SQL from user input safe at all.
 */

/** The fields, with what to call them and what kind of value they take. */
const FIELDS: {
  id: RuleField;
  label: string;
  kind: 'text' | 'number' | 'date' | 'bool';
}[] = [
  { id: 'title', label: 'Title', kind: 'text' },
  { id: 'artist', label: 'Artist', kind: 'text' },
  { id: 'album_artist', label: 'Album artist', kind: 'text' },
  { id: 'album', label: 'Album', kind: 'text' },
  { id: 'genre', label: 'Genre', kind: 'text' },
  { id: 'composer', label: 'Composer', kind: 'text' },
  { id: 'tag', label: 'Tag', kind: 'text' },
  { id: 'kind', label: 'Source', kind: 'text' },
  { id: 'year', label: 'Year', kind: 'number' },
  { id: 'duration', label: 'Length (seconds)', kind: 'number' },
  { id: 'bpm', label: 'BPM', kind: 'number' },
  { id: 'stars', label: 'Rating', kind: 'number' },
  { id: 'plays', label: 'Play count', kind: 'number' },
  { id: 'added', label: 'Date added', kind: 'date' },
  { id: 'last_played', label: 'Last played', kind: 'date' },
  { id: 'liked', label: 'Liked', kind: 'bool' },
  { id: 'downloaded', label: 'Downloaded', kind: 'bool' },
  { id: 'explicit', label: 'Explicit', kind: 'bool' },
];

/** The operators each kind of field accepts. */
const OPS: Record<string, { id: RuleOp; label: string }[]> = {
  text: [
    { id: 'is', label: 'is' },
    { id: 'is_not', label: 'is not' },
    { id: 'contains', label: 'contains' },
    { id: 'not_contains', label: 'does not contain' },
    { id: 'starts_with', label: 'starts with' },
    { id: 'ends_with', label: 'ends with' },
    { id: 'empty', label: 'is empty' },
    { id: 'not_empty', label: 'is not empty' },
  ],
  number: [
    { id: 'is', label: 'is' },
    { id: 'is_not', label: 'is not' },
    { id: 'gt', label: 'is more than' },
    { id: 'gte', label: 'is at least' },
    { id: 'lt', label: 'is less than' },
    { id: 'lte', label: 'is at most' },
    { id: 'between', label: 'is between' },
  ],
  // Dates are always relative. An absolute date stops being true the day after
  // you write it, which defeats the point of a *smart* playlist.
  date: [
    { id: 'within_days', label: 'in the last (days)' },
    { id: 'not_within_days', label: 'not in the last (days)' },
    { id: 'ever', label: 'ever' },
    { id: 'never', label: 'never' },
  ],
  bool: [{ id: 'is', label: 'is' }],
};

function kindOf(field: RuleField): string {
  return FIELDS.find((entry) => entry.id === field)?.kind ?? 'text';
}

const NEW_RULE: Rule = { field: 'artist', op: 'is', value: '', value2: '' };

export function SmartPlaylistEditor({
  existing,
  open,
  onOpenChange,
  onSaved,
}: {
  /** The playlist being edited, or null to create one. */
  existing: SmartPlaylist | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        {/*
          Mounted only while open, so the form starts from the playlist being
          edited rather than being copied into state by an effect. Copying props
          into state from an effect is a cascading render, and remounting is
          what React offers instead.
        */}
        {open && (
          <SmartPlaylistForm
            existing={existing}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SmartPlaylistForm({
  existing,
  onOpenChange,
  onSaved,
}: {
  existing: SmartPlaylist | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [rules, setRules] = useState<RuleSet>(
    existing?.rules ?? { matchMode: 'all', rules: [{ ...NEW_RULE }] },
  );
  const [sortBy, setSortBy] = useState(existing?.sortBy ?? 'added');
  const [sortDesc, setSortDesc] = useState(existing?.sortDesc ?? true);
  const [cap, setCap] = useState(existing?.cap ?? 0);
  const [preview, setPreview] = useState<TrackRow[]>([]);

  // The live preview. Debounced, because typing into a value field would
  // otherwise run a query per keystroke against the whole library.
  useEffect(() => {
    const timer = setTimeout(() => {
      void store
        .smartPreview(rules, sortBy, sortDesc, cap || 200)
        .then(setPreview)
        .catch(() => setPreview([]));
    }, 250);

    return () => clearTimeout(timer);
  }, [rules, sortBy, sortDesc, cap]);

  const update = (index: number, patch: Partial<Rule>) =>
    setRules((existingSet) => ({
      ...existingSet,
      rules: existingSet.rules.map((rule, at) =>
        at === index ? { ...rule, ...patch } : rule,
      ),
    }));

  const save = async () => {
    const id = existing?.id ?? `smart-${Date.now().toString(36)}`;
    const [coverA, coverB] = fallbackCover(name || 'Smart playlist');

    await store.smartUpsert({
      id,
      name: name.trim() || 'Smart playlist',
      rules,
      sortBy,
      sortDesc,
      cap,
      coverA,
      coverB,
      createdAt: existing?.createdAt ?? 0,
      updatedAt: 0,
      trackCount: 0,
    });

    onSaved();
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {existing ? 'Edit smart playlist' : 'New smart playlist'}
        </DialogTitle>
        <DialogDescription>
          A list that keeps itself up to date. Tracks join and leave it as they
          match the rules.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1">
        <Label htmlFor="smart-name">Name</Label>
        <Input
          id="smart-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Recently added favourites"
        />
      </div>

      <div className="flex items-center gap-2 text-sm">
        Match
        <Select
          value={rules.matchMode}
          onValueChange={(value) =>
            setRules((set) => ({ ...set, matchMode: value as 'all' | 'any' }))
          }
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="any">any</SelectItem>
          </SelectContent>
        </Select>
        of these rules
      </div>

      <ul className="space-y-2">
        {rules.rules.map((rule, index) => {
          const kind = kindOf(rule.field);
          const ops = OPS[kind] ?? OPS.text;
          const needsValue = !['empty', 'not_empty', 'ever', 'never'].includes(
            rule.op,
          );

          return (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <Select
                value={rule.field}
                onValueChange={(value) => {
                  const field = value as RuleField;
                  // The operator has to change with the field: "contains" on
                  // a rating is meaningless, and leaving it there produces a
                  // rule that silently matches nothing.
                  const first = (OPS[kindOf(field)] ?? OPS.text)[0].id;
                  update(index, { field, op: first, value: '', value2: '' });
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELDS.map((field) => (
                    <SelectItem key={field.id} value={field.id}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={rule.op}
                onValueChange={(value) =>
                  update(index, { op: value as RuleOp })
                }
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ops.map((op) => (
                    <SelectItem key={op.id} value={op.id}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {needsValue &&
                (kind === 'bool' ? (
                  <Select
                    value={String(rule.value === true || rule.value === 'true')}
                    onValueChange={(value) =>
                      update(index, { value: value === 'true' })
                    }
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">yes</SelectItem>
                      <SelectItem value="false">no</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="w-40"
                    type={kind === 'text' ? 'text' : 'number'}
                    value={String(rule.value ?? '')}
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                  />
                ))}

              {rule.op === 'between' && (
                <Input
                  className="w-32"
                  type="number"
                  placeholder="and"
                  value={String(rule.value2 ?? '')}
                  onChange={(event) =>
                    update(index, { value2: event.target.value })
                  }
                />
              )}

              <Button
                animate
                variant="ghost"
                size="icon"
                aria-label="Remove this rule"
                // The last rule cannot be removed: an empty rule set selects
                // everything, and a smart playlist that is the whole library
                // is a confusing thing to arrive at by clicking a bin icon.
                disabled={rules.rules.length === 1}
                onClick={() =>
                  setRules((set) => ({
                    ...set,
                    rules: set.rules.filter((_, at) => at !== index),
                  }))
                }
              >
                <X className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>

      <Button
        animate
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          setRules((set) => ({
            ...set,
            rules: [...set.rules, { ...NEW_RULE }],
          }))
        }
      >
        <Plus className="size-4" />
        Add a rule
      </Button>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Sort by</Label>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="added">Date added</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="artist">Artist</SelectItem>
              <SelectItem value="album">Album</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="plays">Play count</SelectItem>
              <SelectItem value="last_played">Last played</SelectItem>
              <SelectItem value="stars">Rating</SelectItem>
              <SelectItem value="random">Random</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Order</Label>
          <Select
            value={sortDesc ? 'desc' : 'asc'}
            onValueChange={(value) => setSortDesc(value === 'desc')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest first</SelectItem>
              <SelectItem value="asc">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="smart-cap">Limit</Label>
          <Input
            id="smart-cap"
            type="number"
            min={0}
            value={cap || ''}
            placeholder="No limit"
            onChange={(event) => setCap(Number(event.target.value) || 0)}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-sm font-medium">
          {preview.length === 0
            ? 'No tracks match these rules'
            : `${preview.length}${cap && preview.length >= cap ? '+' : ''} ${preview.length === 1 ? 'track' : 'tracks'} match`}
        </p>
        {preview.length > 0 && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {preview
              .slice(0, 4)
              .map((track) => `${track.artist} — ${track.title}`)
              .join(' · ')}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={() => void save()}>
          {existing ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </>
  );
}
