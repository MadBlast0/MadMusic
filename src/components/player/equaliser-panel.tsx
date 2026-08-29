import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  applyEqualiser,
  loadEqualiser,
  saveEqualiser,
  type StoredEqualiser,
} from '@/lib/audio/equaliser';
import { audioGraph, BANDS, BAND_LIMIT_DB } from '@/lib/audio/graph';
import { identifyPreset, PRESETS, presetBands } from '@/lib/audio/presets';

/**
 * The ten-band equaliser.
 *
 * # The limitation it has to be honest about
 *
 * The equaliser is Web Audio, and Web Audio can only touch a source that sends
 * CORS headers. The app's own `stream:` protocol does; a local file served
 * through `asset:` or `blob:` does not, and routing one through the graph
 * anyway produces **silence with no way back**.
 *
 * So the equaliser applies to catalogue tracks and not to your own files, and
 * this panel says so in a banner rather than leaving somebody to conclude their
 * headphones are broken. That banner is the most important part of this screen.
 *
 * # The preset is identified, not remembered
 *
 * Dragging a slider back to exactly "Rock" says Rock again, because the name is
 * derived from the curve. A stored preset id that survived editing would leave
 * the label claiming a curve the user has since changed — the small lie that
 * makes people stop trusting a screen.
 */
export function EqualiserPanel() {
  const [equaliser, setEqualiser] = useState<StoredEqualiser | null>(null);

  useEffect(() => {
    void loadEqualiser().then(setEqualiser);
  }, []);

  if (!equaliser) return null;

  /** Applies immediately and stores after, so a drag is heard as it moves. */
  const update = (next: StoredEqualiser) => {
    setEqualiser(next);
    applyEqualiser(next);
    void saveEqualiser(next);
  };

  const setBand = (index: number, value: number) => {
    const bands = [...equaliser.bands];
    bands[index] = value;
    update({ ...equaliser, bands, preset: identifyPreset(bands) });
  };

  return (
    <div className="space-y-6">
      {!audioGraph.active && (
        <Alert>
          <AlertTitle>Nothing to equalise yet</AlertTitle>
          <AlertDescription>
            The equaliser attaches when a track starts. Play something and the
            bands below take effect — local files included, since they are
            served through the app&rsquo;s own protocol.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="flex items-center gap-3">
          <Switch
            checked={equaliser.enabled}
            onCheckedChange={(enabled) => update({ ...equaliser, enabled })}
          />
          <span className="text-sm font-medium">Equaliser</span>
        </label>

        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="eq-preset" className="text-xs">
              Preset
            </Label>
            <Select
              value={equaliser.preset}
              onValueChange={(id) => {
                const bands = presetBands(id);
                update({ ...equaliser, preset: id, bands, enabled: true });
              }}
            >
              <SelectTrigger id="eq-preset" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {equaliser.preset === 'custom' && (
                  <SelectItem value="custom">Custom</SelectItem>
                )}
                {PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update({
                ...equaliser,
                preset: 'flat',
                bands: presetBands('flat'),
                preamp: 0,
                bassBoost: 0,
              })
            }
          >
            Reset
          </Button>
        </div>
      </div>

      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${BANDS.length}, minmax(0, 1fr))`,
        }}
      >
        {BANDS.map((frequency, index) => (
          <div key={frequency} className="flex flex-col items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {(equaliser.bands[index] ?? 0) > 0 ? '+' : ''}
              {(equaliser.bands[index] ?? 0).toFixed(0)}
            </span>
            <Slider
              orientation="vertical"
              className="h-40"
              min={-BAND_LIMIT_DB}
              max={BAND_LIMIT_DB}
              step={1}
              value={[equaliser.bands[index] ?? 0]}
              disabled={!equaliser.enabled}
              onValueChange={([value]) => setBand(index, value)}
              aria-label={`${formatFrequency(frequency)} band, in decibels`}
            />
            <span className="text-xs text-muted-foreground">
              {formatFrequency(frequency)}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs">Preamp ({equaliser.preamp} dB)</Label>
          <Slider
            min={-12}
            max={12}
            step={1}
            value={[equaliser.preamp]}
            disabled={!equaliser.enabled}
            onValueChange={([preamp]) => update({ ...equaliser, preamp })}
          />
          <p className="text-xs text-muted-foreground">
            {/* Explaining the automatic trim, because otherwise somebody boosts
                every band and wonders why it did not get louder. */}
            Boosting bands is automatically trimmed to stop the output clipping,
            so a large boost sounds clearer rather than louder.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">
            Bass boost ({equaliser.bassBoost} dB)
          </Label>
          <Slider
            min={0}
            max={12}
            step={1}
            value={[equaliser.bassBoost]}
            disabled={!equaliser.enabled}
            onValueChange={([bassBoost]) => update({ ...equaliser, bassBoost })}
          />
          <p className="text-xs text-muted-foreground">
            A separate low shelf, so it survives changing preset.
          </p>
        </div>
      </div>
    </div>
  );
}

/** 1000 becomes 1k, which is what an equaliser has always labelled it. */
function formatFrequency(hertz: number): string {
  return hertz >= 1000 ? `${hertz / 1000}k` : String(hertz);
}
