/**
 * Searching by speaking.
 *
 * Uses the Web Speech API, which every Chromium build has and which the Tauri
 * webview inherits. No model is downloaded and no audio is stored by this app —
 * the recognition happens through the browser engine, and on most platforms
 * that means the audio does reach the OS speech service. That is stated in the
 * UI rather than buried here, because "this app is listening" is something
 * people are entitled to know before it happens.
 *
 * # Why this is not `MediaRecorder`
 *
 * Recording audio and transcribing it ourselves would need a model to do the
 * transcribing, which is tens of megabytes and a great deal of work for a
 * feature most people use twice. The audio-recognition path in `meta/acoustid`
 * *does* capture audio, because identifying a song from a recording is
 * something no speech API can do.
 */

/** What the browser exposes, which is still prefixed on some engines. */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

type SpeechWindow = typeof globalThis & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/** Whether this build can listen at all. */
export function voiceSearchAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const scope = window as SpeechWindow;
  return Boolean(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
}

export type VoiceSession = {
  /** Stops listening. Safe to call more than once. */
  stop: () => void;
};

/**
 * Listens once and reports what was heard.
 *
 * `onPartial` fires as the engine revises its guess, which is what makes the
 * field fill in while somebody is still talking — without it the screen sits
 * blank for several seconds and looks broken. `onFinal` fires once, with the
 * transcript to actually search for.
 *
 * Errors are reported rather than thrown: the common ones are "no microphone"
 * and "permission denied", both of which are answers rather than faults, and
 * both of which the caller has to show as text either way.
 */
export function listenOnce({
  lang,
  onPartial,
  onFinal,
  onError,
}: {
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}): VoiceSession | null {
  const scope = window as SpeechWindow;
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Recognition) {
    onError('This build cannot listen.');
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = lang ?? navigator.language ?? 'en-US';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  // One utterance. Continuous listening for a search box would keep the
  // microphone open indefinitely for a query that is over in three seconds.
  recognition.continuous = false;

  let settled = false;

  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    const text = last?.[0]?.transcript?.trim() ?? '';
    if (!text) return;

    if (last.isFinal) {
      settled = true;
      onFinal(text);
    } else {
      onPartial?.(text);
    }
  };

  recognition.onerror = (event) => {
    settled = true;
    onError(describeSpeechError(event.error));
  };

  recognition.onend = () => {
    // Ended without a final result: the engine heard nothing it could use.
    // Saying so beats leaving a spinner running.
    if (!settled) onError('Nothing was heard.');
  };

  try {
    recognition.start();
  } catch {
    // Already running, which happens if two presses land close together.
    onError('Already listening.');
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
    },
  };
}

/**
 * Turns an engine error code into something worth reading.
 *
 * The raw codes are things like `not-allowed`, which is accurate and tells a
 * user nothing about what to do next.
 */
export function describeSpeechError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was refused. Allow it in your system settings to search by voice.';
    case 'no-speech':
      return 'Nothing was heard.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'Speech recognition needs a connection and could not reach it.';
    case 'aborted':
      return 'Listening stopped.';
    default:
      return 'Could not listen just now.';
  }
}
