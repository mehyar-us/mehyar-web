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

  useEffect(() => {
    document.title = "Unsubscribe | MehyarSoft";
  }, []);

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
    <>
      <section className="pt-28 pb-16 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto max-w-3xl text-center">
          <div className="w-20 h-20 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldOff className="text-primary" size={32} />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">Unsubscribe</h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300">
            Control before scale: every outreach path must honor suppression requests before campaign activity.
          </p>
        </div>
      </section>

      <section className="py-16 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-xl">
          <Card className="bg-white dark:bg-neutral-800 shadow-lg">
            <CardContent className="p-6">
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="unsubscribe-email">Email</Label>
                  <Input id="unsubscribe-email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unsubscribe-reason">Reason (optional)</Label>
                  <Textarea id="unsubscribe-reason" rows={4} placeholder="Optional: tell us what went wrong." value={reason} onChange={(event) => setReason(event.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Submitting..." : "Unsubscribe"}</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
};

export default Unsubscribe;
