import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { trackPublicAnalyticsEvent } from "@/components/GoogleAnalytics";
import { IntakeFormType, mehyarSoftApi } from "@/lib/mehyarsoft-api";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const COMPILED_TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const CLIENT_CONFIG_ENDPOINT = "/api/client-config";
const LOCAL_QA_TURNSTILE_TOKEN = "test-valid";

type TurnstileConfigStatus = "loading" | "ready" | "missing";
type SubmitStatus = "idle" | "submitting" | "success" | "error";

export type ConversionFlowMode =
  | "contact_general"
  | "newsletter_signup"
  | "offer_330_missed_lead_rescue"
  | "booking_call"
  | "unsubscribe"
  | "subscription_preferences"
  | "payment_test_hidden";

type ConversionFlowProps = {
  mode: ConversionFlowMode;
  selectedOffer?: string;
  serviceCategory?: string;
  source?: string;
  campaign?: string;
  prefill?: Partial<ConversionFormState>;
  returnUrl?: string;
  featureFlags?: {
    allowHiddenPaymentTest?: boolean;
    compact?: boolean;
  };
  adminContext?: {
    operator?: string;
    routeAccessClass?: string;
  };
  title?: string;
  description?: string;
  variant?: "card" | "footer" | "inline";
};

type ConversionFormState = {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  zip_code: string;
  phone: string;
  business_name: string;
  website: string;
  message: string;
  service_category: string;
  urgency: string;
  budget_range: string;
  preferred_contact_method: string;
  missed_lead_channel: string;
  current_tools: string;
  estimated_missed_leads: string;
  desired_outcome: string;
  requested_time_window: string;
  topics: string[];
  frequency: string;
  unsubscribe_reason: string;
  hp_field: string;
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

const inputClassName =
  "min-h-11 w-full rounded-xl border-border bg-white px-4 py-3 text-ink shadow-sm transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-brand-950 dark:text-white";

const textareaClassName = cn(inputClassName, "min-h-32 resize-y leading-7");

const modeCopy: Record<ConversionFlowMode, { eyebrow: string; title: string; description: string; success: string; submit: string }> = {
  contact_general: {
    eyebrow: "Founder-led intake",
    title: "Request a practical next step.",
    description: "Tell us what is leaking: website clarity, missed calls, booking friction, manual work, or disconnected systems.",
    success: "Got it — we’ll review and respond with the next practical step.",
    submit: "Request practical next step",
  },
  newsletter_signup: {
    eyebrow: "Free checklist",
    title: "Get the free AI automation checklist.",
    description: "One focused email path for practical updates. No spam, no fake urgency, unsubscribe anytime.",
    success: "Checklist request received. You can update preferences or unsubscribe anytime.",
    submit: "Send me the checklist",
  },
  offer_330_missed_lead_rescue: {
    eyebrow: "$330 rescue intake",
    title: "Request the $330 AI missed-lead rescue path.",
    description: "Tell us where calls, forms, emails, booking, or follow-up are slipping so Boss can route the smallest useful first step.",
    success: "Request received. We’ll review your missed-lead setup and reply with the next best step.",
    submit: "Request the $330 review",
  },
  booking_call: {
    eyebrow: "Book a call",
    title: "Request a MehyarSoft booking call.",
    description: "Choose the closest service. If live calendar auth is unavailable, this captures a manual scheduling request without faking availability.",
    success: "Booking request received. If a confirmed slot is not available, we’ll send available times manually.",
    submit: "Request booking time",
  },
  unsubscribe: {
    eyebrow: "Suppression request",
    title: "Unsubscribe from MehyarSoft updates.",
    description: "One clear unsubscribe path. The optional reason appears only after the unsubscribe action and is never required.",
    success: "You’re unsubscribed. The suppression request was recorded.",
    submit: "Unsubscribe",
  },
  subscription_preferences: {
    eyebrow: "Preferences",
    title: "Update email preferences.",
    description: "Choose what you want to hear about and how often. Full unsubscribe remains available.",
    success: "Preferences updated.",
    submit: "Update preferences",
  },
  payment_test_hidden: {
    eyebrow: "Hidden payment test",
    title: "Operator-only payment path test.",
    description: "Sandbox/test evidence only. This mode must not be linked from public nav, footer, sitemap, or SEO surfaces.",
    success: "Payment test evidence recorded.",
    submit: "Record hidden test evidence",
  },
};

const serviceOptions = [
  { value: "ai_missed_lead_rescue_330", label: "$330 AI Missed-Lead Rescue", publicLabel: "Fix missed calls or missed leads", formType: "micro_offer" as IntakeFormType },
  { value: "tech_audit", label: "Tech Audit", publicLabel: "Audit my tech / website", formType: "audit" as IntakeFormType },
  { value: "website_booking_cleanup", label: "Website cleanup / landing page / booking setup", publicLabel: "Clean up website or booking", formType: "booking" as IntakeFormType },
  { value: "ai_follow_up", label: "AI missed-call / SMS / email follow-up flow", publicLabel: "Set up AI follow-up", formType: "booking" as IntakeFormType },
  { value: "automation_sprint", label: "Internal automation sprint", publicLabel: "Automate internal work", formType: "contact" as IntakeFormType },
  { value: "systems_consulting", label: "Systems architecture / integration consulting", publicLabel: "Connect systems / architecture help", formType: "contact" as IntakeFormType },
  { value: "retainer", label: "Monthly support retainer", publicLabel: "Monthly help / support", formType: "contact" as IntakeFormType },
  { value: "general", label: "General consultation", publicLabel: "Not sure — help me choose", formType: "contact" as IntakeFormType, notSure: true },
];

const serviceAliases: Record<string, string> = {
  "tech-audit": "tech_audit",
  "website-booking-cleanup": "website_booking_cleanup",
  "missed-call-followup": "ai_follow_up",
  "automation-sprint": "automation_sprint",
  "systems-integration": "systems_consulting",
  "custom-software": "systems_consulting",
  "crm-support-retainer": "retainer",
  "330": "ai_missed_lead_rescue_330",
  "micro-offer": "ai_missed_lead_rescue_330",
};

function normalizeServiceRequest(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (serviceAliases[trimmed]) return serviceAliases[trimmed];
  const underscored = trimmed.replace(/-/g, "_");
  return serviceOptions.some((option) => option.value === underscored) ? underscored : trimmed;
}

const topicOptions = [
  { value: "ai_automation", label: "AI automation" },
  { value: "missed_leads", label: "Missed leads" },
  { value: "website_cleanup", label: "Website cleanup" },
  { value: "booking_systems", label: "Booking systems" },
  { value: "tech_audits", label: "Tech audits" },
  { value: "systems_crm", label: "Systems / CRM" },
  { value: "offers", label: "Offers" },
];

const defaultFormState: ConversionFormState = {
  name: "",
  first_name: "",
  last_name: "",
  email: "",
  zip_code: "",
  phone: "",
  business_name: "",
  website: "",
  message: "",
  service_category: "general",
  urgency: "not_sure",
  budget_range: "not_sure",
  preferred_contact_method: "email",
  missed_lead_channel: "not_sure",
  current_tools: "not_sure",
  estimated_missed_leads: "unknown",
  desired_outcome: "not_sure",
  requested_time_window: "",
  topics: ["ai_automation"],
  frequency: "weekly",
  unsubscribe_reason: "",
  hp_field: "",
};

function normalizeTurnstileSiteKey(value: unknown) {
  const siteKey = typeof value === "string" ? value.trim() : "";
  return /^0x[A-Za-z0-9_-]{16,}$/.test(siteKey) ? siteKey : "";
}

function isLocalQaTurnstileEnabled() {
  if (typeof window === "undefined") return false;
  const localHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
  return localHosts.includes(window.location.hostname) && new URLSearchParams(window.location.search).get("qa_turnstile") === "1";
}

function shouldFetchRuntimeClientConfig() {
  if (typeof window === "undefined") return false;
  if (COMPILED_TURNSTILE_SITE_KEY) return false;
  return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(window.location.hostname);
}

function getUrlDefaults(mode: ConversionFlowMode, serviceCategory?: string, campaign?: string) {
  if (typeof window === "undefined") return { form: defaultFormState, source: "mehyar_web", campaign: campaign || "" };
  const params = new URLSearchParams(window.location.search);
  const route = window.location.pathname;
  const requestedService = normalizeServiceRequest(params.get("service") || params.get("service_category") || serviceCategory || "");
  const requestedOffer = params.get("offer") || params.get("offer_code") || "";
  const requestType = params.get("request_type") || params.get("form_type") || "";
  const is330 = route === "/330" || route === "/micro-offer" || requestType === "micro_offer" || requestedOffer.includes("330");
  const serviceMatch = serviceOptions.find((option) => [option.value, option.label, option.publicLabel].includes(requestedService));
  const serviceDefault = is330 ? "ai_missed_lead_rescue_330" : serviceMatch?.value || (mode === "booking_call" ? "tech_audit" : "general");

  return {
    form: {
      ...defaultFormState,
      email: params.get("email") || "",
      first_name: params.get("first_name") || params.get("first") || "",
      last_name: params.get("last_name") || params.get("last") || "",
      zip_code: params.get("zip") || params.get("zip_code") || "",
      service_category: serviceDefault,
      budget_range: is330 ? "$330 setup deposit / audit path" : defaultFormState.budget_range,
      urgency: is330 ? "this_week" : defaultFormState.urgency,
      requested_time_window: params.get("time") || "",
    },
    source: params.get("utm_source") || params.get("source") || "mehyar_web",
    campaign: params.get("utm_campaign") || campaign || (is330 ? "330_micro_offer" : "conversion_flow"),
  };
}

function mapModeToFormType(mode: ConversionFlowMode, service: string): IntakeFormType {
  if (mode === "newsletter_signup" || mode === "subscription_preferences") return "newsletter";
  if (mode === "offer_330_missed_lead_rescue") return "micro_offer";
  if (mode === "booking_call") return "booking";
  const serviceOption = serviceOptions.find((option) => option.value === service);
  return serviceOption?.formType || "contact";
}

function ConversionTurnstile({
  isFooter,
  enabled,
  onToken,
  onError,
}: {
  isFooter: boolean;
  enabled: boolean;
  onToken: (token: string) => void;
  onError: () => void;
}) {
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState(() => normalizeTurnstileSiteKey(COMPILED_TURNSTILE_SITE_KEY));
  const [turnstileConfigStatus, setTurnstileConfigStatus] = useState<TurnstileConfigStatus>(() =>
    normalizeTurnstileSiteKey(COMPILED_TURNSTILE_SITE_KEY) ? "ready" : "loading"
  );
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    if (turnstileSiteKey) return;

    if (isLocalQaTurnstileEnabled()) {
      setTurnstileToken(LOCAL_QA_TURNSTILE_TOKEN);
      onToken(LOCAL_QA_TURNSTILE_TOKEN);
      setTurnstileConfigStatus("missing");
      return;
    }

    if (!shouldFetchRuntimeClientConfig()) {
      setTurnstileConfigStatus("missing");
      return;
    }

    let cancelled = false;
    const loadRuntimeConfig = async () => {
      setTurnstileConfigStatus("loading");
      try {
        const response = await fetch(CLIENT_CONFIG_ENDPOINT, { headers: { accept: "application/json" }, cache: "no-store" });
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
  }, [enabled, onToken, turnstileSiteKey]);

  useEffect(() => {
    const container = turnstileContainerRef.current;
    if (!enabled || !turnstileSiteKey || !container) return;

    let cancelled = false;
    const renderTurnstile = () => {
      if (cancelled || !window.turnstile?.render || turnstileWidgetIdRef.current) return;
      turnstileWidgetIdRef.current = window.turnstile.render(container, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => {
          setTurnstileToken(token);
          onToken(token);
        },
        "expired-callback": () => {
          setTurnstileToken("");
          onToken("");
        },
        "error-callback": () => {
          setTurnstileToken("");
          onToken("");
          onError();
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
  }, [enabled, onError, onToken, turnstileSiteKey]);

  return (
    <div className={cn("rounded-2xl border p-3", isFooter ? "border-white/10 bg-black/15" : "border-border bg-white dark:bg-white/[0.04]")}>
      {enabled && turnstileToken ? (
        <p className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200">
          {turnstileToken === LOCAL_QA_TURNSTILE_TOKEN ? "Local QA verification enabled." : "Verification complete."}
        </p>
      ) : null}
      {!enabled ? (
        <div className={cn("flex items-start gap-2 rounded-xl p-3 text-sm", isFooter ? "bg-white/10 text-neutral-200" : "bg-brand-100/70 text-brand-900 dark:bg-white/[0.04] dark:text-brand-100")} role="status" aria-live="polite">
          <ShieldCheck size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p>Cloudflare verification loads after the required fields and consent are ready.</p>
        </div>
      ) : turnstileSiteKey ? (
        <div ref={turnstileContainerRef} className="min-h-[65px] max-w-full overflow-x-auto" />
      ) : turnstileConfigStatus === "loading" ? (
        <div className={cn("flex items-start gap-2 rounded-xl p-3 text-sm", isFooter ? "bg-white/10 text-neutral-200" : "bg-brand-100/70 text-brand-900 dark:bg-white/[0.04] dark:text-brand-100")} role="status" aria-live="polite">
          <Loader2 size={16} className="mt-0.5 flex-shrink-0 animate-spin" aria-hidden="true" />
          <p>Preparing Cloudflare verification.</p>
        </div>
      ) : isLocalQaTurnstileEnabled() ? (
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
  );
}

export function ConversionFlow({
  mode,
  selectedOffer,
  serviceCategory,
  source,
  campaign,
  prefill,
  returnUrl,
  featureFlags,
  adminContext,
  title,
  description,
  variant = "card",
}: ConversionFlowProps) {
  const formId = useId().replace(/:/g, "");
  const { toast } = useToast();
  const urlDefaults = useMemo(() => getUrlDefaults(mode, serviceCategory, campaign), [campaign, mode, serviceCategory]);
  const [form, setForm] = useState<ConversionFormState>(() => ({ ...urlDefaults.form, ...prefill }));
  const [service, setService] = useState(urlDefaults.form.service_category);
  const [consentContact, setConsentContact] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [showDetails, setShowDetails] = useState(mode !== "newsletter_signup");

  const copy = modeCopy[mode];
  const isFooter = variant === "footer";
  const isNewsletter = mode === "newsletter_signup" || mode === "subscription_preferences";
  const isUnsubscribe = mode === "unsubscribe";
  const isBooking = mode === "booking_call";
  const isOffer330 = mode === "offer_330_missed_lead_rescue";
  const isPaymentTest = mode === "payment_test_hidden";
  const serviceOption = serviceOptions.find((option) => option.value === service) ?? serviceOptions[serviceOptions.length - 1];
  const notSureSelected = Boolean(serviceOption.notSure);
  const compact = Boolean(featureFlags?.compact);
  const sourceValue = source || urlDefaults.source;
  const campaignValue = campaign || urlDefaults.campaign;

  const hiddenPaymentAllowed = !isPaymentTest || Boolean(featureFlags?.allowHiddenPaymentTest || adminContext?.routeAccessClass);
  const needsServiceConsent = !isUnsubscribe && mode !== "subscription_preferences" && !isPaymentTest;
  const hasContactMethod = Boolean(form.email.trim() || form.phone.trim());
  const needsIdentity = !isNewsletter && !isUnsubscribe && !isPaymentTest;
  const identityReady = !needsIdentity || (Boolean(form.name.trim()) && hasContactMethod && Boolean(form.message.trim()));
  const consentReady = !needsServiceConsent || consentContact || isNewsletter;
  const turnstileEnabled = !isUnsubscribe && !isPaymentTest && identityReady && consentReady && (isNewsletter ? Boolean(form.email.trim()) && consentMarketing : true);
  const canSubmit =
    hiddenPaymentAllowed &&
    status !== "submitting" &&
    (isUnsubscribe ? Boolean(form.email.trim()) : true) &&
    (isNewsletter ? Boolean(form.email.trim()) : true) &&
    identityReady &&
    consentReady &&
    (isNewsletter ? consentMarketing : true) &&
    (isUnsubscribe || isPaymentTest || Boolean(turnstileToken));

  const shellClassName = cn("rounded-[1.5rem] border p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] sm:p-6", {
    "border-border bg-card text-foreground dark:bg-card": variant === "card",
    "border-white/10 bg-white/[0.04] text-white shadow-none": variant === "footer",
    "border-brand-700/20 bg-secondary/80 text-foreground dark:border-white/10 dark:bg-white/[0.04]": variant === "inline",
  });

  const setField = (field: keyof ConversionFormState, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (status === "success" || status === "error") setStatus("idle");
  };

  const toggleTopic = (topic: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      topics: checked ? Array.from(new Set([...prev.topics, topic])) : prev.topics.filter((item) => item !== topic),
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    trackPublicAnalyticsEvent("lead_attempt", {
      form_type: mapModeToFormType(mode, service),
      conversion_mode: mode,
      offer_code: isOffer330 ? "ai_missed_lead_rescue_330" : selectedOffer,
      service_category: serviceOption.label,
      not_sure_selected: notSureSelected,
      source: sourceValue,
      campaign: campaignValue,
      consent_contact: consentContact || consentMarketing,
      turnstile_ready: Boolean(turnstileToken),
    });

    if (!hiddenPaymentAllowed) {
      toast({ title: "Hidden test blocked", description: "Payment test UI requires an operator-only route or feature flag." });
      return;
    }

    if (!canSubmit) {
      toast({ title: "Complete required fields", description: "Add contact details, consent, and Cloudflare verification where required." });
      return;
    }

    setStatus("submitting");
    try {
      if (isUnsubscribe) {
        await mehyarSoftApi.unsubscribe({ email: form.email.trim(), reason: form.unsubscribe_reason.trim() || undefined, source: sourceValue });
      } else if (isPaymentTest) {
        await mehyarSoftApi.submitIntake({
          form_type: "contact",
          request_type: "contact",
          email: form.email.trim() || "operator-test@mehyarsoft.local",
          name: form.name.trim() || adminContext?.operator || "Operator payment test",
          message: "Hidden sandbox payment flow evidence request. No card data or raw tokens submitted through this public component.",
          service_interest: "Hidden payment test evidence",
          selected_offer: "payment_test_hidden",
          consent_contact: true,
          consent_marketing: false,
          turnstile_token: turnstileToken || "operator-hidden-payment-test",
          hp_field: form.hp_field,
          payment_test_environment: "sandbox",
          route_access_class: adminContext?.routeAccessClass || "operator_gated",
          public_ui_exposure_check: "hidden_not_nav_footer_sitemap",
        });
      } else {
        const formType = mapModeToFormType(mode, service);
        await mehyarSoftApi.submitIntake({
          form_type: formType,
          request_type: formType,
          selected_offer: isOffer330 ? "ai_missed_lead_rescue_330" : selectedOffer,
          offer_code: isOffer330 ? "ai_missed_lead_rescue_330" : selectedOffer,
          value_estimate: isOffer330 ? 330 : undefined,
          calendar_intent: isBooking || isOffer330 ? "manual_booking_request_or_calendar_fallback" : undefined,
          name: isNewsletter ? [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(" ") || undefined : form.name.trim() || undefined,
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          company: form.business_name.trim() || undefined,
          website: form.website.trim() || undefined,
          service_interest: serviceOption.label,
          budget_range: form.budget_range,
          timeline: form.urgency,
          message: [
            form.message.trim(),
            isBooking ? `Requested time window: ${form.requested_time_window || "manual scheduling needed"}.` : "",
            isOffer330 ? `Missed-lead channel: ${form.missed_lead_channel}; current tools: ${form.current_tools}; estimated missed leads: ${form.estimated_missed_leads}; desired outcome: ${form.desired_outcome}.` : "",
            isNewsletter ? `First name: ${form.first_name || ""}; last name: ${form.last_name || ""}; ZIP: ${form.zip_code || ""}; topics: ${form.topics.join(", ")}; frequency: ${form.frequency}.` : "",
            notSureSelected ? "User selected Not sure — help me choose; route to General consultation with low confidence." : "",
          ]
            .filter(Boolean)
            .join("\n"),
          consent_contact: needsServiceConsent ? consentContact : consentMarketing,
          consent_marketing: isNewsletter || consentMarketing,
          turnstile_token: turnstileToken,
          hp_field: form.hp_field,
          conversion_mode: mode,
          service_category_public_label: serviceOption.publicLabel,
          service_category_internal_key: service,
          intent_confidence: notSureSelected ? "low" : "medium",
          not_sure_selected: notSureSelected,
          preferred_contact_method: form.preferred_contact_method,
          requested_time_window: form.requested_time_window,
          availability_status: isBooking ? "manual_fallback_if_calendar_unavailable" : undefined,
          calendar_write_status: isBooking ? "requires_explicit_confirmation" : undefined,
          utm: { source: sourceValue, medium: "owned_site", campaign: campaignValue },
        });
      }

      setStatus("success");
      toast({ title: copy.success, description: returnUrl ? "You can continue from the next safe step." : "Captured securely." });
      setConsentContact(false);
      setConsentMarketing(false);
      setTurnstileToken("");
      if (returnUrl) window.setTimeout(() => (window.location.href = returnUrl), 800);
    } catch (error) {
      setStatus("error");
      toast({
        title: isUnsubscribe ? "Could not process request" : "Could not send request",
        description: error instanceof Error ? error.message : "Please refresh and try again, or email contact@mehyar.us.",
        variant: "destructive",
      });
      setTurnstileToken("");
    }
  };

  if (isPaymentTest && !hiddenPaymentAllowed) {
    return (
      <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="font-semibold">Hidden payment test is gated.</p>
        <p className="mt-2 text-sm leading-6">No public payment UI is exposed from this route without an operator feature flag or admin context.</p>
      </section>
    );
  }

  return (
    <section className={shellClassName} aria-labelledby={`${formId}-title`} data-conversion-mode={mode}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className={cn("mb-2 text-xs font-semibold uppercase tracking-[0.18em]", isFooter ? "text-brand-100" : "text-brand-700 dark:text-brand-100")}>{copy.eyebrow}</p>
          <h2 id={`${formId}-title`} className={cn("text-2xl font-semibold tracking-[-0.035em] sm:text-3xl", isFooter ? "text-white" : "text-ink dark:text-white")}>
            {title || copy.title}
          </h2>
        </div>
        {isBooking ? <CalendarClock className="mt-1 h-5 w-5 flex-shrink-0 text-brand-700 dark:text-brand-100" aria-hidden="true" /> : <ShieldCheck className={cn("mt-1 h-5 w-5 flex-shrink-0", isFooter ? "text-brand-100" : "text-brand-700 dark:text-brand-100")} aria-hidden="true" />}
      </div>
      <p className={cn("text-sm leading-6", isFooter ? "text-neutral-300" : "text-muted-foreground")}>{description || copy.description}</p>

      <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
        <div className="hidden" aria-hidden="true">
          <Label htmlFor={`${formId}-hp`}>Leave blank</Label>
          <Input id={`${formId}-hp`} tabIndex={-1} autoComplete="off" value={form.hp_field} onChange={(event) => setField("hp_field", event.target.value)} />
        </div>

        {!isNewsletter && !isUnsubscribe ? (
          <div className="space-y-3 rounded-2xl border border-brand-700/15 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <Label htmlFor={`${formId}-service`}>What do you need?</Label>
            <select id={`${formId}-service`} value={service} onChange={(event) => setService(event.target.value)} className={inputClassName}>
              {serviceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.publicLabel}</option>
              ))}
            </select>
            {notSureSelected ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-100">
                <Sparkles className="mr-2 inline h-4 w-4" aria-hidden="true" />
                AI helper mode: send whatever you know. MehyarSoft will triage the request, identify the likely leak, and recommend audit, booking, automation, or consulting next.
              </div>
            ) : (
              <div className="rounded-xl border border-brand-700/15 bg-brand-50/80 p-3 text-sm leading-6 text-brand-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-brand-100">
                <Sparkles className="mr-2 inline h-4 w-4" aria-hidden="true" />
                Smart default: {serviceOption.label}. If this is not right, choose “Not sure” and the AI-assisted request audit will route it.
              </div>
            )}
          </div>
        ) : null}

        {isNewsletter ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`${formId}-email`}>Email <span className="text-red-600 dark:text-red-300">required</span></Label>
              <Input id={`${formId}-email`} type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} className={inputClassName} placeholder="you@company.com" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-first-name`}>First name <span className="font-normal text-neutral-500">optional</span></Label>
              <Input id={`${formId}-first-name`} value={form.first_name} onChange={(event) => setField("first_name", event.target.value)} className={inputClassName} placeholder="First name" autoComplete="given-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-last-name`}>Last name <span className="font-normal text-neutral-500">optional</span></Label>
              <Input id={`${formId}-last-name`} value={form.last_name} onChange={(event) => setField("last_name", event.target.value)} className={inputClassName} placeholder="Last name" autoComplete="family-name" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor={`${formId}-zip`}>ZIP code <span className="font-normal text-neutral-500">optional</span></Label>
              <Input id={`${formId}-zip`} value={form.zip_code} onChange={(event) => setField("zip_code", event.target.value)} className={inputClassName} placeholder="Optional ZIP code" autoComplete="postal-code" inputMode="numeric" />
            </div>
          </div>
        ) : (
          <div className={cn("grid grid-cols-1 gap-4", compact || isUnsubscribe ? "" : "md:grid-cols-2")}>
            {!isUnsubscribe ? (
              <div className="space-y-2">
                <Label htmlFor={`${formId}-name`}>Name</Label>
                <Input id={`${formId}-name`} value={form.name} onChange={(event) => setField("name", event.target.value)} className={inputClassName} placeholder="Your name" autoComplete="name" aria-required="true" />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={`${formId}-email`}>Email{!isUnsubscribe ? " or phone required" : ""}</Label>
              <Input id={`${formId}-email`} type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} className={inputClassName} placeholder="you@company.com" autoComplete="email" required={isUnsubscribe} />
            </div>
            {!isUnsubscribe ? (
              <div className="space-y-2">
                <Label htmlFor={`${formId}-phone`}>Phone <span className="font-normal text-neutral-500">optional if email provided</span></Label>
                <Input id={`${formId}-phone`} value={form.phone} onChange={(event) => setField("phone", event.target.value)} className={inputClassName} placeholder="Optional phone" autoComplete="tel" />
              </div>
            ) : null}
            {!compact && !isUnsubscribe ? (
              <div className="space-y-2">
                <Label htmlFor={`${formId}-business`}>Business / company <span className="font-normal text-neutral-500">optional</span></Label>
                <Input id={`${formId}-business`} value={form.business_name} onChange={(event) => setField("business_name", event.target.value)} className={inputClassName} placeholder="Restaurant, clinic, agency, SaaS..." autoComplete="organization" />
              </div>
            ) : null}
          </div>
        )}

        {isNewsletter ? (
          <div className={cn("space-y-4 rounded-2xl border p-4", isFooter ? "border-white/15 bg-black/15" : "border-border bg-white dark:bg-white/[0.04]")}>
            <div className="grid gap-3 sm:grid-cols-2">
              {topicOptions.map((topic) => (
                <label key={topic.value} htmlFor={`${formId}-topic-${topic.value}`} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm", isFooter ? "border-white/15 bg-white/10 text-neutral-100" : "border-border text-foreground")}>
                  <Checkbox id={`${formId}-topic-${topic.value}`} checked={form.topics.includes(topic.value)} onCheckedChange={(checked) => toggleTopic(topic.value, checked === true)} />
                  <span className={isFooter ? "text-neutral-100" : undefined}>{topic.label}</span>
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-frequency`}>Frequency</Label>
              <select id={`${formId}-frequency`} value={form.frequency} onChange={(event) => setField("frequency", event.target.value)} className={inputClassName}>
                <option value="important_only">Important only</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        ) : null}

        {isOffer330 && showDetails ? (
          <div className="grid gap-4 rounded-2xl border border-border bg-white p-4 dark:bg-white/[0.04] md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-channel`}>Where are leads missed?</Label>
              <select id={`${formId}-channel`} value={form.missed_lead_channel} onChange={(event) => setField("missed_lead_channel", event.target.value)} className={inputClassName}>
                <option value="phone">Phone</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="website_form">Website form</option>
                <option value="booking">Booking</option>
                <option value="crm">CRM</option>
                <option value="not_sure">Not sure</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-tools`}>Current tools</Label>
              <select id={`${formId}-tools`} value={form.current_tools} onChange={(event) => setField("current_tools", event.target.value)} className={inputClassName}>
                <option value="none">None</option>
                <option value="gmail_zoho">Gmail / Zoho</option>
                <option value="google_calendar">Google Calendar</option>
                <option value="website_form">Website form</option>
                <option value="crm">CRM</option>
                <option value="booking_tool">Booking tool</option>
                <option value="other">Other</option>
                <option value="not_sure">Not sure</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-missed-estimate`}>Estimated missed leads</Label>
              <select id={`${formId}-missed-estimate`} value={form.estimated_missed_leads} onChange={(event) => setField("estimated_missed_leads", event.target.value)} className={inputClassName}>
                <option value="unknown">Unknown</option>
                <option value="1_5_month">1–5 / month</option>
                <option value="6_20_month">6–20 / month</option>
                <option value="20_plus_month">20+ / month</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-outcome`}>Desired outcome</Label>
              <select id={`${formId}-outcome`} value={form.desired_outcome} onChange={(event) => setField("desired_outcome", event.target.value)} className={inputClassName}>
                <option value="respond_faster">Respond faster</option>
                <option value="automate_follow_up">Automate follow-up</option>
                <option value="setup_booking">Setup booking</option>
                <option value="audit_first">Audit first</option>
                <option value="not_sure">Not sure</option>
              </select>
            </div>
          </div>
        ) : null}

        {isBooking ? (
          <div className="space-y-4 rounded-2xl border border-border bg-white p-4 dark:bg-white/[0.04]">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-time-window`}>Requested time window</Label>
              <Input id={`${formId}-time-window`} value={form.requested_time_window} onChange={(event) => setField("requested_time_window", event.target.value)} className={inputClassName} placeholder="Example: Tue/Thu afternoon, next week, mornings" />
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
              Calendar rule: availability is shown only when authenticated. If OAuth is unavailable, this form creates a manual scheduling request. It never fakes slots or creates an event without explicit confirmation.
            </div>
          </div>
        ) : null}

        {!isNewsletter && !isUnsubscribe ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-1">
                <Label htmlFor={`${formId}-urgency`}>Urgency</Label>
                <select id={`${formId}-urgency`} value={form.urgency} onChange={(event) => setField("urgency", event.target.value)} className={inputClassName}>
                  <option value="this_week">This week</option>
                  <option value="30_days">Next 30 days</option>
                  <option value="later">Later</option>
                  <option value="not_sure">Not sure</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-contact-method`}>Preferred contact</Label>
                <select id={`${formId}-contact-method`} value={form.preferred_contact_method} onChange={(event) => setField("preferred_contact_method", event.target.value)} className={inputClassName}>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="either">Either</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-budget`}>Budget range</Label>
                <select id={`${formId}-budget`} value={form.budget_range} onChange={(event) => setField("budget_range", event.target.value)} className={inputClassName}>
                  <option value="not_sure">Not sure</option>
                  <option value="$330 setup deposit / audit path">$330 audit path</option>
                  <option value="$500-$5k">$500–$5k</option>
                  <option value="$5k+">$5k+</option>
                  <option value="retainer">Monthly retainer</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-website`}>Website <span className="font-normal text-neutral-500">optional</span></Label>
              <Input id={`${formId}-website`} type="url" value={form.website} onChange={(event) => setField("website", event.target.value)} className={inputClassName} placeholder="https://example.com" autoComplete="url" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-message`}>Short context</Label>
              <Textarea id={`${formId}-message`} value={form.message} onChange={(event) => setField("message", event.target.value)} rows={5} className={textareaClassName} placeholder="Example: We miss after-hours calls, leads do not get followed up, booking is manual, and nobody trusts the CRM data." required={!isPaymentTest} />
              <p className="text-xs leading-5 text-muted-foreground">Do not paste passwords, API keys, PHI, payment data, private customer lists, or confidential files.</p>
            </div>
          </>
        ) : null}

        {isUnsubscribe ? (
          <div className="space-y-4 rounded-2xl border border-border bg-white p-4 dark:bg-white/[0.04]">
            <p className="text-sm leading-6 text-muted-foreground">Submitting unsubscribes this email first. The survey below is optional and not required.</p>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-reason`}>Reason after unsubscribe <span className="font-normal text-neutral-500">optional</span></Label>
              <Textarea id={`${formId}-reason`} rows={4} placeholder="Optional: tell us what went wrong." value={form.unsubscribe_reason} onChange={(event) => setField("unsubscribe_reason", event.target.value)} className={textareaClassName} />
            </div>
          </div>
        ) : null}

        {!isUnsubscribe && !isPaymentTest ? (
          <div className="space-y-4 rounded-2xl border border-border bg-white p-4 dark:bg-white/[0.04]">
            {!isNewsletter ? (
              <label htmlFor={`${formId}-consent-contact`} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6 text-muted-foreground">
                <Checkbox id={`${formId}-consent-contact`} checked={consentContact} onCheckedChange={(checked) => setConsentContact(checked === true)} className="mt-1" />
                <span><span className="font-semibold text-ink dark:text-white">Required:</span> MehyarSoft LLC may contact me about this request by email or phone if provided. This is only service follow-up.</span>
              </label>
            ) : null}
            <label htmlFor={`${formId}-consent-marketing`} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6 text-muted-foreground">
              <Checkbox id={`${formId}-consent-marketing`} checked={consentMarketing} onCheckedChange={(checked) => setConsentMarketing(checked === true)} className="mt-1" />
              <span><span className="font-semibold text-ink dark:text-white">{isNewsletter ? "Required:" : "Optional:"}</span> send occasional MehyarSoft updates. Unsubscribe anytime.</span>
            </label>
          </div>
        ) : null}

        {!isUnsubscribe ? <ConversionTurnstile isFooter={isFooter} enabled={turnstileEnabled} onToken={setTurnstileToken} onError={() => setStatus("error")} /> : null}

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
              <p className="font-semibold">{status === "success" ? copy.success : status === "error" ? "The request did not send" : status === "submitting" ? "Sending securely" : "Ready when the required fields are complete"}</p>
              <p className="mt-1 leading-6">
                {status === "idle" ? "Cloudflare verification, consent, source/campaign metadata, and safe routing are handled in this shared conversion component." : status === "success" ? "No internal IDs, secrets, or raw backend errors are shown." : status === "error" ? "Please refresh and try again, or email contact@mehyar.us without sensitive data." : "Hold tight — this is being delivered through the secure intake path."}
              </p>
              {status === "success" && isNewsletter ? (
                <a href="/330?request_type=micro_offer&utm_campaign=newsletter_thank_you#intake" className={cn(buttonVariants({ variant: "cta", size: "sm" }), "mt-3 rounded-full")}>Request the $330 audit</a>
              ) : null}
            </div>
          </div>
        </div>

        {isNewsletter && !showDetails ? (
          <Button type="button" variant="outline" className="w-full rounded-xl" onClick={() => setShowDetails(true)}>
            Add optional topics and frequency
          </Button>
        ) : null}

        <Button type="submit" disabled={!canSubmit} className="w-full rounded-xl bg-action px-5 py-5 text-sm font-semibold text-white shadow-lg shadow-brand-900/20 transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-60 dark:text-brand-950">
          {status === "submitting" ? "Sending securely..." : copy.submit}
        </Button>
        <p className={cn("text-xs leading-5", isFooter ? "text-neutral-400" : "text-muted-foreground")}>
          Protected by Cloudflare Turnstile where applicable. Never submit passwords, API keys, PHI, payment data, or confidential customer lists.
        </p>
      </form>
    </section>
  );
}

export const BaseConversionForm = ConversionFlow;
export const SmartSignup = (props: Omit<ConversionFlowProps, "mode">) => <ConversionFlow {...props} mode="newsletter_signup" />;
export const BookingCallFlow = (props: Omit<ConversionFlowProps, "mode">) => <ConversionFlow {...props} mode="booking_call" />;
export const SubscriptionPreferences = (props: Omit<ConversionFlowProps, "mode">) => <ConversionFlow {...props} mode="subscription_preferences" />;

export default ConversionFlow;
