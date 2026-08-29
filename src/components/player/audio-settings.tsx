import { useEffect, useRef } from 'react';

import { useSettings } from '@/components/common/settings-context';
import { usePlayer } from '@/components/player/player-context';
import { audioGraph, FLAT, type GraphSettings } from '@/lib/audio/graph';
import {
  onDeviceChange,
  rememberVolume,
  selectOutput,
  volumeForDevice,
  type DeviceVolumes,
} from '@/lib/audio/devices';
import { loadEqualiser } from '@/lib/audio/equaliser';
import { store } from '@/lib/store';
import { keys } from '@/lib/store/keys';

/**
 * Keeps the audio processing chain in step with the settings.
 *
 * Renders nothing. It exists because the graph is a module singleton with
 * mutable state, and something has to be responsible for pushing preferences
 * into it — otherwise every screen that can change a preference would have to
 * remember to, and the equaliser screen would be the only one that did.
 *
 * The curve itself lives in `src/lib/audio/equaliser.ts`, which is where the
 * reading, writing and applying of it are. This component is only the part that
 * has to be mounted.
 */

export function AudioSettings() {
  const { settings } = useSettings();
  const { elements, volume, setVolume } = usePlayer();

  useEffect(() => {
    let cancelled = false;

    void loadEqualiser().then((equaliser) => {
      if (cancelled) return;

      const graph: Partial<GraphSettings> = {
        // A disabled equaliser is flat rather than absent. Leaving the previous
        // curve in place while the switch says off is the kind of thing that
        // has somebody convinced their headphones are broken.
        bands: equaliser.enabled ? equaliser.bands : [...FLAT.bands],
        preamp: equaliser.enabled ? equaliser.preamp : 0,
        bassBoost: equaliser.enabled ? equaliser.bassBoost : 0,
        mono: settings.monoAudio,
        balance: settings.balance,
        loudness: settings.loudnessCompensation,
      };

      audioGraph.apply(graph);
    });

    return () => {
      cancelled = true;
    };
  }, [settings.monoAudio, settings.balance, settings.loudnessCompensation]);

  /* ── the output device, and the volume it remembers ──────────────── */

  const volumesRef = useRef<DeviceVolumes>({});
  const deviceRef = useRef(settings.outputDevice);

  // Loaded once. Reading this on every volume change would turn dragging the
  // slider into a stream of database reads.
  useEffect(() => {
    void store
      .kvGet(keys.DEVICE_VOLUMES)
      .then((raw) => {
        if (raw) volumesRef.current = JSON.parse(raw) as DeviceVolumes;
      })
      .catch(() => {
        // A corrupt blob costs the remembered volumes, not playback.
      });
  }, []);

  useEffect(() => {
    const device = settings.outputDevice;
    let cancelled = false;

    void (async () => {
      // One call with both elements: the deck hands over between them for
      // gapless playback, so setting the sink on only the active one would put
      // the next track back on the default device.
      await selectOutput(device, elements()).catch(() => {
        // The device was unplugged between listing and selecting. Playback
        // stays on the default, which is audible and therefore better than
        // throwing.
      });
      if (cancelled) return;

      // Switching devices restores the volume that device was last played at —
      // headphones and speakers wanting the same number is the exception, not
      // the rule. A device nobody has set carries the current volume over
      // rather than jumping.
      if (device !== deviceRef.current) {
        deviceRef.current = device;
        setVolume(volumeForDevice(volumesRef.current, device, volume));
      }
    })();

    return () => {
      cancelled = true;
    };
    // `volume` is deliberately absent: this runs when the *device* changes, and
    // including it would re-apply the stored volume on every slider movement,
    // pinning the slider in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.outputDevice, elements, setVolume]);

  // Remember the volume against whichever device is playing it.
  useEffect(() => {
    const device = deviceRef.current;
    const next = rememberVolume(volumesRef.current, device, volume);
    volumesRef.current = next;

    const timer = setTimeout(() => {
      void store
        .kvSet(keys.DEVICE_VOLUMES, JSON.stringify(next))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [volume]);

  // Hardware appearing or disappearing changes what the picker should offer,
  // and can silently move playback to another device.
  useEffect(() => onDeviceChange(() => {}), []);

  return null;
}
