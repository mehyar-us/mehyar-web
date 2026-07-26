// POST /api/admin/mayor
//
// Backward-compatible command endpoint for the admin UI. The implementation
// lives in /api/admin/jarvis; this file keeps older MayorBar callers working.

export { onRequestOptions, onRequestPost } from "../jarvis/index.js";
