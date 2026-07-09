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
        .catch(() => {
          // SW registration is best-effort; the app must work without it.
        });
    });
  }
}
