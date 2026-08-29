/**
 * The picture-in-picture window.
 *
 * # Why Document PiP rather than video PiP
 *
 * The familiar `requestPictureInPicture()` puts a *video element* in a floating
 * window. This app has no video: the artwork is an image and the transport is
 * HTML. Faking it — drawing the cover into a canvas, capturing that as a stream,
 * feeding it to a hidden `<video>` — produces a floating window whose buttons
 * are a picture of buttons. Nothing in it can be clicked.
 *
 * Document PiP opens a real, empty browser window that ordinary DOM can be
 * rendered into, so the controls are controls. It is Chromium-only, which is
 * exactly the engine the desktop app ships (WebView2), and [`pipAvailable`] is
 * how every caller finds out rather than assuming.
 *
 * # Why the stylesheets have to be copied
 *
 * The new window is a separate document. It inherits nothing — not the app's
 * CSS, not its custom properties, not the theme — so a portal into it renders
 * unstyled text on white unless every stylesheet is carried across by hand.
 * Adopted stylesheets copy directly; `<link>` and `<style>` elements are cloned.
 *
 * Cross-origin stylesheets throw on `cssRules` access, which is why the clone
 * path is guarded rather than assumed to work: one Google Font in the page
 * would otherwise take down the whole PiP window.
 */

/** The bits of the API this module uses. Not in TypeScript's DOM library yet. */
type PipApi = {
  requestWindow: (options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }) => Promise<Window>;
  window: Window | null;
};

function api(): PipApi | null {
  const found = (globalThis as { documentPictureInPicture?: PipApi })
    .documentPictureInPicture;
  return found && typeof found.requestWindow === 'function' ? found : null;
}

/** Whether this engine can open a document picture-in-picture window. */
export function pipAvailable(): boolean {
  return api() !== null;
}

/** Whether one is open right now. */
export function pipOpen(): boolean {
  return api()?.window != null;
}

/**
 * Copies the app's styles into another document.
 *
 * Exported for its test: getting this wrong produces a window that looks
 * broken rather than one that fails, which is much harder to notice.
 */
export function copyStyles(from: Document, to: Document): void {
  // Constructed stylesheets — what a CSS-in-JS runtime or a bundler's dev
  // server may use — transfer as objects rather than as text.
  //
  // Guarded because not every document has them: an engine without constructed
  // stylesheets would otherwise throw here and copy nothing at all, which turns
  // a missing optimisation into an unstyled window.
  if (Array.isArray(from.adoptedStyleSheets)) {
    to.adoptedStyleSheets = [...from.adoptedStyleSheets];
  }

  for (const node of from.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = to.createElement('link');
      link.rel = 'stylesheet';
      link.href = node.href;
      to.head.append(link);
      continue;
    }

    if (!(node instanceof HTMLStyleElement)) continue;

    const style = to.createElement('style');
    try {
      // `cssRules` throws for a sheet loaded cross-origin. The text content is
      // the fallback and is usually identical for an inline `<style>`.
      const sheet = node.sheet;
      style.textContent = sheet
        ? [...sheet.cssRules].map((rule) => rule.cssText).join('\n')
        : node.textContent;
    } catch {
      style.textContent = node.textContent;
    }
    to.head.append(style);
  }
}

/**
 * Opens the window, styled and themed.
 *
 * Returns null where the engine has no such API or the user dismissed the
 * request — both are ordinary outcomes rather than errors, and a caller that
 * has to distinguish them can ask [`pipAvailable`] first.
 *
 * The theme attributes are copied because they live on `<html>`, which the new
 * document has its own copy of: without this, a dark app opens a white window.
 */
export async function openPip(
  size: { width: number; height: number } = { width: 380, height: 460 },
): Promise<Window | null> {
  const found = api();
  if (!found) return null;

  try {
    const pip = await found.requestWindow({
      width: size.width,
      height: size.height,
    });

    copyStyles(document, pip.document);

    const source = document.documentElement;
    const target = pip.document.documentElement;
    for (const name of ['data-theme', 'data-density', 'data-motion', 'class']) {
      const value = source.getAttribute(name);
      if (value !== null) target.setAttribute(name, value);
    }
    pip.document.body.style.margin = '0';

    return pip;
  } catch {
    // Dismissed, or refused because the gesture was not a user gesture.
    return null;
  }
}
