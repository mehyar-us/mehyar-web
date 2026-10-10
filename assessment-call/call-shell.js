// assessment-call/call-shell.js — the assessment-call page shell (infra crew).
//
// OURS: recording-consent UI (checkboxes, unchecked by default), session
// lifecycle (start -> heartbeat 45-min cap -> end/delete), captions, legal
// footer. The voice team's transport owns mic/VAD/STT/TTS; the VoiceAdapter
// (voice-adapter.js) wires transport <-> brain (/api/assessment/turn) <-> avatar.
//
// Start flow:
//   1. Consent checkboxes -> POST /api/assessment/start (brain session; its
//      first reply_text is the spoken consent script)
//   2. POST /api/assessment-call/session { consent, adult, brainSessionId }
//      (infra session: rate limit, neuron guard, 45-min cap, latency log)
//   3. VoiceAdapter.startCall({ brainSessionId, callSessionId })

import { VoiceAdapter } from "./voice-adapter.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class CallShell {
  constructor({ avatar, transport, fetchFn = (...args) => fetch(...args) } = {}) {
    if (!avatar) throw Error("CallShell needs an avatar implementing the avatar API");
    if (!transport) throw Error("CallShell needs a voice transport implementing the transport contract");
    this.avatar = avatar;
    this.transport = transport;
    this.fetchFn = fetchFn;
    this.adapter = new VoiceAdapter({ transport, avatar, fetchFn });
    this.state = "idle";
    this.events = [];
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  mount(container) {
    this.root = container;
    this.renderConsent();
  }

  clear() {
    this.root.innerHTML = "";
  }

  legalFooter() {
    const f = el("div", "ac-legal");
    const links = [
      ["Privacy Policy", "https://mehyar.us/privacy-policy/"],
      ["Terms", "https://mehyar.us/terms/"],
      ["Data Deletion", "https://mehyar.us/data-deletion/"],
    ];
    links.forEach(([t, href], i) => {
      if (i) f.appendChild(document.createTextNode(" · "));
      const a = el("a", "", t);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      f.appendChild(a);
    });
    f.appendChild(el("div", "ac-biz", "Mehyar Soft LLC · info@mehyar.us"));
    return f;
  }

  renderConsent() {
    this.state = "consent";
    this.clear();
    const wrap = el("div", "ac-consent");
    wrap.appendChild(el("h2", "", "Free business assessment call"));
    wrap.appendChild(
      el(
        "p",
        "ac-notice",
        "This is a voice call with the Mayor. The call is recorded and transcribed " +
          "so we can build your business audit. The transcript is stored securely and you can " +
          "delete it at any time. This is a free assessment — no charge, no payment taken."
      )
    );
    const mk = (id, label) => {
      const row = el("label", "ac-check");
      const box = el("input");
      box.type = "checkbox";
      box.id = id;
      row.appendChild(box);
      row.appendChild(el("span", "", label));
      wrap.appendChild(row);
      return box;
    };
    const consentBox = mk("ac-consent-box", "I agree that this call is recorded and transcribed.");
    const adultBox = mk("ac-adult-box", "I am 18 years or older.");
    const err = el("p", "ac-error", "");
    err.style.display = "none";
    wrap.appendChild(err);
    const btn = el("button", "ac-start", "Start my free assessment");
    btn.type = "button";
    btn.setAttribute("data-analytics-cta", "assessment-call-start");
    btn.addEventListener("click", async () => {
      if (!consentBox.checked || !adultBox.checked) {
        err.textContent = "Please check both boxes to start the call.";
        err.style.display = "";
        return;
      }
      err.style.display = "none";
      btn.disabled = true;
      await this.startCall();
    });
    wrap.appendChild(btn);
    wrap.appendChild(this.legalFooter());
    this.root.appendChild(wrap);
  }

  renderCall() {
    this.clear();
    const wrap = el("div", "ac-call");
    const stage = el("div", "ac-stage");
    stage.setAttribute("data-avatar", "");
    wrap.appendChild(stage);
    this.avatar.mountAvatar(stage, { mode: "assessment" });
    this.statusLine = el("p", "ac-status", "Connecting…");
    wrap.appendChild(this.statusLine);
    this.clockLine = el("p", "ac-clock", "");
    wrap.appendChild(this.clockLine);
    this.captions = el("div", "ac-captions");
    this.captions.setAttribute("aria-live", "polite");
    wrap.appendChild(this.captions);
    const controls = el("div", "ac-controls");
    const endBtn = el("button", "ac-end", "End call");
    endBtn.type = "button";
    endBtn.addEventListener("click", () => this.endCall("user"));
    controls.appendChild(endBtn);
    wrap.appendChild(controls);
    wrap.appendChild(this.legalFooter());
    this.root.appendChild(wrap);
    // Surface adapter events as captions.
    const origEmit = this.adapter.emit.bind(this.adapter);
    this.adapter.emit = (type, data = {}) => {
      if (type === "reply" && data.replyText) this.caption("assistant", data.replyText);
      if (type === "thinking" && data.text) this.caption("user", data.text);
      origEmit(type, data);
      this.emit(type, data);
    };
  }

  renderEnded({ reason, turnCount }) {
    this.clear();
    const wrap = el("div", "ac-ended");
    wrap.appendChild(el("h2", "", reason === "limit" ? "Time's up — great call" : "Call ended"));
    wrap.appendChild(
      el("p", "", `Thanks for your time across ${turnCount || 0} turns. Your business audit is being prepared.`)
    );
    const del = el("button", "ac-delete", "Delete my transcript");
    del.type = "button";
    del.addEventListener("click", async () => {
      del.disabled = true;
      try {
        await this.fetchFn("/api/assessment-call/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: this.callSessionId }),
        });
        wrap.appendChild(el("p", "", "Your transcript has been deleted."));
      } catch {
        wrap.appendChild(el("p", "ac-error", "Couldn't delete just now — email info@mehyar.us and we'll remove it."));
      }
    });
    wrap.appendChild(del);
    wrap.appendChild(this.legalFooter());
    this.root.appendChild(wrap);
  }

  setStatus(t) {
    if (this.statusLine) this.statusLine.textContent = t;
  }

  caption(role, text) {
    if (!this.captions) return;
    const p = el("p", `ac-cap-${role}`, `${role === "user" ? "You" : "Mayor"}: ${text}`);
    this.captions.appendChild(p);
    this.captions.scrollTop = this.captions.scrollHeight;
  }

  async api(path, body) {
    const res = await this.fetchFn(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.message || data.error || `request_failed_${res.status}`);
    return data;
  }

  async startCall() {
    this.state = "starting";
    this.emit("start");
    try {
      // 1) Brain session (its first reply_text is the spoken consent script).
      const start = await this.api("/api/assessment/start", {});
      this.brainSessionId = start.session_id;
      // 2) Infra session + voice wiring (shared with the chat on-ramp).
      await this.beginVoiceSession();
      // Speak the consent script as the first turn (goes through the same
      // latency-logged path as every reply).
      if (start.reply_text) {
        this.caption("assistant", start.reply_text);
        await this.adapter.speak(start.reply_text, { userText: "(call started)", sttMs: 0, tttMs: 0 });
      }
      this.setStatus("You're live — speak naturally.");
      this.state = "incall";
    } catch (e) {
      this.fail(e.message);
    }
  }

  /**
   * startVoiceCall — entry point for the chat on-ramp handoff.
   * The chat already collected consent and created the brain session, so this
   * skips the consent screen, the brain start, and the spoken consent script,
   * then runs the identical voice-session tail as startCall().
   */
  async startVoiceCall({ brainSessionId } = {}) {
    if (!brainSessionId) throw Error("startVoiceCall needs brainSessionId");
    this.brainSessionId = brainSessionId;
    this.state = "starting";
    this.emit("start");
    try {
      await this.beginVoiceSession();
      this.setStatus("You're live — speak naturally.");
      this.state = "incall";
    } catch (e) {
      this.fail(e.message);
    }
  }

  /** Shared tail: infra session → render → wire transport → heartbeat/clock. */
  async beginVoiceSession() {
    // 2) Infra session (consent gate, rate limit, 45-min cap, latency log).
    const s = await this.api("/api/assessment-call/session", {
      consent: true,
      adult: true,
      brainSessionId: this.brainSessionId,
    });
    this.callSessionId = s.sessionId;
    this.secondsRemaining = s.secondsRemaining;
    this.renderCall();
    this.setStatus("Connecting…");
    // 3) Wire the voice transport.
    await this.adapter.startCall({ brainSessionId: this.brainSessionId, callSessionId: this.callSessionId });
    this.startHeartbeat();
    this.startClock();
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        const data = await this.api("/api/assessment-call/heartbeat", { sessionId: this.callSessionId });
        if (!data.ok || data.secondsRemaining <= 0) {
          await this.endCall("limit");
          return;
        }
        this.secondsRemaining = data.secondsRemaining;
      } catch {
        this.emit("heartbeat_missed");
      }
    }, 30000);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  startClock() {
    this.stopClock();
    this.clockTimer = setInterval(() => {
      this.secondsRemaining = Math.max(0, (this.secondsRemaining || 0) - 1);
      if (this.clockLine) {
        const m = Math.floor(this.secondsRemaining / 60);
        const s = String(this.secondsRemaining % 60).padStart(2, "0");
        this.clockLine.textContent = `${m}:${s} remaining`;
      }
      if (this.secondsRemaining <= 0) this.endCall("limit");
    }, 1000);
  }
  stopClock() {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
  }

  async endCall(reason) {
    if (this.state === "ended") return;
    this.state = "ended";
    this.stopHeartbeat();
    this.stopClock();
    let turnCount = 0;
    try {
      turnCount = this.adapter.events.filter((e) => e.type === "spoken").length;
      await this.adapter.endCall(reason);
    } catch {}
    this.renderEnded({ reason, turnCount });
  }

  fail(message) {
    this.state = "error";
    this.stopHeartbeat();
    this.stopClock();
    this.clear();
    const wrap = el("div", "ac-ended");
    wrap.appendChild(el("h2", "", "Call couldn't start"));
    wrap.appendChild(el("p", "ac-error", message));
    const retry = el("button", "ac-start", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => this.renderConsent());
    wrap.appendChild(retry);
    wrap.appendChild(this.legalFooter());
    this.root.appendChild(wrap);
  }
}
