import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath, URL } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // Public analytics IDs (rot509 / AU-509-1 root-cause fix): the tracker
  // modules read MEHYAR_PUBLIC_* via import.meta.env. Previously the four
  // GoogleAnalytics IDs were defined straight from process.env — always
  // empty in the deploy build — and the MarketingTags IDs (GTM / Meta /
  // Ads) had no source at all, so every tracker compiled EMPTY and the
  // SPA analytics layer was inert in production. Resolution order now:
  // shell env (explicit override) -> client/.env.production (the Vite
  // root is client/, so that is where Vite's env files live) -> "".
  const fileEnv = loadEnv(mode, path.resolve(__dirname, "client"), ["VITE_", "MEHYAR_PUBLIC_"]);
  const pub = (key: string) => JSON.stringify(process.env[key] || fileEnv[key] || "");
  // Audit pause keying (rot605, 2026-10-23): the bundle's JSON-LD Offers for
  // the paused Audit SKUs key off the same audit_paused literal in
  // functions/api/pay/availability.js that the shell JSON-LD injector reads
  // — one flag, flipped by the unpause commit, both surfaces self-clear.
  const auditPaused = /audit_paused:\s*true/.test(
    readFileSync(path.resolve(__dirname, "functions/api/pay/availability.js"), "utf8"),
  )
    ? "true"
    : "";

  return {
    // Expose only explicitly public MehyarSoft client env. Keep admin/private Google API vars out of the public bundle.
    envPrefix: ["VITE_", "MEHYAR_PUBLIC_"],
    define: {
      "import.meta.env.MEHYAR_PUBLIC_GTM_ID": pub("MEHYAR_PUBLIC_GTM_ID"),
      "import.meta.env.MEHYAR_PUBLIC_META_PIXEL_ID": pub("MEHYAR_PUBLIC_META_PIXEL_ID"),
      "import.meta.env.MEHYAR_PUBLIC_GOOGLE_ADS_ID": pub("MEHYAR_PUBLIC_GOOGLE_ADS_ID"),
      "import.meta.env.MEHYAR_PUBLIC_GOOGLE_TAG_ID": pub("MEHYAR_PUBLIC_GOOGLE_TAG_ID"),
      "import.meta.env.MEHYAR_PUBLIC_GOOGLE_GA4_MEASUREMENT_ID": pub("MEHYAR_PUBLIC_GOOGLE_GA4_MEASUREMENT_ID"),
      "import.meta.env.MEHYAR_AUDIT_PAUSED": JSON.stringify(auditPaused),
      "import.meta.env.MEHYAR_PUBLIC_ANALYTICS_FORCE_ENABLE": pub("MEHYAR_PUBLIC_ANALYTICS_FORCE_ENABLE"),
      "import.meta.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN": pub("MEHYAR_PUBLIC_ANALYTICS_DRY_RUN"),
    },
    // Cloudflare Pages serves the production site from the custom-domain root.
    // Keep asset URLs rooted at `/`; `/mehyar-web/` is only valid for GitHub Pages.
    base: "/",
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
    },
    root: path.resolve(__dirname, "client"),
    server: {
      // The Pages Function is not available inside Vite. Proxy only the
      // read-only calendar lookup so the local Booking page can render real
      // availability without allowing local forms to write to production.
      proxy: {
        "/api/calendar/availability": {
          target: "https://mehyar.us",
          changeOrigin: true,
          secure: true,
        },
      },
    },
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "client/index.html"),
        },
      },
    },
  };
});
