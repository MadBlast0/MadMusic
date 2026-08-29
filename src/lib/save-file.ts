import { isNative } from '@/lib/native';

/**
 * Puts a generated file somewhere the user can find it.
 *
 * Two routes, because the two builds have genuinely different capabilities and
 * pretending otherwise produces a worse experience in both. On the desktop this
 * opens a real save dialog and writes where the user chose; in the browser it
 * triggers a download.
 *
 * Returns the path written, or an empty string when the user cancelled. A
 * cancel is not an error and must not be reported as one — it is the most
 * common outcome of opening a save dialog by mistake.
 */
export async function saveTextFile(
  suggestedName: string,
  contents: string,
  /** Extension without the dot, for the dialog's filter. */
  extension: string,
): Promise<string> {
  if (isNative()) {
    const [{ save }, { invoke }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core'),
    ]);

    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return '';

    // Written through a command rather than the `fs` plugin. The only plugin
    // scope that covers "wherever the save dialog pointed" is the whole disk,
    // which is a large permission to hold permanently for an occasional
    // export. See `src-tauri/src/export.rs`.
    return await invoke<string>('write_text_file', { path, contents });
  }

  // The browser route. A blob URL rather than a data URL: a long playlist
  // exceeds the length some browsers accept in a URL, and the failure is
  // silent when it happens.
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();

  // Revoked on the next tick rather than immediately: revoking synchronously
  // can beat the download starting, and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return suggestedName;
}

/**
 * Saves a data URL as a binary file.
 *
 * The image sibling of [`saveTextFile`]. Separate because the decoding differs
 * and because getting it wrong is silent: writing base64 as text produces a
 * file of the right name and the wrong contents, which looks like success.
 *
 * Returns the path written, or an empty string when the user cancelled.
 */
export async function saveDataUrl(
  suggestedName: string,
  dataUrl: string,
): Promise<string> {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('that is not a data URL');
  const base64 = dataUrl.slice(comma + 1);

  if (isNative()) {
    const [{ save }, { invoke }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core'),
    ]);

    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!path) return '';

    return await invoke<string>('write_binary_file', { path, base64 });
  }

  // The browser route, as with text: a blob rather than the data URL itself,
  // because a long data URL exceeds what some browsers accept in an href.
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'image/png' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return suggestedName;
}

/** A file name that a file system will accept. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned.slice(0, 60) : 'lyric';
}
