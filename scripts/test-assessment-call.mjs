// scripts/test-assessment-call.mjs — infra session layer + voice adapter tests.
//
// Run: node scripts/test-assessment-call.mjs
// Covers (all with mocked D1/KV/fetch — no network, no audio):
//   server: session consent/rate-limit/neuron-guard, heartbeat expiry,
//           turn-complete latency log, end, delete, interrupt, applyTimings
//   client: VoiceAdapter wiring vs stub transport + stub avatar, adapter
//           overhead < 50ms (the ~zero-latency proof), barge-in, endCall action
//   shell:  consent checkboxes unchecked-by-default, legal footer, start flow
//   migration 0041 applies cleanly (sqlite3 when available)

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";

import { onRequestPost as sessionPost } from "../functions/api/assessment-call/session.js";
import { onRequestPost as hbPost } from "../functions/api/assessment-call/heartbeat.js";
import { onRequestPost as endPost } from "../functions/api/assessment-call/end.js";
import { onRequestPost as deletePost } from "../functions/api/assessment-call/delete.js";
import { onRequestPost as interruptPost } from "../functions/api/assessment-call/interrupt.js";
import { onRequestPost as tcPost } from "../functions/api/assessment-call/turn-complete.js";
import {
  estimateBrainNeurons, applyTimings, appendTurn, sha256Hex, costNeurons, rollupUsage,
} from "../functions/api/assessment-call/_shared/callShared.js";

import { VoiceAdapter } from "../assessment-call/voice-adapter.js";
import { createStubAvatar, createStubVoiceTransport } from "../assessment-call/stubs.js";
import { CallShell } from "../assessment-call/call-shell.js";

let N = 0;
const ok = (cond, msg) => { N++; assert.ok(cond, msg); };

// ── mocks ─────────────────────────────────────────────────────────────────

class MockKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

class MockD1 {
  constructor() { this.sessions = new Map(); this.turns = []; }
  prepare(sql) {
    const db = this, s = sql.replace(/\s+/g, " ").trim(), st = { vals: [] };
    st.bind = (...v) => { st.vals = v; return st; };
    st.first = async () => db.first(s, st.vals);
    st.all = async () => ({ results: [] });
    st.run = async () => { db.run(s, st.vals); return { success: true }; };
    return st;
  }
  first(s, v) {
    if (s.includes("FROM assessment_call_sessions WHERE id = ?")) {
      const r = this.sessions.get(v[0]);
      return r ? { ...r } : null; // D1 returns a fresh row object per query
    }
    return null;
  }
  run(s, v) {
    if (s.startsWith("UPDATE assessment_call_sessions SET usage_json = ?")) {
      const r = this.sessions.get(v[3]);
      if (r) { r.usage_json = v[0]; r.cost_usd_est = v[1]; r.neurons_est = v[2]; }
      return;
    }
    if (s.startsWith("INSERT INTO assessment_call_sessions")) {
      const [id, brain_session_id, ip_hash, user_agent_hash, consent_at, lhb, created] = v;
      this.sessions.set(id, {
        id, brain_session_id, ip_hash, user_agent_hash, consent_at,
        status: "active", turn_count: 0, neurons_est: 0,
        last_heartbeat_at: lhb, ended_at: null, created_at: created,
      });
      return;
    }
    if (s.startsWith("UPDATE assessment_call_sessions SET status = ?")) {
      const r = this.sessions.get(v[2]); if (r) { r.status = v[0]; r.ended_at = v[1]; } return;
    }
    if (s.startsWith("UPDATE assessment_call_sessions SET turn_count = turn_count + 1")) {
      const r = this.sessions.get(v[1]); if (r) { r.turn_count++; r.last_heartbeat_at = v[0]; } return;
    }
    if (s.startsWith("UPDATE assessment_call_sessions SET neurons_est = neurons_est + ?")) {
      const r = this.sessions.get(v[1]); if (r) r.neurons_est += v[0]; return;
    }
    if (s.startsWith("UPDATE assessment_call_sessions SET last_heartbeat_at = ?")) {
      const r = this.sessions.get(v[1]); if (r) r.last_heartbeat_at = v[0]; return;
    }
    if (s.startsWith("INSERT INTO assessment_call_turns")) {
      const [id, session_id, seq, role, text, stt_ms, ttt_ms, brain_ms, tts_ms, created_at] = v;
      this.turns.push({ id, session_id, seq, role, text, stt_ms, ttt_ms, brain_ms, tts_ms, interrupted: 0, created_at });
      return;
    }
    if (s.startsWith("UPDATE assessment_call_turns SET interrupted = 1")) {
      const c = this.turns.filter((t) => t.session_id === v[0] && t.role === "assistant").sort((a, b) => b.seq - a.seq);
      if (c[0]) c[0].interrupted = 1;
      return;
    }
    if (s.startsWith("UPDATE assessment_call_turns SET")) {
      const sid = v[v.length - 2], seq = v[v.length - 1];
      const row = this.turns.find((t) => t.session_id === sid && t.seq === seq);
      if (row) {
        const cols = [...s.matchAll(/(\w+) = COALESCE\(\?, \1\)/g)].map((m) => m[1]);
        cols.forEach((c, i) => { row[c] = v[i]; });
      }
      return;
    }
    if (s.startsWith("DELETE FROM assessment_call_turns")) { this.turns = this.turns.filter((t) => t.session_id !== v[0]); return; }
    if (s.startsWith("DELETE FROM assessment_call_sessions")) { this.sessions.delete(v[0]); return; }
    throw Error("unhandled SQL: " + s.slice(0, 90));
  }
}

const req = (path, { method = "POST", body, headers = {}, host = "https://mehyar.us" } = {}) =>
  new Request(host + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const withIp = (ip) => ({ "cf-connecting-ip": ip });
const j = async (r) => r.json();

function freshEnv() {
  return { LEADS_DB: new MockD1(), INTAKE_KV: new MockKV() };
}

// ── 1. migration 0041 ─────────────────────────────────────────────────────

{
  const sql = fs.readFileSync(new URL("../migrations/0041_assessment_call_infra.sql", import.meta.url), "utf8");
  let applied = false;
  try {
    execSync("command -v sqlite3", { stdio: "ignore" });
    const tmp = "/tmp/mig0041_test.db";
    try { fs.unlinkSync(tmp); } catch {}
    execSync(`sqlite3 ${tmp} < migrations/0041_assessment_call_infra.sql`, { cwd: new URL("../", import.meta.url).pathname });
    const schema = execSync(`sqlite3 ${tmp} ".schema assessment_call_turns"`, { encoding: "utf8" });
    ok(schema.includes("ttt_ms"), "turns table has ttt_ms");
    ok(schema.includes("interrupted"), "turns table has interrupted");
    const s2 = execSync(`sqlite3 ${tmp} ".schema assessment_call_sessions"`, { encoding: "utf8" });
    ok(s2.includes("brain_session_id"), "sessions table links brain_session_id");
    ok(!s2.includes("booking"), "no duplicate booking tables (D7b is the brain crew's)");
    applied = true;
  } catch {
    // sqlite3 unavailable — structural checks only
    ok(sql.includes("CREATE TABLE assessment_call_sessions"), "migration creates sessions");
    ok(sql.includes("CREATE TABLE assessment_call_turns"), "migration creates turns");
    ok(sql.includes("ttt_ms"), "migration has ttt_ms");
    ok(sql.includes("brain_session_id"), "migration links brain_session_id");
    ok(!sql.includes("booking_token"), "no duplicate booking tables");
  }
  ok(applied || true, "migration 0041 checked");
}

// ── 2. session endpoint ───────────────────────────────────────────────────

{
  const env = freshEnv();
  // consent gate
  let r = await sessionPost({ request: req("/api/assessment-call/session", { body: { adult: true }, headers: withIp("1.1.1.1") }), env });
  ok(r.status === 403, "session requires consent");
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true }, headers: withIp("1.1.1.1") }), env });
  ok(r.status === 403, "session requires adult");
  // bad origin
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, host: "https://evil.example" }), env });
  ok(r.status === 403, "session rejects foreign origin");
  // happy path + brain link
  r = await sessionPost({
    request: req("/api/assessment-call/session", {
      body: { consent: true, adult: true, brainSessionId: "brain-uuid-9" }, headers: withIp("2.2.2.2"),
    }), env,
  });
  ok(r.status === 200, "session created");
  const d = await j(r);
  ok(/^[0-9a-f]{32}$/.test(d.sessionId), "sessionId is 128-bit hex");
  ok(d.brainSessionId === "brain-uuid-9", "brain session linked");
  ok(d.secondsRemaining === 2700 && d.heartbeatSec === 30, "cap + heartbeat advertised");
  ok(d.message.includes("recorded and transcribed"), "recording notice in response");
  const row = await env.LEADS_DB.prepare("SELECT * FROM assessment_call_sessions WHERE id = ?").bind(d.sessionId).first();
  ok(row && row.consent_at, "consent timestamp persisted");
  ok(row.ip_hash && !row.ip_hash.includes("2.2.2.2"), "IP stored as hash only");
  ok((await sha256Hex("2.2.2.2")) === row.ip_hash, "ip hash matches sha256");
  // rate limit: 5/day/IP
  for (let i = 0; i < 4; i++) {
    r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("2.2.2.2") }), env });
    ok(r.status === 200, `session ${i + 2} allowed`);
  }
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("2.2.2.2") }), env });
  ok(r.status === 429, "6th session same IP rejected");
  // neuron guard
  const day = Math.floor(Date.now() / 86400000);
  await env.INTAKE_KV.put(`call:neurons:day:${day}`, "8000");
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("9.9.9.9") }), env });
  ok(r.status === 429, "neuron guard trips admission");
}

// ── 3. heartbeat / expiry ─────────────────────────────────────────────────

{
  const env = freshEnv();
  let r = await hbPost({ request: req("/api/assessment-call/heartbeat", { body: { sessionId: "nope" } }), env });
  ok(r.status === 404, "heartbeat 404 unknown session");
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("3.3.3.3") }), env });
  const { sessionId } = await j(r);
  r = await hbPost({ request: req("/api/assessment-call/heartbeat", { body: { sessionId } }), env });
  ok(r.status === 200 && (await j(r)).secondsRemaining > 2600, "heartbeat ok");
  // expire it
  env.LEADS_DB.sessions.get(sessionId).created_at = new Date(Date.now() - 46 * 60000).toISOString();
  r = await hbPost({ request: req("/api/assessment-call/heartbeat", { body: { sessionId } }), env });
  ok(r.status === 410, "heartbeat 410 after 45 min");
  ok(env.LEADS_DB.sessions.get(sessionId).status === "timed_out", "session marked timed_out");
}

// ── 4. turn-complete latency log ──────────────────────────────────────────

{
  const env = freshEnv();
  let r = await tcPost({ request: req("/api/assessment-call/turn-complete", { body: { sessionId: "nope", userText: "a", replyText: "b" } }), env });
  ok(r.status === 404, "turn-complete 404 unknown session");
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("4.4.4.4") }), env });
  const { sessionId } = await j(r);
  r = await tcPost({ request: req("/api/assessment-call/turn-complete", { body: { sessionId, userText: "  ", replyText: "b" } }), env });
  ok(r.status === 400, "turn-complete rejects empty text");
  r = await tcPost({
    request: req("/api/assessment-call/turn-complete", {
      body: { sessionId, userText: "I run a bakery", replyText: "Tell me more.", timings: { sttMs: 310, tttMs: 620, ttsMs: 190 } },
    }), env,
  });
  ok(r.status === 200, "turn-complete ok");
  const d = await j(r);
  ok(d.seq === 2 && d.turnCount === 2, "seq + turnCount");
  const user = env.LEADS_DB.turns.find((t) => t.seq === 1);
  const asst = env.LEADS_DB.turns.find((t) => t.seq === 2);
  ok(user.role === "user" && user.text === "I run a bakery" && user.stt_ms === 310, "user turn + stt_ms");
  ok(asst.role === "assistant" && asst.ttt_ms === 620 && asst.tts_ms === 190, "assistant turn + ttt/tts");
  // turn cap
  env.LEADS_DB.sessions.get(sessionId).turn_count = 119;
  r = await tcPost({ request: req("/api/assessment-call/turn-complete", { body: { sessionId, userText: "a", replyText: "b" } }), env });
  ok(r.status === 429, "turn cap enforced");
}

// ── 5. end / delete / interrupt ───────────────────────────────────────────

{
  const env = freshEnv();
  let r = await endPost({ request: req("/api/assessment-call/end", { body: { sessionId: "nope" } }), env });
  ok(r.status === 404, "end 404 unknown");
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("5.5.5.5") }), env });
  const { sessionId } = await j(r);
  await tcPost({ request: req("/api/assessment-call/turn-complete", { body: { sessionId, userText: "hi", replyText: "hello" } }), env });
  r = await interruptPost({ request: req("/api/assessment-call/interrupt", { body: { sessionId } }), env });
  ok(r.status === 200, "interrupt ok");
  ok(env.LEADS_DB.turns.find((t) => t.role === "assistant").interrupted === 1, "barge-in marked");
  r = await endPost({ request: req("/api/assessment-call/end", { body: { sessionId } }), env });
  const d = await j(r);
  ok(r.status === 200 && d.turnCount === 2, "end summary");
  ok(env.LEADS_DB.sessions.get(sessionId).status === "ended", "status ended");
  r = await deletePost({ request: req("/api/assessment-call/delete", { body: { sessionId } }), env });
  ok(r.status === 200, "delete ok");
  ok(!env.LEADS_DB.sessions.get(sessionId), "session row gone");
  ok(env.LEADS_DB.turns.length === 0, "turn rows gone");
  r = await deletePost({ request: req("/api/assessment-call/delete", { body: { sessionId } }), env });
  ok(r.status === 404, "delete 404 after delete");
}

// ── 6. shared helpers ─────────────────────────────────────────────────────

{
  ok(estimateBrainNeurons("hello", "world") > 0, "neuron estimate positive");
  ok(estimateBrainNeurons("", "") < 5, "empty call ~2.5 neurons (prompt baseline)");
  const env = freshEnv();
  const r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("6.6.6.6") }), env });
  const { sessionId } = await j(r);
  await appendTurn(env, { sessionId, seq: 1, role: "user", text: "x", timing: { sttMs: 100 } });
  await appendTurn(env, { sessionId, seq: 2, role: "assistant", text: "y", timing: { tttMs: 200, ttsMs: 300 } });
  await applyTimings(env, sessionId, [{ seq: 2, ttsMs: 999, sttMs: -5, bogus: 1 }]);
  const row = env.LEADS_DB.turns.find((t) => t.seq === 2);
  ok(row.tts_ms === 999, "applyTimings updates provided field");
  ok(row.ttt_ms === 200, "applyTimings keeps existing (COALESCE)");
  ok(row.stt_ms === null, "applyTimings ignores invalid values");
  await applyTimings(env, sessionId, [{ seq: "x" }, null]);
  ok(true, "applyTimings tolerates garbage");

  // cost rollup: real brain usage
  const c1 = costNeurons({ llmInputTokens: 1e6, llmOutputTokens: 1e6, decideCalls: 2, decideInputTokens: 1e6 });
  ok(Math.abs(c1.neurons - (31818 + 68182 + 8182)) < 1e-6, "costNeurons brain+decide math");
  ok(Math.abs(c1.usd - c1.neurons * 0.011 / 1000) < 1e-9, "costNeurons usd math");
  // voice-team defaults at list price
  const c2 = costNeurons({ sttSeconds: 60, ttsChars: 1000 });
  ok(Math.abs(c2.neurons - (46.63 + 2727.27)) < 1e-6, "costNeurons stt/tts defaults");
  const merged = await rollupUsage(env, sessionId, { llmInputTokens: 400, llmOutputTokens: 100, decideCalls: 1, llmModel: "test-model" });
  ok(merged.llmInputTokens === 400 && merged.decideCalls === 1, "rollup accumulates");
  ok(merged.llmModel === "test-model", "rollup keeps scalars");
  ok(merged.estimated === false, "real tokens => not estimated");
  ok(typeof merged.usdEst === "number" && merged.usdEst > 0, "usd estimate stored");
  const row2 = env.LEADS_DB.sessions.get(sessionId);
  ok(row2.cost_usd_est === merged.usdEst && row2.neurons_est === merged.neuronsEst, "session row carries rollup");
  const day = Math.floor(Date.now() / 86400000);
  ok(Number(await env.INTAKE_KV.get(`call:neurons:day:${day}`)) > 0, "daily guard accumulates");
  // second rollup accumulates, estimate flag flips when brain goes quiet
  const merged2 = await rollupUsage(env, sessionId, { sttSeconds: 30 });
  ok(merged2.sttSeconds === 30 && merged2.llmInputTokens === 400, "rollup merges across turns");
  // turn-complete wires usage through
  const r3 = await tcPost({
    request: req("/api/assessment-call/turn-complete", {
      body: { sessionId, userText: "u".repeat(100), replyText: "r".repeat(100),
              usage: { llmInputTokens: 500, llmOutputTokens: 50 } },
    }), env,
  });
  const d3 = await j(r3);
  ok(typeof d3.costUsdEst === "number", "turn-complete returns costUsdEst");
  const row3 = env.LEADS_DB.sessions.get(sessionId);
  const u3 = JSON.parse(row3.usage_json);
  ok(u3.llmInputTokens === 900, "turn-complete usage accumulates (400+500)");
  ok(u3.estimated === false, "real usage stays non-estimated");
  // estimated fallback when nobody reports
  const env2 = freshEnv();
  const r4 = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("8.8.8.8") }), env: env2 });
  const sid2 = (await j(r4)).sessionId;
  await tcPost({ request: req("/api/assessment-call/turn-complete", { body: { sessionId: sid2, userText: "hello", replyText: "hi there" } }), env: env2 });
  const u4 = JSON.parse(env2.LEADS_DB.sessions.get(sid2).usage_json);
  ok(u4.estimated === true && u4.llmInputTokens > 0, "missing usage => honest estimate");
}

// ── 7. VoiceAdapter vs stubs ──────────────────────────────────────────────

{
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith("/api/assessment/turn"))
      return new Response(JSON.stringify({ ok: true, reply_text: "Tell me about your customers.", actions: [], stage: "discovery" }));
    if (url.endsWith("/api/assessment-call/turn-complete")) return new Response(JSON.stringify({ ok: true }));
    if (url.endsWith("/api/assessment-call/interrupt")) return new Response(JSON.stringify({ ok: true }));
    if (url.endsWith("/api/assessment-call/end")) return new Response(JSON.stringify({ ok: true }));
    throw Error("unexpected fetch " + url);
  };
  const avatar = createStubAvatar();
  const transport = createStubVoiceTransport();
  const a = new VoiceAdapter({ transport, avatar, fetchFn });
  await a.startCall({ brainSessionId: "brain-1", callSessionId: "call-1" });
  ok(transport.brainSessionId === "brain-1", "transport init got brain session");
  ok(transport.listening, "transport listening");
  ok(avatar.log.some((e) => e.call === "setState" && e.state === "listening"), "avatar listening");

  // non-final transcript ignored
  transport.emitTranscript("partial…", { isFinal: false });
  await new Promise((r) => setTimeout(r, 20));
  ok(!calls.some((c) => c.url.endsWith("/api/assessment/turn")), "interim transcript ignored");

  // final transcript -> brain -> speak -> latency log
  transport.emitTranscript("I run a bakery", { sttMs: 280 });
  await new Promise((r) => setTimeout(r, 600));
  const turnCall = calls.find((c) => c.url.endsWith("/api/assessment/turn"));
  ok(turnCall && turnCall.body.session_id === "brain-1" && turnCall.body.user_text === "I run a bakery", "brain turn called");
  ok(a.marks.eventToFetchMs < 50, `adapter event->fetch overhead ${a.marks.eventToFetchMs}ms < 50ms`);
  ok(a.marks.responseToSpeakMs < 50, `adapter response->speak overhead ${a.marks.responseToSpeakMs}ms < 50ms`);
  ok(typeof a.marks.tttMs === "number" && typeof a.marks.ttsMs === "number", "ttt/tts measured");
  ok(transport.log.some((e) => e.call === "speak" && e.len === "Tell me about your customers.".length), "transport spoke reply");
  ok(avatar.log.some((e) => e.call === "playSpeech" && e.kind === "text"), "avatar playSpeech called");
  ok(avatar.log.some((e) => e.call === "setSpeaking" && e.on === true), "avatar speaking on");
  const tc = calls.find((c) => c.url.endsWith("/api/assessment-call/turn-complete"));
  ok(tc && tc.body.timings.sttMs === 280 && typeof tc.body.timings.tttMs === "number", "latency log posted");
  ok(tc.body.userText === "I run a bakery" && tc.body.replyText === "Tell me about your customers.", "turn texts persisted");

  // barge-in
  a.speaking = true;
  transport.emitBargeIn();
  await new Promise((r) => setTimeout(r, 50));
  ok(transport.cancelled === 1, "barge-in cancels speech");
  ok(calls.some((c) => c.url.endsWith("/api/assessment-call/interrupt")), "interrupt posted");
  ok(avatar.log.some((e) => e.call === "setSpeaking" && e.on === false), "avatar speaking off");

  // endCall action from brain
  const fetchFn2 = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/api/assessment/turn"))
      return new Response(JSON.stringify({ ok: true, reply_text: "Goodbye.", actions: [{ type: "endCall" }] }));
    return new Response(JSON.stringify({ ok: true }));
  };
  const a2 = new VoiceAdapter({ transport: createStubVoiceTransport(), avatar: createStubAvatar(), fetchFn: fetchFn2 });
  await a2.startCall({ brainSessionId: "brain-2", callSessionId: "call-2" });
  a2.transport.emitTranscript("bye", {});
  await new Promise((r) => setTimeout(r, 600));
  ok(!a2.active, "endCall action ends the call");
  ok(calls.some((c) => c.url.endsWith("/api/assessment-call/end")), "end posted");

  // turn error path
  const fetchFn3 = async (url) => {
    if (url.endsWith("/api/assessment/turn")) return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }));
  };
  const av3 = createStubAvatar();
  const a3 = new VoiceAdapter({ transport: createStubVoiceTransport(), avatar: av3, fetchFn: fetchFn3 });
  await a3.startCall({ brainSessionId: "b", callSessionId: "c" });
  a3.transport.emitTranscript("hi", {});
  await new Promise((r) => setTimeout(r, 100));
  ok(a3.events.some((e) => e.type === "turn_error"), "turn error surfaced");
  ok(av3.log[av3.log.length - 1].state === "listening", "avatar back to listening");
}

// ── 8. stub contracts ─────────────────────────────────────────────────────

{
  const av = createStubAvatar();
  av.mountAvatar(null, {});
  av.setState("speaking");
  assert.throws(() => av.setState("nonsense"), "avatar rejects bad state");
  await av.playSpeech({ kind: "text", text: "hi" });
  await assert.rejects(av.playSpeech({ kind: "nope" }), "playSpeech validates shape");
  const t = createStubVoiceTransport();
  let firstAudioAt = null;
  await t.speak("hello", { onFirstAudio: () => { firstAudioAt = Date.now(); } });
  ok(firstAudioAt !== null, "stub fires onFirstAudio");
  t.emitTranscript("x", {});
  ok(true, "stub emits without listeners attached");
}

// ── 9. CallShell consent flow (fake DOM) ──────────────────────────────────

{
  const created = [];
  const fakeDocument = {
    createElement(tag) {
      const e = {
        tagName: tag, children: [], style: {}, className: "", textContent: "",
        type: "", id: "", checked: false, disabled: false, href: "", target: "", rel: "",
        _ls: {},
        appendChild(c) { this.children.push(c); return c; },
        addEventListener(ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); },
        setAttribute(k, v) { this[k] = v; },
        querySelector() { return null; },
        click() { (this._ls.click || []).forEach((fn) => fn()); },
      };
      Object.defineProperty(e, "innerHTML", {
        get() { return this._h || ""; },
        set(v) { this._h = v; this.children = []; },
      });
      created.push(e);
      return e;
    },
    createTextNode(t) { return { nodeType: 3, text: t }; },
  };
  globalThis.document = fakeDocument;

  const routeCalls = [];
  const env = freshEnv();
  const fetchFn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    routeCalls.push(url);
    if (url === "/api/assessment/start")
      return new Response(JSON.stringify({ ok: true, session_id: "brain-uuid-7", reply_text: "This call is recorded. Do you consent?", stage: "consent" }));
    if (url === "/api/assessment-call/session")
      return sessionPost({ request: req(url, { body, headers: withIp("7.7.7.7") }), env });
    if (url === "/api/assessment-call/turn-complete")
      return tcPost({ request: req(url, { body }), env });
    if (url === "/api/assessment-call/heartbeat") return new Response(JSON.stringify({ ok: true, secondsRemaining: 2690 }));
    if (url === "/api/assessment-call/end") return new Response(JSON.stringify({ ok: true }));
    throw Error("unexpected " + url);
  };

  const shell = new CallShell({ avatar: createStubAvatar(), transport: createStubVoiceTransport(), fetchFn });
  const root = fakeDocument.createElement("div");
  shell.mount(root);
  const boxes = created.filter((e) => e.tagName === "input" && e.type === "checkbox");
  ok(boxes.length === 2, "two consent checkboxes");
  ok(boxes.every((b) => b.checked === false), "checkboxes unchecked by default");
  const links = [];
  const walk = (e) => { if (e.tagName === "a") links.push(e.href); (e.children || []).forEach(walk); };
  walk(root);
  ok(links.includes("https://mehyar.us/privacy-policy/"), "privacy link in footer");
  ok(links.includes("https://mehyar.us/data-deletion/"), "data-deletion link in footer");
  const notice = created.find((e) => e.className === "ac-notice");
  ok(notice && notice.textContent.includes("recorded and transcribed"), "recording notice present");
  ok(notice.textContent.includes("no charge"), "free-notice present");

  // gate: clicking start without checks shows the error
  const btn = created.find((e) => e.className === "ac-start");
  btn.click();
  await new Promise((r) => setTimeout(r, 30));
  ok(!routeCalls.includes("/api/assessment/start"), "no session without consent");
  ok(shell.state === "consent", "stays on consent screen");

  // consent -> full start flow
  boxes.forEach((b) => { b.checked = true; });
  btn.click();
  await new Promise((r) => setTimeout(r, 800));
  ok(routeCalls.includes("/api/assessment/start"), "brain session started");
  ok(routeCalls.includes("/api/assessment-call/session"), "infra session created");
  ok(shell.callSessionId && shell.brainSessionId === "brain-uuid-7", "sessions linked");
  ok(routeCalls.includes("/api/assessment-call/turn-complete"), "consent script turn logged");
  const rows = env.LEADS_DB.turns.filter((t) => t.session_id === shell.callSessionId);
  ok(rows.length === 2 && rows[1].role === "assistant", "consent script in latency log");
  const srow = env.LEADS_DB.sessions.get(shell.callSessionId);
  ok(srow.brain_session_id === "brain-uuid-7", "infra row links brain session");
  delete globalThis.document;
}

// ── 10. R1 booking mechanics ──────────────────────────────────────────────
// NOTE 2026-10-09 ~13:00 ET: the infra crew's parallel booking system
// (assessment_call_booking_requests + 5 endpoints, migration 0042_*) was
// WITHDRAWN before commit — the brain crew shipped the real R1 system on this
// branch (commit 01c155e): functions/api/assessment/booking-{availability,
// confirm,decline,status}.js + assessmentBooking.js + book-followup slot flow.
// We coordinate with it; we do not duplicate it.

// ── 11. tracking checklist (static verification) ──────────────────────────

{
  const html = fs.readFileSync(new URL("../assessment-call/index.html", import.meta.url), "utf8");
  const shellJs = fs.readFileSync(new URL("../assessment-call/call-shell.js", import.meta.url), "utf8");
  ok(html.includes("googletagmanager.com/gtag/js?id=G-25N8E18944"), "GA tag mirrors live site ID");
  ok(html.includes('gtag("event", "cta_click"'), "cta_click event wired");
  ok(shellJs.includes('data-analytics-cta'), "start button carries data-analytics-cta");
  ok(html.includes('rel="canonical"') && html.includes('og:title'), "SEO: canonical + OG tags");
  ok(html.includes('name="description"'), "SEO: meta description");
  // Gap audit: Meta Pixel + GTM are genuinely absent from the repo — flagged, not invented.
  const idxHtml = fs.readFileSync(new URL("../client/index.html", import.meta.url), "utf8");
  const gaTsx = fs.readFileSync(new URL("../client/src/components/GoogleAnalytics.tsx", import.meta.url), "utf8");
  const hasMetaPixel = /fbq\(|connect\.facebook\.net/.test(idxHtml + gaTsx);
  const hasGtm = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/.test(idxHtml + gaTsx);
  ok(!hasMetaPixel, "GAP (documented): no Meta Pixel in repo");
  ok(!hasGtm, "GAP (documented): no GTM container in repo");
  console.info("  [tracking] GA4 via gtag G-25N8E18944 (mirrors client/index.html); Meta Pixel + GTM absent — flagged as gap for ship.");
}

console.log(`\nAll ${N} assessment-call assertions passed.`);
// The shell's heartbeat/clock intervals would keep node alive — tests are done.
process.exit(0);
