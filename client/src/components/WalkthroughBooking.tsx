import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock3, Loader2, Mail, Phone, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConversionTurnstile } from "@/components/conversion/ConversionFlow";
import { useToast } from "@/hooks/use-toast";

/* ── Walkthrough-call picker for the $330 post-checkout return ────────────
   A buyer who just paid lands on /audit/?token=… and, until now, met no way
   to book the walkthrough the offer implies. This compact picker reuses the
   proven calendar backend (GET /api/calendar/availability, POST
   /api/calendar/book — the same endpoints /booking runs on) inside the
   report view, in both the generating and ready states. */

type Slot = { start: string; end: string; label: string; date: string; timezone: string };
type Availability = { ok: boolean; slots: Slot[]; timezone: string; duration_minutes: number; min_notice_hours: number; work_hours: string; message?: string };

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function dayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return {
    dow: dt.toLocaleDateString("en-US", { weekday: "short" }),
    md: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

export default function WalkthroughBooking({ businessName }: { businessName?: string }) {
  const { toast } = useToast();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ label: string } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [consent, setConsent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: businessName || "", notes: "" });

  const loadAvailability = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/calendar/availability?days=21", { headers: { accept: "application/json" }, cache: "no-store" });
      const payload = (await response.json()) as Availability;
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Live calendar is temporarily unavailable.");
      setAvailability(payload);
      if (payload.slots[0]) setSelectedDate(payload.slots[0].date);
    } catch {
      setAvailability(null);
      setLoadError("Live times are temporarily unavailable. Please try again shortly or email info@mehyar.us.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAvailability(); }, [loadAvailability]);
  useEffect(() => { if (businessName && !form.company) setForm((c) => ({ ...c, company: businessName })); }, [businessName]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of availability?.slots || []) map.set(slot.date, [...(map.get(slot.date) || []), slot]);
    return map;
  }, [availability]);
  const days = useMemo(() => [...grouped.keys()], [grouped]);
  const daySlots = grouped.get(selectedDate) || [];
  const detailsReady = Boolean(form.name.trim() && form.email.trim() && form.phone.trim() && selectedSlot && consent);

  const setField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);
  const handleTurnstileError = useCallback(() => setTurnstileToken(""), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detailsReady || !turnstileToken || !selectedSlot) {
      toast({ title: "Finish the booking details", description: "Choose a time, add your name, email and phone, accept contact about this call, and complete verification." });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          booking_id: crypto.randomUUID(),
          start: selectedSlot.start,
          selected_label: selectedSlot.label,
          client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          page_url: "https://mehyar.us/audit",
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          company: form.company.trim(),
          service_interest: "Audit My Business — report walkthrough",
          message: form.notes.trim(),
          consent_contact: consent,
          consent_marketing: false,
          turnstile_token: turnstileToken,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "That time could not be booked. Please choose another slot.");
      setConfirmed({ label: payload.appointment.label });
      setTurnstileToken("");
      setTurnstileReset((v) => v + 1);
      toast({ title: "Walkthrough booked", description: "Your call is confirmed and confirmation emails are on the way." });
    } catch (error) {
      toast({ title: "Booking not completed", description: error instanceof Error ? error.message : "Refresh the available times and try again.", variant: "destructive" });
      setTurnstileToken("");
      setTurnstileReset((v) => v + 1);
      await loadAvailability();
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="no-print mt-10 text-left shadow-xl shadow-brand-900/5">
      <CardContent className="p-6 md:p-8">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-100">
          <CalendarClock className="h-4 w-4" aria-hidden="true" /> Included with your audit
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">Book your report walkthrough call</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          A 30-minute call to walk through your report's findings and the fix order, live. Pick a real open time — Monday to Friday, 9 AM–5 PM ET, at least 24 hours out.
        </p>

        {confirmed ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Your walkthrough call is booked.</p>
              <p className="mt-1 text-sm">{confirmed.label}. Confirmation emails are on the way to you and info@mehyar.us — reply to yours if anything changes.</p>
            </div>
          </div>
        ) : loading ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking live availability…</p>
        ) : loadError ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-sm leading-6 text-foreground">{loadError}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={loadAvailability}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Try again</Button>
              <Button type="button" size="sm" variant="outline" asChild><a href="mailto:info@mehyar.us?subject=Report%20walkthrough%20call">Email info@mehyar.us</a></Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-100">1. Choose a day</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {days.map((key) => {
                const { dow, md } = dayLabel(key);
                const active = key === selectedDate;
                return (
                  <button key={key} type="button" onClick={() => { setSelectedDate(key); setSelectedSlot(null); }}
                    className={`min-h-11 rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${active ? "border-brand-800 bg-brand-800 text-white dark:border-brand-100 dark:bg-brand-100 dark:text-brand-950" : "border-border bg-background hover:border-brand-700/50"}`}>
                    {dow} · {md}
                  </button>
                );
              })}
            </div>

            <p className="mt-5 text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-100">2. Choose a time (ET)</p>
            {daySlots.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {daySlots.map((slot) => {
                  const active = selectedSlot?.start === slot.start;
                  return (
                    <button key={slot.start} type="button" onClick={() => setSelectedSlot(slot)}
                      className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition ${active ? "border-brand-800 bg-brand-800 text-white dark:border-brand-100 dark:bg-brand-100 dark:text-brand-950" : "border-border bg-background hover:border-brand-700/50"}`}>
                      <Clock3 className="mr-1.5 inline h-4 w-4" aria-hidden="true" />{timeLabel(slot.start)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 rounded-xl bg-muted p-4 text-sm text-muted-foreground">Choose an available date to see open times.</p>
            )}
            {selectedSlot && (
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Selected: {selectedSlot.label}
              </p>
            )}

            <p className="mt-5 text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-100">3. Tell us who to call</p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="wt-name">Your name *</Label><Input id="wt-name" value={form.name} onChange={(e) => setField("name", e.target.value)} autoComplete="name" required /></div>
              <div className="space-y-2"><Label htmlFor="wt-email">Email *</Label><Input id="wt-email" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} autoComplete="email" required /></div>
              <div className="space-y-2"><Label htmlFor="wt-phone">Phone we should call *</Label><Input id="wt-phone" type="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)} autoComplete="tel" required /></div>
              <div className="space-y-2"><Label htmlFor="wt-company">Business name</Label><Input id="wt-company" value={form.company} onChange={(e) => setField("company", e.target.value)} autoComplete="organization" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="wt-notes">Anything you want covered first?</Label><Textarea id="wt-notes" value={form.notes} onChange={(e) => setField("notes", e.target.value)} rows={3} placeholder="The finding you want to start with, or a question for the call" /></div>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border bg-muted/30 p-4 text-sm leading-6">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-800" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span><strong>Required:</strong> MehyarSoft may email or call me about this appointment.</span>
            </label>

            <div className="mt-4">
              <ConversionTurnstile isFooter={false} enabled={detailsReady} resetSignal={turnstileReset} onToken={handleTurnstileToken} onError={handleTurnstileError} />
            </div>

            <Button type="submit" size="lg" className="mt-4 min-h-13 w-full rounded-2xl text-base" disabled={!detailsReady || !turnstileToken || submitting}>
              {submitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />Confirming your appointment…</> : <><Phone className="mr-2 h-5 w-5" aria-hidden="true" />Book your walkthrough call</>}
            </Button>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              We recheck the slot before booking and email both you and info@mehyar.us. Prefer email? <a className="font-semibold text-brand-800 dark:text-brand-100" href="mailto:info@mehyar.us"><Mail className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />info@mehyar.us</a>
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
