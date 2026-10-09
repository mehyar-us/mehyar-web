import {expect,it,vi} from 'vitest';
import {createVoiceConsentStore,VOICE_CONSENT_COPY,VOICE_CONSENT_VERSION} from '../web/voice-consent';

function memStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

it('starts ungranted, grants, and withdraws', () => {
  const store = createVoiceConsentStore(memStore());
  expect(store.granted()).toBe(false);
  store.grant();
  expect(store.granted()).toBe(true);
  store.withdraw();
  expect(store.granted()).toBe(false);
});

it('persists the grant across store instances with the current version', () => {
  const backend = memStore();
  createVoiceConsentStore(backend).grant();
  expect(createVoiceConsentStore(backend).granted()).toBe(true);
});

it('rejects a stale version and corrupt payloads', () => {
  const backend = memStore();
  backend.setItem('mayor.voice-consent.v1', JSON.stringify({ v: VOICE_CONSENT_VERSION - 1, grantedAt: 'x' }));
  expect(createVoiceConsentStore(backend).granted()).toBe(false);
  backend.setItem('mayor.voice-consent.v1', 'not-json{');
  expect(createVoiceConsentStore(backend).granted()).toBe(false);
});

it('treats a throwing storage backend as ungranted, never throws', () => {
  const backend = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {},
    removeItem: () => {},
  };
  expect(createVoiceConsentStore(backend).granted()).toBe(false);
});

it('keeps the session grant when persistence is unavailable', () => {
  const backend = memStore();
  const store = createVoiceConsentStore({
    ...backend,
    setItem: () => {
      throw new Error('quota');
    },
  });
  store.grant();
  expect(store.granted()).toBe(true);
});

it('works with no storage at all (node / private mode)', () => {
  const store = createVoiceConsentStore(null);
  expect(store.granted()).toBe(false);
  store.grant();
  expect(store.granted()).toBe(true);
  store.withdraw();
  expect(store.granted()).toBe(false);
});

it('carries the required plain-words disclosures', () => {
  const text = [VOICE_CONSENT_COPY.intro, ...VOICE_CONSENT_COPY.lines].join(' ');
  expect(text).toMatch(/AI assistant/);
  expect(text).toMatch(/never saved/);
  expect(text).toMatch(/deleted anytime/);
  expect(text).toMatch(/microphone permission/);
  // No jargon in the disclosure.
  expect(text).not.toMatch(/transcri|biometric|telemetry|SDK/i);
  expect(VOICE_CONSENT_COPY.accept).toBe('Start talking');
  expect(VOICE_CONSENT_COPY.decline).toBe('Not now');
});
