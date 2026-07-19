// ChecklistPopup — modal dialog that opens the AI checklist newsletter signup.
//
// Triggered from the Footer ("Get the free AI checklist" link) instead of an
// always-visible inline signup card. The form is the same ConversionFlow used
// elsewhere, just scoped to a Dialog so it doesn't take up permanent layout
// space. Persists "dismissed today" in sessionStorage so a returning visitor
// doesn't get the popup bouncing back during the same browsing session.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles, X } from "lucide-react";
import ConversionFlow, { ConversionFlowMode } from "@/components/conversion/ConversionFlow";

const STORAGE_KEY = "mehyar-checklist-popup-dismissed";
const SESSION_HOURS = 6;

const shouldShowAutomatically = () => {
  if (typeof window === "undefined") return false;
  if (window.sessionStorage.getItem(STORAGE_KEY)) return false;
  // Wait 8 seconds on the homepage before opening — feels less aggressive than
  // an immediate popup, and gives the visitor a chance to actually read the page.
  return true;
};

export type ChecklistPopupProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
  source?: string;
};

const ChecklistPopup = ({
  open,
  onOpenChange,
  title = "Get the free AI checklist.",
  description = "A practical checklist for missed calls, weak follow-up, website leaks, and manual work. Short, no-fluff, unsubscribe anytime.",
  source = "footer_popup",
}: ChecklistPopupProps) => {
  const handleClose = (v: boolean) => {
    if (!v && typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    }
    onOpenChange(v);
  };
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg gap-3 p-0 sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-border/40 bg-[linear-gradient(135deg,rgba(11,82,104,0.10),transparent_70%)] p-5">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-100 dark:bg-white/10">
            <Sparkles className="h-4 w-4 text-brand-700 dark:text-brand-100" aria-hidden="true" />
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
            onClick={() => handleClose(false)}
            aria-label="Close"
            className="ml-auto -mr-1 -mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 pt-3">
          <ConversionFlow
            mode={"newsletter_signup" as ConversionFlowMode}
            source={source}
            campaign="checklist_popup"
            featureFlags={{ compact: true, compactTopics: true }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChecklistPopup;

// Hook that owns the popup state for the Footer / global trigger.
// Returns the open-state setter so any UI can call `openPopup()`.
export const useChecklistPopup = () => {
  const [open, setOpen] = useState(false);
  return { open, setOpen, openPopup: () => setOpen(true), closePopup: () => setOpen(false) };
};

// Auto-opens on home page once per session, after a short delay. Honors the
// sessionStorage dismissal so closing the popup doesn't immediately reopen it.
export const ChecklistPopupAutoOpen = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!shouldShowAutomatically()) return;
    const t = window.setTimeout(() => setOpen(true), 8_000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <ChecklistPopup
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && typeof window !== "undefined") {
          window.sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
        }
      }}
    />
  );
};

// Re-export a couple of helper to keep the time-dismissal logic simple:
export const _resetChecklistPopupDismissal = () => {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
};

// Use the SESSION_HOURS constant to detect stale dismissals when reading.
export const _isDismissalStale = () => {
  if (typeof window === "undefined") return true;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return true;
  const t = Number(raw);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > SESSION_HOURS * 60 * 60 * 1000;
};
