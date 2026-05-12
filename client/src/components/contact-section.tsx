import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { IntakeFormType, mehyarSoftApi } from "@/lib/mehyarsoft-api";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const IS_LOCAL_PREVIEW = import.meta.env.DEV;

declare global {
  interface Window {
    onMehyarTurnstile?: (token: string) => void;
    onMehyarTurnstileExpired?: () => void;
    onMehyarTurnstileError?: () => void;
    turnstile?: { reset?: () => void };
  }
}

type FormState = {
  name: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  service_interest: string;
  budget_range: string;
  timeline: string;
  message: string;
  hp_field: string;
};

type SubmitStatus = "idle" | "submitting" | "success" | "error";

const initialFormData: FormState = {
  name: "",
  email: "",
  phone: "",
  company: "",
  website: "",
  service_interest: "",
  budget_range: "",
  timeline: "",
  message: "",
  hp_field: "",
};

const requestTypeLabels: Record<IntakeFormType, string> = {
  contact: "General lead request",
  audit: "Website / systems audit",
  booking: "Booking or missed-call setup",
  newsletter: "Newsletter signup",
  phone_help: "Local phone / electronics help",
};

const trustPoints = [
  "Founder-led review by a senior software, systems, and AI automation consultant.",
  "Built for local businesses and regulated teams that need clean handoffs, not agency theater.",
  "No spam: service follow-up requires consent, and marketing updates stay optional.",
];

const requestOptions: Array<{ value: IntakeFormType; label: string; hint: string }> = [
  { value: "audit", label: "Website / systems audit", hint: "Find where trust, leads, calls, or staff time are leaking." },
  { value: "booking", label: "Booking or missed-call setup", hint: "Turn missed calls and loose follow-up into a simple response path." },
  { value: "contact", label: "General consulting request", hint: "Ask about systems, integrations, AI automation, or architecture." },
  { value: "phone_help", label: "Local phone / electronics help", hint: "A practical local entry point when the tech problem starts with a device." },
];

const includeItems = [
  "Business type and city/service area",
  "Current website, CRM, booking, phone, or email tools",
  "Where customers, money, or staff time are being lost",
  "Urgency and budget range if known",
];

const nextSteps = [
  "Boss reviews the request personally.",
  "You get one practical next step: audit, booking call, larger sprint, or no-fit answer.",
  "If there is no fit, you get a direct no-fit answer.",
];

const privacyNotes = [
  "No passwords, API keys, patient records, or private customer lists.",
  "Required consent only covers service follow-up about this request.",
  "Optional updates are separate and can be unsubscribed from later.",
];

const inputClassName =
  "w-full rounded-xl border-border bg-white px-4 py-3 text-ink shadow-sm transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-brand-950 dark:text-white";

const statusCopy: Record<SubmitStatus, { tone: string; title: string; body: string }> = {
  idle: {
    tone: "neutral",
    title: "Response expectation",
    body: "You will get a practical next step: audit, cleanup, booking setup, automation sprint, or a direct no-fit answer.",
  },
  submitting: {
    tone: "blue",
    title: "Sending securely",
    body: "Hold tight — the request is being verified and delivered through the Cloudflare intake path.",
  },
  success: {
    tone: "green",
    title: "Request received",
    body: "Next step: Boss will review the leak, tools, urgency, and budget, then reply with the smallest practical move before proposing anything larger.",
  },
  error: {
    tone: "red",
    title: "The form did not send",
    body: "Please email contact@mehyar.us with the same details. Do not include passwords, API keys, or private customer data.",
  },
};

const ContactSection = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState<FormState>(initialFormData);
  const [formType, setFormType] = useState<IntakeFormType>("audit");
  const [consentContact, setConsentContact] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");

  const selectedRequestLabel = requestTypeLabels[formType];
  const selectedRequest = requestOptions.find((option) => option.value === formType) ?? requestOptions[0];
  const canSubmit = consentContact && Boolean(TURNSTILE_SITE_KEY) && Boolean(turnstileToken) && status !== "submitting" && status !== "success";
  const currentStatus = statusCopy[status];
  const getSubmitHint = () => {
    if (status === "success") return "Form cleared. Watch your email for a practical next step; do not resend unless you need to add new details.";
    if (!TURNSTILE_SITE_KEY) {
      return IS_LOCAL_PREVIEW
        ? "Local preview only: configure VITE_TURNSTILE_SITE_KEY to test secure submit, or use the email fallback."
        : "Secure submit is temporarily unavailable. Please email contact@mehyar.us with the same details.";
    }
    if (!consentContact) return "Confirm service follow-up consent to unlock the secure send button.";
    if (!turnstileToken) return "Complete the Cloudflare verification to unlock the secure send button.";
    return "Ready to send securely.";
  };
  const submitHint = getSubmitHint();
  const submitButtonLabel = status === "submitting" ? "Sending request..." : status === "success" ? "Request received" : "Request Practical Next Step";

  const statusClassName = useMemo(
    () =>
      cn("rounded-2xl border p-4 text-sm", {
        "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300": currentStatus.tone === "neutral",
        "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200": currentStatus.tone === "blue",
        "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200": currentStatus.tone === "green",
        "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200": currentStatus.tone === "red",
      }),
    [currentStatus.tone]
  );

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === "#intake" || hash === "#contact") {
      window.setTimeout(() => {
        document.querySelector(hash)?.scrollIntoView({ block: "start" });
      }, 0);
    }
  }, []);

  useEffect(() => {
    window.onMehyarTurnstile = (token: string) => setTurnstileToken(token);
    window.onMehyarTurnstileExpired = () => setTurnstileToken("");
    window.onMehyarTurnstileError = () => {
      setTurnstileToken("");
      setStatus("error");
    };

    if (TURNSTILE_SITE_KEY && !document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      delete window.onMehyarTurnstile;
      delete window.onMehyarTurnstileExpired;
      delete window.onMehyarTurnstileError;
    };
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
    if (status === "success" || status === "error") setStatus("idle");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!consentContact) {
      toast({
        title: "Consent required",
        description: "Please confirm MehyarSoft may contact you about this request.",
      });
      return;
    }

    if (!TURNSTILE_SITE_KEY || !turnstileToken) {
      toast({
        title: "Security check required",
        description: "Please complete the Cloudflare verification before sending.",
      });
      return;
    }

    setStatus("submitting");

    try {
      const params = new URLSearchParams(window.location.search);
      await mehyarSoftApi.submitIntake({
        form_type: formType,
        ...formData,
        consent_contact: consentContact,
        consent_marketing: consentMarketing,
        turnstile_token: turnstileToken,
        utm: {
          source: params.get("utm_source") || "",
          medium: params.get("utm_medium") || "",
          campaign: params.get("utm_campaign") || "",
        },
      });

      setStatus("success");
      toast({
        title: "Request received",
        description: "Thanks — your request was received. You will get a practical next step.",
      });
      setFormData(initialFormData);
      setFormType("audit");
      setConsentContact(false);
      setConsentMarketing(false);
      setTurnstileToken("");
      window.turnstile?.reset?.();
    } catch {
      setStatus("error");
      toast({
        title: "Could not send request",
        description: "Please email contact@mehyar.us if the form does not go through.",
      });
      window.turnstile?.reset?.();
      setTurnstileToken("");
    }
  };

  return (
    <section id="contact" className="scroll-mt-24 bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.12),transparent_32%),linear-gradient(180deg,#fff_0%,hsl(var(--background))_100%)] px-4 py-14 dark:bg-[radial-gradient(circle_at_top_left,rgba(102,210,235,0.10),transparent_32%),linear-gradient(180deg,hsl(var(--brand-900))_0%,hsl(var(--background))_100%)] sm:py-20">
      <div className="container mx-auto">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-brand-700 dark:text-brand-100">Founder-led intake</p>
          <h2 className="mb-4 text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-5xl">
            Request a tech audit or consulting call.
          </h2>
          <p className="mx-auto max-w-2xl text-lg leading-8 text-muted-foreground">
            Describe the leak: bad website flow, missed calls, manual follow-up, disconnected systems, or work your team keeps doing by hand.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
          <form id="contactForm" className="rounded-[2rem] border border-border bg-card/92 p-4 shadow-[0_24px_80px_rgba(8,63,84,0.10)] dark:bg-card/88 dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)] sm:p-6 lg:p-8" onSubmit={handleSubmit}>
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-brand-700/15 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink dark:text-white">{selectedRequestLabel}</p>
                <p className="text-sm text-muted-foreground">{selectedRequest.hint}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800 dark:bg-white/10 dark:text-brand-100">
                <ShieldCheck size={14} aria-hidden="true" />
                Cloudflare protected
              </div>
            </div>

            <div className="hidden" aria-hidden="true">
              <Label htmlFor="hp_field">Leave this field blank</Label>
              <Input
                type="text"
                id="hp_field"
                tabIndex={-1}
                autoComplete="off"
                value={formData.hp_field}
                onChange={handleChange}
              />
            </div>

            <fieldset className="space-y-5 disabled:opacity-80" disabled={status === "submitting"} aria-busy={status === "submitting"}>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" type="text" value={formData.name} onChange={handleChange} className={inputClassName} placeholder="Your name" autoComplete="name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={formData.email} onChange={handleChange} className={inputClassName} placeholder="you@company.com" autoComplete="email" required />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone <span className="font-normal text-neutral-500">optional</span></Label>
                  <Input id="phone" type="tel" value={formData.phone} onChange={handleChange} className={inputClassName} placeholder="Best callback number" autoComplete="tel" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">Business / company</Label>
                  <Input id="company" type="text" value={formData.company} onChange={handleChange} className={inputClassName} placeholder="Restaurant, clinic, agency, SaaS..." autoComplete="organization" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input id="website" type="url" value={formData.website} onChange={handleChange} className={inputClassName} placeholder="https://example.com" autoComplete="url" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="form_type">Request type</Label>
                  <select
                    id="form_type"
                    value={formType}
                    onChange={(event) => {
                      setFormType(event.target.value as IntakeFormType);
                      if (status === "success" || status === "error") setStatus("idle");
                    }}
                    className={inputClassName}
                    aria-describedby="request-type-help"
                  >
                    {requestOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <p id="request-type-help" className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{selectedRequest.hint}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <div className="space-y-2 md:col-span-1">
                  <Label htmlFor="service_interest">Main need</Label>
                  <Input id="service_interest" value={formData.service_interest} onChange={handleChange} className={inputClassName} placeholder="Booking setup, CRM, AI phone, website cleanup" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="budget_range">Budget range</Label>
                  <Input id="budget_range" value={formData.budget_range} onChange={handleChange} className={inputClassName} placeholder="$500–$5k, $5k+, unsure" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timeline">Timeline</Label>
                  <Input id="timeline" value={formData.timeline} onChange={handleChange} className={inputClassName} placeholder="Book this week, 30 days, later" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">What needs fixing?</Label>
                <Textarea
                  id="message"
                  value={formData.message}
                  onChange={handleChange}
                  rows={6}
                  className={cn(inputClassName, "min-h-36 resize-y leading-7")}
                  placeholder="Example: We miss after-hours calls, leads do not get followed up, booking is manual, and nobody trusts the CRM data."
                  aria-describedby="message-help"
                  required
                />
                <p id="message-help" className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  Share symptoms and tools. Do not paste credentials, private customer records, or regulated data.
                </p>
              </div>

              <div className="space-y-4 rounded-2xl border border-border bg-white p-4 dark:bg-white/[0.04]">
                <div>
                  <p className="text-sm font-semibold text-ink dark:text-white">Consent and privacy boundaries</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
                    {privacyNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
                <label htmlFor="consent_contact" className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-muted-foreground">
                  <Checkbox id="consent_contact" checked={consentContact} onCheckedChange={(checked) => setConsentContact(checked === true)} className="mt-1" />
                  <span>
                    <span className="font-semibold text-ink dark:text-white">Required:</span> I agree that MehyarSoft LLC may contact me about this request by email or phone if provided. This is only for service follow-up about the problem I submitted.
                  </span>
                </label>
                <label htmlFor="consent_marketing" className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-muted-foreground">
                  <Checkbox id="consent_marketing" checked={consentMarketing} onCheckedChange={(checked) => setConsentMarketing(checked === true)} className="mt-1" />
                  <span>
                    <span className="font-semibold text-ink dark:text-white">Optional:</span> send occasional MehyarSoft updates. This is separate from service follow-up, can be unsubscribed from later, and is never required to get a reply.
                  </span>
                </label>
              </div>

              <div className="rounded-2xl border border-border bg-white p-4 dark:bg-white/[0.04]">
                <div className="mb-3 flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 text-brand-700 dark:text-brand-100" size={18} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-ink dark:text-white">Cloudflare Turnstile check</p>
                    <p className="text-sm text-muted-foreground">
                      Place this last: decide the request, confirm consent, then complete the lightweight anti-abuse check.
                    </p>
                  </div>
                </div>
                {turnstileToken ? (
                  <p className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200">
                    Verification complete. The secure send button is available when required consent is checked.
                  </p>
                ) : null}
                {TURNSTILE_SITE_KEY ? (
                  <div
                    className="cf-turnstile min-h-[65px] max-w-full overflow-x-auto"
                    data-sitekey={TURNSTILE_SITE_KEY}
                    data-callback="onMehyarTurnstile"
                    data-expired-callback="onMehyarTurnstileExpired"
                    data-error-callback="onMehyarTurnstileError"
                    data-theme="auto"
                  />
                ) : IS_LOCAL_PREVIEW ? (
                  <div className="flex items-start gap-2 rounded-xl border border-brand-700/20 bg-brand-100/70 p-3 text-sm text-brand-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-brand-100">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <p>Local preview only: configure VITE_TURNSTILE_SITE_KEY to render Cloudflare verification before secure submit.</p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <p>Secure verification is temporarily unavailable. Please email contact@mehyar.us with the same brief.</p>
                  </div>
                )}
              </div>
            </fieldset>

            <div className="mt-5 space-y-4">
              <div className={statusClassName} role={status === "error" ? "alert" : "status"} aria-live="polite">
                <div className="flex items-start gap-3">
                  {status === "success" ? <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : null}
                  {status === "submitting" ? <Loader2 size={18} className="mt-0.5 flex-shrink-0 animate-spin" aria-hidden="true" /> : null}
                  {status === "error" ? <AlertCircle size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : null}
                  <div>
                    <p className="font-semibold">{currentStatus.title}</p>
                    <p className="mt-1 leading-6">{currentStatus.body}</p>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-xl bg-action px-6 py-6 text-base font-semibold text-white shadow-lg shadow-brand-900/20 transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-60 dark:text-brand-950"
                aria-describedby="submit-readiness"
              >
                {submitButtonLabel}
              </Button>
              <p id="submit-readiness" className="text-center text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                {submitHint}
              </p>
            </div>
          </form>

          <aside className="space-y-6">
            <Card className="border-border bg-card shadow-[0_18px_60px_rgba(8,63,84,0.08)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
              <CardContent className="p-6">
                <h3 className="mb-4 text-xl font-semibold text-ink dark:text-white">What to include</h3>
                <div className="space-y-3">
                  {includeItems.map((item) => (
                    <div key={item} className="flex gap-3 rounded-2xl bg-brand-100/60 p-3 text-sm leading-6 text-muted-foreground dark:bg-white/[0.04]">
                      <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-brand-700/15 bg-brand-100/55 shadow-none dark:border-white/10 dark:bg-white/[0.04]">
              <CardContent className="p-6">
                <h3 className="mb-4 text-xl font-semibold text-ink dark:text-white">What happens next</h3>
                <div className="mb-5 space-y-3">
                  {nextSteps.map((step, index) => (
                    <div key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-white dark:bg-brand-100 dark:text-brand-950">{index + 1}</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
                <h3 className="mb-4 text-xl font-semibold text-ink dark:text-white">Why this form is specific</h3>
                <div className="space-y-4">
                  {trustPoints.map((point) => (
                    <p key={point} className="text-sm leading-6 text-muted-foreground">{point}</p>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-start rounded-2xl border border-border bg-card p-5">
              <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-white/10">
                <Mail className="text-brand-700 dark:text-brand-100" size={18} aria-hidden="true" />
              </div>
              <div className="ml-4">
                <h4 className="font-semibold text-ink dark:text-white">Email fallback</h4>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">If the security check fails, send the same short brief directly.</p>
                <a href="mailto:contact@mehyar.us" className="mt-2 inline-flex text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
                  contact@mehyar.us
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
