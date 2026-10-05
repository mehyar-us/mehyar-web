export function registerDiscoveryPwa() {
  if (!("serviceWorker" in navigator)) return;
  const host = location.hostname;
  const local = ["localhost", "127.0.0.1"].includes(host);
  if (
    !["mehyar.us", "www.mehyar.us"].includes(host) &&
    !(local && import.meta.env.PROD)
  )
    return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        const announce = () => {
          if (reg.waiting)
            window.dispatchEvent(
              new CustomEvent("mehyar-pwa-update", { detail: reg }),
            );
        };
        announce();
        reg.addEventListener("updatefound", () => {
          reg.installing?.addEventListener("statechange", () => {
            if (reg.waiting && navigator.serviceWorker.controller) announce();
          });
        });
      })
      .catch(() => {
        /* Browsing remains available if registration fails. */
      });
  });
}
