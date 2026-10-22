import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath, URL } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Expose only explicitly public MehyarSoft client env. Keep admin/private Google API vars out of the public bundle.
  envPrefix: ["VITE_", "MEHYAR_PUBLIC_"],
  define: {
    "import.meta.env.MEHYAR_PUBLIC_GOOGLE_TAG_ID": JSON.stringify(process.env.MEHYAR_PUBLIC_GOOGLE_TAG_ID || ""),
    "import.meta.env.MEHYAR_PUBLIC_GOOGLE_GA4_MEASUREMENT_ID": JSON.stringify(process.env.MEHYAR_PUBLIC_GOOGLE_GA4_MEASUREMENT_ID || ""),
    "import.meta.env.MEHYAR_PUBLIC_ANALYTICS_FORCE_ENABLE": JSON.stringify(process.env.MEHYAR_PUBLIC_ANALYTICS_FORCE_ENABLE || ""),
    "import.meta.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN": JSON.stringify(process.env.MEHYAR_PUBLIC_ANALYTICS_DRY_RUN || ""),
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
});
