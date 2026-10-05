# Public Mayor release

The locally approved public redesign was repeatedly replaced by GitHub Actions builds from main, which still contained the old audit homepage. This release commits that public source on top of the latest main (096179d), preserving recent FloodLens fulfillment/report work and remote-only product assets.

Home leads with the Mayor avatar, visual conversation, public Free and $14/month plans. Mobile hero clears the fixed header, page scrolling remains native, and the PWA update notice clears the chat launcher. The private business workspace remains separate. The automatic $330 Mayor audit stays unpublished.

Cloudflare Actions now builds Functions from the checkout (including shared imports), uploads only dist/public, serializes production releases, and checks the Mayor heading/avatar/entry/plans before deployment and on both public domains afterward.

Validation: TypeScript, production build (74 rendered route shells / 45 canonical routes), mocked intake, PWA offline/cache boundaries, Mayor voice/recorder/business-context regressions, visual response boundaries, and Wrangler Functions compilation passed. The fixture used by client schema tests is historical live-provider evidence, not a new hardware voice test.
