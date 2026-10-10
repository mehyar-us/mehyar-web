// assessment-call/chat.js — chat-first on-ramp for the Mayor assessment call.
//
// The Mayor's order: the assessment experience opens as a CHAT WINDOW with
// The Mayor, who then assesses the visitor ON THE PHONE (in-browser WebRTC
// voice call). The chat is the on-ramp, not a separate product.
//
// Flow:
//   1. Chat window: Mayor greets "Hi, I'm the mayor." (exact — never mentions AI)
//   2. Consent card (recording/transcription + 18+, unchecked by default)
//   3. POST /api/assessment/start → brain session (existing API, untouched)
//   4. Text turns via POST /api/assessment/turn (existing brain, untouched)
//      — brief qualification: business type, name, URL (brain-driven DISCOVERY)
//   5. Handoff: "Let's talk it through — calling you now." → incoming-call UI
//   6. Answer → onHandoff({ brainSessionId }) → parent starts the voice call
//      on the SAME brain session (CallShell.startVoiceCall)
//
// Rules honored: no fabricated claims, consent gate before recording, no raw
// audio persisted (voice path untouched), no AI disclosure (standing rule).

const GREETING = "Hi, I'm the mayor.";
const HANDOFF_LINE = "Let's talk it through — calling you now.";
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// Handoff after this many user text turns even if the brain wants more.
const DEFAULT_MAX_TEXT_TURNS = 4;
// Brain stages past which text chat hands off to voice.
const HANDOFF_STAGES = new Set(["diagnosis", "pitch", "depth", "wrap"]);
// Native incoming-call alert: vibration pattern + looped ringtone (HTMLAudio).
// The vibrate() pattern plays once per call, so it is re-triggered on a timer
// while the call screen is up. iOS Safari has no vibration API — guarded.
const RING_VIBE_PATTERN = [1000, 500, 1000, 500];
const RING_VIBE_REPEAT_MS = 4000;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function svgPhone() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "currentColor");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute(
    "d",
    "M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.4 11.4 0 003.57.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.57 1 1 0 01-.25 1.02l-2.2 2.2z"
  );
  s.appendChild(p);
  return s;
}

function svgSend() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "currentColor");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "M3.4 20.4l17.4-8.4L3.4 3.6l-.01 6.53L14 12 3.39 13.87l.01 6.53z");
  s.appendChild(p);
  return s;
}

export class ChatOnramp {
  constructor({
    fetchFn = (...args) => fetch(...args),
    avatarSrc = "./mayor-avatar.png",
    ringtoneSrc = "./ringtone.mp3",
    maxTextTurns = DEFAULT_MAX_TEXT_TURNS,
    onHandoff = null,
  } = {}) {
    this.fetchFn = fetchFn;
    this.avatarSrc = avatarSrc;
    this.ringtoneSrc = ringtoneSrc;
    this.maxTextTurns = maxTextTurns;
    this.onHandoff = onHandoff;
    this.state = "idle"; // idle → greeting → consent → chatting → handoff → calling → ended
    this.events = [];
    this.brainSessionId = null;
    this.userTurns = 0;
    this.emailCaptured = false;
    this.consentGiven = false;
    this.ringAudio = null;
    this.ringVibeTimer = null;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  mount(container) {
    this.root = container;
    this.root.classList.add("chat-page");
    this.render();
    this.state = "greeting";
    // Beat 1: the greeting. Beat 2 (consent card) follows after a short pause
    // so it reads as a conversation, not a form.
    this.addMessage("mayor", GREETING);
    this.emit("greeting");
    setTimeout(() => {
      if (this.state !== "greeting") return;
      this.renderConsentCard();
    }, 900);
  }

  // ── rendering ──────────────────────────────────────────────

  render() {
    this.root.innerHTML = "";
    const wrap = el("div");
    wrap.id = "chat-root";

    // Header
    const header = el("header", "chat-header");
    const avatar = el("img", "chat-avatar");
    avatar.src = this.avatarSrc;
    avatar.alt = "The Mayor";
    header.appendChild(avatar);
    const htext = el("div", "chat-header-text");
    htext.appendChild(el("p", "chat-header-name", "The Mayor"));
    const status = el("div", "chat-header-status");
    status.appendChild(el("span", "chat-online-dot"));
    status.appendChild(el("span", "", "Online — replies instantly"));
    htext.appendChild(status);
    header.appendChild(htext);
    wrap.appendChild(header);

    // Messages
    this.messagesEl = el("div", "chat-messages");
    this.messagesEl.setAttribute("role", "log");
    this.messagesEl.setAttribute("aria-live", "polite");
    this.messagesEl.setAttribute("aria-label", "Chat with the Mayor");
    wrap.appendChild(this.messagesEl);

    // Input bar
    const bar = el("div", "chat-input-bar");
    this.inputEl = el("input", "chat-input");
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Agree above to start chatting…";
    this.inputEl.disabled = true;
    this.inputEl.setAttribute("aria-label", "Type your message");
    this.inputEl.autocomplete = "off";
    this.sendBtn = el("button", "chat-send");
    this.sendBtn.type = "button";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.disabled = true;
    this.sendBtn.appendChild(svgSend());
    const submit = () => this.submitInput();
    this.sendBtn.addEventListener("click", submit);
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    bar.appendChild(this.inputEl);
    bar.appendChild(this.sendBtn);
    wrap.appendChild(bar);

    // Legal footer
    const legal = el("div", "chat-legal");
    legal.appendChild(el("span", "", "Mehyar Soft LLC · "));
    const links = [
      ["Privacy", "https://mehyar.us/privacy-policy/"],
      ["Terms", "https://mehyar.us/terms/"],
      ["Data Deletion", "https://mehyar.us/data-deletion/"],
    ];
    links.forEach(([t, href], i) => {
      if (i) legal.appendChild(document.createTextNode(" · "));
      const a = el("a", "", t);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      legal.appendChild(a);
    });
    wrap.appendChild(legal);

    this.root.appendChild(wrap);
  }

  scrollDown() {
    if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  addMessage(role, text) {
    const row = el("div", `chat-row ${role}`);
    if (role === "mayor") {
      const avatar = el("img", "chat-avatar");
      avatar.src = this.avatarSrc;
      avatar.alt = "";
      row.appendChild(avatar);
    }
    row.appendChild(el("div", "chat-bubble", text));
    this.messagesEl.appendChild(row);
    this.scrollDown();
    this.emit("message", { role, text });
    return row;
  }

  showTyping() {
    const row = el("div", "chat-row mayor");
    const avatar = el("img", "chat-avatar");
    avatar.src = this.avatarSrc;
    avatar.alt = "";
    row.appendChild(avatar);
    const bubble = el("div", "chat-bubble chat-typing");
    bubble.setAttribute("aria-label", "The Mayor is typing");
    for (let i = 0; i < 3; i++) bubble.appendChild(el("span"));
    row.appendChild(bubble);
    this.messagesEl.appendChild(row);
    this.scrollDown();
    return row;
  }

  hideTyping(row) {
    if (row && row.parentNode) row.parentNode.removeChild(row);
  }

  enableInput(placeholder) {
    this.inputEl.disabled = false;
    this.sendBtn.disabled = false;
    if (placeholder) this.inputEl.placeholder = placeholder;
    this.inputEl.focus({ preventScroll: true });
  }

  disableInput(placeholder) {
    this.inputEl.disabled = true;
    this.sendBtn.disabled = true;
    if (placeholder) this.inputEl.placeholder = placeholder;
  }

  // ── consent ────────────────────────────────────────────────

  renderConsentCard() {
    this.state = "consent";
    const row = el("div", "chat-row mayor");
    const avatar = el("img", "chat-avatar");
    avatar.src = this.avatarSrc;
    avatar.alt = "";
    row.appendChild(avatar);
    const card = el("div", "chat-consent-card");
    card.appendChild(
      el(
        "p",
        "",
        "Quick heads-up before we start: our chat and the call are recorded and transcribed so I can build your assessment. Nothing is shared, and you can delete everything at any time."
      )
    );
    const mk = (label) => {
      const rowEl = el("label", "chat-consent-row");
      const box = el("input");
      box.type = "checkbox";
      rowEl.appendChild(box);
      rowEl.appendChild(el("span", "", label));
      card.appendChild(rowEl);
      return box;
    };
    const consentBox = mk("I agree this chat and the call are recorded and transcribed.");
    const adultBox = mk("I am 18 years or older.");
    const err = el("p", "chat-consent-error", "Please check both boxes to continue.");
    card.appendChild(err);
    const btn = el("button", "chat-btn", "Sounds good — let's go");
    btn.type = "button";
    btn.setAttribute("data-analytics-cta", "assessment-chat-consent");
    btn.addEventListener("click", async () => {
      if (!consentBox.checked || !adultBox.checked) {
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      btn.disabled = true;
      this.consentGiven = true;
      this.emit("consent");
      // Replace the card with a confirmation bubble, then start the brain.
      row.innerHTML = "";
      const avatar2 = el("img", "chat-avatar");
      avatar2.src = this.avatarSrc;
      avatar2.alt = "";
      row.appendChild(avatar2);
      row.appendChild(el("div", "chat-bubble", "Perfect. Give me one second…"));
      this.scrollDown();
      await this.startBrain();
    });
    card.appendChild(btn);
    row.appendChild(card);
    this.messagesEl.appendChild(row);
    this.scrollDown();
  }

  // ── brain ──────────────────────────────────────────────────

  async api(path, body) {
    const res = await this.fetchFn(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = Error(data.message || data.error || `request_failed_${res.status}`);
      err.status = res.status;
      err.code = data.error;
      throw err;
    }
    return data;
  }

  async startBrain() {
    this.state = "starting";
    const typing = this.showTyping();
    try {
      const start = await this.api("/api/assessment/start", {});
      this.brainSessionId = start.session_id;
      this.emit("brain_started", { sessionId: this.brainSessionId });
      // Move past the CONSENT stage: the visitor already consented via the
      // card above, so confirm in the brain's own consent gate.
      const first = await this.api("/api/assessment/turn", {
        session_id: this.brainSessionId,
        user_text: "Yes, I agree.",
      });
      this.hideTyping(typing);
      this.state = "chatting";
      this.enableInput("Type your message…");
      this.handleTurn(first);
    } catch (e) {
      this.hideTyping(typing);
      this.addMessage(
        "mayor",
        e.code === "rate_limited"
          ? "Looks like we've hit today's limit from this connection — try again tomorrow and we'll pick it right up."
          : "Hmm, I'm having trouble starting on my end. Tap below to try again."
      );
      this.renderRetry(() => this.startBrain());
      this.emit("error", { message: e.message });
    }
  }

  renderRetry(fn) {
    const row = el("div", "chat-row mayor");
    const btn = el("button", "chat-btn", "Try again");
    btn.type = "button";
    btn.addEventListener("click", () => {
      row.parentNode && row.parentNode.removeChild(row);
      fn();
    });
    row.appendChild(btn);
    this.messagesEl.appendChild(row);
    this.scrollDown();
  }

  async submitInput() {
    const text = this.inputEl.value.trim();
    if (!text || this.state !== "chatting") return;
    this.inputEl.value = "";
    this.addMessage("user", text);
    this.userTurns++;
    // Client-side email detection (the brain does the same server-side).
    const emailM = text.match(EMAIL_RE);
    if (emailM && !this.emailCaptured) {
      this.emailCaptured = true;
      this.emit("email_captured", { email: emailM[0].toLowerCase() });
    }
    const typing = this.showTyping();
    this.disableInput();
    try {
      const data = await this.api("/api/assessment/turn", {
        session_id: this.brainSessionId,
        user_text: text.slice(0, 2000),
      });
      this.hideTyping(typing);
      this.handleTurn(data);
    } catch (e) {
      this.hideTyping(typing);
      this.addMessage("mayor", "Lost you for a second there — mind saying that again?");
      this.emit("error", { message: e.message });
    } finally {
      if (this.state === "chatting") this.enableInput("Type your message…");
    }
  }

  handleTurn(data) {
    const replyText = (data.reply_text || "").trim();
    const actions = data.actions || [];
    const stage = data.stage || "";

    // Honor brain actions first.
    for (const a of actions) {
      if (a.type === "endCall") {
        if (replyText) this.addMessage("mayor", replyText);
        this.endChat("The Mayor has left the chat. Come back anytime for your free assessment.");
        return;
      }
      if (a.type === "captureEmail" && !this.emailCaptured) {
        if (replyText) this.addMessage("mayor", replyText);
        this.renderEmailCapture();
        return;
      }
      if (a.type === "bookAudit" && a.booking_url) {
        if (replyText) this.addMessage("mayor", replyText);
        this.addMessage("mayor", `Here's your audit checkout: ${a.booking_url}`);
      }
    }
    if (replyText) this.addMessage("mayor", replyText);

    // Handoff decision: email captured, enough turns, or brain moved past discovery.
    if (this.shouldHandoff(stage)) {
      this.beginHandoff();
    }
  }

  shouldHandoff(stage) {
    if (this.state !== "chatting") return false;
    if (HANDOFF_STAGES.has(stage)) return true;
    if (this.userTurns >= this.maxTextTurns) return true;
    return false;
  }

  renderEmailCapture() {
    const row = el("div", "chat-row mayor");
    const avatar = el("img", "chat-avatar");
    avatar.src = this.avatarSrc;
    avatar.alt = "";
    row.appendChild(avatar);
    const bubble = el("div", "chat-bubble");
    bubble.appendChild(el("div", "", "Where should I send your assessment?"));
    const erow = el("div", "chat-email-row");
    const input = el("input", "chat-input");
    input.type = "email";
    input.placeholder = "you@business.com";
    input.setAttribute("aria-label", "Email for your assessment");
    input.autocomplete = "email";
    const btn = el("button", "chat-send");
    btn.type = "button";
    btn.setAttribute("aria-label", "Submit email");
    btn.appendChild(svgSend());
    const submit = () => {
      const v = input.value.trim();
      const m = v.match(EMAIL_RE);
      if (!m) {
        input.focus();
        input.style.borderColor = "#b3261e";
        return;
      }
      this.emailCaptured = true;
      this.emit("email_captured", { email: m[0].toLowerCase() });
      this.addMessage("user", m[0].toLowerCase());
      row.parentNode && row.parentNode.removeChild(row);
      // Feed it to the brain as a turn so the session has the email.
      this.brainSay(`My email is ${m[0].toLowerCase()}`);
    };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    erow.appendChild(input);
    erow.appendChild(btn);
    bubble.appendChild(erow);
    row.appendChild(bubble);
    this.messagesEl.appendChild(row);
    this.scrollDown();
    input.focus({ preventScroll: true });
  }

  async brainSay(text) {
    const typing = this.showTyping();
    this.disableInput();
    try {
      const data = await this.api("/api/assessment/turn", {
        session_id: this.brainSessionId,
        user_text: text,
      });
      this.hideTyping(typing);
      this.handleTurn(data);
    } catch (e) {
      this.hideTyping(typing);
      this.addMessage("mayor", "Got it — let's keep going.");
      this.emit("error", { message: e.message });
    } finally {
      if (this.state === "chatting") this.enableInput("Type your message…");
    }
  }

  // ── handoff: chat → voice call ─────────────────────────────

  beginHandoff() {
    this.state = "handoff";
    this.disableInput("Starting your call…");
    this.addMessage("mayor", HANDOFF_LINE);
    this.emit("handoff_started");
    setTimeout(() => {
      if (this.state !== "handoff") return;
      this.renderIncomingCall();
    }, 1200);
  }

  renderIncomingCall() {
    this.state = "incoming";
    this.root.innerHTML = "";
    const wrap = el("div");
    wrap.id = "chat-root";
    const ho = el("div", "chat-handoff");
    ho.setAttribute("role", "alertdialog");
    ho.setAttribute("aria-label", "Incoming call from the Mayor");

    const ring = el("div", "chat-handoff-ring");
    const avatar = el("img", "chat-handoff-avatar");
    avatar.src = this.avatarSrc;
    avatar.alt = "The Mayor";
    ring.appendChild(avatar);
    ho.appendChild(ring);

    ho.appendChild(el("p", "chat-handoff-title", "The Mayor is calling…"));
    ho.appendChild(
      el(
        "p",
        "chat-handoff-sub",
        "Your voice assessment is ready. Answer and we'll talk through your business live — 45 minutes, free, recorded with your consent."
      )
    );

    const actions = el("div", "chat-handoff-actions");
    const decline = el("button", "chat-decline-btn");
    decline.type = "button";
    decline.setAttribute("aria-label", "Decline call, keep chatting");
    const dSvg = svgPhone();
    dSvg.style.transform = "rotate(135deg)";
    decline.appendChild(dSvg);
    decline.addEventListener("click", () => {
      this.stopRinger();
      this.emit("handoff_declined");
      // Back to chat — the brain session is still alive.
      this.render();
      this.state = "chatting";
      this.addMessage("mayor", "No problem — we can keep chatting here. What's on your mind?");
      this.enableInput("Type your message…");
    });
    const answer = el("button", "chat-answer-btn");
    answer.type = "button";
    answer.setAttribute("aria-label", "Answer the call");
    answer.setAttribute("data-analytics-cta", "assessment-call-answer");
    answer.appendChild(svgPhone());
    answer.addEventListener("click", async () => {
      answer.disabled = true;
      await this.answerCall();
    });
    // Decline on the left, answer on the right (phone convention).
    actions.appendChild(decline);
    actions.appendChild(answer);
    ho.appendChild(actions);
    wrap.appendChild(ho);
    this.root.appendChild(wrap);
    this.emit("incoming_call_shown");
    this.startRinger();
  }

  // ── incoming-call ringer: native vibration + HTMLAudio ringtone ──

  startRinger() {
    this.stopRinger(); // idempotent — never double-ring on re-render
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(RING_VIBE_PATTERN);
        this.ringVibeTimer = setInterval(() => {
          try {
            navigator.vibrate(RING_VIBE_PATTERN);
          } catch {
            /* vibration failed mid-ring — ringtone continues */
          }
        }, RING_VIBE_REPEAT_MS);
        if (this.ringVibeTimer && typeof this.ringVibeTimer.unref === "function") {
          this.ringVibeTimer.unref(); // node test env: don't hold the process open
        }
      }
    } catch {
      /* no vibration API (e.g. iOS Safari) — ringtone still plays */
    }
    try {
      if (typeof Audio !== "undefined" && this.ringtoneSrc) {
        const audio = new Audio(this.ringtoneSrc);
        audio.loop = true;
        audio.preload = "auto";
        this.ringAudio = audio;
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            // Autoplay blocked (no recent user gesture): retry on the
            // visitor's next tap — answer/decline are right there.
            const retry = () => {
              if (typeof document !== "undefined") document.removeEventListener("pointerdown", retry);
              if (this.ringAudio === audio) audio.play().catch(() => {});
            };
            if (typeof document !== "undefined") document.addEventListener("pointerdown", retry);
          });
        }
      }
    } catch {
      /* audio unavailable — vibration still ran */
    }
  }

  stopRinger() {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(0); // cancel any in-progress vibration
      }
    } catch {
      /* noop */
    }
    if (this.ringVibeTimer) {
      clearInterval(this.ringVibeTimer);
      this.ringVibeTimer = null;
    }
    if (this.ringAudio) {
      const a = this.ringAudio;
      this.ringAudio = null;
      try {
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch {
        /* noop */
      }
    }
  }

  async answerCall() {
    this.state = "calling";
    this.stopRinger();
    this.emit("call_answered");
    try {
      if (typeof this.onHandoff === "function") {
        await this.onHandoff({
          brainSessionId: this.brainSessionId,
          consent: { consent: true, adult: true },
        });
      } else {
        throw Error("no_handoff_handler");
      }
    } catch (e) {
      this.state = "incoming";
      this.emit("error", { message: e.message });
      // Re-render the incoming UI with an error note.
      this.renderIncomingCall();
      const note = el("p", "chat-handoff-sub", "The call couldn't connect just now — tap answer to try again.");
      note.style.color = "#b3261e";
      this.root.querySelector(".chat-handoff").appendChild(note);
    }
  }

  endChat(note) {
    this.state = "ended";
    this.disableInput("Chat ended");
    if (note) this.addMessage("mayor", note);
    this.emit("ended");
  }
}
