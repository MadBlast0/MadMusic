/**
 * Where the app is running.
 *
 * Checked against the globals Tauri injects into the webview rather than a
 * build-time flag, because the same bundle is served both by the native shell
 * and by the dev server in a browser.
 */
export function isNative(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}
