import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function PwaControls({compact=false}:{compact?:boolean}) {
  const [install, setInstall] = useState<InstallEvent | null>(null),
    [installed, setInstalled] = useState(false),
    [help, setHelp] = useState(false),
    [waiting, setWaiting] = useState<ServiceWorkerRegistration | null>(null),
    [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  useEffect(() => {
    const sync = () =>
      setInstalled(
        window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone ===
            true,
      );
    const capture = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    const appInstalled = () => {
      sync();
      setInstalled(true);
      setInstall(null);
    };
    const update = (e: Event) => setWaiting((e as CustomEvent).detail);
    const guide = () => setHelp(true);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.getRegistration("/").then((reg) => {
        if (reg?.waiting) setWaiting(reg);
      });
    sync();
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", appInstalled);
    window.addEventListener("mehyar-pwa-update", update);
    window.addEventListener("mehyar-install-guide", guide);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", appInstalled);
      window.removeEventListener("mehyar-pwa-update", update);
      window.removeEventListener("mehyar-install-guide", guide);
    };
  }, []);
  useEffect(() => {
    if (
      !["localhost", "127.0.0.1", "mehyar.us", "www.mehyar.us"].includes(location.hostname) ||
      !new URLSearchParams(location.search).has("qa_pwa")
    )
      return;
    const inspect = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const names = await caches.keys();
        const entries = [];
        for (const name of names.filter((n) =>
          n.startsWith("mehyar-discovery-"),
        )) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) entries.push(request.url);
        }
        setDiagnostics(
          JSON.stringify({
            active: !!reg?.active,
            waiting: !!reg?.waiting,
            controlled: !!navigator.serviceWorker.controller,
            caches: names,
            entries,
          }),
        );
      } catch {
        setDiagnostics(JSON.stringify({ available: false }));
      }
    };
    void inspect();
    navigator.serviceWorker?.addEventListener("controllerchange", inspect);
    return () =>
      navigator.serviceWorker?.removeEventListener("controllerchange", inspect);
  }, []);
  const doInstall = async () => {
    if (!install) {
      setHelp(true);
      return;
    }
    await install.prompt();
    const choice = await install.userChoice;
    setMessage(
      choice.outcome === "accepted"
        ? "Installation requested. Follow your browser to finish."
        : "You can keep exploring in your browser.",
    );
    setInstall(null);
  };
  const update = () => {
    if (!waiting?.waiting) return;
    if (
      !window.dispatchEvent(
        new Event("mehyar-preserve-draft", { cancelable: true }),
      )
    ) {
      setMessage(
        "Your browser could not preserve this visit. Keep this version open; copy your draft before updating.",
      );
      return;
    }
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.location.reload(),
      { once: true },
    );
    waiting?.waiting?.postMessage({ type: "SKIP_WAITING" });
  };
  return (
    <>
      <output hidden id="local-pwa-diagnostics">
        {diagnostics}
      </output>
      <div className={`pwa-controls ${compact?'pwa-compact':''}`}>
        <div>
          <strong>
            {installed
              ? "MehyarSoft is installed"
              : "Keep your next idea close."}
          </strong>
          <p>
            Return to visual exploration from your home screen. Live AI needs a
            connection.
          </p>
        </div>
        {!installed && (
          <button onClick={() => void doInstall()} aria-label={compact ? (install ? "Install MehyarSoft" : "Install & offline guide") : undefined}>
            <Download size={17} />
            {install ? "Install MehyarSoft" : compact ? "Install & offline" : "How to install"}
          </button>
        )}
        <span role="status">{message}</span>
      </div>
      {waiting && (
        <aside className="pwa-update" role="status">
          <span>A new version is ready.</span>
          <button onClick={update}>
            <RefreshCw size={16} /> Preserve this visit & update
          </button>
          <button
            aria-label="Dismiss update notice"
            onClick={() => setWaiting(null)}
          >
            <X size={16} />
          </button>
        </aside>
      )}
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogTitle>The Mayor, a tap away.</DialogTitle>
          <DialogDescription>
            Keep visual exploration a tap away. Installation is optional; every
            public page also works in your browser.
          </DialogDescription>
          <div className="space-y-4 text-sm leading-7">
            <img src="/assets/pwa-discovery-narrow.jpg" alt="Actual mobile MehyarSoft interface" width="375" height="812" className="pwa-guide-preview"/>
            <p>
              <strong>iPhone or iPad:</strong> open this site in Safari, tap
              Share, then Add to Home Screen and confirm Add.
            </p>
            <p>
              <strong>Android or desktop:</strong> use your browser's Install
              app or Add to Home Screen action when available. If this browser
              does not offer it, continue here.
            </p>
            <p>
              Offline, you can open cached public pages and compose a draft. AI
              answers and business actions require a connection. The private
              Mayor workspace at mayor.mehyar.us is a separate app with its own sign-in. Saved public conversations stay on this device.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
