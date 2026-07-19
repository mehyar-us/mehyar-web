// IntakePopup — modal dialog for the founder-led intake form.
//
// Triggered from the homepage CTA ("Send the leak") instead of the previous
// inline form on the homepage. The full ContactSection component is still
// used on /contact, /booking, /micro-offer pages — the popup is a focused
// subset of that flow for quick top-of-page conversions.
//
// Simplifications vs the full ContactSection:
// - No topics/frequency selectors (compact: true, compactTopics: true)
// - No "Add optional topics" details toggle
// - No success-card 4-bullet checklist upsell — just a clean confirmation
// - No "Protected by Cloudflare Turnstile…" footer line
// - No verbose status-text that reveals backend internals
//
// The Radix DialogContent already max-h's to 100dvh-2rem and scrolls
// internally; on mobile the form is keyboard-navigable inside the scroll.

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Mail, X } from "lucide-react";
import ConversionFlow, { ConversionFlowMode } from "@/components/conversion/ConversionFlow";

export type IntakePopupProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
  source?: string;
  campaign?: string;
  serviceCategory?: string;
  selectedOffer?: string;
};

const IntakePopup = ({
  open,
  onOpenChange,
  title = "Send the leak.",
  description = "Short brief in, short answer out. No drip campaign, no fake availability — an honest scoped answer or a direct no-fit.",
  source = "home_cta_popup",
  campaign = "contact_general",
  serviceCategory,
  selectedOffer,
}: IntakePopupProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-3 p-0 sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-border/40 bg-[linear-gradient(135deg,rgba(11,82,104,0.10),transparent_70%)] p-5">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 dark:bg-white/10">
            <Mail className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold tracking-[-0.02em] text-ink dark:text-white">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="ml-auto -mr-1 -mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 pt-3">
          <ConversionFlow
            mode={"contact_general" as ConversionFlowMode}
            source={source}
            campaign={campaign}
            serviceCategory={serviceCategory}
            selectedOffer={selectedOffer}
            featureFlags={{ compact: true, compactTopics: true }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default IntakePopup;