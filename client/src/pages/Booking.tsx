import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, CheckCircle2, Clock3, Loader2, Mail, Phone, RefreshCw, ShieldCheck } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConversionTurnstile } from "@/components/conversion/ConversionFlow";
import { useToast } from "@/hooks/use-toast";

type Slot = { start: string; end: string; label: string; date: string; timezone: string };
type Availability = { ok: boolean; slots: Slot[]; timezone: string; duration_minutes: number; min_notice_hours: number; work_hours: string; error?: string; message?: string };

const SERVICE_OPTIONS = [
  "Free discovery call",
  "Website or booking system",
  "AI, SMS, or email automation",
  "AI phone and customer care",
  "OpenClaw or Hermes business agent",
  "Social media automation",
  "Maintenance or support",
  "Not sure - help me choose",
];

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Booking() {
  const { toast } = useToast();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ label: string; id: string } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [consent, setConsent] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", service: SERVICE_OPTIONS[0], notes: "", hp_field: "" });

  const loadAvailability = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/calendar/availability?days=21", { headers: { accept: "application/json" }, cache: "no-store" });
      const payload = (await response.json()) as Availability;
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Live calendar is temporarily unavailable.");
      setAvailability(payload);
      if (payload.slots[0]) setSelectedDate(dateFromKey(payload.slots[0].date));
    } catch {
      setAvailability(null);
      setLoadError("Live availability is temporarily unavailable. Please try again shortly or email info@mehyar.us.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAvailability(); }, [loadAvailability]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of availability?.slots || []) map.set(slot.date, [...(map.get(slot.date) || []), slot]);
    return map;
  }, [availability]);
  const availableDates = useMemo(() => new Set(grouped.keys()), [grouped]);
  const selectedDateKey = selectedDate ? dayKey(selectedDate) : "";
  const daySlots = grouped.get(selectedDateKey) || [];
  const detailsReady = Boolean(form.name.trim() && form.email.trim() && form.phone.trim() && selectedSlot && consent);

  const setField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);
  const handleTurnstileError = useCallback(() => setTurnstileToken(""), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detailsReady || !turnstileToken || !selectedSlot) {
      toast({ title: "Finish the booking details", description: "Choose a time, add your name, email and phone, accept service follow-up, and complete verification." });
      return;
    }
    setSubmitting(true);
    const bookingId = crypto.randomUUID();
    try {
      const response = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, start: selectedSlot.start, selected_label: selectedSlot.label, client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, page_url: window.location.href, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), company: form.company.trim(), service_interest: form.service, message: form.notes.trim(), consent_contact: consent, consent_marketing: marketing, turnstile_token: turnstileToken, hp_field: form.hp_field }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "That time could not be booked. Please choose another slot.");
      setConfirmed({ label: payload.appointment.label, id: payload.appointment.id });
      setTurnstileToken("");
      setTurnstileReset((value) => value + 1);
      toast({ title: "Call booked", description: "Your appointment is confirmed and confirmation emails are on the way." });
    } catch (error) {
      toast({ title: "Booking not completed", description: error instanceof Error ? error.message : "Refresh the available times and try again.", variant: "destructive" });
      await loadAvailability();
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmed) {
    return (
      <main className="min-h-[75vh] bg-brand-50 px-4 pb-20 pt-28 dark:bg-brand-950">
        <Card className="mx-auto max-w-xl overflow-hidden border-emerald-200 shadow-2xl dark:border-emerald-900">
          <CardContent className="p-7 text-center sm:p-10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="h-8 w-8" /></div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">Your call is booked.</h1>
            <p className="mt-3 text-lg font-semibold text-brand-800 dark:text-brand-100">{confirmed.label}</p>
            <p className="mt-4 leading-7 text-muted-foreground">Your appointment is confirmed. We sent the details to you and info@mehyar.us.</p>
            <div className="mt-6 rounded-2xl bg-muted/70 p-4 text-left text-sm"><strong>What happens next:</strong> Mehyar will call the phone number you provided. Reply to the confirmation email if anything changes.</div>
            <Button className="mt-7" onClick={() => window.location.assign("/")}>Back to MehyarSoft</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="bg-brand-50 pb-20 pt-24 dark:bg-brand-950 sm:pt-28">
      <section className="px-4"><div className="container mx-auto max-w-6xl">
        <div className="mb-8 max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Book a phone call</p><h1 className="mt-3 text-4xl font-bold tracking-tight text-ink dark:text-white sm:text-5xl">Choose a real open time.</h1><p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">Pick a time directly from Mehyar&apos;s live availability. Calls are 30 minutes, Monday through Friday, with at least 24 hours&apos; notice.</p></div>
        {loading ? (
          <Card><CardContent className="flex min-h-80 items-center justify-center gap-3 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Checking live availability…</CardContent></Card>
        ) : loadError ? (
          <Card className="border-amber-200 dark:border-amber-900"><CardContent className="p-7"><h2 className="text-xl font-semibold">Live times are temporarily unavailable.</h2><p className="mt-2 leading-7 text-muted-foreground">{loadError}</p><div className="mt-5 flex flex-wrap gap-3"><Button onClick={loadAvailability}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button><Button variant="outline" asChild><a href="mailto:info@mehyar.us?subject=Call%20request">Email info@mehyar.us</a></Button></div></CardContent></Card>
        ) : (
          <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
            <Card className="overflow-hidden shadow-xl shadow-brand-900/5 lg:sticky lg:top-24"><CardContent className="p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-100">1. Choose a day</p><h2 className="mt-1 text-xl font-semibold">Available dates</h2></div><Button type="button" size="icon" variant="ghost" onClick={loadAvailability} aria-label="Refresh availability"><RefreshCw className="h-4 w-4" /></Button></div>
              <Calendar mode="single" selected={selectedDate} onSelect={(date) => { setSelectedDate(date); setSelectedSlot(null); }} disabled={(date) => !availableDates.has(dayKey(date))} className="mx-auto w-fit rounded-2xl border bg-background" />
              <div className="mt-5"><p className="mb-3 text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-100">2. Choose a time</p>{daySlots.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">{daySlots.map((slot) => { const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(slot.start)); const active = selectedSlot?.start === slot.start; return <button key={slot.start} type="button" onClick={() => setSelectedSlot(slot)} className={`min-h-12 rounded-xl border px-3 py-2 text-sm font-semibold transition ${active ? "border-brand-800 bg-brand-800 text-white dark:border-brand-100 dark:bg-brand-100 dark:text-brand-950" : "border-border bg-background hover:border-brand-700/50"}`}><Clock3 className="mr-1.5 inline h-4 w-4" />{time}</button>; })}</div> : <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Choose an available date to see open times.</p>}</div>
              <div className="mt-5 grid grid-cols-2 gap-2 text-xs text-muted-foreground"><div className="rounded-xl bg-muted/70 p-3"><CalendarIcon className="mb-1 h-4 w-4 text-brand-700" />Mon-Fri, 9 AM-5 PM ET</div><div className="rounded-xl bg-muted/70 p-3"><Clock3 className="mb-1 h-4 w-4 text-brand-700" />30-minute phone call</div></div>
            </CardContent></Card>
            <Card className="shadow-xl shadow-brand-900/5"><CardContent className="p-5 sm:p-7">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-100">3. Tell us who to call</p><h2 className="mt-1 text-2xl font-semibold">Your details</h2>
              {selectedSlot ? <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>Selected:</strong><br />{selectedSlot.label}</div></div> : <div className="mt-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Choose a date and time first.</div>}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="booking-name">Your name *</Label><Input id="booking-name" value={form.name} onChange={(event) => setField("name", event.target.value)} autoComplete="name" required /></div>
                <div className="space-y-2"><Label htmlFor="booking-email">Email *</Label><Input id="booking-email" type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} autoComplete="email" required /></div>
                <div className="space-y-2"><Label htmlFor="booking-phone">Phone we should call *</Label><Input id="booking-phone" type="tel" value={form.phone} onChange={(event) => setField("phone", event.target.value)} autoComplete="tel" required /></div>
                <div className="space-y-2"><Label htmlFor="booking-company">Business name</Label><Input id="booking-company" value={form.company} onChange={(event) => setField("company", event.target.value)} autoComplete="organization" /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="booking-service">What should we discuss?</Label><select id="booking-service" value={form.service} onChange={(event) => setField("service", event.target.value)} className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">{SERVICE_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="booking-notes">Anything helpful before the call?</Label><Textarea id="booking-notes" value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={4} placeholder="Your website, current problem, or goal" /></div>
                <input aria-hidden="true" tabIndex={-1} autoComplete="off" className="hidden" value={form.hp_field} onChange={(event) => setField("hp_field", event.target.value)} />
              </div>
              <div className="mt-5 space-y-3 rounded-2xl border bg-muted/30 p-4 text-sm leading-6"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-800" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><strong>Required:</strong> MehyarSoft may email or call me about this appointment.</span></label><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand-800" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /><span><strong>Optional:</strong> Send occasional practical updates. Unsubscribe anytime.</span></label></div>
              <div className="mt-5"><ConversionTurnstile isFooter={false} enabled={detailsReady} resetSignal={turnstileReset} onToken={handleTurnstileToken} onError={handleTurnstileError} /></div>
              <Button type="submit" size="lg" className="mt-5 min-h-14 w-full rounded-2xl text-base" disabled={!detailsReady || !turnstileToken || submitting}>{submitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Confirming your appointment…</> : <><Phone className="mr-2 h-5 w-5" />Book this phone call</>}</Button>
              <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />We recheck the slot before booking, create the event only once, and email both you and info@mehyar.us.</div>
              <a href="mailto:info@mehyar.us" className="mt-4 flex min-h-11 items-center justify-center gap-2 text-sm font-semibold text-brand-800 dark:text-brand-100"><Mail className="h-4 w-4" />Prefer email? info@mehyar.us</a>
            </CardContent></Card>
          </form>
        )}
      </div></section>
    </main>
  );
}
