import type { Express } from "express";
import { createServer, type Server } from "http";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "mehyar-web", api: "no-outreach-send-capability" });
  });

  // Public outreach/campaign send endpoints are intentionally absent.
  // Any future send/admin API must enforce shared/outreachCompliance.ts gates,
  // server-side admin authentication, suppression checks, and audit logging before release.

  const httpServer = createServer(app);

  return httpServer;
}
