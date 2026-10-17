/* ------------------------------------------------------------------ */
/* Provider worked example (sales-copy micro-pass, 2026-10-17).       */
/*                                                                     */
/* The selling pages carry a provider note ("your provider bills you  */
/* directly … never on your Mayor bill") with no dollars in it, by    */
/* design: the static pages and the SSR builder are test-frozen       */
/* against hardcoded amounts because OUR plan prices come only from   */
/* the billing catalog. The chief ordered the second bill disclosed   */
/* IN DOLLARS anyway — so the provider's figures live HERE, in one    */
/* dedicated module, and render at serve time like every other        */
/* amount on those pages.                                             */
/*                                                                     */
/* Source of record: Telnyx's own published US pay-as-you-go rates,   */
/* telnyx.com/pricing (+ /pricing/voice-api, /pricing/elastic-sip,    */
/* /pricing/numbers, /pricing/messaging), checked 2026-10-17:         */
/*   local number            $1.00/mo (+$0.10/mo with SMS/MMS on)     */
/*   voice API               $0.002/min (inbound and outbound)        */
/*   SIP trunk inbound local from $0.0032/min                         */
/*   SIP trunk outbound local from $0.005/min                         */
/*   SMS outbound            $0.004/message part + carrier fee        */
/*     (AT&T $0.0035, Verizon/T-Mobile $0.0045 per part)              */
/* All-in per-minute: inbound $0.0052, outbound $0.007 (Telnyx's own  */
/* comparison table prints the same $0.007 US outbound list rate).    */
/* When Telnyx republishes its rates, update THIS module and the     */
/* checked-date line — never the pages.                               */
/* ------------------------------------------------------------------ */

export const TELNYX_RATES_CHECKED = 'October 2026';
export const TELNYX_NUMBER_MONTHLY_CENTS = 100;
export const TELNYX_NUMBER_SMS_MONTHLY_CENTS = 10;
export const TELNYX_INBOUND_PER_MIN_CENTS = 0.52; // 0.2 voice API + 0.32 trunk
export const TELNYX_OUTBOUND_PER_MIN_CENTS = 0.7; // 0.2 voice API + 0.5 trunk
export const TELNYX_SMS_OUTBOUND_CENTS = 0.85; // 0.4 Telnyx + ~0.45 carrier fee

/* The worked example's stated usage: 100 answered calls averaging
 * 3 minutes, 40 call-backs of 2 minutes, 150 text-backs. */
export const EXAMPLE_INBOUND_MINUTES = 300;
export const EXAMPLE_OUTBOUND_MINUTES = 80;
export const EXAMPLE_TEXTS = 150;

export function providerExampleTotalCents():number{
  return TELNYX_NUMBER_MONTHLY_CENTS + TELNYX_NUMBER_SMS_MONTHLY_CENTS
    + EXAMPLE_INBOUND_MINUTES * TELNYX_INBOUND_PER_MIN_CENTS
    + EXAMPLE_OUTBOUND_MINUTES * TELNYX_OUTBOUND_PER_MIN_CENTS
    + EXAMPLE_TEXTS * TELNYX_SMS_OUTBOUND_CENTS;
}

const dollars=(cents:number)=>`$${(cents/100).toFixed(2)}`;
const perMin=(cents:number)=>`$${(cents/100).toFixed(4).replace(/0$/,'')}`;

/** The labeled worked-example paragraph rendered after the provider
 * note on /sales and /pricing. Every figure derives from the
 * constants above; the total is computed, never typed. */
export function providerExampleSsrHtml():string{
  const total = providerExampleTotalCents();
  return `<p class="plans-note"><strong>Worked example — what that provider bill comes to:</strong> `
    + `on Telnyx's published US pay-as-you-go rates (telnyx.com/pricing, checked ${TELNYX_RATES_CHECKED}) — `
    + `your number ${dollars(TELNYX_NUMBER_MONTHLY_CENTS + TELNYX_NUMBER_SMS_MONTHLY_CENTS)}/mo with texting on, `
    + `answered calls ${perMin(TELNYX_INBOUND_PER_MIN_CENTS)}/min, call-backs ${perMin(TELNYX_OUTBOUND_PER_MIN_CENTS)}/min, `
    + `text-backs about ${dollars(TELNYX_SMS_OUTBOUND_CENTS)} each including the carrier fee — `
    + `a month of 100 answered calls (about 3 minutes each), 40 call-backs (2 minutes each) and 150 text-backs `
    + `totals about ${dollars(Math.round(total))}, billed by Telnyx to your own account: `
    + `billed by them, never marked up by us. Rates change; your provider's current rates govern.</p>`;
}
