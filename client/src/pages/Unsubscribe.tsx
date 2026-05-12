import { useEffect, useState } from "react";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { mehyarSoftApi } from "@/lib/mehyarsoft-api";

const Unsubscribe = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await mehyarSoftApi.unsubscribe({ email, reason, source: "mehyar-web-unsubscribe" });
      toast({ title: "You're unsubscribed", description: "This email has been added to the suppression list." });
      setEmail("");
      setReason("");
    } catch (error) {
      toast({
        title: "Could not process unsubscribe",
        description: error instanceof Error ? error.message : "Please email contact@mehyar.us.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.12),transparent_34%),linear-gradient(180deg,hsl(var(--background))_0%,#fff_100%)] px-4 pb-16 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_34%),linear-gradient(180deg,hsl(var(--brand-950))_0%,hsl(var(--background))_100%)] md:pb-20 md:pt-32">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card text-brand-700 shadow-[0_1px_2px_rgba(10,20,24,0.06)] dark:text-brand-100">
            <ShieldOff className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Suppression request</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Unsubscribe</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
            Control before scale: every outreach path must honor suppression requests before campaign activity.
          </p>
        </div>

        <Card className="border-border bg-card shadow-[0_24px_80px_rgba(8,63,84,0.10)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
          <CardContent className="p-6 md:p-8">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="unsubscribe-email">Email</Label>
                <Input id="unsubscribe-email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unsubscribe-reason">Reason (optional)</Label>
                <Textarea id="unsubscribe-reason" rows={4} placeholder="Optional: tell us what went wrong." value={reason} onChange={(event) => setReason(event.target.value)} />
              </div>
              <div className="rounded-2xl border border-border bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
                Submitting this form records a suppression request for this email. It is not a client portal and should not include passwords, customer records, or confidential business data.
              </div>
              <Button type="submit" variant="cta" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Submitting..." : "Unsubscribe"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default Unsubscribe;
