import { createRoot } from "react-dom/client";
import App from "./App";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

// Register the app-shell service worker on the public host only.
// Keeps /api, /admin, /billing/* on the network — conversion paths never
// get served stale responses from cache.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const host = window.location.hostname;
  if (host === "mehyar.us" || host === "www.mehyar.us") {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Listen for SW update messages and auto-reload so users get the fresh shell
          navigator.serviceWorker.addEventListener("message", (e) => {
            if (e.data?.type === "SW_UPDATED") {
              // Hard-reload bypasses HTTP cache for the HTML + bundle
              window.location.reload();
            }
          });
          // If a new SW is waiting, activate it immediately
          if (reg.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          }
          reg.addEventListener("updatefound", () => {
            const newSw = reg.installing;
            if (!newSw) return;
            newSw.addEventListener("statechange", () => {
              if (newSw.state === "installed" && navigator.serviceWorker.controller) {
                newSw.postMessage({ type: "SKIP_WAITING" });
              }
            });
          });
        })
        .catch(() => {
          // SW registration is best-effort; the app must work without it.
        });
    });
  }
}
