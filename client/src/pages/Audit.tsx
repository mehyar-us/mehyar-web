import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Video,
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import BusinessReportView from "@/components/BusinessReportView";
import MayorBait from "@/components/MayorBait";
import { trackBeginCheckout } from "@/components/MarketingTags";

/* ── API contract (matches functions/api/audit/business/*, commit 8cbc372) ──
   POST /api/audit/business/intake   { business_name, url, email }
     → { ok, audit_id (UUID), signals: { url, https, load_ms, title,
         has_meta_description, h1, word_count, page_weight_kb, has_phone,
         has_contact_path, form_count, cta_count, has_viewport, socials[],
         pixels[], trust[], has_schema }, message?, error? }
       Errors: invalid_email, invalid_url (400); fetch_failed (422);
       rate_limited (429 — 10/day/IP).
   POST /api/audit/business/upload   multipart: audit_id, video (MP4 ≤ 30 min),
     audio? (16kHz mono 16-bit WAV)
     → { ok, audit_id, video_key, duration_s, bytes, audio_stored,
         audio_truncated, message?, error? }
       Errors: missing_video, invalid_audit_id (400); too_large (413);
       unknown_audit (404); audit_locked (409); rate_limited (429).
   GET  /api/audit/business/report?token=<64-hex minted at checkout>
     → { ok, status: "generating"|"ready"|"failed", audit_id, url,
         business_name, created_at, paid_at, failure_reason, buyer_message,
         report?: { score, grade, executive_summary, money_leaks[], flaws[],
           suggestions[], ai_opportunities[], prioritized_fixes[],
           video_section, one_thing, coverage_note, methodology, ... } }
   POST /api/pay/checkout            { product_id: "audit-my-business", email,
     success_url (server APPENDS ?token=<64-hex> — never put a token here),
     cancel_url, params: { audit_id } }
     → { ok, payment_id, token, checkout_url } | { ok, already_ready, token }
       Errors: audit_email_mismatch (email must match intake email),
       unknown_audit (400), audit_not_payable (already paid). */

const DEMO_VIDEO_SRC = "/assets/audit/ceo-walkthrough-demo.mp4";
const MAX_VIDEO_SECONDS = 1800; // 30 minutes — enforced client-side before upload

type PreviewSignal = { label: string; value: string; good?: boolean | null };
type IntakeResult = {
  auditId: string;
  signals: PreviewSignal[];
  /** True when the site is a JS app shell: content rows show "couldn't be assessed". */
  contentUnmeasured: boolean;
};

/** URL-first intake: what /api/audit/business/peek reads off the site itself. */
type PeekResult = {
  identity: {
    name: string;
    name_source: string | null;
    title: string;
    tagline: string;
    favicon: string | null;
    og_image: string | null;
    theme_color: string | null;
    emails: string[];
    phones: string[];
    url: string;
  };
  found: {
    https: boolean;
    load_ms: number;
    has_phone: boolean;
    has_contact_path: boolean;
    has_schema: boolean;
    socials: string[];
    content_unmeasured: boolean;
  };
};

function joinList(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return "None found";
  return v.map(String).filter(Boolean).join(", ") || "None found";
}

/** Map the real intake `signals` (snake_case) into honest preview rows.
    Only what the server-side fetch measured — no AI claims. */
function mapIntakeSignals(s: Record<string, any>): PreviewSignal[] {
  const rows: PreviewSignal[] = [];
  const push = (label: string, value: string, good?: boolean | null) => rows.push({ label, value, good });
  /* When the site is a JS app shell, content-dependent signals couldn't be
     measured from the initial HTML — disclose honestly instead of the 0s. */
  const unmeasured = !!s.content_unmeasured;
  const na = "In your $330 audit";
  push("Page title", s.title ? String(s.title) : "No title found", s.title ? true : false);
  push("HTTPS", s.https ? "On" : "Off", !!s.https);
  push("Load time", typeof s.load_ms === "number" ? `${s.load_ms} ms` : "—", null);
  push("H1 heading", unmeasured ? na : (s.h1 ? String(s.h1) : "None found"), unmeasured ? null : (s.h1 ? true : false));
  push("Meta description", s.has_meta_description ? "Present" : "Missing", !!s.has_meta_description);
  push("Words on page", unmeasured ? na : (typeof s.word_count === "number" ? s.word_count.toLocaleString() : "—"), null);
  push("Page weight", typeof s.page_weight_kb === "number" ? `${s.page_weight_kb} KB` : "—", null);
  push("Phone number found", unmeasured ? na : (s.has_phone ? "Yes" : "No"), unmeasured ? null : !!s.has_phone);
  push("Contact path", s.has_contact_path ? "Yes" : (unmeasured ? na : "None found"), s.has_contact_path ? true : null);
  push("Forms / CTAs", unmeasured ? na : `${s.form_count ?? "—"} / ${s.cta_count ?? "—"}`, null);
  push("Mobile viewport", s.has_viewport ? "Yes" : "No", !!s.has_viewport);
  push("Trust signals", joinList(s.trust), Array.isArray(s.trust) && s.trust.length > 0 ? true : null);
  push("Tracking pixels", joinList(s.pixels), null);
  push("Social profiles", joinList(s.socials), null);
  push("Schema markup", s.has_schema ? "Present" : "None found", s.has_schema ? true : null);
  return rows;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeUrl(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Client-side 30-minute enforcement: read the MP4's duration metadata in a
    hidden <video> element and reject anything over 1800s BEFORE uploading. */
function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const d = v.duration;
      URL.revokeObjectURL(objectUrl);
      if (!isFinite(d) || d <= 0) reject(new Error("Could not read this video's length."));
      else resolve(d);
    };
    v.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read this video's metadata — is it a valid MP4?"));
    };
    v.src = objectUrl;
  });
}

/* ── Client-side audio extraction for the transcription pipeline ──────────
   The worker can't decode AAC, so the page extracts the audio track:
   file bytes -> AudioContext -> decodeAudioData -> downmix to mono ->
   resample to 16kHz -> 16-bit PCM WAV, uploaded as the `audio` part of the
   /api/audit/business/upload multipart body (alongside `video` + audit_id).
   30 min at 16kHz mono 16-bit ≈ 57MB, under the server's 64MB audio cap.
   Anything failing here is NON-FATAL: the upload proceeds video-only and
   the report honestly marks the transcript "couldn't be assessed". */
const TARGET_SAMPLE_RATE = 16000;

function writeAscii(dv: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
}

/** 44-byte-header 16-bit mono PCM WAV at 16kHz — exactly what the server's
    parseWav() validates before Whisper transcription. */
function encodeWav16kMono(samples: Float32Array): Blob {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buffer);
  writeAscii(dv, 0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  writeAscii(dv, 8, "WAVE");
  writeAscii(dv, 12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, TARGET_SAMPLE_RATE, true);
  dv.setUint32(28, TARGET_SAMPLE_RATE * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  writeAscii(dv, 36, "data");
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function extractAudio16kMonoWav(file: File): Promise<Blob> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("This browser can't extract audio (no Web Audio support).");
  const bytes = await file.arrayBuffer();
  let ctx: AudioContext | null = null;
  try {
    try {
      ctx = new AC({ sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      ctx = new AC(); // manual resample below covers non-conforming browsers
    }
    // decodeAudioData detaches its input — work on a copy.
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    const chans = decoded.numberOfChannels;
    const first = decoded.getChannelData(0);
    let mono: Float32Array;
    if (chans === 1) {
      mono = first;
    } else {
      mono = new Float32Array(first.length);
      for (let c = 0; c < chans; c++) {
        const d = decoded.getChannelData(c);
        for (let i = 0; i < d.length; i++) mono[i] += d[i];
      }
      const inv = 1 / chans;
      for (let i = 0; i < mono.length; i++) mono[i] *= inv;
    }
    let out = mono;
    if (decoded.sampleRate !== TARGET_SAMPLE_RATE) {
      const ratio = decoded.sampleRate / TARGET_SAMPLE_RATE;
      const len = Math.max(1, Math.floor(mono.length / ratio));
      out = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(i0 + 1, mono.length - 1);
        const f = pos - i0;
        out[i] = mono[i0] * (1 - f) + mono[i1] * f;
      }
    }
    if (out.length < TARGET_SAMPLE_RATE) throw new Error("No audible audio track found in this video.");
    return encodeWav16kMono(out);
  } finally {
    try {
      await ctx?.close();
    } catch {
      /* already closed */
    }
  }
}

/* ── CEO demo video: example walkthrough wired to the deployed asset.
   The final mp4 + cover live at /assets/audit/ceo-walkthrough-demo.* — the
   video is portrait (720x1280), so it renders in a phone-style 9:16 frame. ── */
function DemoVideo() {
  return (
    <figure className="mt-6 rounded-2xl border border-border bg-card p-5">
      <p className="text-center text-sm font-semibold text-foreground">Watch an example walkthrough</p>
      <div className="mx-auto mt-4 w-full max-w-[300px]">
        <video
          controls
          playsInline
          preload="metadata"
          src={DEMO_VIDEO_SRC}
          poster="/assets/audit/ceo-walkthrough-demo-cover.jpg"
          className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
          aria-label="Example CEO walkthrough video"
        >
          <track kind="captions" />
        </video>
      </div>
      <figcaption className="mx-auto mt-4 max-w-md text-center text-xs leading-5 text-muted-foreground">
        An example CEO walkthrough — the kind of video that unlocks the deep-dive
        section of your report. Phone footage is fine; just talk us through your business.
      </figcaption>
    </figure>
  );
}

function StepShell({
  step,
  title,
  children,
  id,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section id={id} aria-label={`${step}: ${title}`} className="scroll-mt-24 px-4 py-12 md:py-16">
      <div className="site-shell max-w-3xl">
        <p className="site-eyebrow">{step}</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-h-14 items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {q}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && <div className="px-5 pb-5 text-sm leading-6 text-muted-foreground">{children}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */
export default function Audit() {
  const token = new URLSearchParams(window.location.search).get("token");

  /* ── Report view: same page when ?token= is present ── */
  if (token) {
    return (
      <section className="px-4 py-10 md:py-14">
        <div className="site-shell max-w-4xl">
          <BusinessReportView token={token} />
        </div>
      </section>
    );
  }

  /* ── Step 1: intake ── */
  const [businessName, setBusinessName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [intaking, setIntaking] = useState(false);
  const [intakeError, setIntakeError] = useState("");
  const [intake, setIntake] = useState<IntakeResult | null>(null);
  /* Direct-buy lane (rot542): ?buy=1 (or the hero skip link) lets a ready
     buyer pay from the landing — the Step 3 card collects business name +
     URL inline and checkout creates the intake row inside the payment. */
  const [directBuy, setDirectBuy] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).get("buy") === "1"; } catch { return false; }
  });
  /* URL-first Step 1: "url" → peek → "confirm" card; "manual" = classic form. */
  const [step1Phase, setStep1Phase] = useState<"url" | "confirm" | "manual">("url");
  const [peeking, setPeeking] = useState(false);
  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [peekNote, setPeekNote] = useState("");


  /* ── Step 2: video upload (optional) ── */
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [checkingVideo, setCheckingVideo] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [videoUploaded, setVideoUploaded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /* Audio-extraction state: the WAV for transcription, or a skip/failure
     that keeps the upload video-only (designed fallback). */
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioSeconds, setAudioSeconds] = useState<number | null>(null);
  const [extractingAudio, setExtractingAudio] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [audioSkipped, setAudioSkipped] = useState(false);
  const [audioWasStored, setAudioWasStored] = useState(false);
  const [audioWasTruncated, setAudioWasTruncated] = useState(false);
  const extractIdRef = useRef(0);

  /* ── Step 3: pay ── */
  const [payEmail, setPayEmail] = useState("");
  const [payEmailEditing, setPayEmailEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  /* True while live checkout is unavailable: show notify-me instead of letting
     the visitor bounce with nothing captured. */
  const [payBlocked, setPayBlocked] = useState(false);
  const [notifyState, setNotifyState] = useState<"idle" | "saving" | "saved">("idle");
  const [notifyMsg, setNotifyMsg] = useState("");
  /* Up-front availability probe: warn visitors at the top of step 3 and under
     the hero BEFORE they invest time in steps 1–2. Null = unknown (probe failed
     — stay quiet; the post-click blocked panel still catches it). */
  const [checkoutOpen, setCheckoutOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pay/availability", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCheckoutOpen(d && d.ok ? !!d.checkout_open : null); })
      .catch(() => { if (!cancelled) setCheckoutOpen(null); });
    return () => { cancelled = true; };
  }, []);

  /* $5 Full Report credit at the pay point: ask the server whether THIS
     buyer (Step 3 email == Step 1 email — the only population the credit
     can apply to) is eligible under the exact rule checkout enforces, and
     show the arithmetic only when they are. Figures come from the server
     (billing_products + credit), never computed here. Any failure leaves
     the standard pay display untouched. */
  const [creditInfo, setCreditInfo] = useState<{ eligible: boolean; credit_cents: number; list_cents: number; due_cents: number } | null>(null);
  useEffect(() => {
    const pay = payEmail.trim().toLowerCase();
    const step1 = email.trim().toLowerCase();
    /* Direct-buy (rot542): no Step 1 — the pay email IS the linked email,
       so the credit display keys off it alone. */
    const linked = intake ? pay === step1 : directBuy;
    if (!linked || !pay || !EMAIL_RE.test(pay)) {
      setCreditInfo(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch("/api/pay/credit-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: pay }),
      })
        .then((r) => r.json())
        .then((d) => { if (!cancelled && d && d.ok) setCreditInfo(d); })
        .catch(() => { /* display is informational; stay standard */ });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intake, payEmail, email, directBuy]);

  /* Blocked-checkout notify-me: the buyer already gave us their email in this
     step; clicking the button IS the explicit consent to one notification email
     when checkout reopens (compliance item 6). POSTs to /api/audit/pay-blocked. */
  const notifyWhenBack = async () => {
    if (notifyState !== "idle") return;
    if (!intake && !directBuy) return;
    setNotifyState("saving");
    setNotifyMsg("");
    try {
      const r = await fetch("/api/audit/pay-blocked", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(intake
          ? { email: payEmail.trim(), audit_id: intake.auditId }
          : { email: payEmail.trim(), direct: true, business_name: businessName.trim(), url: normalizeUrl(siteUrl) }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        if (!intake && data.audit_id) {
          /* Adopt the row the direct capture created: the buyer is now on
             the standard rails. Set the Step 1 email state to the same
             address so the pay-email linkage effect stays consistent. */
          setEmail(payEmail.trim());
          setIntake({ auditId: String(data.audit_id), signals: [], contentUnmeasured: true });
        }
        setNotifyState("saved");
      } else {
        setNotifyState("idle");
        setNotifyMsg(data.error === "rate_limited" ? "Too many tries — wait a bit and try again." : "Couldn't save that — try again in a bit.");
      }
    } catch {
      setNotifyState("idle");
      setNotifyMsg("Couldn't save that — check your connection and try again.");
    }
  };

  useEffect(() => {
    if (intake) {
      setPayEmail(email);
      setPayEmailEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intake]);

  /* Step zero of the URL-first flow: read the business off its own site.
     On any failure we fall back to the classic form — never a dead end. */
  const submitPeek = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntakeError("");
    setPeekNote("");
    const url = normalizeUrl(siteUrl);
    if (!url || !/^https?:\/\/[^/\s]+\.[^/\s]+/.test(url)) {
      return setIntakeError("That URL doesn't look right — try yourbusiness.com.");
    }
    setPeeking(true);
    try {
      const r = await fetch("/api/audit/business/peek", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await r.json().catch(() => ({}));
      if (!data.ok || !data.identity) throw new Error(data.message || "fetch_failed");
      setPeek(data as PeekResult);
      if (data.identity.name && !businessName.trim()) setBusinessName(String(data.identity.name));
      if (data.identity.url) setSiteUrl(String(data.identity.url));
      setStep1Phase("confirm");
    } catch {
      setPeekNote("We couldn't read that site automatically — no problem. Type your details here and we'll take it from there.");
      setStep1Phase("manual");
    } finally {
      setPeeking(false);
    }
  };

  const submitIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    await doIntake();
  };

  const doIntake = async () => {
    setIntakeError("");
    const url = normalizeUrl(siteUrl);
    if (!businessName.trim()) return setIntakeError("Please tell us your business name.");
    if (!url || !/^https?:\/\/[^/\s]+\.[^/\s]+/.test(url)) return setIntakeError("That URL doesn't look right — try yourbusiness.com.");
    if (!EMAIL_RE.test(email.trim())) return setIntakeError("Please enter a valid email so we can deliver your report.");
    setIntaking(true);
    try {
      const r = await fetch("/api/audit/business/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_name: businessName.trim(), url, email: email.trim() }),
      });
      if (r.status === 404) {
        throw new Error(
          "The intake service is still being connected — we're finishing the wiring on our side. Please check back shortly.",
        );
      }
      const data = await r.json();
      if (!data.ok || !data.audit_id) {
        const code = String(data.error || "");
        if (code === "fetch_failed") throw new Error(data.message || "We couldn't load that site. Check the URL and try again.");
        if (code === "rate_limited") throw new Error(data.message || "Too many previews — try again tomorrow.");
        if (code === "invalid_email") throw new Error("That email doesn't look valid — check it and try again.");
        if (code === "invalid_url") throw new Error("That URL doesn't look right — try yourbusiness.com.");
        throw new Error(data.message || code || "Couldn't start your audit.");
      }
      setIntake({
        auditId: String(data.audit_id),
        signals: mapIntakeSignals(data.signals || {}),
        contentUnmeasured: !!(data.signals || {}).content_unmeasured,
      });
      setVideoUploaded(false);
    } catch (err: any) {
      setIntakeError(err?.message || "Something went wrong starting your audit.");
    } finally {
      setIntaking(false);
    }
  };

  const onPickFile = async (file: File | undefined | null) => {
    setVideoError("");
    setUploadError("");
    if (!file) return;
    const isMp4 = file.type === "video/mp4" || /\.mp4$/i.test(file.name);
    if (!isMp4) {
      setVideoError("Please choose an MP4 video file.");
      return;
    }
    setCheckingVideo(true);
    try {
      const dur = await readVideoDuration(file);
      if (dur > MAX_VIDEO_SECONDS) {
        setVideoFile(null);
        setVideoDuration(null);
        setVideoError(
          `This video is ${formatClock(dur)} long — the limit is 30:00. Please trim it and try again.`,
        );
        return;
      }
      setVideoFile(file);
      setVideoDuration(dur);
      /* Kick off audio extraction for the transcription pipeline. Non-fatal:
         failures (or an explicit skip) fall back to a video-only upload. */
      const myId = ++extractIdRef.current;
      setAudioBlob(null);
      setAudioSeconds(null);
      setAudioError("");
      setAudioSkipped(false);
      setAudioWasStored(false);
      setExtractingAudio(true);
      extractAudio16kMonoWav(file)
        .then((blob) => {
          if (extractIdRef.current !== myId) return;
          setAudioBlob(blob);
          setAudioSeconds(Math.max(1, Math.round((blob.size - 44) / 2 / TARGET_SAMPLE_RATE)));
          setExtractingAudio(false);
        })
        .catch((err: unknown) => {
          if (extractIdRef.current !== myId) return;
          setExtractingAudio(false);
          setAudioError(err instanceof Error ? err.message : "Couldn't extract the audio from this video.");
        });
    } catch (err: unknown) {
      setVideoFile(null);
      setVideoDuration(null);
      setVideoError(err instanceof Error ? err.message : "Could not read this video.");
    } finally {
      setCheckingVideo(false);
    }
  };

  /** User skips audio extraction — the upload proceeds video-only (designed
      fallback; the report's transcript section says it couldn't be assessed). */
  const skipAudio = () => {
    extractIdRef.current++;
    setExtractingAudio(false);
    setAudioSkipped(true);
  };

  const uploadVideo = async () => {
    if (!videoFile || !intake) return;
    setUploadError("");
    setUploading(true);
    setUploadProgress(0);
    try {
      let audioStored = false;
      let audioTruncated = false;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/audit/business/upload");
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          let data: { ok?: boolean; duration_s?: number; audio_stored?: boolean; audio_truncated?: boolean; message?: string; error?: string } | null = null;
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            /* non-JSON response */
          }
          if (xhr.status === 404) return reject(new Error("The upload service is still being connected — please check back shortly."));
          if (xhr.status === 409) return reject(new Error(data?.message || "This audit is already being built."));
          if (xhr.status === 413) return reject(new Error(data?.message || "That video is too large."));
          if (xhr.status === 429) return reject(new Error(data?.message || "Too many uploads — try again later."));
          if (xhr.status >= 200 && xhr.status < 300 && data?.ok) {
            audioStored = data.audio_stored === true;
            audioTruncated = data.audio_truncated === true;
            return resolve();
          }
          reject(new Error(data?.message || data?.error || `Upload failed (status ${xhr.status}).`));
        };
        xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
        const form = new FormData();
        form.append("audit_id", intake.auditId);
        form.append("video", videoFile, videoFile.name);
        if (audioBlob) form.append("audio", audioBlob, "audio.wav");
        xhr.send(form);
      });
      setAudioWasStored(audioStored);
      setAudioWasTruncated(audioTruncated);
      setVideoUploaded(true);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  /* Upload is enabled once the audio question is settled: extracted, skipped,
     or failed-and-acknowledged (video-only fallback). */
  const audioSettled = !!audioBlob || audioSkipped || !!audioError;
  const canUpload = !!videoFile && !videoError && !checkingVideo && !extractingAudio && !uploading && audioSettled;

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError("");
    setPayBlocked(false);
    setNotifyState("idle");
    setNotifyMsg("");
    if (!intake && !directBuy) return setPayError("Complete step 1 first so we know which business to audit.");
    if (!intake && directBuy) {
      if (!businessName.trim()) return setPayError("Please tell us your business name.");
      const directUrl = normalizeUrl(siteUrl);
      if (!directUrl || !/^https?:\/\/[^/\s]+\.[^/\s]+/.test(directUrl)) return setPayError("That URL doesn't look right — try yourbusiness.com.");
    }
    if (!EMAIL_RE.test(payEmail.trim())) return setPayError("Please enter a valid email for delivery.");
    setPaying(true);
    /* Money-path event (rot509): fire before the POST/redirect, carrying
       the amount this buyer will actually be charged (325 when the $5
       Full Report credit applies, per the server's own credit-status). */
    trackBeginCheckout("audit-my-business", creditInfo?.eligible ? creditInfo.due_cents / 100 : 330);
    try {
      const r = await fetch("/api/pay/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: "audit-my-business",
          email: payEmail.trim(),
          /* The server mints the 64-hex report token at checkout and APPENDS
             ?token= to this URL. Never put a token here ourselves — a
             pre-existing ?token= would NOT be overwritten. Lands on THIS
             page (/audit/?token= renders BusinessReportView under the
             Audit My Business title) — never /audit/report, which is the
             $5 Full Report's page and title. */
          success_url: "https://mehyar.us/audit",
          cancel_url: "https://mehyar.us/audit/",
          params: intake
            ? { audit_id: intake.auditId }
            : { direct: true, business_name: businessName.trim(), url: normalizeUrl(siteUrl) },
        }),
      });
      const data = await r.json();
      if (data.already_ready && data.token) {
        window.location.href = `/audit?token=${encodeURIComponent(data.token)}`;
        return;
      }
      if (!data.ok) {
        const code = String(data.error || "");
        if (code === "audit_email_mismatch") {
          throw new Error("That email doesn't match the email you entered in Step 1 — use the same email so we can link your audit.");
        }
        if (code === "audit_not_payable") {
          throw new Error("This audit was already paid for — check your email for the report link.");
        }
        if (code === "unknown_audit") {
          throw new Error("We couldn't find your intake — go back to Step 1 and re-enter your URL.");
        }
        if (code === "invalid_url") {
          throw new Error("That URL doesn't look right — try yourbusiness.com.");
        }
        if (code === "missing_business_name") {
          throw new Error("Please tell us your business name.");
        }
        if (code === "stripe_not_configured") {
          setPayBlocked(true);
          throw new Error("Checkout is temporarily unavailable — no charge was made.");
        }
        if (/product/i.test(code + String(data.message || ""))) {
          throw new Error("Checkout is still being wired up for this product — your audit details are saved. Check back shortly.");
        }
        throw new Error(data.message || code || "Couldn't start checkout.");
      }
      if (!data.checkout_url) throw new Error("Couldn't start checkout — try again.");
      window.location.href = data.checkout_url;
    } catch (err: any) {
      setPayError(err?.message || "Something went wrong starting checkout.");
      setPaying(false);
    }
  };

  const signals = intake?.signals || [];

  return (
    <>
      {/* ── HERO ── */}
      <section className="site-hero px-4">
        <div className="site-shell max-w-3xl text-center">
          <p className="site-eyebrow mb-4">One-time audit · $330</p>
          <h1 className="site-display text-balance">Audit My Business</h1>
          <p className="site-lede mx-auto mt-4 max-w-2xl text-balance">
            Enter your business URL and our AI audits your public site — then writes you a
            professional visual report: an overall score, your money leaks ranked, your flaws,
            prioritized fixes, and where AI fits in your business. Add an optional
            CEO walkthrough video (2–30 min) for a deeper assessment.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#step-1" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "w-full sm:w-auto")}>
              Start step 1 — it's free <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </a>
            <a href="#whats-inside" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full sm:w-auto")}>
              What's inside the report
            </a>
          </div>
          <p className="mx-auto mt-4 max-w-xl text-xs leading-5 text-muted-foreground">
            One-time $330 · No subscription · This page sells Audit My Business — the
            automated audit: our AI reads your site and your walkthrough and emails
            your report within 3–5 business days. It is not the founder-led $330 tech
            audit (a human review, invoiced by email) — the side-by-side is below.
          </p>
          <p className="mt-3 text-sm">
            <button
              type="button"
              className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-100"
              onClick={() => {
                setDirectBuy(true);
                document.getElementById("step-3")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Already know you want it? Skip the free scan — buy the audit now
            </button>
          </p>
          <p className="mt-2 text-sm">
            <a href="/blog/what-does-a-business-audit-check" className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-100">
              Prefer to read first? What a business audit checks, area by area
            </a>
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-4 pb-4 pt-2">
        <div className="site-shell grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            { n: "1", t: "Share your URL", d: "Just your URL — we fetch your site, find your business details ourselves, and show you the honest signals we found. Free.", icon: FileSearch },
            { n: "2", t: "Add your walkthrough (optional)", d: "Even 2 minutes works (up to 30 min MP4): talk us through your business like you're showing a friend. The AI uses it for a deeper read.", icon: Video },
            { n: "3", t: "Pay $330, get the report", d: "One-time payment. The AI writes your visual report and emails you a permanent link.", icon: BadgeCheck },
          ].map(({ n, t, d, icon: Icon }) => (
            <div key={n} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-950 text-sm font-bold text-white dark:bg-white/10" aria-hidden="true">{n}</span>
                <Icon className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{t}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {d}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── THE LADDER: free scan / $5 Full Report / $330 Audit My Business ── */}
      <section className="px-4 pb-2" aria-label="Compare the free scan, the $5 Full Report, and Audit My Business">
        <div className="site-shell max-w-4xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground">Three depths — pick yours</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Free scan</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">$0</p>
              <p className="mt-1 text-xs text-muted-foreground">60 seconds · no card</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Overall site score snapshot</li>
                <li>3 money leaks, priced in dollars</li>
                <li>3 quick wins you can do today</li>
              </ul>
              <a href="#step-1" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-5 w-full")}>
                Start the free scan
              </a>
            </div>
            <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Full Report</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">$5</p>
              <p className="mt-1 text-xs text-muted-foreground">one-time · your website only</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Every page graded, not just the homepage</li>
                <li>Every leak priced, with the math shown</li>
                <li>AI capacity blueprint + 90-day plan</li>
                <li>Delivered in about a minute</li>
              </ul>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Your $5 is credited toward the $330 Audit My Business — you pay $325 at checkout with the same email.
              </p>
              <Link href="/audit/report" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "mt-5 w-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400")}>
                Get the $5 report <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="flex flex-col rounded-2xl border-2 border-brand-600 bg-card p-5 shadow-sm dark:border-brand-400">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">Audit My Business</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">$330</p>
              <p className="mt-1 text-xs text-muted-foreground">one-time · your whole business</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>The full site read — plus your CEO walkthrough video, transcribed and assessed</li>
                <li>Findings on how you sell, book, and follow up — not just the site</li>
                <li>Money leaks ranked by dollar impact, fixes in priority order</li>
                <li>Delivered by email within 3–5 business days</li>
              </ul>
              <a href="#step-1" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "mt-5 w-full")}>
                Start Step 1 — it's free <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already bought the $5 Full Report? Its $5 is credited toward Audit My Business when you
            check out with the same email — the discount shows on the checkout page before you pay.
            You pay $325 at checkout ($330 − your $5 credit).
          </p>
        </div>
      </section>

      {/* ── TWO $330 AUDITS ── */}
      <section className="px-4 pb-2" aria-label="Audit My Business compared with the founder-led tech audit">
        <div className="site-shell max-w-4xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground">Two $330 audits — this page sells the automated one</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border-2 border-brand-600 bg-card p-5 shadow-sm dark:border-brand-400">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">Audit My Business — this page</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li><span className="font-semibold text-foreground">$330 one-time</span>, paid by card through Stripe checkout</li>
                <li>Automated: our AI audits your public site and your CEO walkthrough video</li>
                <li>Visual report emailed within 3–5 business days — score, money leaks ranked, prioritized fixes, AI opportunity map</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Founder-led tech audit — different product</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li><span className="font-semibold text-foreground">$330 one-time</span>, invoiced by email</li>
                <li>A human reviews your website, booking path, and follow-up end to end</li>
                <li>Delivered about 3 business days after the intake call, with an audit + setup plan</li>
              </ul>
              <Link href="/micro-offer" className="mt-4 inline-block text-sm font-semibold underline underline-offset-2 hover:text-foreground">
                See the founder-led audit
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── STEP 1: INTAKE ── */}
      <StepShell step="Step 1 · free" title="Start with your website" id="step-1">
        <Card>
          <CardContent className="p-5 md:p-7">
            {step1Phase === "url" && (
              <form onSubmit={submitPeek} className="space-y-4">
                <div>
                  <Label htmlFor="ab-url">Your business website</Label>
                  <Input id="ab-url" type="text" inputMode="url" autoComplete="url" required placeholder="acmeplumbing.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} className="mt-2 h-14 text-lg" />
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Just the URL. We read your site and fill in your business details ourselves — free, about 10 seconds.
                  </p>
                </div>
                {intakeError && (
                  <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    {intakeError}
                  </p>
                )}
                <Button type="submit" variant="cta" size="lg" className="w-full" disabled={peeking}>
                  {peeking ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Reading your site…</>) : (<><Sparkles className="mr-2 h-4 w-4" aria-hidden="true" /> Find my business <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>)}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <button type="button" className="underline underline-offset-2" onClick={() => { setPeekNote(""); setIntakeError(""); setStep1Phase("manual"); }}>
                    Rather type it? Enter details manually
                  </button>
                </p>
              </form>
            )}

            {step1Phase === "confirm" && peek && (
              <form onSubmit={submitIntake} className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-border">
                  {peek.identity.og_image ? (
                    <img src={peek.identity.og_image} alt="" className="h-36 w-full object-cover" />
                  ) : (
                    <div className="h-14 w-full" style={peek.identity.theme_color ? { backgroundColor: peek.identity.theme_color } : undefined} aria-hidden="true" />
                  )}
                  <div className="space-y-4 p-5">
                    <div className="flex items-start gap-3">
                      {peek.identity.favicon && (
                        <img src={peek.identity.favicon} alt="" className="mt-1 h-10 w-10 shrink-0 rounded-lg border border-border bg-white object-contain p-1" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <Label htmlFor="ab-name-confirm">We found this business — is it yours?</Label>
                        <Input id="ab-name-confirm" type="text" autoComplete="organization" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="mt-2 h-12 text-base font-semibold" />
                        {peek.identity.tagline && <p className="mt-2 truncate text-sm text-muted-foreground">{peek.identity.tagline}</p>}
                        <p className="mt-1 truncate text-xs text-muted-foreground">{peek.identity.url}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        peek.found.https ? "HTTPS on" : null,
                        peek.found.has_phone ? "Phone number found" : null,
                        peek.found.has_contact_path ? "Contact path found" : null,
                        peek.found.has_schema ? "Structured data found" : null,
                        ...peek.found.socials.map((s) => `${s} linked`),
                        typeof peek.found.load_ms === "number" ? `Loaded in ${peek.found.load_ms} ms` : null,
                      ].filter(Boolean).map((chip) => (
                        <span key={chip as string} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {chip}
                        </span>
                      ))}
                    </div>
                    {peek.found.content_unmeasured && (
                      <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        Your site builds its pages with JavaScript — your full audit reads all of it.
                      </p>
                    )}
                  </div>
                </div>
                {peek.identity.emails.length > 0 && !email && (
                  <p className="text-sm leading-6 text-muted-foreground">
                    We found <strong className="text-foreground">{peek.identity.emails[0]}</strong> on your site —{" "}
                    <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => setEmail(peek.identity.emails[0])}>
                      use it for my report
                    </button>
                  </p>
                )}
                <div>
                  <Label htmlFor="ab-email">Email for your report</Label>
                  <Input id="ab-email" type="email" autoComplete="email" required placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 text-base" />
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    We use your email only to deliver your report and updates about this audit.
                  </p>
                </div>
                {intakeError && (
                  <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    {intakeError}
                  </p>
                )}
                <Button type="submit" variant="cta" size="lg" className="w-full" disabled={intaking}>
                  {intaking ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Fetching your site…</>) : (<>Yes, that&rsquo;s us — start my free preview <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>)}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <button type="button" className="underline underline-offset-2" onClick={() => { setStep1Phase("url"); setPeek(null); setIntakeError(""); }}>
                    Not your site? Start over
                  </button>
                  {" · "}
                  <button type="button" className="underline underline-offset-2" onClick={() => { setPeekNote(""); setIntakeError(""); setStep1Phase("manual"); }}>
                    Enter details manually
                  </button>
                </p>
              </form>
            )}

            {step1Phase === "manual" && (
              <>
                {peekNote && (
                  <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    {peekNote}
                  </p>
                )}
                <form onSubmit={submitIntake} className="space-y-4">
                  <div>
                    <Label htmlFor="ab-name">Business name</Label>
                    <Input id="ab-name" type="text" autoComplete="organization" required placeholder="Acme Plumbing Co." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="mt-2 h-12 text-base" />
                  </div>
                  <div>
                    <Label htmlFor="ab-url-manual">Business website URL</Label>
                    <Input id="ab-url-manual" type="text" inputMode="url" autoComplete="url" required placeholder="acmeplumbing.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} className="mt-2 h-12 text-base" />
                  </div>
                  <div>
                    <Label htmlFor="ab-email-manual">Email</Label>
                    <Input id="ab-email-manual" type="email" autoComplete="email" required placeholder="you@yourbusiness.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-12 text-base" />
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      We use your email only to deliver your report and updates about this audit.
                    </p>
                  </div>
                  {intakeError && (
                    <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      {intakeError}
                    </p>
                  )}
                  <Button type="submit" variant="cta" size="lg" className="w-full" disabled={intaking}>
                    {intaking ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Fetching your site…</>) : (<>Fetch my site — free <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>)}
                  </Button>
                </form>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  <button type="button" className="underline underline-offset-2" onClick={() => { setPeekNote(""); setIntakeError(""); setStep1Phase("url"); }}>
                    ← Use the smart start instead
                  </button>
                </p>
              </>
            )}

            {/* ── Free honest-signals preview: only what the fetch measured ── */}
            {intake && (
              <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-50/50 p-5 dark:bg-emerald-950/20" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Free preview — what the fetch actually measured
                </p>
                {intake.contentUnmeasured && (
                  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    Your site loads its content with JavaScript — your full $330 audit covers
                    headings, word count, forms, CTAs, and phone in depth via your walkthrough video.
                  </p>
                )}
                {signals.length > 0 ? (
                  <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                    {signals.map((s, i) => (
                      <div key={i} className="rounded-xl bg-white/70 p-3 dark:bg-white/5">
                        <dt className="text-xs font-medium text-muted-foreground">{s.label}</dt>
                        <dd className={cn("mt-1 text-sm font-semibold", s.good === true ? "text-emerald-700 dark:text-emerald-400" : s.good === false ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>
                          {s.good === false ? "✗ " : s.good === true ? "✓ " : ""}{s.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Your site renders mostly in JavaScript — the full $330 audit digs into all of it.
                  </p>
                )}
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  This preview is a small sample. The full $330 report adds the score, ranked money
                  leaks, flaws, prioritized fixes, and where AI fits in your business.
                </p>
                <a href="#step-3" className={cn(buttonVariants({ variant: "cta" }), "mt-4")}>
                  Continue to payment — $330 <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </StepShell>

      {/* ── STEP 2: VIDEO UPLOAD (OPTIONAL) ── */}
      <StepShell step="Step 2 · optional" title="Add your CEO walkthrough" id="step-2">
        <Card>
          <CardContent className="p-5 md:p-7">
            <p className="text-sm leading-6 text-muted-foreground">
              Record a quick walkthrough — <strong className="text-foreground">even 2 minutes works</strong> (up to 30 minutes of MP4) — walk us
              through your business like you're showing a friend: your site, your offer, your
              customers, what's working and what isn't. The AI uses it for a deeper assessment,
              including transcript-based findings in your report. Skip it and the audit covers
              your public site alone.
            </p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              <strong className="text-foreground">Video terms:</strong> your walkthrough and its
              audio track upload to our secure Cloudflare storage with your audit. The audio
              is transcribed by Cloudflare AI, and the transcript is used only to write your
              report's deep-dive section. Your video and its audio are deleted 90 days after
              your report is delivered; the transcript and your report stay with your audit
              record so we can re-send your report — never sold, never used for marketing, and
              never used to train AI models.
            </p>

            {!intake ? (
              <p className="mt-4 rounded-xl border border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
                Complete <a href="#step-1" className="font-semibold text-foreground underline underline-offset-2">step 1</a> first —
                the upload attaches to your audit.
              </p>
            ) : videoUploaded ? (
              <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50/60 p-4 text-sm font-medium text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Video received{audioWasStored
                  ? audioWasTruncated
                    ? " — audio extracted (trimmed to the first 30 minutes for transcription), so your report gets the transcript deep-dive."
                    : " — audio extracted, so your report gets the full transcript deep-dive."
                  : " — without audio, so your report's deep-dive is built from your site and video."}
              </p>
            ) : (
              <div className="mt-4">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Choose an MP4 walkthrough video to upload, up to 30 minutes"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); void onPickFile(e.dataTransfer.files?.[0]); }}
                  className={cn(
                    "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    dragOver ? "border-brand-600 bg-brand-50 dark:bg-brand-950/30" : "border-border hover:border-brand-600/60",
                  )}
                >
                  <UploadCloud className="h-8 w-8 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                  <p className="text-sm font-semibold text-foreground">
                    {checkingVideo ? "Reading video length…" : "Drop your MP4 here, or click to choose"}
                  </p>
                  <p className="text-xs text-muted-foreground">MP4 only · max 30 minutes · audio extracted on your device for transcription</p>
                  {videoFile && videoDuration != null && (
                    <p className="mt-1 flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <Video className="h-3.5 w-3.5" aria-hidden="true" /> {videoFile.name} · {formatClock(videoDuration)}
                    </p>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,.mp4"
                  className="sr-only"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }}
                />
                {videoError && (
                  <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {videoError}
                  </p>
                )}
                {uploadError && (
                  <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    {uploadError}
                  </p>
                )}
                {videoFile && !videoError && (
                  <div className="mt-4">
                    {/* ── Audio-extraction status: extracted / extracting (skippable) /
                           skipped / failed (video-only fallback) ── */}
                    <div className="mb-3 rounded-xl border border-border bg-secondary/40 p-4" aria-live="polite">
                      {extractingAudio ? (
                        <div className="flex items-center justify-between gap-3">
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                            <span>Extracting audio for transcription… (can take a minute for long videos)</span>
                          </p>
                          <button
                            type="button"
                            onClick={skipAudio}
                            className="shrink-0 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-100"
                          >
                            Skip audio
                          </button>
                        </div>
                      ) : audioBlob ? (
                        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            Audio extracted{audioSeconds != null ? ` (${formatClock(audioSeconds)})` : ""} — it will be
                            transcribed for the report's deep-dive section.
                          </span>
                        </p>
                      ) : audioSkipped ? (
                        <p className="text-sm text-muted-foreground">
                          Audio skipped — uploading video only. Your report covers your site and video in full.
                        </p>
                      ) : audioError ? (
                        <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            {audioError} You can still upload the video — your report covers your site and video in full.
                          </span>
                        </p>
                      ) : null}
                    </div>
                    {uploading && (
                      <div className="mb-3" role="status" aria-label={`Uploading: ${uploadProgress}%`}>
                        <div className="h-2 overflow-hidden rounded-full bg-border">
                          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">Uploading… {uploadProgress}%</p>
                      </div>
                    )}
                    <Button type="button" variant="cta" className="w-full sm:w-auto" disabled={!canUpload} onClick={uploadVideo}>
                      {uploading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Uploading…</>) : "Upload video"}
                    </Button>
                    {!audioSettled && !uploading && (
                      <p className="mt-2 text-xs text-muted-foreground">The upload button unlocks once the audio is extracted — or skip it above.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <DemoVideo />
          </CardContent>
        </Card>
      </StepShell>

      {/* ── STEP 3: PAY ── */}
      <StepShell step="Step 3 · one-time $330" title="Get your report" id="step-3">
        <Card className="overflow-hidden">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Audit My Business</p>
                <p className="mt-2 text-5xl font-extrabold tracking-tight text-foreground">$330</p>
                <p className="mt-1 text-sm text-muted-foreground">one-time · no subscription</p>
              </div>
              <ShieldCheck className="h-10 w-10 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            </div>

            <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">What the report includes</h3>
            <ul className="mt-3 space-y-2.5">
              {[
                "Overall score (0–100) with what it measures",
                "Money leaks, ranked by estimated dollar impact — every leak priced in dollars",
                "Flaws in your site, messaging, and conversion path",
                "Prioritized fixes — what to do first, second, third",
                "Where AI fits in your business — concrete opportunities",
                "Transcript-based findings, if you upload the walkthrough video",
                "Every finding tied to the page evidence behind it",
              ].map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-6 text-muted-foreground">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Curious what lands in your inbox?{" "}
              <Link href="/audit/sample-report" className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-100">
                See a sample report
              </Link>{" "}
              — a labelled illustration in the real format, with a fictional business.
            </p>

            <div className="mt-6 rounded-2xl border border-border bg-secondary/50 p-4">
              <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>
                  Your audit reads your public site plus your walkthrough video and tells you
                  exactly where the leaks are and what to fix first.
                </span>
              </p>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Delivered by email within 3–5 business days. Results vary by business — this
              audit shows what's true for your business today, and no audit can guarantee
              specific revenue results.
            </p>

            <form onSubmit={pay} className="mt-6 space-y-4">
              {directBuy && !intake && (
                <>
                  <div className="rounded-2xl border border-border bg-secondary/50 p-4">
                    <p className="text-sm leading-6 text-muted-foreground">
                      <strong className="text-foreground">Buying directly — no free scan first.</strong>{" "}
                      Name your business and its website below; we audit that site and email your
                      report within 3–5 business days. Prefer the free preview first? Use Step 1
                      above instead — the audit is the same.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="ab-direct-business">Business name</Label>
                    <Input id="ab-direct-business" type="text" autoComplete="organization" required placeholder="Your Business LLC" value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="mt-2 h-12 text-base" />
                  </div>
                  <div>
                    <Label htmlFor="ab-direct-url">Website URL</Label>
                    <Input id="ab-direct-url" type="text" inputMode="url" autoComplete="url" required placeholder="yourbusiness.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} className="mt-2 h-12 text-base" />
                  </div>
                </>
              )}
              <div>
                <Label htmlFor="ab-pay-email">Email for delivery</Label>
                {intake && !payEmailEditing ? (
                  <>
                    <div className="mt-2 flex h-12 items-center justify-between gap-3 rounded-md border border-input bg-secondary/40 px-3">
                      <span className="min-w-0 truncate text-base text-foreground">{payEmail}</span>
                      <button
                        type="button"
                        onClick={() => setPayEmailEditing(true)}
                        className="shrink-0 text-sm font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-100"
                      >
                        Edit
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Carried from Step 1 — your audit is linked to this email, and your report is delivered here.
                    </p>
                  </>
                ) : (
                  <>
                    <Input id="ab-pay-email" type="email" autoComplete="email" required placeholder="you@yourbusiness.com" value={payEmail} onChange={(e) => setPayEmail(e.target.value)} className="mt-2 h-12 text-base" />
                    {intake && payEmail.trim() && !EMAIL_RE.test(payEmail.trim()) && (
                      <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">Enter a valid email address.</p>
                    )}
                    {intake && payEmail.trim() && EMAIL_RE.test(payEmail.trim()) && payEmail.trim().toLowerCase() !== email.trim().toLowerCase() && (
                      <div className="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" role="alert">
                        <p>
                          This doesn't match your Step 1 email ({email.trim()}). Checkout needs the same
                          email so your audit stays linked — the mismatch is flagged now, before you pay.
                        </p>
                        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                          <button
                            type="button"
                            className="font-semibold underline underline-offset-2"
                            onClick={() => {
                              setEmail(payEmail.trim());
                              setIntake(null);
                              setPayEmailEditing(false);
                              document.getElementById("step-1")?.scrollIntoView({ behavior: "smooth" });
                            }}
                          >
                            Use this email instead — restart Step 1 with it
                          </button>
                          <button
                            type="button"
                            className="font-semibold underline underline-offset-2"
                            onClick={() => { setPayEmail(email); setPayEmailEditing(false); }}
                          >
                            Back to my Step 1 email
                          </button>
                        </p>
                      </div>
                    )}
                    {intake && payEmailEditing && payEmail.trim().toLowerCase() === email.trim().toLowerCase() && EMAIL_RE.test(payEmail.trim()) && (
                      <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">Matches your Step 1 email — you're good to pay.</p>
                    )}
                    {!intake && (
                      <p className="mt-2 text-xs text-muted-foreground">{directBuy ? "Your audit is linked to this email — your report is delivered here." : "Use the same email as Step 1 — your audit is linked to it."}</p>
                    )}
                  </>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Secure checkout via Stripe. We never see your card number.
                </p>
                {(intake || directBuy) && !creditInfo?.eligible && (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Bought the Full Report with this email? Your $5 credit applies: $330 − $5 = $325 due at checkout.
                  </p>
                )}
              </div>
              {payError && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  {payError}
                </p>
              )}
              {(payBlocked || checkoutOpen === false) && (
                <div className="rounded-2xl border border-border bg-card p-5">
                  <p className="text-sm font-semibold text-foreground">Don't lose your audit details</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Your audit is saved. Leave your email and we'll send you one message the moment
                    checkout reopens — nothing else, ever. No charge is made until you pay.
                  </p>
                  {notifyState === "saved" ? (
                    <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      You're on the list — we'll email you at {payEmail.trim()} the moment checkout is back.
                    </p>
                  ) : (
                    <>
                      <Button type="button" variant="outline" size="lg" className="mt-3 w-full" onClick={notifyWhenBack} disabled={notifyState === "saving"}>
                        {notifyState === "saving" ? "Saving…" : "Notify me when checkout opens"}
                      </Button>
                      {notifyMsg && (
                        <p role="alert" className="mt-2 text-sm text-amber-700 dark:text-amber-300">{notifyMsg}</p>
                      )}
                    </>
                  )}
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Rather talk to a human?{" "}
                    <a href="mailto:info@mehyar.us" className="font-semibold text-foreground underline underline-offset-2">Email info@mehyar.us</a>{" "}
                    — we'll sort it out personally.
                  </p>
                </div>
              )}
              {checkoutOpen === false && (
                <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  Checkout is briefly unavailable right now — no charge can be taken. Rather talk to a human?{" "}
                  <a href="mailto:info@mehyar.us" className="font-semibold underline underline-offset-2">Email info@mehyar.us</a>{" "}
                  and we'll sort it out personally.
                </p>
              )}
              {creditInfo?.eligible && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
                  <div className="space-y-1 text-sm">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">Audit My Business</span>
                      <span className="font-semibold text-foreground">${(creditInfo.list_cents / 100).toFixed(2).replace(/\.00$/, "")}</span>
                    </p>
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">Your Full Report credit</span>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">−${(creditInfo.credit_cents / 100).toFixed(2).replace(/\.00$/, "")}</span>
                    </p>
                    <p className="flex items-baseline justify-between gap-3 border-t border-emerald-200 pt-1.5 dark:border-emerald-900">
                      <span className="font-semibold text-foreground">Due at checkout</span>
                      <span className="font-bold text-foreground">${(creditInfo.due_cents / 100).toFixed(2).replace(/\.00$/, "")}</span>
                    </p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Your $5 Full Report purchase with this email is credited toward your audit — the discount shows on the checkout page before you pay.
                  </p>
                </div>
              )}
              <Button type="submit" variant="cta" size="lg" className="w-full" disabled={paying || checkoutOpen === false}>
                {checkoutOpen === false ? (<>Checkout is briefly unavailable</>) : paying ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Starting secure checkout…</>) : creditInfo?.eligible ? (<>Pay ${(creditInfo.due_cents / 100).toFixed(2).replace(/\.00$/, "")} — get my audit <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>) : (<>Pay $330 — get my audit <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>)}
              </Button>
              <p className="text-center text-xs text-muted-foreground">One-time payment · {creditInfo?.eligible ? `$${(creditInfo.due_cents / 100).toFixed(2).replace(/\.00$/, "")}` : "$330"} · Report emailed with a permanent link</p>
              <p className="text-center text-xs text-muted-foreground">
                All sales are final — Audit My Business is a one-time digital service, and purchases are not
                refundable. If your report hasn&rsquo;t arrived within 3–5 business days, email{" "}
                <a href="mailto:info@mehyar.us" className="underline underline-offset-2 hover:text-foreground">info@mehyar.us</a>{" "}
                and we&rsquo;ll re-send it right away.
              </p>
            </form>
          </CardContent>
        </Card>
      </StepShell>

      {/* ── HONEST SCOPE + FAQ ── */}
      <section id="whats-inside" className="scroll-mt-24 bg-secondary px-4 py-12 md:py-16">
        <div className="site-shell max-w-3xl">
          <p className="site-eyebrow">Straight answers</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">What this audit does for you</h2>
          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> It can
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Read your public website like a first-time buyer would</li>
                <li>Rank the leaks it finds by estimated impact</li>
                <li>Point out messaging, trust, and conversion-path flaws</li>
                <li>Map concrete places AI could fit in your business</li>
                <li>Use your walkthrough video for a deeper, transcript-based read</li>
              </ul>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <FaqItem q="Which offer is which — the free scan, the Full Report, or Audit My Business?">
              Three different rungs, all on this page. The free scan (Step 1) scores your
              public site and names your top money leaks — free, no card. The Full Report
              ($5, one-time) is the complete written breakdown of that scan: every leak
              found, priced and ranked. Audit My Business ($330, one-time) is the deep
              audit — a separate, fuller report built from your site and your walkthrough
              video, with prioritized fixes and an AI opportunity map, delivered by email
              within 3–5 business days; if you bought the Full Report first, its $5 is
              credited toward the $330 — you pay $325 at checkout ($330 − $5). The{" "}
              <Link href="/micro-offer" className="underline underline-offset-2">founder-led $330 tech audit</Link>{" "}
              is a different product again: a human review, invoiced by email.
            </FaqItem>
            <FaqItem q="Do I need the walkthrough video?">
              No. The audit works on your public site alone. The video unlocks the deep-dive
              section: the AI watches you explain your business and adds transcript-based findings
              it can't get from the site — like whether your offer matches how you describe it.
            </FaqItem>
            <FaqItem q="How thorough is the audit?">
              Every finding in your report is tied to something the audit actually saw on your
              site or in your walkthrough — specific, evidenced, and ranked by impact.
            </FaqItem>
          </div>

          <div className="mt-10 rounded-3xl bg-brand-950 p-8 text-center text-white dark:bg-white/5">
            <Sparkles className="mx-auto h-8 w-8 text-brand-200" aria-hidden="true" />
            <p className="mt-3 text-xl font-semibold">Know exactly what's leaking.</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/75">
              One URL, one optional video, one $330 payment — and a professional report that tells
              you what to fix first.
            </p>
            <a href="#step-1" className={cn(buttonVariants({ variant: "cta", size: "lg" }), "mt-6")}>
              Start your audit <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
      <MayorBait campaign="audit" />
    </>
  );
}
