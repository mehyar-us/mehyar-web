// scripts/test-cookie-consent.mjs — consent-gated GA4 verification (full-QA RED fix).
//
// For BOTH client/index.html (mehyar.us SPA) and assessment-call/index.html:
//   1. Consent-Mode defaults deny analytics_storage before any choice.
//   2. gtag.js is NOT injected pre-consent (no _ga can be set).
//   3. Banner appears only when no stored choice; Accept loads gtag.js +
//      grants analytics_storage; Decline records choice and never loads it.
//   4. Returning visitor (stored 'accepted') loads gtag.js silently, no banner.
// Run: node scripts/test-cookie-consent.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { Script } from "node:vm";

let N = 0;
const ok = (cond, msg) => { N++; assert.ok(cond, msg); };

function extractConsentScript(html, marker) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const hit = blocks.find((b) => b.includes(marker));
  assert.ok(hit, `consent script (${marker}) found`);
  return hit;
}

function runPage(name, htmlPath, marker) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const src = extractConsentScript(html, marker);

  function boot(stored) {
    const store = new Map(stored ? [[stored[0], stored[1]]] : []);
    const dataLayer = [];
    const scripts = [];
    const listeners = {};
    const sandbox = {
      console,
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
      document: {
        head: { appendChild: (el) => scripts.push(el) },
        body: { appendChild: (el) => { sandbox.__banner = el; } },
        createElement: (tag) => ({
          tag, src: "", async: false, _attrs: {},
          setAttribute(k, v) { this._attrs[k] = v; },
          querySelector(sel) {
            if (sel === "#ms-ok") return { addEventListener: (ev, fn) => { sandbox.__accept = fn; } };
            if (sel === "#ms-no") return { addEventListener: (ev, fn) => { sandbox.__decline = fn; } };
            return null;
          },
          addEventListener() {},
          remove() { sandbox.__bannerRemoved = true; },
        }),
      },
      window: {},
      CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    };
    sandbox.window = sandbox;
    sandbox.window.dataLayer = dataLayer;
    sandbox.window.dispatchEvent = (e) => { (listeners[e.type] = listeners[e.type] || []).push(e); };
    sandbox.window.addEventListener = () => {};
    new Script(src).runInNewContext(sandbox);
    return { sandbox, store, dataLayer, scripts };
  }

  // ── 1+2. fresh visitor: defaults deny, no gtag.js injected ────────────────
  {
    const { dataLayer, scripts } = boot(null);
    const consentDefault = dataLayer.find((a) => a[0] === "consent" && a[1] === "default");
    ok(consentDefault && consentDefault[2].analytics_storage === "denied", `${name}: consent default denies analytics_storage`);
    ok(!scripts.some((s) => String(s.src).includes("googletagmanager")), `${name}: gtag.js NOT injected pre-consent`);
  }

  // ── 3. banner accept → loads gtag.js + grants; decline → never loads ──────
  const bannerSrc = (() => {
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    return blocks.find((b) => b.includes("ms-cookie-bar"));
  })();
  if (bannerSrc) {
    // accept path
    {
      const { sandbox, store, dataLayer, scripts } = boot(null);
      new Script(bannerSrc).runInNewContext(sandbox);
      ok(sandbox.__banner, `${name}: banner shown with no stored choice`);
      sandbox.__accept();
      ok(store.get("ms_cookie_consent") === "accepted", `${name}: accept stores choice`);
      ok(scripts.some((s) => String(s.src).includes("googletagmanager")), `${name}: accept loads gtag.js`);
      const update = dataLayer.find((a) => a[0] === "consent" && a[1] === "update");
      ok(update && update[2].analytics_storage === "granted", `${name}: accept grants analytics_storage`);
      ok(sandbox.__bannerRemoved === true, `${name}: banner removed after choice`);
    }
    // decline path
    {
      const { sandbox, store, scripts } = boot(null);
      new Script(bannerSrc).runInNewContext(sandbox);
      sandbox.__decline();
      ok(store.get("ms_cookie_consent") === "declined", `${name}: decline stores choice`);
      ok(!scripts.some((s) => String(s.src).includes("googletagmanager")), `${name}: decline never loads gtag.js`);
    }
  } else {
    // assessment-call page: banner lives in the SPA shell; its own page only
    // needs the consent default + gated loader, verified via __mehyarConsent.
    const { sandbox, store, scripts, dataLayer } = boot(null);
    ok(typeof sandbox.__mehyarConsent.grant === "function", `${name}: __mehyarConsent.grant exposed`);
    sandbox.__mehyarConsent.grant();
    ok(store.get("ms_cookie_consent") === "accepted", `${name}: grant stores accepted`);
    ok(scripts.some((s) => String(s.src).includes("googletagmanager")), `${name}: grant loads gtag.js`);
    const update = dataLayer.find((a) => a[0] === "consent" && a[1] === "update");
    ok(update && update[2].analytics_storage === "granted", `${name}: grant updates consent`);
    const b2 = boot(null);
    b2.sandbox.__mehyarConsent.deny();
    ok(b2.store.get("ms_cookie_consent") === "declined", `${name}: deny stores declined`);
    ok(!b2.scripts.some((s) => String(s.src).includes("googletagmanager")), `${name}: deny never loads gtag.js`);
  }

  // ── 4. returning accepted visitor: silent load, no banner ─────────────────
  {
    const { scripts, sandbox } = boot(["ms_cookie_consent", "accepted"]);
    ok(scripts.some((s) => String(s.src).includes("googletagmanager")), `${name}: returning accepted visitor loads gtag.js`);
    if (bannerSrc) {
      new Script(bannerSrc).runInNewContext(sandbox);
      ok(!sandbox.__banner, `${name}: no banner for returning decided visitor`);
    }
  }
}

const root = new URL("../", import.meta.url);
runPage("client/index.html", new URL("client/index.html", root), "__mehyarConsent");
runPage("assessment-call/index.html", new URL("assessment-call/index.html", root), "__mehyarConsent");

console.log(`\nAll ${N} cookie-consent assertions passed.`);
process.exit(0);
