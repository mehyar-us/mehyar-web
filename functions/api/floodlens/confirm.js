// functions/api/floodlens/confirm.js
// GET /api/floodlens/confirm?token= — double-opt-in confirmation.
import { confirmToken } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  try {
    return await confirmToken(request, env);
  } catch (e) {
    console.error("floodlens confirm failed", e && e.message);
    return new Response("Confirm failed", { status: 500 });
  }
}
