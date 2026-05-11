import type { Express, NextFunction, Request, Response } from "express";

const DEFAULT_ALLOWED_ORIGINS = ["https://mehyar.us", "https://www.mehyar.us"];
const SENSITIVE_KEYS = /password|secret|token|api[_-]?key|authorization|cookie|email|phone|message|name|company/i;

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function applySecurityMiddleware(app: Express): void {
  app.disable("x-powered-by");

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("X-Frame-Options", "DENY");

    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store");
      const origin = req.headers.origin;
      const allowlist = allowedOrigins();

      if (origin && allowlist.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }

      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        if (origin && !allowlist.includes(origin)) {
          res.status(403).end();
          return;
        }
        res.status(204).end();
        return;
      }
    }

    next();
  });
}

export function redactForLog(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEYS.test(key) ? "[redacted]" : redactForLog(entry),
      ]),
    );
  }

  return value;
}
