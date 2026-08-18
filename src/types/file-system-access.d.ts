/**
 * File System Access API.
 *
 * TypeScript's DOM library does not declare `showDirectoryPicker` because the
 * API is not implemented across all browsers — Chromium has it, Safari and
 * Firefox do not. That is exactly why `local-source.ts` feature-detects before
 * calling it; this declaration only describes the shape when it is present.
 */
interface DirectoryPickerOptions {
  /** Lets the browser remember a different last-used folder per id. */
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?:
    | 'desktop'
    | 'documents'
    | 'downloads'
    | 'music'
    | 'pictures'
    | 'videos'
    | FileSystemHandle;
}

interface Window {
  showDirectoryPicker(
    options?: DirectoryPickerOptions,
  ): Promise<FileSystemDirectoryHandle>;
}
