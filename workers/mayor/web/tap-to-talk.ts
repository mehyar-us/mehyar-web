/** Tap-to-talk controller for the composer mic button.
 *
 * A small, fully testable state machine around the same client shape used by
 * createVoiceCall (web/voice-call.ts): all media, SDK and consent dependencies
 * are injected, so unit tests run with fakes and no real microphone.
 *
 * States:
 *   idle -> consent-needed -> permission-needed -> starting
 *        -> listening -> thinking -> speaking
 * Barge-in: the owner interrupts mid-reply and the assistant stops and listens:
 *   speaking -> listening (via interrupt(), or an observed remote status flip).
 * A stalled permission request is bounded (30s) and its late grant is dropped.
 *
 * The transport stays the incumbent WebSocket path (PWA -> MayorVoice agent ->
 * Workers AI STT/TTS). See workers/mayor/docs/voice-transport-evaluation.md for
 * why WebRTC/SFU was evaluated and rejected for owner<->assistant.
 */

export type TapTalkState =
  | 'idle'
  | 'consent-needed'
  | 'permission-needed'
  | 'starting'
  | 'listening'
  | 'thinking'
  | 'speaking';

export type TapTalkRemote = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface TapTalkConsent {
  granted(): boolean;
}
export interface TapTalkPermission {
  request(): Promise<void>;
}
/** Same shape as the Client used by createVoiceCall, so the two wrappers are
 *  interchangeable against the SDK VoiceClient. */
export interface TapTalkClient {
  startCall(): Promise<void>;
  endCall(): void;
  readonly error: string | null;
}
export interface TapTalkEvents {
  onState(state: TapTalkState): void;
  onNotice(message: string): void;
}

const PERMISSION_TIMEOUT_MS = 30_000;

/** Plain-words teaching hints for permission failures. Never blame the user;
 *  always name the next tap. */
export function permissionTeachingHint(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const text = message.toLowerCase();
  if (text.includes('unavailable in this browser') || text.includes('secure context'))
    return 'Voice talk needs a full browser. Open the app in Safari or Chrome (not inside another app), or just type below.';
  if (text.includes('blocked') || text.includes('denied') || text.includes('allow'))
    return 'The microphone is blocked. Tap the lock or tune icon in your browser\u2019s address bar, allow the microphone for this site, then tap the mic again. Typing works too.';
  if (text.includes('no microphone') || text.includes('not found'))
    return 'No microphone was found on this device. Plug one in and try again — or just type below.';
  if (text.includes('using it') || text.includes('could not be opened'))
    return 'Another app is using your microphone right now (a call or a recording). Close it and try again — or just type below.';
  if (text.includes('sample rate'))
    return 'This browser could not set up voice capture. Update it to the latest version and try again — or just type below.';
  return message || 'The microphone could not start. Check your device settings and try again — or just type below.';
}

const CONSENT_PROMPT =
  'One quick thing first: you are talking with The Mayor, an AI assistant. Your voice audio is never saved — only the words, like typed messages.';
const CONSENT_DECLINED = 'No problem — you can still type below. Tap the mic anytime to try voice.';
const PERMISSION_HINT = 'Tap to talk — allow the mic when your browser asks. You can cancel and type instead.';
const PERMISSION_TIMEOUT_HINT =
  'Voice startup timed out. Check your microphone permission and connection, then try again — or just type below.';
const BARGE_IN_HINT = 'Go ahead — I\u2019m listening.';

export function createTapToTalk(
  client: TapTalkClient,
  consent: TapTalkConsent,
  permission: TapTalkPermission,
  events: TapTalkEvents,
) {
  let state: TapTalkState = 'idle';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setState = (next: TapTalkState) => {
    state = next;
    events.onState(next);
  };
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  /** Generation-guarded teardown: a late async result after stop()/cancel()
   *  must not restart anything or end a newer session. */
  const fail = (message: string) => {
    generation++;
    clearTimer();
    client.endCall();
    setState('idle');
    events.onNotice(message);
  };

  const beginCall = async (attempt: number) => {
    setState('starting');
    try {
      await client.startCall();
      if (attempt !== generation) return;
      if (client.error) throw new Error(client.error);
      // Local capture is up; the server announces 'listening' via remoteStatus().
    } catch (error) {
      if (attempt !== generation) return;
      fail(permissionTeachingHint(error));
    }
  };

  const beginPermission = async () => {
    const attempt = ++generation;
    setState('permission-needed');
    events.onNotice(PERMISSION_HINT);
    timer = setTimeout(() => {
      if (attempt !== generation) return;
      fail(PERMISSION_TIMEOUT_HINT);
    }, PERMISSION_TIMEOUT_MS);
    try {
      await permission.request();
      if (attempt !== generation) return;
      clearTimer();
      await beginCall(attempt);
    } catch (error) {
      if (attempt !== generation) return;
      clearTimer();
      fail(permissionTeachingHint(error));
    }
  };

  return {
    get state() {
      return state;
    },
    /** Tap the mic button. */
    async start() {
      if (state !== 'idle') return;
      if (!consent.granted()) {
        setState('consent-needed');
        events.onNotice(CONSENT_PROMPT);
        return;
      }
      await beginPermission();
    },
    /** The consent sheet accepted: the store is granted, continue to permission. */
    async grantConsent() {
      if (state !== 'consent-needed') return;
      if (!consent.granted()) return;
      await beginPermission();
    },
    /** The consent sheet declined. */
    denyConsent() {
      if (state !== 'consent-needed') return;
      generation++;
      clearTimer();
      setState('idle');
      events.onNotice(CONSENT_DECLINED);
    },
    /** The owner interrupts the assistant mid-reply: stop speaking, listen. */
    interrupt(): boolean {
      if (state !== 'speaking') return false;
      setState('listening');
      events.onNotice(BARGE_IN_HINT);
      return true;
    },
    /** Server-side status updates (from the SDK statuschange event). */
    remoteStatus(status: TapTalkRemote) {
      if (status === 'idle') {
        if (state === 'starting' || state === 'listening' || state === 'thinking' || state === 'speaking') {
          generation++;
          clearTimer();
          setState('idle');
        }
        return;
      }
      if (state === 'starting' && status === 'listening') setState('listening');
      else if (state === 'listening' && status === 'thinking') setState('thinking');
      else if ((state === 'listening' || state === 'thinking') && status === 'speaking') setState('speaking');
      // speaking -> listening observed remotely: the barge-in landed server-side.
      else if (state === 'speaking' && status === 'listening') setState('listening');
    },
    /** SDK-level failure (mirrors createVoiceCall.error semantics). */
    error(message: string | null) {
      if (!message || state === 'idle') return;
      fail(message);
    },
    /** End the conversation (mic button while active). */
    stop() {
      generation++;
      clearTimer();
      client.endCall();
      if (state !== 'idle') setState('idle');
    },
  };
}

export type TapToTalk = ReturnType<typeof createTapToTalk>;
