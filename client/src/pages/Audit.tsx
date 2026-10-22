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
  const na = "Couldn't be assessed";
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
  /* Assessment-call prefill (?prefill=<token>): the post-call email links here
     with a tokenized payload (business name, URL, call findings). Redeem it and
     fill the intake form — the token, name, URL and findings must never be
     silently discarded (full-QA fix F2). Invalid/expired tokens degrade to an
     empty form with a gentle note, never an error wall. */
  const prefillToken = new URLSearchParams(window.location.search).get("prefill");
  const [prefillNote, setPrefillNote] = useState("");
  const [prefillLoading, setPrefillLoading] = useState(false);

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
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  useEffect(() => {
    if (intake && !payEmail) setPayEmail(email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intake]);

  /* ── F2: redeem the assessment-call prefill token once on mount ── */
  useEffect(() => {
    if (!prefillToken) return;
    let cancelled = false;
    setPrefillLoading(true);
    fetch(`/api/assessment/prefill?token=${encodeURIComponent(prefillToken)}`)
      .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
      .then(({ status, data }) => {
        if (cancelled) return;
        if (status === 200 && data && data.ok && data.payload) {
          const p = data.payload as { business_name?: string; url?: string; findings_summary?: string };
          if (p.business_name) setBusinessName(p.business_name);
          if (p.url) setSiteUrl(p.url);
          setPrefillNote(
            "Pre-filled from your assessment call" +
              (p.findings_summary ? ` — we covered: ${p.findings_summary}.` : ".") +
              " Check it over and continue below."
          );
        } else {
          setPrefillNote("That personal link has expired — no problem, just fill in the form below.");
        }
      })
      .catch(() => {
        if (!cancelled) setPrefillNote("Couldn't load your saved details — just fill in the form below.");
      })
      .finally(() => {
        if (!cancelled) setPrefillLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillToken]);

  const submitIntake = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (!intake) return setPayError("Complete step 1 first so we know which business to audit.");
    if (!EMAIL_RE.test(payEmail.trim())) return setPayError("Please enter a valid email for delivery.");
    setPaying(true);
    try {
      const r = await fetch("/api/pay/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: "audit-my-business",
          email: payEmail.trim(),
          /* The server mints the 64-hex report token at checkout and APPENDS
             ?token= to this URL. Never put a token here ourselves — a
             pre-existing ?token= would NOT be overwritten. */
          success_url: "https://mehyar.us/audit/report",
          cancel_url: "https://mehyar.us/audit/",
          params: { audit_id: intake.auditId },
        }),
      });
      const data = await r.json();
      if (data.already_ready && data.token) {
        window.location.href = `/audit/report?token=${encodeURIComponent(data.token)}`;
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
        if (code === "stripe_not_configured") {
          throw new Error("Checkout opens very soon — your audit details are saved. Check back in a bit!");
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
            prioritized fixes, and where AI fits in your business. Add an optional 30-minute
            CEO walkthrough video for a deeper assessment.
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
            One-time $330 · No subscription · Purchases are final (no refunds) ·
            the automated counterpart to our{" "}
            <Link href="/micro-offer" className="underline underline-offset-2 hover:text-foreground">
              founder-led $330 tech audit
            </Link>
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-4 pb-4 pt-2">
        <div className="site-shell grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            { n: "1", t: "Share your URL", d: "Business name, URL, and email. We fetch your site and show you the honest signals we found — free.", icon: FileSearch },
            { n: "2", t: "Add your walkthrough (optional)", d: "Upload up to 30 minutes of MP4: talk us through your business like you're showing a friend. The AI uses it for a deeper read.", icon: Video },
            { n: "3", t: "Pay $330, get the report", d: "One-time payment. The AI writes your visual report and emails you a permanent link.", icon: BadgeCheck },
          ].map(({ n, t, d, icon: Icon }) => (
            <div key={n} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-950 text-sm font-bold text-white dark:bg-white/10" aria-hidden="true">{n}</span>
                <Icon className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{t}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── STEP 1: INTAKE ── */}
      <StepShell step="Step 1 · free" title="Tell us about your business" id="step-1">
        <Card>
          <CardContent className="p-5 md:p-7">
            {prefillLoading && (
              <p className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground" aria-live="polite">
                Loading your saved details…
              </p>
            )}
            {prefillNote && (
              <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" aria-live="polite">
                {prefillNote}
              </p>
            )}
            <form onSubmit={submitIntake} className="space-y-4">
              <div>
                <Label htmlFor="ab-name">Business name</Label>
                <Input id="ab-name" type="text" autoComplete="organization" required placeholder="Acme Plumbing Co." value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="mt-2 h-12 text-base" />
              </div>
              <div>
                <Label htmlFor="ab-url">Business website URL</Label>
                <Input id="ab-url" type="text" inputMode="url" autoComplete="url" required placeholder="acmeplumbing.com" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} className="mt-2 h-12 text-base" />
              </div>
              <div>
                <Label htmlFor="ab-email">Email</Label>
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
                {intaking ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Fetching your site…</>) : (<>Fetch my site — free <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>)}
              </Button>
            </form>

            {/* ── Free honest-signals preview: only what the fetch measured ── */}
            {intake && (
              <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-50/50 p-5 dark:bg-emerald-950/20" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Free preview — what the fetch actually measured
                </p>
                {intake.contentUnmeasured && (
                  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    This site loads its content with JavaScript, so headings, word count, forms, CTAs,
                    and phone couldn't be assessed from the initial page load — they're marked
                    "couldn't be assessed" below, not counted as missing. The paid audit covers
                    them via your walkthrough video.
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
                    The fetch returned your page but no measurable signals this time — this happens
                    with sites that render mostly in JavaScript. The paid audit digs deeper either way.
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
              Record up to <strong className="text-foreground">30 minutes</strong> of MP4 — walk us
              through your business like you're showing a friend: your site, your offer, your
              customers, what's working and what isn't. The AI uses it for a deeper assessment,
              including transcript-based findings in your report. Skip it and the audit covers
              your public site alone.
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
                  : " — without audio, so the transcript section of your report will note it couldn't be assessed."}
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
                          Audio skipped — uploading video only. The transcript section of your report will note it couldn't be assessed.
                        </p>
                      ) : audioError ? (
                        <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>
                            {audioError} You can still upload the video — the transcript section of your report will
                            note it couldn't be assessed.
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
                "Money leaks, ranked by estimated impact",
                "Flaws in your site, messaging, and conversion path",
                "Prioritized fixes — what to do first, second, third",
                "Where AI fits in your business — concrete opportunities",
                "Transcript-based findings, if you upload the walkthrough video",
                "\u201CNeeds review\u201D flags wherever the AI isn't confident, and an honest \u201Ccouldn't be assessed\u201D wherever it can't see enough",
              ].map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-6 text-muted-foreground">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-2xl border border-border bg-secondary/50 p-4">
              <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span>
                  <strong className="text-foreground">Honest scope:</strong> the audit assesses what's
                  publicly visible on your site plus your walkthrough video. It doesn't see your
                  private numbers, and it doesn't promise revenue results — it tells you where the
                  leaks are and what to fix first. Purchases are final — no refunds.
                </span>
              </p>
            </div>

            <form onSubmit={pay} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="ab-pay-email">Email for delivery</Label>
                <Input id="ab-pay-email" type="email" autoComplete="email" required placeholder="you@yourbusiness.com" value={payEmail} onChange={(e) => setPayEmail(e.target.value)} className="mt-2 h-12 text-base" />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Secure checkout via Stripe. We never see your card number.
                </p>
              </div>
              {payError && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  {payError}
                </p>
              )}
              <Button type="submit" variant="cta" size="lg" className="w-full" disabled={paying}>
                {paying ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Starting secure checkout…</>) : (<>Pay $330 — get my audit <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></>)}
              </Button>
              <p className="text-center text-xs text-muted-foreground">One-time payment · Report emailed with a permanent link</p>
            </form>
          </CardContent>
        </Card>
      </StepShell>

      {/* ── HONEST SCOPE + FAQ ── */}
      <section id="whats-inside" className="scroll-mt-24 bg-secondary px-4 py-12 md:py-16">
        <div className="site-shell max-w-3xl">
          <p className="site-eyebrow">Straight answers</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl">What this audit can and can't do</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
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
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> It can't
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>See your private numbers, ad accounts, or CRM</li>
                <li>Crawl pages hidden behind logins</li>
                <li>Promise revenue results — no audit can</li>
                <li>Replace a founder's judgment on your specific market</li>
              </ul>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <FaqItem q="Is this the same as the founder-led $330 tech audit?">
              No — same price, different product. The{" "}
              <Link href="/micro-offer" className="underline underline-offset-2">founder-led $330 tech audit</Link>{" "}
              is a human review, manually invoiced after a scope check. Audit My Business is the
              automated AI counterpart: instant checkout, AI-written visual report, delivered by email.
              Pick the human eye or the AI engine — or run both and compare.
            </FaqItem>
            <FaqItem q="Do I need the walkthrough video?">
              No. The audit works on your public site alone. The video unlocks the deep-dive
              section: the AI watches you explain your business and adds transcript-based findings
              it can't get from the site — like whether your offer matches how you describe it.
            </FaqItem>
            <FaqItem q="What if the AI isn't sure about something?">
              It says so. Low-confidence findings carry a "Needs review" flag, and anything the
              audit couldn't see enough of is marked "couldn't be assessed" instead of guessed at.
            </FaqItem>
            <FaqItem q="Can I get a refund?">
              Purchases are final — there are no refunds on the $330 audit. Read the honest scope
              above before you pay; if you'd rather talk to a human first,{" "}
              <Link href="/booking" className="underline underline-offset-2">book a free call</Link>.
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
    </>
  );
}
