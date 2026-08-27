import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import ConversionFlow from "@/components/conversion/ConversionFlow";

const SUPPORT_EVENT = "mehyarsoft:open-support";

export function openSupportTicket() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SUPPORT_EVENT));
}

export default function SupportTicketModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(SUPPORT_EVENT, handleOpen);
    return () => window.removeEventListener(SUPPORT_EVENT, handleOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl p-0 sm:rounded-3xl">
        <DialogTitle className="sr-only">Create a MehyarSoft support ticket</DialogTitle>
        <DialogDescription className="sr-only">Send business, contact, affected-service, maintenance, and urgency details to MehyarSoft support.</DialogDescription>
        <div className="flex items-center gap-3 border-b border-border bg-brand-100/55 px-5 py-4 dark:bg-white/[0.04]">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-950 text-brand-100"><LifeBuoy className="h-5 w-5" /></span>
          <div><p className="font-semibold text-foreground">MehyarSoft support</p><p className="text-sm text-muted-foreground">Website, app, automation, maintenance, or account help</p></div>
        </div>
        <div className="p-4 sm:p-6">
          <ConversionFlow mode="support_ticket" source="global_support_ticket" campaign="support" serviceCategory="support_request" variant="inline" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
