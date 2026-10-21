import { env as testEnv } from 'cloudflare:workers';
import { it, expect } from 'vitest';
import type { Env } from '../../src/env';
import { MayorVoice } from '../../src/voice';
import { confirmProfile, readMemory } from '../../src/memory';

/** UX audit Tier 0 — CHG-094 (LIVE-01/LIVE-34). Live, the owner asked
 * for a 10-step salon marketing plan and was answered with a dump of
 * their own confirmed record: "Please verify: name: Mehyar US.
 * vertical: salon. language: en. industry: Hair Salon. business
 * goals: …". The producer: the model proposed the whole record (one
 * field differing) and the server read the WHOLE patch back as a
 * verification demand. The gate: a proposal may only ever read back
 * fields that change the confirmed profile — on both proposal paths —
 * and a confirmed vertical answers the industry question forever. */

const seedProfile = {
  name: 'Mehyar US',
  vertical: 'salon',
  industry: 'Hair Salon',
  businessGoals: ['Grow bookings'],
} as const;

async function fixture(aiRun: (call: number) => unknown) {
  const env = testEnv as unknown as Env;
  const actor = { tenantId: crypto.randomUUID(), userId: crypto.randomUUID() };
  await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)')
    .bind(actor.tenantId, 'Mehyar US', new Date().toISOString()).run();
  await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')")
    .bind(actor.tenantId, actor.userId).run();
  let calls = 0;
  const ai = {
    run: async () => {
      const events = aiRun(calls++);
      const bytes = new TextEncoder().encode(
        [...(events as object[]), { choices: [{ delta: {}, finish_reason: 'stop' }] }]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
      );
      return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    },
  };
  const voice = Object.create(MayorVoice.prototype) as any;
  for (const field of ['generations', 'pending', 'pendingCalendar', 'pendingPolicy', 'pendingBooking', 'pendingChange', 'pendingCallback', 'pendingCustomer'])
    voice[field] = new Map();
  Object.assign(voice, { env: { ...env, AI: ai }, ready: new Set(), authorize: async () => actor });
  const events: any[] = [];
  const turn = async (text: string) => {
    const result = await voice.onTurn(text, {
      connection: { id: 'gate', send: (event: string) => events.push(JSON.parse(event)) },
      signal: new AbortController().signal,
      messages: [],
    });
    if (typeof result === 'string') return result;
    let answer = '';
    for await (const chunk of result) answer += chunk;
    return answer;
  };
  return { env, actor, voice, events, turn, calls: () => calls };
}

const toolCall = (name: string, args: unknown) => [
  { choices: [{ delta: { tool_calls: [{ id: 'call-1', index: 0, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
];
const replyCall = (text: string) => toolCall('reply', { text });

it('CHG-094: a normal request answered with the whole record reads back ONLY the one changed field', async () => {
  const { env, actor, voice, events, turn } = await fixture((call) =>
    call === 0
      ? toolCall('proposeProfile', { ...seedProfile, language: 'en', locations: ['Queens'] })
      : replyCall('Here is your plan.'),
  );
  await confirmProfile(env, actor, { ...seedProfile }, 0);
  const answer = await turn('Give me a 10-step salon marketing plan.');
  // The verification prompt covers the genuinely new field alone.
  expect(answer).toBe('Please verify: locations: Queens. Say “yes, that is correct” to save these business details, or tell me what to correct.');
  expect(answer).not.toContain('Mehyar US');
  expect(answer).not.toContain('vertical');
  expect(answer).not.toContain('Hair Salon');
  expect(answer).not.toContain('language: en');
  // The pending proposal and the client event carry the same narrowed patch.
  expect(voice.pending.get('gate')?.patch).toEqual({ locations: ['Queens'] });
  expect(events.find((event) => event.type === 'profile_proposal')?.patch).toEqual({ locations: ['Queens'] });
  // Confirmation saves exactly the change; the confirmed record is untouched elsewhere.
  const confirmation = await turn('Yes, that is correct.');
  expect(confirmation).toMatch(/^Saved\./);
  const saved = await readMemory(env, actor);
  expect(saved.revision).toBe(2);
  expect(saved.profile).toMatchObject({ ...seedProfile, locations: ['Queens'] });
});

it('CHG-094: proposing the confirmed record verbatim is already-saved — no confirmation is armed', async () => {
  const { env, actor, voice, turn, calls } = await fixture((call) =>
    call === 0 ? toolCall('proposeProfile', { ...seedProfile, language: 'en' }) : replyCall('Anything else?'),
  );
  await confirmProfile(env, actor, { ...seedProfile }, 0);
  const answer = await turn('What do you remember? Do not change anything.');
  expect(answer).toContain('Already saved:');
  expect(answer).toContain('No changes made.');
  expect(answer).not.toContain('Please verify');
  expect(calls()).toBe(1);
  expect(voice.ready.size).toBe(0);
  expect(voice.pending.size).toBe(0);
  await turn('yes');
  expect((await readMemory(env, actor)).revision).toBe(1);
});

it('CHG-094: the website path narrows too — and the narrowed proposal still confirms end to end', async () => {
  const sourceId = crypto.randomUUID();
  const { env, actor, voice, turn } = await fixture((call) =>
    call === 0
      ? toolCall('proposeWebsiteProfile', {
          patch: { ...seedProfile, language: 'en', industry: 'Barbershop' },
          source: {
            sourceId,
            quotes: { name: 'Mehyar US — barbershop and salon', industry: 'Mehyar US is a barbershop in Queens' },
          },
        })
      : replyCall('Anything else?'),
  );
  await confirmProfile(env, actor, { ...seedProfile }, 0);
  await env.AGENT_DB.prepare(
    'INSERT INTO mayor_website_sources(id,tenant_id,requested_url,source_url,title,excerpt,content_hash,fetched_by,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)',
  )
    .bind(sourceId, actor.tenantId, 'https://mehyar-us.example.com/', 'https://mehyar-us.example.com/about', 'Mehyar US',
      'Mehyar US — barbershop and salon. Mehyar US is a barbershop in Queens, offering cuts and color.', 'hash', actor.userId, new Date().toISOString())
    .run();
  const answer = await turn('Propose the facts from my website.');
  expect(answer).toContain('From mehyar-us.example.com, please verify: industry: Barbershop.');
  expect(answer).not.toContain('vertical: salon');
  expect(answer).not.toContain('business goals');
  expect(voice.pending.get('gate')?.patch).toEqual({ industry: 'Barbershop' });
  const confirmation = await turn('Yes, that is correct.');
  expect(confirmation).toMatch(/^Saved\./);
  const saved = await readMemory(env, actor);
  expect(saved.profile.industry).toBe('Barbershop');
  expect(saved.profile.name).toBe('Mehyar US');
});

it('LIVE-34: the resume command never re-asks a trade the confirmed vertical already answers', async () => {
  const { env, actor, turn } = await fixture(() => {
    throw new Error('The deterministic resume route must not consult the model');
  });
  await confirmProfile(env, actor, { name: 'Mehyar US', vertical: 'salon' }, 0);
  const answer = await turn(
    'Resume onboarding from my confirmed details. Ask one missing question at a time, and do not repeat details I already confirmed.',
  );
  expect(answer).toBe('We can build your profile by talking; a website is optional. What services or products do you offer?');
});
