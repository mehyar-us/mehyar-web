import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

declare global {
  interface Window {
    onMehyarTurnstile?: (token: string) => void;
    turnstile?: { reset?: () => void };
  }
}

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

type FormState = {
  name: string;
  email: string;
  company: string;
  website: string;
  service_interest: string;
  budget_range: string;
  timeline: string;
  message: string;
  hp_field: string;
};

const initialFormData: FormState = {
  name: "",
  email: "",
  company: "",
  website: "",
  service_interest: "",
  budget_range: "",
  timeline: "",
  message: "",
  hp_field: "",
};

const ContactSection = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState<FormState>(initialFormData);
  const [consentContact, setConsentContact] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  useEffect(() => {
    window.onMehyarTurnstile = (token: string) => setTurnstileToken(token);
    if (TURNSTILE_SITE_KEY && !document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]')) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    return () => {
      delete window.onMehyarTurnstile;
    };
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentContact) {
      toast({ title: "Consent required", description: "Please confirm MehyarSoft may contact you about this request." });
      return;
    }
    if (!TURNSTILE_SITE_KEY || !turnstileToken) {
      toast({ title: "Security check required", description: "Please complete the verification before sending." });
      return;
    }

    setStatus("submitting");
    try {
      const params = new URLSearchParams(window.location.search);
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          form_type: "contact",
          ...formData,
          consent_contact: consentContact,
          consent_marketing: consentMarketing,
          turnstile_token: turnstileToken,
          utm: {
            source: params.get("utm_source") || "",
            medium: params.get("utm_medium") || "",
            campaign: params.get("utm_campaign") || "",
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        throw new Error("intake_failed");
      }
      setStatus("success");
      toast({ title: "Request received", description: "Thanks — your request was received." });
      setFormData(initialFormData);
      setConsentContact(false);
      setConsentMarketing(false);
      setTurnstileToken("");
      window.turnstile?.reset?.();
    } catch {
      setStatus("error");
      toast({ title: "Could not send request", description: "Please email contact@mehyar.us if the form does not go through." });
    }
  };

  return (
    <section id="contact" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Request a tech audit or consulting call
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Describe the business, the current workflow, and where leads or time are being lost. The response will focus on the smallest practical next step.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-12">
          <div className="lg:w-1/2">
            <form id="contactForm" className="space-y-6" onSubmit={handleSubmit}>
              <div className="hidden" aria-hidden="true">
                <Label htmlFor="hp_field">Leave this field blank</Label>
                <Input type="text" id="hp_field" tabIndex={-1} autoComplete="off" value={formData.hp_field} onChange={handleChange} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name</Label>
                  <Input type="text" id="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Your name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Email</Label>
                  <Input type="email" id="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="you@company.com" required />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="company" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Business / company</Label>
                  <Input type="text" id="company" value={formData.company} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Restaurant, clinic, agency, SaaS, etc." />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Website</Label>
                  <Input type="url" id="website" value={formData.website} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="https://example.com" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="service_interest" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Need</Label>
                  <Input id="service_interest" value={formData.service_interest} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Audit, CRM, AI phone, automation" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="budget_range" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Budget range</Label>
                  <Input id="budget_range" value={formData.budget_range} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="$500–$5k, $5k+, unsure" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timeline" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Timeline</Label>
                  <Input id="timeline" value={formData.timeline} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="This week, 30 days, later" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="message" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">What needs fixing?</Label>
                <Textarea id="message" value={formData.message} onChange={handleChange} rows={5} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none" placeholder="Example: We miss calls after hours, leads do not get followed up, and booking is manual." required />
              </div>
              <div className="space-y-4 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
                <label className="flex items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
                  <Checkbox checked={consentContact} onCheckedChange={(checked) => setConsentContact(checked === true)} className="mt-1" />
                  <span>I agree that MehyarSoft LLC may contact me about this request.</span>
                </label>
                <label className="flex items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
                  <Checkbox checked={consentMarketing} onCheckedChange={(checked) => setConsentMarketing(checked === true)} className="mt-1" />
                  <span>Optional: send me occasional MehyarSoft updates. This is separate from service follow-up.</span>
                </label>
              </div>
              {TURNSTILE_SITE_KEY ? (
                <div className="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} data-callback="onMehyarTurnstile" data-theme="auto" />
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Security verification is not configured yet. Please email contact@mehyar.us directly.
                </p>
              )}
              <Button type="submit" disabled={status === "submitting"} className="w-full px-6 py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-md hover:shadow-lg">
                {status === "submitting" ? "Sending..." : "Send Request"}
              </Button>
              {status === "success" && <p className="text-sm text-green-700 dark:text-green-300">Thanks — your request was received.</p>}
              {status === "error" && <p className="text-sm text-red-700 dark:text-red-300">The form could not send. Please email contact@mehyar.us.</p>}
            </form>
          </div>
          <div className="lg:w-1/2 space-y-8">
            <div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">What to include</h3>
              <div className="space-y-4">
                {["Business type and city/service area", "Current website, CRM, booking, phone, or email tools", "Where customers or staff time are being lost", "Urgency and budget range if known"].map((item) => (
                  <Card key={item} className="bg-white dark:bg-neutral-800 shadow-sm">
                    <CardContent className="p-4 text-neutral-700 dark:text-neutral-300">{item}</CardContent>
                  </Card>
                ))}
              </div>
            </div>
            <div className="flex items-start">
              <div className="w-10 h-10 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <Mail className="text-primary" size={18} />
              </div>
              <div className="ml-4">
                <h4 className="font-medium text-neutral-900 dark:text-white">Email fallback</h4>
                <a href="mailto:contact@mehyar.us" className="text-neutral-700 dark:text-neutral-300 hover:text-primary">contact@mehyar.us</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
