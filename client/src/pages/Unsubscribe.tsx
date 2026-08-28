import { ShieldOff } from "lucide-react";
import ConversionFlow, { SubscriptionPreferences } from "@/components/conversion/ConversionFlow";

const Unsubscribe = () => {
  return (
    <section className="site-hero">
      <div className="site-shell max-w-4xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card text-brand-700 shadow-[0_1px_2px_rgba(10,20,24,0.06)] dark:text-brand-100">
            <ShieldOff className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="site-eyebrow mb-3">Suppression and preferences</p>
          <h1 className="site-display">Unsubscribe or update preferences</h1>
          <p className="site-lede mx-auto mt-4 max-w-2xl">
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
