import { LazyMotion, MotionConfig } from 'motion/react';

import { SettingsProvider } from '@/components/common/settings-provider';
import { ThemeProvider } from '@/components/common/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WidgetShell } from '@/components/player/widget-shell';
import { RemoteWidgetTransport } from '@/components/player/widget-transport-remote';

/** Split out so Motion's feature bundle is fetched rather than bundled. */
const loadMotionFeatures = () =>
  import('@/lib/motion-features').then((module) => module.default);

/**
 * Everything the widget window mounts, and nothing else.
 *
 * # Why this is not `Providers`
 *
 * Because `Providers` contains `PlayerProvider`, and `PlayerProvider` owns the
 * audio element. A second one in a second window is a second element: every
 * track would play twice, slightly out of phase, and pausing one would leave
 * the other going. The widget window must not own playback — see
 * `lib/widget-link.ts` for what it does instead.
 *
 * What is left is the smallest tree that can draw a themed, animated widget:
 * motion for the record and the pill, settings and theme so the colours match
 * the app, and tooltips because the controls have labels rather than text. No
 * library, no store subscriptions, no backend, no auth. It mounts in
 * milliseconds and holds no resources, which matters for a window somebody
 * leaves on their desktop all day.
 */
export function WidgetWindow() {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <SettingsProvider>
          <ThemeProvider>
            <TooltipProvider>
              <RemoteWidgetTransport>
                <WidgetShell />
              </RemoteWidgetTransport>
            </TooltipProvider>
          </ThemeProvider>
        </SettingsProvider>
      </MotionConfig>
    </LazyMotion>
  );
}
