import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { mehyarSoftApi } from "@/lib/mehyarsoft-api";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const COMPILED_TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const CLIENT_CONFIG_ENDPOINT = "/api/client-config";
const IS_LOCAL_PREVIEW = import.meta.env.DEV;

type TurnstileConfigStatus = "loading" | "ready" | "missing";
type SubmitStatus = "idle" | "submitting" | "success" | "error";
type NewsletterVariant = "card" | "footer" | "inline";

type NewsletterSignupProps = {
  variant?: NewsletterVariant;
  source?: string;
  title?: string;
  description?: string;
  compact?: boolean;
};

declare global {
  interface Window {
    turnstile?: {
      render?: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset?: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

const interestOptions = [
  { value: "missed_calls_follow_up", label: "Missed calls / follow-up" },
  { value: "website_booking_cleanup", label: "Website or booking cleanup" },
  { value: "ai_automation", label: "AI automation ideas" },
  { value: "crm_systems", label: "CRM / systems cleanup" },
  { value: "regulated_systems", label: "Regulated systems / pharma-style controls" },
  { value: "local_tech_help", label: "Local phone or electronics help" },
];

const statusCopy: Record<SubmitStatus, { title: string; body: string }> = {
  idle: {
    title: "Free checklist",
    body: "Get the practical AI automation checklist. No passwords, private records, or confidential files needed.",
  },
  submitting: {
    title: "Sending securely",
    body: "Cloudflare is verifying the signup before it reaches the intake backend.",
  },
  success: {
    title: "Checklist request received",
    body: "Next step: use the checklist to spot leaks. If you want Boss to review them, the focused $330 audit is the fastest path.",
  },
  error: {
    title: "Signup did not send",
    body: "Please refresh and try again, or email contact@mehyar.us with “free checklist” in the subject.",
  },
};

function normalizeTurnstileSiteKey(value: unknown) {
  const siteKey = typeof value === "string" ? value.trim() : "";
  return /^0x[A-Za-z0-9_-]{16,}$/.test(siteKey) ? siteKey : "";
}

function getUtm(source: string) {
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("utm_source") || source,
    medium: params.get("utm_medium") || "owned_site",
    campaign: params.get("utm_campaign") || "free_ai_automation_checklist",
  };
}

const inputClassName =
  "w-full rounded-xl border-border bg-white px-4 py-3 text-ink shadow-sm transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-brand-950 dark:text-white";

const NewsletterSignup = ({
  variant = "card",
  source = "newsletter_signup",
  title = "Get the free AI automation checklist.",
  description = "A short owner-friendly checklist for finding missed calls, bad website flow, weak follow-up, and manual work before buying another tool.",
  compact = false,
}: NewsletterSignupProps) => {
  const formId = useId().replace(/:/g, "");
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [interest, setInterest] = useState(interestOptions[0].value);
  const [consent, setConsent] = useState(false);
  const [hpField, setHpField] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(() => normalizeTurnstileSiteKey(COMPILED_TURNSTILE_SITE_KEY));
  const [turnstileConfigStatus, setTurnstileConfigStatus] = useState<TurnstileConfigStatus>(() =>
    normalizeTurnstileSiteKey(COMPILED_TURNSTILE_SITE_KEY) ? "ready" : "loading"
  );
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | undefined>(undefined);

  const selectedInterest = interestOptions.find((option) => option.value === interest) ?? interestOptions[0];
  const currentStatus = statusCopy[status];
  const canSubmit = Boolean(email.trim()) && consent && Boolean(turnstileSiteKey) && Boolean(turnstileToken) && status !== "submitting";
  const isFooter = variant === "footer";

  const shellClassName = useMemo(
    () =>
      cn(
        "rounded-[1.5rem] border p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)]",
        {
          "border-border bg-card text-foreground dark:bg-card": variant === "card",
          "border-white/10 bg-white/[0.04] text-white shadow-none": variant === "footer",
          "border-brand-700/20 bg-secondary/80 text-foreground dark:border-white/10 dark:bg-white/[0.04]": variant === "inline",
        }
      ),
    [variant]
  );

  useEffect(() => {
    if (turnstileSiteKey) return;

    let cancelled = false;
    const loadRuntimeConfig = async () => {
      setTurnstileConfigStatus("loading");
      try {
        const response = await fetch(CLIENT_CONFIG_ENDPOINT, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("client_config_unavailable");
        const config = (await response.json()) as { turnstileSiteKey?: unknown };
        const siteKey = normalizeTurnstileSiteKey(config.turnstileSiteKey);
        if (!siteKey) throw new Error("turnstile_site_key_missing");
        if (!cancelled) {
          setTurnstileSiteKey(siteKey);
          setTurnstileConfigStatus("ready");
        }
      } catch {
        if (!cancelled) setTurnstileConfigStatus("missing");
      }
    };

    void loadRuntimeConfig();

    return () => {
      cancelled = true;
    };
  }, [turnstileSiteKey]);

  useEffect(() => {
    const container = turnstileContainerRef.current;
    if (!turnstileSiteKey || !container) return;

    let cancelled = false;
    const renderTurnstile = () => {
      if (cancelled || !window.turnstile?.render || turnstileWidgetIdRef.current) return;
      turnstileWidgetIdRef.current = window.turnstile.render(container, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => {
          setTurnstileToken("");
          setStatus("error");
        },
        theme: "auto",
      });
    };

    if (window.turnstile?.render) {
      renderTurnstile();
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
      const script = existingScript ?? document.createElement("script");
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", renderTurnstile, { once: true });
      if (!existingScript) document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current) {
        window.turnstile?.remove?.(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = undefined;
      }
    };
  }, [turnstileSiteKey]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!consent) {
      toast({ title: "Consent required", description: "Confirm that MehyarSoft may email the checklist and occasional related updates." });
      return;
    }

    if (!turnstileSiteKey || !turnstileToken) {
      toast({ title: "Security check required", description: "Complete the Cloudflare verification before joining the list." });
      return;
    }

    setStatus("submitting");

    try {
      await mehyarSoftApi.submitIntake({
        form_type: "newsletter",
        request_type: "newsletter",
        selected_offer: "free_ai_automation_checklist",
        offer_code: "free_ai_automation_checklist",
        name: name.trim() || undefined,
        email: email.trim(),
        service_interest: selectedInterest.label,
        message: `Free AI automation checklist signup. Interest: ${selectedInterest.label}. Source: ${source}.`,
        consent_contact: consent,
        consent_marketing: consent,
        turnstile_token: turnstileToken,
        hp_field: hpField,
        utm: getUtm(source),
      });

      setStatus("success");
      toast({ title: "Checklist request received", description: "Thanks — the free checklist signup was captured securely." });
      setEmail("");
      setName("");
      setInterest(interestOptions[0].value);
      setConsent(false);
      setHpField("");
      setTurnstileToken("");
      window.turnstile?.reset?.(turnstileWidgetIdRef.current);
    } catch {
      setStatus("error");
      toast({ title: "Could not send signup", description: "Please refresh and try again, or use contact@mehyar.us." });
      window.turnstile?.reset?.(turnstileWidgetIdRef.current);
      setTurnstileToken("");
    }
  };

  return (
    <section className={shellClassName} aria-labelledby={`${formId}-title`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className={cn("mb-2 text-xs font-semibold uppercase tracking-[0.18em]", isFooter ? "text-brand-100" : "text-brand-700 dark:text-brand-100")}>Free checklist</p>
          <h2 id={`${formId}-title`} className={cn("text-2xl font-semibold tracking-[-0.035em]", isFooter ? "text-white" : "text-ink dark:text-white")}>
            {title}
          </h2>
        </div>
        <ShieldCheck className={cn("mt-1 h-5 w-5 flex-shrink-0", isFooter ? "text-brand-100" : "text-brand-700 dark:text-brand-100")} aria-hidden="true" />
      </div>
      <p className={cn("text-sm leading-6", isFooter ? "text-neutral-300" : "text-muted-foreground")}>{description}</p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="hidden" aria-hidden="true">
          <Label htmlFor={`${formId}-hp`}>Leave blank</Label>
          <Input id={`${formId}-hp`} tabIndex={-1} autoComplete="off" value={hpField} onChange={(event) => setHpField(event.target.value)} />
        </div>

        {!compact ? (
          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`} className={isFooter ? "text-white" : undefined}>Name <span className="font-normal opacity-70">optional</span></Label>
            <Input id={`${formId}-name`} value={name} onChange={(event) => { setName(event.target.value); if (status !== "submitting") setStatus("idle"); }} className={inputClassName} placeholder="Your name" autoComplete="name" />
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={`${formId}-email`} className={isFooter ? "text-white" : undefined}>Email</Label>
          <Input id={`${formId}-email`} type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (status !== "submitting") setStatus("idle"); }} className={inputClassName} placeholder="you@company.com" autoComplete="email" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${formId}-interest`} className={isFooter ? "text-white" : undefined}>What do you want to fix first?</Label>
          <select
            id={`${formId}-interest`}
            value={interest}
            onChange={(event) => { setInterest(event.target.value); if (status !== "submitting") setStatus("idle"); }}
            className={inputClassName}
          >
            {interestOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <label htmlFor={`${formId}-consent`} className={cn("flex cursor-pointer items-start gap-3 text-sm leading-6", isFooter ? "text-neutral-300" : "text-muted-foreground")}>
          <Checkbox id={`${formId}-consent`} checked={consent} onCheckedChange={(checked) => { setConsent(checked === true); if (status !== "submitting") setStatus("idle"); }} className="mt-1" />
          <span>
            <span className={cn("font-semibold", isFooter ? "text-white" : "text-ink dark:text-white")}>Required:</span> email me the checklist and occasional MehyarSoft updates about websites, missed calls, follow-up, and automation. Unsubscribe anytime.
          </span>
        </label>

        <div className={cn("rounded-2xl border p-3", isFooter ? "border-white/10 bg-black/15" : "border-border bg-white dark:bg-white/[0.04]")}>
          {turnstileToken ? (
            <p className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200">
              Verification complete.
            </p>
          ) : null}
          {turnstileSiteKey ? (
            <div ref={turnstileContainerRef} className="min-h-[65px] max-w-full overflow-x-auto" />
          ) : turnstileConfigStatus === "loading" ? (
            <div className={cn("flex items-start gap-2 rounded-xl p-3 text-sm", isFooter ? "bg-white/10 text-neutral-200" : "bg-brand-100/70 text-brand-900 dark:bg-white/[0.04] dark:text-brand-100")} role="status" aria-live="polite">
              <Loader2 size={16} className="mt-0.5 flex-shrink-0 animate-spin" aria-hidden="true" />
              <p>Preparing Cloudflare verification.</p>
            </div>
          ) : IS_LOCAL_PREVIEW ? (
            <div className={cn("flex items-start gap-2 rounded-xl p-3 text-sm", isFooter ? "bg-white/10 text-neutral-200" : "bg-brand-100/70 text-brand-900 dark:bg-white/[0.04] dark:text-brand-100")}>
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p>Local preview: configure VITE_TURNSTILE_SITE_KEY to test secure submit.</p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100" role="status" aria-live="polite">
              <Loader2 size={16} className="mt-0.5 flex-shrink-0 animate-spin" aria-hidden="true" />
              <p>Preparing secure verification. Refresh if it does not appear.</p>
            </div>
          )}
        </div>

        <div className={cn("rounded-2xl border p-3 text-sm", {
          "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300": status === "idle",
          "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200": status === "submitting",
          "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200": status === "success",
          "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200": status === "error",
        })} role={status === "error" ? "alert" : "status"} aria-live="polite">
          <div className="flex items-start gap-2">
            {status === "success" ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : null}
            {status === "submitting" ? <Loader2 size={16} className="mt-0.5 flex-shrink-0 animate-spin" aria-hidden="true" /> : null}
            {status === "error" ? <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : null}
            <div>
              <p className="font-semibold">{currentStatus.title}</p>
              <p className="mt-1 leading-6">{currentStatus.body}</p>
              {status === "success" ? (
                <a href="/330?request_type=micro_offer&utm_campaign=newsletter_thank_you#intake" className={cn(buttonVariants({ variant: "cta", size: "sm" }), "mt-3 rounded-full")}>Request the $330 audit</a>
              ) : null}
            </div>
          </div>
        </div>

        <Button type="submit" disabled={!canSubmit} className="w-full rounded-xl bg-action px-5 py-5 text-sm font-semibold text-white shadow-lg shadow-brand-900/20 transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-60 dark:text-brand-950">
          {status === "submitting" ? "Joining securely..." : "Send me the free checklist"}
        </Button>
        <p className={cn("text-xs leading-5", isFooter ? "text-neutral-400" : "text-muted-foreground")}>
          Protected by Cloudflare Turnstile. Do not submit passwords, API keys, PHI, payment data, or confidential customer lists.
        </p>
      </form>
    </section>
  );
};

export default NewsletterSignup;
