import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { DesktopLinkView } from '@/views/desktop-link-view';
import { Providers } from '@/components/common/providers';
import { ErrorBoundary } from '@/components/common/error-boundary';
import { mark } from '@/lib/startup';
import '@/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

/**
 * The moment the window stops being a blank rectangle.
 *
 * Marked here rather than from a `requestAnimationFrame` inside React: this is
 * the last line before the first render is scheduled, and the stylesheet above
 * it has already been applied. See `src/lib/startup.ts` for what is measured
 * and why there is a budget at all.
 */
mark('paint');

/**
 * The desktop hand-off page.
 *
 * Routed here rather than through the app's tab system because it is not a
 * screen of the app — it is a step in signing in, reached only by the desktop
 * build opening a browser, and it must render without the player, the library
 * or anything else that assumes a session.
 */
const isDesktopLink =
  window.location.pathname.replace(/\/+$/, '') === '/desktop-link';

createRoot(container).render(
  <StrictMode>
    {/*
      Outside the providers on purpose. The boundary inside `App` covers a
      screen; this one covers everything else — including a provider that
      throws on mount, which the inner one cannot catch because it would never
      be rendered.

      A blank window is the worst possible failure: the process is alive, so it
      does not look like a crash, and there is nothing on screen to report or
      to click. This is what stands between a fault and that.
    */}
    <ErrorBoundary what="MadMusic">
      <Providers>{isDesktopLink ? <DesktopLinkView /> : <App />}</Providers>
    </ErrorBoundary>
  </StrictMode>,
);
