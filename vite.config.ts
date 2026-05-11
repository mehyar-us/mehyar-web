import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath, URL } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
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
