import {afterEach,expect,it,vi} from 'vitest';
import {createTapToTalk,permissionTeachingHint,type TapTalkState} from '../web/tap-to-talk';

afterEach(() => vi.useRealTimers());

function deferred() {
  let resolve!: () => void,
    reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const client = { startCall: vi.fn(async () => {}), endCall: vi.fn(), error: null as string | null };
  let consentGranted = false;
  const consent = { granted: () => consentGranted, set: (v: boolean) => (consentGranted = v) };
  const permission = { request: vi.fn(async () => {}) };
  const states: TapTalkState[] = [];
  const notices: string[] = [];
  const talk = createTapToTalk(client, consent, permission, {
    onState: (s) => void states.push(s),
    onNotice: (m) => void notices.push(m),
  });
  return { client, consent, permission, states, notices, talk };
}

async function toListening(f: ReturnType<typeof fixture>) {
  f.consent.set(true);
  const started = f.talk.start();
  await started;
  f.talk.remoteStatus('listening');
  return started;
}

it('walks the full turn: idle -> listening -> thinking -> speaking -> barge-in -> idle', async () => {
  const f = fixture();
  await toListening(f);
  expect(f.states).toEqual(['permission-needed', 'starting', 'listening']);
  f.talk.remoteStatus('thinking');
  f.talk.remoteStatus('speaking');
  expect(f.states.at(-1)).toBe('speaking');
  // The owner interrupts mid-reply: the assistant stops and listens.
  expect(f.talk.interrupt()).toBe(true);
  expect(f.states.at(-1)).toBe('listening');
  expect(f.notices.at(-1)).toMatch(/listening/);
  f.talk.stop();
  expect(f.states.at(-1)).toBe('idle');
  expect(f.client.endCall).toHaveBeenCalledOnce();
});

it('gates on consent first and only proceeds after the grant', async () => {
  const f = fixture();
  await f.talk.start();
  expect(f.states).toEqual(['consent-needed']);
  expect(f.permission.request).not.toHaveBeenCalled();
  // Stale grantConsent with the store still ungranted does nothing.
  await f.talk.grantConsent();
  expect(f.permission.request).not.toHaveBeenCalled();
  f.consent.set(true);
  await f.talk.grantConsent();
  expect(f.permission.request).toHaveBeenCalledOnce();
  expect(f.states).toContain('starting');
  f.talk.stop();
});

it('consent decline returns to idle with a friendly teaching notice', async () => {
  const f = fixture();
  await f.talk.start();
  f.talk.denyConsent();
  expect(f.states.at(-1)).toBe('idle');
  expect(f.notices.at(-1)).toMatch(/type below/);
  expect(f.permission.request).not.toHaveBeenCalled();
  expect(f.client.endCall).not.toHaveBeenCalled();
});

it('permission denial surfaces a teaching hint, never a blame message', async () => {
  const f = fixture();
  f.consent.set(true);
  f.permission.request.mockRejectedValueOnce(new Error('This browser blocked microphone access.'));
  await f.talk.start();
  expect(f.states.at(-1)).toBe('idle');
  expect(f.notices.at(-1)).toMatch(/allow the microphone/);
  expect(f.client.startCall).not.toHaveBeenCalled();
});

it('maps every permission failure class to plain words', () => {
  expect(permissionTeachingHint(new Error('Microphone capture is unavailable in this browser'))).toMatch(/full browser/);
  expect(permissionTeachingHint(new Error('No microphone was found'))).toMatch(/No microphone/);
  expect(permissionTeachingHint(new Error('could not be opened'))).toMatch(/Another app/);
  expect(permissionTeachingHint(new Error('weird failure'))).toMatch(/weird failure/);
  expect(permissionTeachingHint('not an error')).toMatch(/could not start/);
});

it('does not double-start on a second tap while busy', async () => {
  const f = fixture();
  f.consent.set(true);
  const gate = deferred();
  f.permission.request.mockImplementationOnce(() => gate.promise);
  const first = f.talk.start();
  await f.talk.start();
  gate.resolve();
  await first;
  expect(f.permission.request).toHaveBeenCalledTimes(1);
  f.talk.stop();
});

it('drops a late permission grant after the user cancelled', async () => {
  const f = fixture();
  f.consent.set(true);
  const gate = deferred();
  f.permission.request.mockImplementationOnce(() => gate.promise);
  const started = f.talk.start();
  f.talk.stop();
  gate.resolve();
  await started;
  expect(f.client.startCall).not.toHaveBeenCalled();
  expect(f.client.endCall).toHaveBeenCalledOnce();
  expect(f.states.at(-1)).toBe('idle');
});

it('bounds a stalled permission request and ignores its late completion', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.consent.set(true);
  const gate = deferred();
  f.permission.request.mockImplementationOnce(() => gate.promise);
  const started = f.talk.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.states.at(-1)).toBe('idle');
  expect(f.notices.at(-1)).toMatch(/timed out/);
  expect(f.client.endCall).toHaveBeenCalledOnce();
  gate.resolve();
  await started;
  expect(f.client.startCall).not.toHaveBeenCalled();
});

it('treats a late remote idle as the end of the session', async () => {
  const f = fixture();
  await toListening(f);
  f.talk.remoteStatus('speaking');
  f.talk.remoteStatus('idle');
  expect(f.states.at(-1)).toBe('idle');
});

it('observes a server-side barge-in (speaking -> listening) without a tap', async () => {
  const f = fixture();
  await toListening(f);
  f.talk.remoteStatus('speaking');
  f.talk.remoteStatus('listening');
  expect(f.states.at(-1)).toBe('listening');
});

it('ignores interrupt when the assistant is not speaking', async () => {
  const f = fixture();
  await toListening(f);
  expect(f.talk.interrupt()).toBe(false);
  expect(f.states.at(-1)).toBe('listening');
});

it('surfaces an SDK failure as a plain notice and tears down', async () => {
  const f = fixture();
  await toListening(f);
  f.talk.error('Voice service unavailable');
  expect(f.states.at(-1)).toBe('idle');
  expect(f.notices.at(-1)).toBe('Voice service unavailable');
  expect(f.client.endCall).toHaveBeenCalledOnce();
  f.talk.error(null);
});

it('stops a rejected client start without claiming success', async () => {
  const f = fixture();
  f.consent.set(true);
  f.client.startCall.mockRejectedValueOnce(new Error('boom'));
  await f.talk.start();
  expect(f.states.at(-1)).toBe('idle');
  expect(f.client.endCall).toHaveBeenCalledOnce();
});

it('does not mistake a client error string for success', async () => {
  const f = fixture();
  f.consent.set(true);
  f.client.error = 'Microphone denied';
  await f.talk.start();
  expect(f.states.at(-1)).toBe('idle');
  expect(f.notices.at(-1)).toMatch(/Microphone denied|microphone/i);
  f.talk.stop();
});
