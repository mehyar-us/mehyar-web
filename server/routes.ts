import type { Express } from "express";
import { createServer, type Server } from "http";

export async function registerRoutes(app: Express): Promise<Server> {
  // This is a pure frontend application
  // No API routes are needed as all data is static and embedded in the client

  const httpServer = createServer(app);

  return httpServer;
}
