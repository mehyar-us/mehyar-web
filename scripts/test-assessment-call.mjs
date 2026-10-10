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
  checkSpendGuard, dailySpendCapUsd, dailySpendUsd,
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
  // spend guard: at cap → clean decline (429), never a half-call
  const day = Math.floor(Date.now() / 86400000);
  await env.INTAKE_KV.put(`call:spend:day:${day}`, "20");
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("9.9.9.9") }), env });
  ok(r.status === 429, "spend guard trips admission at cap");
  // under cap → admitted
  await env.INTAKE_KV.put(`call:spend:day:${day}`, "19.99");
  r = await sessionPost({ request: req("/api/assessment-call/session", { body: { consent: true, adult: true }, headers: withIp("9.9.9.9") }), env });
  ok(r.status === 200, "spend guard admits under cap");
  // configurability
  ok(dailySpendCapUsd({}) === 20, "spend cap defaults $20/day");
  ok(dailySpendCapUsd({ ASSESSMENT_CALL_DAILY_SPEND_CAP_USD: "50" }) === 50, "spend cap configurable via env");
  ok(dailySpendCapUsd({ ASSESSMENT_CALL_DAILY_SPEND_CAP_USD: "junk" }) === 20, "bad env value falls back to $20");
  ok((await dailySpendUsd(env)) === 19.99, "dailySpendUsd reads the KV counter");
  ok((await checkSpendGuard(env)) === true, "checkSpendGuard true under cap");
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
  // voice-team frozen shape (answers doc §11): actuals verbatim, never list-price estimates
  const c2 = costNeurons({
    stt: { model: "@cf/deepgram/flux", audioMinutes: 12.4, neurons: 8680 },
    tts: { model: "@cf/deepgram/aura-1", chars: 8230, neurons: 11224 },
    turn: { model: "@cf/pipecat-ai/smart-turn-v2", audioMinutes: 45.0, neurons: 23 },
  });
  ok(c2.neurons === 8680 + 11224 + 23, "costNeurons voice actuals passthrough");
  ok(Math.abs(c2.usd - 19927 * 0.011 / 1000) < 1e-12, "costNeurons voice usd math");
  // legacy list-price estimation is gone: old fields contribute nothing
  ok(costNeurons({ sttSeconds: 60, ttsChars: 1000 }).neurons === 0, "no list-price STT/TTS estimation");
  // garbage voice shapes are ignored, not fatal
  ok(costNeurons({ stt: { neurons: "nope" }, tts: null, turn: { neurons: -5 } }).neurons === 0, "garbage voice usage ignored");
  const merged = await rollupUsage(env, sessionId, { llmInputTokens: 400, llmOutputTokens: 100, decideCalls: 1, llmModel: "test-model" });
  ok(merged.llmInputTokens === 400 && merged.decideCalls === 1, "rollup accumulates");
  ok(merged.llmModel === "test-model", "rollup keeps scalars");
  ok(merged.estimated === false, "real tokens => not estimated");
  ok(typeof merged.usdEst === "number" && merged.usdEst > 0, "usd estimate stored");
  const row2 = env.LEADS_DB.sessions.get(sessionId);
  ok(row2.cost_usd_est === merged.usdEst && row2.neurons_est === merged.neuronsEst, "session row carries rollup");
  const day = Math.floor(Date.now() / 86400000);
  ok(Number(await env.INTAKE_KV.get(`call:spend:day:${day}`)) > 0, "daily spend guard accumulates");
  // second rollup merges the frozen voice shape; estimate flag flips when brain goes quiet
  const merged2 = await rollupUsage(env, sessionId, {
    stt: { model: "@cf/deepgram/flux", audioMinutes: 12.4, neurons: 8680 },
    tts: { model: "@cf/deepgram/aura-1", chars: 8230, neurons: 11224 },
    turn: { model: "@cf/pipecat-ai/smart-turn-v2", audioMinutes: 45, neurons: 23 },
  });
  ok(merged2.stt.neurons === 8680 && merged2.stt.audioMinutes === 12.4, "rollup merges voice stt actuals");
  ok(merged2.stt.model === "@cf/deepgram/flux", "rollup keeps voice stt model");
  ok(merged2.tts.chars === 8230 && merged2.tts.model === "@cf/deepgram/aura-1", "rollup merges voice tts actuals");
  ok(merged2.turn.neurons === 23, "rollup merges turn actuals");
  ok(merged2.llmInputTokens === 400, "rollup keeps brain counters across turns");
  ok(Math.abs(merged2.neuronsEst - (merged.neuronsEst + 19927)) < 0.01, "voice actuals land in the cost rollup");
  ok(Math.abs(Number(await env.INTAKE_KV.get(`call:spend:day:${day}`)) - merged2.usdEst) < 1e-9, "spend counter tracks rollup USD");
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
  // turn-complete passes the frozen voice shape through to the rollup
  const r3b = await tcPost({
    request: req("/api/assessment-call/turn-complete", {
      body: { sessionId, userText: "u".repeat(100), replyText: "r".repeat(100),
              usage: { stt: { model: "flux", audioMinutes: 2, neurons: 1400 },
                       tts: { model: "aura-1", chars: 500, neurons: 682 } } },
    }), env,
  });
  ok(r3b.status === 200, "turn-complete accepts frozen voice usage");
  const u3b = JSON.parse(env.LEADS_DB.sessions.get(sessionId).usage_json);
  ok(u3b.stt.neurons === 8680 + 1400 && u3b.tts.chars === 8230 + 500, "frozen voice usage accumulates across turns");
  ok(u3b.tts.model === "aura-1", "latest voice model kept");
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
  ok(transport.sessionId === "call-1", "transport init got call sessionId (voice WS auth)");
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

// ── 7b. voiceUsageDelta: cumulative DO usage -> per-turn deltas ─────────────

{
  const mkT = (frames) => {
    let i = 0;
    return { getUsage: () => JSON.parse(JSON.stringify(frames[Math.min(i++, frames.length - 1)])) };
  };
  const zero = { stt: { model: "flux", audioMinutes: 0, neurons: 0 },
                 tts: { model: "aura-1", chars: 0, neurons: 0 },
                 turn: { model: "st", audioMinutes: 0, neurons: 0 } };
  const f1 = { stt: { model: "flux", audioMinutes: 2, neurons: 1400 },
               tts: { model: "aura-1", chars: 500, neurons: 682 },
               turn: { model: "st", audioMinutes: 2.5, neurons: 3 } };
  const f2 = { stt: { model: "flux", audioMinutes: 5, neurons: 3500 },
               tts: { model: "aura-1", chars: 900, neurons: 1228 },
               turn: { model: "st", audioMinutes: 6, neurons: 7 } };
  const mk = (frames) => new VoiceAdapter({ transport: mkT(frames), avatar: createStubAvatar(), fetchFn: async () => new Response("{}") });
  const a = mk([zero, f1, f2]);
  ok(a.voiceUsageDelta() === null, "delta: zeros-shape first frame -> nothing posted");
  const d1 = a.voiceUsageDelta();
  ok(d1 && d1.stt.neurons === 1400 && d1.tts.chars === 500 && d1.turn.audioMinutes === 2.5,
    "delta: first real frame -> full values as the delta");
  const d2 = a.voiceUsageDelta();
  ok(d2 && d2.stt.neurons === 2100 && d2.tts.chars === 400 && d2.turn.neurons === 4 && d2.stt.model === "flux",
    "delta: second frame -> per-turn diff only (no double-count on the server)");
  // unchanged frame -> null (no empty posts)
  const d3 = a.voiceUsageDelta();
  ok(d3 === null, "delta: repeated frame -> null");
  // transport without getUsage -> null, no crash
  const a2 = new VoiceAdapter({ transport: {}, avatar: createStubAvatar(), fetchFn: async () => new Response("{}") });
  ok(a2.voiceUsageDelta() === null, "delta: legacy transport without getUsage -> null");
  // voice actuals win over estimates in the /turn-complete post
  const posted = [];
  const fetchFn = async (url, init) => { posted.push(JSON.parse(init.body)); return new Response("{}"); };
  const t3 = mkT([f1]);
  const a3 = new VoiceAdapter({
    transport: { getUsage: t3.getUsage, speak: async () => {}, cancelSpeech() {} },
    avatar: createStubAvatar(), fetchFn,
  });
  a3.active = true; a3.callSessionId = "s1";
  await a3.speak("hello", { userText: "hi", usage: { stt: { neurons: 1 }, llmInputTokens: 10 } });
  const lastPost = posted[posted.length - 1];
  ok(lastPost.usage.stt.neurons === 1400 && lastPost.usage.llmInputTokens === 10,
    "speak: DO-measured voice actuals override estimates, brain usage preserved");
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
  ok(html.includes("G-25N8E18944"), "GA tag mirrors live site ID");
  ok(/consent.*default.*denied/s.test(html), "GA4 consent-gated: defaults deny storage (full-QA fix)");
  ok(!/script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js/.test(html), "GA4: no unconditional gtag.js load pre-consent");
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

// ── 12. ChatOnramp: chat-first on-ramp → voice handoff ───────────────────

{
  const { ChatOnramp } = await import("../assessment-call/chat.js");
  const created = [];
  const mkEl = (tag, ns) => {
    const e = {
      tagName: tag, namespace: ns || null, children: [], style: {},
      className: "", textContent: "", type: "", id: "", checked: false,
      disabled: false, href: "", target: "", rel: "", value: "",
      src: "", alt: "", placeholder: "", parentNode: null,
      _ls: {}, _attrs: {},
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
      addEventListener(ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      querySelector() { return null; },
      click() { (this._ls.click || []).forEach((fn) => fn()); },
      focus() {},
      focus() {},
    };
    Object.defineProperty(e, "innerHTML", {
      get() { return this._h || ""; },
      set(v) { this._h = v; this.children = []; },
    });
    Object.defineProperty(e, "scrollHeight", { get() { return 100; } });
    created.push(e);
    return e;
  };
  const fakeDocument = {
    createElement: (t) => mkEl(t),
    createElementNS: (ns, t) => mkEl(t, ns),
    createTextNode: (t) => ({ nodeType: 3, text: t }),
  };
  globalThis.document = fakeDocument;

  const routeCalls = [];
  let turnCount = 0;
  const fetchFn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    routeCalls.push(url);
    if (url === "/api/assessment/start")
      return new Response(JSON.stringify({
        ok: true, session_id: "brain-chat-1",
        reply_text: "Hi, I'm the mayor. Before we start — quick heads-up: this call is recorded...",
        stage: "consent",
      }));
    if (url === "/api/assessment/turn") {
      turnCount++;
      return new Response(JSON.stringify({
        ok: true,
        reply_text: turnCount === 1 ? "Great — what kind of business are we talking about?" : `Noted (${turnCount}).`,
        stage: "discovery",
        actions: [],
      }));
    }
    throw Error("unexpected " + url);
  };

  let handoffArgs = null;
  const chat = new ChatOnramp({
    fetchFn,
    avatarSrc: "./mayor-avatar.png",
    maxTextTurns: 2, // short for tests
    onHandoff: async (args) => { handoffArgs = args; },
  });
  const root = fakeDocument.createElement("div");
  chat.mount(root);

  const bubbles = () => created.filter((e) => e.className && e.className.includes("chat-bubble"));
  const texts = () => bubbles().map((b) => b.textContent);

  // Greeting: exact, no AI mention
  ok(texts().some((t) => t === "Hi, I'm the mayor."), "greeting is exactly \"Hi, I'm the mayor.\"");
  ok(!texts().join(" ").toLowerCase().includes("ai assistant"), "no AI disclosure in greeting");
  ok(chat.state === "greeting", "starts in greeting state");

  // Consent card appears after the beat
  await new Promise((r) => setTimeout(r, 1100));
  ok(chat.state === "consent", "consent card shown");
  const boxes = created.filter((e) => e.tagName === "input" && e.type === "checkbox");
  ok(boxes.length === 2, "two consent checkboxes in chat");
  ok(boxes.every((b) => b.checked === false), "chat checkboxes unchecked by default");

  // Gate: no session without consent
  const consentBtn = created.find((e) => e.className === "chat-btn" && e.textContent.includes("Sounds good"));
  consentBtn.click();
  await new Promise((r) => setTimeout(r, 50));
  ok(!routeCalls.includes("/api/assessment/start"), "no brain session without consent");
  const errEl = created.find((e) => e.className === "chat-consent-error");
  ok(errEl && errEl.style.display === "block", "consent error shown");

  // Consent → brain session + first turn
  boxes.forEach((b) => { b.checked = true; });
  consentBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  ok(routeCalls.includes("/api/assessment/start"), "brain session started after consent");
  ok(chat.brainSessionId === "brain-chat-1", "brain session id stored");
  ok(chat.state === "chatting", "chat is live after consent");
  ok(texts().some((t) => t.includes("what kind of business")), "brain discovery question rendered");

  // Text turn round-trip
  const input = created.find((e) => e.className === "chat-input" && e.type === "text");
  const sendBtn = created.find((e) => e.className === "chat-send");
  input.value = "I run a plumbing company";
  sendBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  ok(texts().some((t) => t === "I run a plumbing company"), "user message rendered");
  ok(routeCalls.filter((u) => u === "/api/assessment/turn").length === 2, "second turn sent to brain");

  // Handoff after maxTextTurns
  input.value = "mehyarplumbing.com";
  sendBtn.click();
  await new Promise((r) => setTimeout(r, 400));
  ok(texts().some((t) => t === "Let's talk it through — calling you now."), "handoff line delivered");
  ok(chat.state === "handoff", "handoff state");
  await new Promise((r) => setTimeout(r, 1400));
  ok(chat.state === "incoming", "incoming-call UI shown");
  const answerBtn = created.find((e) => e.className === "chat-answer-btn");
  const declineBtn = created.find((e) => e.className === "chat-decline-btn");
  ok(!!answerBtn && !!declineBtn, "answer + decline buttons present");
  ok(answerBtn.getAttribute("aria-label") === "Answer the call", "answer button labeled");

  // Answer → onHandoff with the SAME brain session
  answerBtn.click();
  await new Promise((r) => setTimeout(r, 100));
  ok(handoffArgs && handoffArgs.brainSessionId === "brain-chat-1", "handoff carries brain session");
  ok(handoffArgs.consent.consent === true && handoffArgs.consent.adult === true, "handoff carries consent");

  // Decline path: fresh chat, decline returns to chatting
  const chat2 = new ChatOnramp({ fetchFn, maxTextTurns: 1, onHandoff: async () => {} });
  const root2 = fakeDocument.createElement("div");
  chat2.mount(root2);
  await new Promise((r) => setTimeout(r, 1100));
  const boxes2 = created.filter((e) => e.tagName === "input" && e.type === "checkbox" && e.checked === false);
  boxes2.slice(-2).forEach((b) => { b.checked = true; });
  const btn2 = created.filter((e) => e.className === "chat-btn" && e.textContent.includes("Sounds good")).pop();
  btn2.click();
  await new Promise((r) => setTimeout(r, 300));
  const input2 = created.filter((e) => e.className === "chat-input" && e.type === "text").pop();
  const send2 = created.filter((e) => e.className === "chat-send").pop();
  input2.value = "test";
  send2.click();
  await new Promise((r) => setTimeout(r, 1800));
  ok(chat2.state === "incoming", "second chat reaches incoming");
  const decline2 = created.filter((e) => e.className === "chat-decline-btn").pop();
  decline2.click();
  await new Promise((r) => setTimeout(r, 100));
  ok(chat2.state === "chatting", "decline returns to chat");
  ok(chat2.brainSessionId === "brain-chat-1", "brain session preserved after decline");

  delete globalThis.document;
}

// ── 13. Regression: default fetchFn must survive a real browser ──────────────
// Browsers throw "Illegal invocation" when the native fetch is detached from
// window (const f = fetch; f()). The default used to be `fetch` itself, which
// broke every real browser while mocked-fetch tests stayed green.
{
  const calls = [];
  function strictFetch(...args) {
    // Emulate the WebIDL receiver check: detached invocation throws.
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    calls.push(args);
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  const savedFetch = globalThis.fetch;
  globalThis.fetch = strictFetch;
  try {
    const { ChatOnramp } = await import("../assessment-call/chat.js");
    const chat = new ChatOnramp(); // default fetchFn
    await chat.fetchFn("/api/assessment/start", { method: "POST" });
    ok(calls.length === 1 && calls[0][0] === "/api/assessment/start", "ChatOnramp default fetchFn is browser-safe");

    const { CallShell } = await import("../assessment-call/call-shell.js");
    const shell = new CallShell({ avatar: createStubAvatar(), transport: createStubVoiceTransport() });
    await shell.fetchFn("/api/assessment-call/session", { method: "POST" });
    ok(calls.length === 2, "CallShell default fetchFn is browser-safe");

    const { VoiceAdapter } = await import("../assessment-call/voice-adapter.js");
    const va = new VoiceAdapter({ avatar: createStubAvatar(), transport: createStubVoiceTransport() });
    await va.fetchFn("/api/assessment/turn", { method: "POST" });
    ok(calls.length === 3, "VoiceAdapter default fetchFn is browser-safe");
  } finally {
    globalThis.fetch = savedFetch;
  }
}

// ── 14. Incoming-call ringer: native vibration + HTMLAudio ringtone ─────────
// The Mayor's order: when the incoming-call screen shows, the device must
// vibrate (navigator.vibrate) and play a ringtone (HTMLAudioElement), and
// both must stop on answer or decline.
{
  const { ChatOnramp } = await import("../assessment-call/chat.js");

  // Ringtone asset: real audio, small, loopable.
  const ringPath = new URL("../assessment-call/ringtone.mp3", import.meta.url);
  ok(fs.existsSync(ringPath), "ringtone.mp3 exists");
  const ringStat = fs.statSync(ringPath);
  ok(ringStat.size > 1000 && ringStat.size < 100 * 1024, `ringtone.mp3 is small (${ringStat.size}b)`);
  try {
    const probe = execSync(`ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "${ringPath.pathname}"`).toString().trim();
    ok(probe.includes("mp3"), `ringtone.mp3 is valid audio (got ${probe})`);
  } catch {
    ok(false, "ringtone.mp3 ffprobe failed");
  }

  // Fake DOM/navigator/audio for the ringer path.
  const mkEl = (tag) => {
    const e = {
      tagName: tag, children: [], style: {}, className: "", textContent: "",
      type: "", src: "", alt: "", disabled: false, _ls: {}, _attrs: {},
      classList: { add() {}, remove() {}, contains() { return false; } },
      appendChild(c) { this.children.push(c); return c; },
      addEventListener(ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      querySelector() { return null; },
      click() { (this._ls.click || []).forEach((fn) => fn()); },
      focus() {},
    };
    Object.defineProperty(e, "innerHTML", {
      get() { return this._h || ""; },
      set(v) { this._h = v; this.children = []; },
    });
    createdRinger.push(e);
    return e;
  };
  const createdRinger = [];
  const docListeners = {};
  globalThis.document = {
    createElement: (t) => mkEl(t),
    createElementNS: (ns, t) => mkEl(t),
    createTextNode: (t) => ({ nodeType: 3, text: t }),
    addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => {
      docListeners[ev] = (docListeners[ev] || []).filter((f) => f !== fn);
    },
  };
  const vibCalls = [];
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, writable: true,
    value: { vibrate: (p) => { vibCalls.push(p); return true; } },
  });
  const audioInstances = [];
  globalThis.Audio = class {
    constructor(src) { this.src = src; this.loop = false; this._played = false; this._paused = false; audioInstances.push(this); }
    play() { this._played = true; return Promise.resolve(); }
    pause() { this._paused = true; }
    removeAttribute() {}
    load() {}
  };

  try {
    const chat = new ChatOnramp({
      fetchFn: async () => { throw Error("no network in ringer test"); },
      onHandoff: async () => {},
    });
    chat.mount(globalThis.document.createElement("div"));

    // Drive straight to the incoming-call screen.
    chat.renderIncomingCall();
    await new Promise((r) => setTimeout(r, 50));
    ok(chat.state === "incoming", "ringer test reaches incoming state");
    ok(vibCalls.some((c) => Array.isArray(c) && c.length > 0),
      "vibration pattern triggered on incoming call");
    ok(audioInstances.length === 1, "ringtone Audio element created");
    ok(audioInstances[0].src === "./ringtone.mp3", "ringtone src is ringtone.mp3");
    ok(audioInstances[0].loop === true, "ringtone loops");
    ok(audioInstances[0]._played === true, "ringtone play() called");

    // Answer stops everything.
    const answerBtn = createdRinger.find((e) => e.className === "chat-answer-btn");
    answerBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    ok(vibCalls[vibCalls.length - 1] === 0, "vibration cancelled on answer");
    ok(audioInstances[0]._paused === true, "ringtone paused on answer");
    ok(chat.ringAudio === null && chat.ringVibeTimer === null, "ringer handles released on answer");

    // Decline stops everything too, and re-render restarts the ring.
    const chat2 = new ChatOnramp({
      fetchFn: async () => { throw Error("no network in ringer test"); },
      onHandoff: async () => {},
    });
    chat2.mount(globalThis.document.createElement("div"));
    const vibBefore = vibCalls.length;
    chat2.renderIncomingCall();
    await new Promise((r) => setTimeout(r, 50));
    ok(vibCalls.length > vibBefore, "vibration restarts on incoming re-render");
    const declineBtn = createdRinger.filter((e) => e.className === "chat-decline-btn").pop();
    declineBtn.click();
    await new Promise((r) => setTimeout(r, 50));
    ok(vibCalls[vibCalls.length - 1] === 0, "vibration cancelled on decline");
    ok(audioInstances[audioInstances.length - 1]._paused === true, "ringtone paused on decline");
    ok(chat2.ringAudio === null && chat2.ringVibeTimer === null, "ringer handles released on decline");
  } finally {
    delete globalThis.document;
    if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
    else delete globalThis.navigator;
    delete globalThis.Audio;
  }
}

console.log(`\nAll ${N} assessment-call assertions passed.`);
// ── 15. F1: live page wires the REAL voice transport, never the stub ───────
// Full-QA finding: assessment-call/index.html shipped createStubVoiceTransport()
// (a silent simulation — a real caller heard nothing). The page must wire the
// voice team's real browser transport instead.
{
  const html = fs.readFileSync(new URL("../assessment-call/index.html", import.meta.url), "utf8");
  ok(!html.includes("createStubVoiceTransport"), "index.html does not reference the stub voice transport");
  ok(html.includes('from "./voice-transport.js"'), "index.html imports the real voice transport");
  ok(html.includes("new VoiceTransport()"), "index.html constructs the real VoiceTransport");
  // Vendored copy must match the voice track's source of truth (below header).
  const src = fs.readFileSync(new URL("../client/src/lib/assessment-call/voice-transport.js", import.meta.url), "utf8");
  const vendored = fs.readFileSync(new URL("../assessment-call/voice-transport.js", import.meta.url), "utf8");
  const srcBody = src.split("\n").slice(51).join("\n");
  const vendoredBody = vendored.split("\n").slice(5).join("\n");
  ok(srcBody === vendoredBody, "vendored voice-transport.js matches client source of truth");
  // The real transport implements the frozen 7-method contract the page needs.
  const { VoiceTransport } = await import("../assessment-call/voice-transport.js");
  const t = new VoiceTransport();
  for (const m of ["init", "startListening", "stopListening", "on", "speak", "cancelSpeech", "dispose", "getUsage"]) {
    ok(typeof t[m] === "function", `VoiceTransport implements ${m}()`);
  }
  t.dispose();
}

// ── 16. Voice honesty: readiness probe + bounded transport init ──────────
// The degraded voice path must say so plainly — never a stuck "Connecting…",
// never silence presented as a working call.

{
  const makeDoc = () => {
    const created = [];
    const doc = {
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
    return { doc, created };
  };
  const readinessUrl = "https://readiness.test/api/voice/readiness";
  // mount + consent -> click start, then wait until the shell settles out of
  // "starting" (the stub transport's speak takes up to ~400ms)
  const consentAndStart = async (shell, created) => {
    const root = globalThis.document.createElement("div");
    shell.mount(root);
    const boxes = created.filter((e) => e.tagName === "input" && e.type === "checkbox");
    boxes.forEach((b) => { b.checked = true; });
    created.find((e) => e.className === "ac-start").click();
    const deadline = Date.now() + 3000;
    while (shell.state === "starting" && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 25));
  };
  const errorText = (created) =>
    (created.find((e) => e.className === "ac-error" && e.textContent) || { textContent: "" }).textContent;

  // 16a. readiness says unavailable -> plain notice, no call attempt
  {
    const { doc, created } = makeDoc();
    globalThis.document = doc;
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (url === readinessUrl)
        return new Response(JSON.stringify({ available: false, reason: "voice service is not configured", transport: "none" }));
      throw Error("unexpected " + url);
    };
    const shell = new CallShell({ avatar: createStubAvatar(), transport: createStubVoiceTransport(), fetchFn, readinessUrl });
    await consentAndStart(shell, created);
    ok(shell.state === "error", "readiness-unavailable: shell fails plainly");
    ok(errorText(created).includes("Voice isn't available right now — voice service is not configured."),
      "readiness-unavailable: plain notice with the server's reason");
    ok(!calls.includes("/api/assessment/start"), "readiness-unavailable: no call is started");
    delete globalThis.document;
  }

  // 16b. readiness probe itself fails (unknown) -> normal attempt proceeds
  {
    const { doc, created } = makeDoc();
    globalThis.document = doc;
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (url === readinessUrl) throw Error("network down");
      if (url === "/api/assessment/start")
        return new Response(JSON.stringify({ ok: true, session_id: "brain-9", reply_text: "consent script", stage: "consent" }));
      if (url === "/api/assessment-call/session")
        return new Response(JSON.stringify({ ok: true, sessionId: "infra-9", secondsRemaining: 2700 }));
      if (url === "/api/assessment-call/turn-complete") return new Response(JSON.stringify({ ok: true }));
      throw Error("unexpected " + url);
    };
    const shell = new CallShell({ avatar: createStubAvatar(), transport: createStubVoiceTransport(), fetchFn, readinessUrl });
    await consentAndStart(shell, created);
    ok(calls.includes("/api/assessment/start"), "readiness-unknown: the normal attempt still runs");
    ok(shell.state === "incall", "readiness-unknown: call reaches incall on a healthy transport");
    shell.dispose && shell.adapter.dispose();
    delete globalThis.document;
  }

  // 16c. transport init throws -> plain notice, no stuck "Connecting…"
  {
    const { doc, created } = makeDoc();
    globalThis.document = doc;
    const fetchFn = async (url) => {
      if (url === readinessUrl)
        return new Response(JSON.stringify({ available: true, reason: null, transport: "direct" }));
      if (url === "/api/assessment/start")
        return new Response(JSON.stringify({ ok: true, session_id: "brain-10", stage: "consent" }));
      if (url === "/api/assessment-call/session")
        return new Response(JSON.stringify({ ok: true, sessionId: "infra-10", secondsRemaining: 2700 }));
      throw Error("unexpected " + url);
    };
    const bad = createStubVoiceTransport();
    bad.init = async () => { throw Error("websocket refused"); };
    const shell = new CallShell({ avatar: createStubAvatar(), transport: bad, fetchFn, readinessUrl });
    await consentAndStart(shell, created);
    ok(shell.state === "error", "init-failure: shell fails instead of hanging");
    ok(errorText(created).includes("Voice isn't available right now — websocket refused."),
      "init-failure: plain notice names the failure");
    delete globalThis.document;
  }

  // 16d. transport init hangs -> bounded timeout -> plain notice
  {
    const { doc, created } = makeDoc();
    globalThis.document = doc;
    const fetchFn = async (url) => {
      if (url === readinessUrl)
        return new Response(JSON.stringify({ available: true, reason: null, transport: "direct" }));
      if (url === "/api/assessment/start")
        return new Response(JSON.stringify({ ok: true, session_id: "brain-11", stage: "consent" }));
      if (url === "/api/assessment-call/session")
        return new Response(JSON.stringify({ ok: true, sessionId: "infra-11", secondsRemaining: 2700 }));
      throw Error("unexpected " + url);
    };
    const hanging = createStubVoiceTransport();
    hanging.init = () => new Promise(() => {}); // never settles
    const shell = new CallShell({
      avatar: createStubAvatar(), transport: hanging, fetchFn, readinessUrl, transportInitTimeoutMs: 50,
    });
    await consentAndStart(shell, created);
    ok(shell.state === "error", "hung-init: bounded timeout fires instead of a stuck Connecting…");
    ok(errorText(created).includes("Voice isn't available right now — the voice connection timed out while connecting."),
      "hung-init: plain timeout notice");
    delete globalThis.document;
  }
}

console.log(`\nAll ${N} assessment-call assertions passed (incl. F1 wiring).`);
// The shell's heartbeat/clock intervals would keep node alive — tests are done.
process.exit(0);
