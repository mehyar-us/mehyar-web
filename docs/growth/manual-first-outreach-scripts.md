# MehyarSoft Manual-First Outreach Scripts

Use these only after a prospect has a source URL, observed pain signal, suppression status, risk tier, and channel eligibility recorded. No fake familiarity, no fake case studies, no automated blasting. Week-1 ceiling: 5-10 highly personalized first touches per day, manually logged.

## Required personalization tokens
- {{business_name}}
- {{first_name_or_team}}
- {{specific_pain_signal}}
- {{source_url}}
- {{website}}
- {{sender_name}} = Mehyar Swelim
- {{company}} = MehyarSoft LLC

## Compliance footer rules
- Include clear sender identity.
- Include accurate subject line.
- Include simple opt-out: “Reply no thanks and I will not follow up.”
- Add physical mailing address before scaled/commercial campaigns.
- Do not send if suppression_status is opted_out, complaint, invalid, blocked, or unchecked.

## Email touch 1 — specific observed leak
Subject option A: Quick note about {{business_name}}’s website follow-up
Subject option B: Possible missed-call/contact leak at {{business_name}}

Hi {{first_name_or_team}},

I’m Mehyar, a software/systems engineer in NYC and founder of MehyarSoft LLC. I help local businesses stop losing customers through missed calls, weak website contact flows, and manual follow-up gaps.

I noticed {{specific_pain_signal}} on {{business_name}}’s public site/profile: {{source_url}}. That can mean some customers leave before booking or never get followed up with.

I can run a short Local Tech Leak Audit and show you the top 3 fixes. If useful, I can also set up a simple missed-call/contact follow-up flow.

Worth a quick look this week?

Mehyar
MehyarSoft LLC
{{website}}
Opt out: reply “no thanks” and I will not follow up.

## Email touch 2 — checklist value
Subject: 4 quick checks for {{business_name}}

Hi {{first_name_or_team}},

Following up with the quick checklist I use for local businesses:
1. Can a mobile visitor call or book in one tap?
2. Does every form/call become a trackable lead?
3. Does an after-hours lead get a response path?
4. Can the owner see which source produced the lead?

If you want, I can review {{business_name}} against this and send the notes.

Mehyar
Opt out: reply “no thanks.”

## Email touch 3 — demo hook
Subject: 2-minute missed-contact demo

Hi {{first_name_or_team}},

I built a simple demo flow for the exact problem: missed contact -> captured lead -> owner notification -> follow-up reminder.

For businesses where one new customer is worth hundreds or thousands, even a few saved leads can pay for the setup.

Want me to show you the 2-minute version?

Mehyar
Opt out: reply “no thanks.”

## Email touch 4 — respectful close
Subject: Closing the loop

Hi {{first_name_or_team}},

I’ll close the loop here. If fixing missed calls, website contact leaks, or follow-up becomes a priority, you can reach me at {{website}}.

I won’t follow up again unless you ask.

Mehyar
MehyarSoft LLC

## LinkedIn connection request
Hi {{name}} — I work on websites, missed-call flows, and follow-up systems for local businesses. Thought it would be good to connect.

## LinkedIn DM after accepted connection
Thanks for connecting, {{name}}. I work on websites, missed-call flows, and follow-up systems for local businesses. If you ever want a quick second set of eyes on where leads may be leaking, happy to take a look.

## LinkedIn follow-up if engaged
I can send a short audit checklist for {{business_name}} — no pitch deck, just 3-5 fixes I’d prioritize from the public site/contact flow. Want me to do that?

## Local group educational post
Local business owners: quick reminder to test your website from your phone. If it takes more than one tap to call/book, or if your contact form just opens an email app, you may be losing leads. I put together a simple 10-point website + missed-call checklist — happy to share it.

## Short-form video prompts
1. I tested local business websites. The biggest leak was not AI — it was no clear booking button.
2. What happens when a customer calls after hours?
3. A practical missed-contact flow: capture the lead, alert the owner, queue the follow-up.
4. Why your contact form should create a CRM record, not just an email.

## Manual send log fields
- prospect_record_id
- send_timestamp
- channel
- actor
- template_used
- personalization_summary
- source_url
- suppression_checked_at
- opt_out_text_included
- outcome
- next_follow_up_at

## Stop conditions
- Any opt-out, complaint, bounce, spam warning, or unclear permission: suppress before future contact.
- High-risk regulated prospect without conservative language review: no outreach.
- Missing source URL, pain signal, or suppression status: no outreach.
- Automation request before compliance gates: deny; manual only until approved.
