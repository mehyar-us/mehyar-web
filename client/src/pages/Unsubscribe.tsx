import { ShieldOff } from "lucide-react";
import ConversionFlow, { SubscriptionPreferences } from "@/components/conversion/ConversionFlow";

const Unsubscribe = () => {
  return (
    <section className="bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.12),transparent_34%),linear-gradient(180deg,hsl(var(--background))_0%,#fff_100%)] px-4 pb-16 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_34%),linear-gradient(180deg,hsl(var(--brand-950))_0%,hsl(var(--background))_100%)] md:pb-20 md:pt-32">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card text-brand-700 shadow-[0_1px_2px_rgba(10,20,24,0.06)] dark:text-brand-100">
            <ShieldOff className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Suppression and preferences</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Unsubscribe or update preferences</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
            One-click unsubscribe stays visible and does not require an account, survey, or marketing preference update first.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <ConversionFlow mode="unsubscribe" source="mehyar-web-unsubscribe" campaign="unsubscribe" />
          <SubscriptionPreferences source="mehyar-web-preferences" campaign="subscription_preferences" title="Keep only useful updates." description="Prefer fewer emails? Choose topics and frequency instead of fully unsubscribing." />
        </div>
      </div>
    </section>
  );
};

export default Unsubscribe;
