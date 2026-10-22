/**
 * founding-door.test.ts — rot523 wiring pins (2026-10-21).
 *
 * The founding slice spans five surfaces; these pins keep each one
 * honest: the /pricing client fallback renders the seats sentence
 * from the catalog payload (never hardcoded) with the door anchor;
 * the shell names a founding intent on the sign-in surface and emits
 * sign_up for a first session; every checkout-session creation on
 * the money path emits begin_checkout with its plan context; the
 * audit OG line carries the offer API's delivery terms verbatim.
 */
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {AUDIT_OFFER} from '../src/billing/audit';

const here=dirname(fileURLToPath(import.meta.url));
const read=(...parts:string[])=>readFileSync(join(here,'..',...parts),'utf8');

describe('leg 1+2 — the door and the data-driven seats sentence',()=>{
  it('pricing.html client fallback renders the founding line from the catalog payload',()=>{
    const pricing=read('web','pricing.html');
    // The door anchor, and the sentence built from the payload fields
    // (founding block + foundingPriceCents), never a baked-in count.
    expect(pricing).toContain('<a href="/billing?plan=founding">');
    expect(pricing).toContain('data.founding');
    expect(pricing).toContain('data.foundingPriceCents');
    expect(pricing).toContain('f.seats_remaining');
    expect(pricing).not.toContain('25 of 25 seats left');
    expect(pricing).not.toContain('$79.20');
  });

  it('main.ts names a founding intent on the sign-in surface and tracks first sessions',()=>{
    const main=read('web','main.ts');
    expect(main).toContain('showFoundingIntentNote');
    expect(main).toContain("bootIntent.id==='founding'");
    expect(main).toContain("fetch('/api/billing/catalog'");
    expect(main).toContain('trackSignUpOnce');
    // The note's price comes from the catalog payload field.
    expect(main).toContain('catalog?.foundingPriceCents');
  });

  it('the session payload carries the creation timestamps sign_up needs',()=>{
    const auth=read('src','auth','index.ts');
    expect(auth).toContain('createdAt: iso(result.user.createdAt)');
    expect(auth).toContain('createdAt: iso(result.session.createdAt)');
  });
});

describe('leg 4 — begin_checkout at every session creation',()=>{
  it('workday fires it for pro, founding, and pack checkouts',()=>{
    const workday=read('web','workday.ts');
    expect(workday).toContain("trackBeginCheckout({plan:'pro'})");
    expect(workday).toContain("trackBeginCheckout({plan:'pro-founding'})");
    expect(workday).toContain("trackBeginCheckout({plan:'pack',packId:pack.id})");
  });

  it('the audit page fires it when its checkout session is created',()=>{
    const auditMain=read('web','audit-main.ts');
    expect(auditMain).toContain("trackBeginCheckout({plan:'business-audit'})");
  });
});

describe('leg 3 — the audit OG line mirrors the offer API',()=>{
  it('og:description carries AUDIT_OFFER.delivery verbatim and no delivery window',()=>{
    const page=read('web','business-audit.html');
    const og=page.match(/<meta property="og:description" content="([^"]*)">/);
    expect(og).toBeTruthy();
    expect(og![1]).toContain(AUDIT_OFFER.delivery);
    expect(og![1]).not.toContain('business days');
    expect(og![1]).not.toContain('All sales final');
  });
});
