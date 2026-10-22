/** First-use voice consent for the in-PWA owner↔assistant voice chat.
 *
 * Compliance posture (see workers/mayor/docs/voice-transport-evaluation.md and the
 * product-compliance audit): voice AUDIO is streamed to the transcription service
 * and never stored. The transcript (your words + the assistant's replies) is saved
 * in this conversation like typed messages, under the shared data-deletion path.
 * No optional audio retention is built; any future retention must be owner-opt-in
 * with a fresh disclosure — never silently added.
 *
 * The assistant's AI identity is disclosed both here (plain words, before the
 * first tap) and server-side (the voice persona is instructed to introduce
 * itself transparently as AI).
 */

export const VOICE_CONSENT_VERSION = 1;
const STORAGE_KEY = 'mayor.voice-consent.v1';

export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage may be unavailable (private mode, blocked storage). Fall back to
 *  a session-scoped in-memory store: consent holds for this tab, is asked again
 *  next visit. Never throws. */
function safeStorage(): ConsentStorage {
  const memory = new Map<string, string>();
  try {
    const ls = window.localStorage;
    return {
      getItem: (key) => {
        try {
          return ls.getItem(key);
        } catch {
          return memory.get(key) ?? null;
        }
      },
      setItem: (key, value) => {
        memory.set(key, value);
        try {
          ls.setItem(key, value);
        } catch {
          /* session-only; asked again next visit */
        }
      },
      removeItem: (key) => {
        memory.delete(key);
        try {
          ls.removeItem(key);
        } catch {
          /* already session-only */
        }
      },
    };
  } catch {
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

export interface VoiceConsentStore {
  granted(): boolean;
  grant(): void;
  withdraw(): void;
}

export function createVoiceConsentStore(storage?: ConsentStorage | null): VoiceConsentStore {
  const backend = storage ?? safeStorage();
  let sessionGranted = false;
  return {
    granted() {
      if (sessionGranted) return true;
      try {
        const raw = backend.getItem(STORAGE_KEY);
        if (!raw) return false;
        const parsed: unknown = JSON.parse(raw);
        return (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as { v?: unknown }).v === VOICE_CONSENT_VERSION &&
          typeof (parsed as { grantedAt?: unknown }).grantedAt === 'string'
        );
      } catch {
        return false;
      }
    },
    grant() {
      sessionGranted = true;
      try {
        backend.setItem(STORAGE_KEY, JSON.stringify({ v: VOICE_CONSENT_VERSION, grantedAt: new Date().toISOString() }));
      } catch {
        /* session-only; asked again next visit */
      }
    },
    withdraw() {
      sessionGranted = false;
      try {
        backend.removeItem(STORAGE_KEY);
      } catch {
        /* already session-only */
      }
    },
  };
}

/** Plain-words disclosure copy. No jargon, no legalese — written for a busy
 * owner reading it on a phone. The "Tap to talk" line carries the brief's
 * spirit: your voice never leaves this conversation without you knowing. */
export const VOICE_CONSENT_COPY = {
  title: 'Talk to The Mayor',
  intro: 'Tap to talk — speak, and your words are turned into text so your assistant can understand you.',
  lines: [
    'You are talking with The Mayor — an AI assistant that runs the front of your business.',
    'The sound of your voice is turned into words and then discarded. Your voice audio is never saved, recorded, or replayed.',
    'The words you say and the replies you get are saved in this conversation, just like typed messages. You can ask to have them deleted anytime (see Data deletion).',
    'Your browser will ask for microphone permission separately. You can change that anytime in your browser\u2019s site settings.',
  ],
  accept: 'Start talking',
  decline: 'Not now',
  withdraw: 'Forget my choice',
  reviewTitle: 'Voice privacy',
  withdrawNote: 'You will be asked again the next time you tap the mic.',
} as const;

export type ConsentSheetMode = 'first-run' | 'review';

export interface ConsentSheetOptions {
  mode: ConsentSheetMode;
  onAccept(): void;
  onDecline(): void;
  /** Only in review mode. */
  onWithdraw?(): void;
}

/** Builds an accessible, framework-free consent sheet with inline styles (no
 * stylesheet dependency). Returns a cleanup that removes it. Escape declines.
 * Focus starts on the primary button. */
export function showVoiceConsentSheet(options: ConsentSheetOptions): () => void {
  const copy = VOICE_CONSENT_COPY;
  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'voice-consent-title');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:200;display:flex;align-items:flex-end;justify-content:center;' +
    'background:rgba(10,12,20,.55);padding:16px;';
  const sheet = document.createElement('div');
  sheet.style.cssText =
    'background:#14161f;color:#f2f3f7;border:1px solid #2a2e3d;border-radius:16px;' +
    'max-width:26rem;width:100%;padding:1.25rem 1.25rem 1rem;' +
    'box-shadow:0 24px 64px rgba(0,0,0,.5);font-size:.95rem;line-height:1.5;';
  const title = document.createElement('h2');
  title.id = 'voice-consent-title';
  title.textContent = options.mode === 'review' ? copy.reviewTitle : copy.title;
  title.style.cssText = 'margin:0 0 .5rem;font-size:1.15rem;';
  const intro = document.createElement('p');
  intro.textContent = copy.intro;
  intro.style.cssText = 'margin:0 0 .5rem;font-weight:600;';
  sheet.append(title, intro);
  const list = document.createElement('ul');
  list.style.cssText = 'margin:0 0 1rem;padding-left:1.15rem;display:grid;gap:.45rem;';
  for (const line of copy.lines) {
    const item = document.createElement('li');
    item.textContent = line;
    list.append(item);
  }
  sheet.append(list);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:.6rem;justify-content:flex-end;flex-wrap:wrap;';
  const decline = document.createElement('button');
  decline.type = 'button';
  decline.textContent = copy.decline;
  decline.style.cssText =
    'background:transparent;color:#f2f3f7;border:1px solid #3a3f52;border-radius:10px;padding:.6rem 1rem;font-size:.95rem;cursor:pointer;';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.textContent = copy.accept;
  accept.style.cssText =
    'background:#f5b638;color:#14161f;border:0;border-radius:10px;padding:.6rem 1.1rem;font-size:.95rem;font-weight:700;cursor:pointer;';
  row.append(decline, accept);
  if (options.mode === 'review') {
    const withdrawRow = document.createElement('div');
    withdrawRow.style.cssText = 'margin-top:.8rem;text-align:center;';
    const withdraw = document.createElement('button');
    withdraw.type = 'button';
    withdraw.textContent = copy.withdraw;
    withdraw.title = copy.withdrawNote;
    withdraw.style.cssText =
      'background:transparent;color:#9aa0b4;border:0;text-decoration:underline;font-size:.85rem;cursor:pointer;padding:.4rem;';
    withdraw.addEventListener('click', () => options.onWithdraw?.());
    withdrawRow.append(withdraw);
    sheet.append(row, withdrawRow);
  } else {
    sheet.append(row);
  }
  overlay.append(sheet);
  document.body.append(overlay);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      options.onDecline();
    }
  };
  overlay.addEventListener('keydown', onKey);
  decline.addEventListener('click', () => options.onDecline());
  accept.addEventListener('click', () => options.onAccept());
  accept.focus();
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    overlay.removeEventListener('keydown', onKey);
    overlay.remove();
  };
}
