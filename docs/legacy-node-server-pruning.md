# Legacy Node/Express server pruning

Date: 2026-05-11

MehyarSoft production now runs as a Cloudflare Pages site with Pages Functions under `functions/api/**`. The old Node/Express server and Drizzle/Postgres package set was not part of the Cloudflare deployment path and was keeping vulnerable packages in the frontend repository dependency graph.

Pruning decision:

- Removed the legacy `server/**` Express entrypoints from the active source tree.
- Removed `drizzle.config.ts` and the root Drizzle/Postgres/Express/session/passport dependencies from `package.json`.
- Removed the tracked `repo-backup/**` snapshot because it duplicated the obsolete server/package-lock tree and would continue to surface stale dependency findings in repository scanners.
- Kept Cloudflare Pages Functions as the active API surface: `/api/health`, `/api/intake`, `/api/admin/auth/login`, `/api/admin/metrics`, and `/api/suppressions/unsubscribe`.
- Kept `shared/outreachCompliance.ts` and the intake docs because those compliance gates remain useful for future backend/admin work.

If a Node server is needed again, rebuild it in the API repository or a new service with fresh dependencies instead of restoring the old Express/Drizzle stack.