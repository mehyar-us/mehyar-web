import {describe,it,expect} from 'vitest';
import {hasUnsupportedAuditPrivateAbsence,hasUnsupportedAuditTrustAbsence,validateAuditCustomerOutreach,validateAuditCustomerPilot,hasAnchoredAuditCommercialPlaceholder} from '../src/business-audit-content-safety';
import {auditFixturePilotActions} from './fixtures/business-audit';
const sources=[{id:'S1',excerpt:'Availability is confirmed by the workshop team. The pages do not supply review counts. Those facts are unknown.'},{id:'S2',excerpt:'The about page says: No customer testimonials are published. This is an owner-authored statement.'}];
describe('audit trust evidence boundaries',()=>{
 it('rejects the actual admitted unrelated trust-absence clause even with captured HTML scope',()=>expect(hasUnsupportedAuditTrustAbsence('No public response-time commitment or independent trust signals were detected in the captured HTML.',sources,[{sourceId:'S1',quote:'Availability is confirmed by the workshop team.'}])).toBe(true));
 it('does not let an unrelated unknown excuse a negative trust claim',()=>{
  expect(hasUnsupportedAuditTrustAbsence('Analytics are unknown, but independent trust signals are absent.',sources)).toBe(true);
  expect(hasUnsupportedAuditTrustAbsence('Review counts are unknown; no customer testimonials were found in captured HTML.',sources)).toBe(true);
  expect(hasUnsupportedAuditTrustAbsence('Customer reviews are unknown and absent from the website.',sources)).toBe(true);
  expect(hasUnsupportedAuditTrustAbsence('Unverified customer reviews are absent from the website.',sources)).toBe(true);
 });
 it('permits topic-local unknown and unavailable supplied data',()=>{
  expect(hasUnsupportedAuditTrustAbsence('Customer reviews are unverified. Review counts are unknown.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('The public pages do not supply review counts.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('No review counts were supplied by the owner.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('Review counts are unavailable.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('Review counts are unavailable, but independent trust signals are absent.',sources)).toBe(true);
 });
 it('permits only relevant literal source-attributed absence, without certifying its truth',()=>expect(hasUnsupportedAuditTrustAbsence('The about page states "No customer testimonials are published."',sources,[{sourceId:'S2',quote:'No customer testimonials are published.'}])).toBe(false));
 it('rejects fabricated attributed text and unrelated quotes',()=>{
  expect(hasUnsupportedAuditTrustAbsence('The page states "No independent trust signals are present."',sources,[{sourceId:'S1',quote:'No independent trust signals are present.'}])).toBe(true);
  expect(hasUnsupportedAuditTrustAbsence('The page states that no independent trust signals were detected.',sources,[{sourceId:'S1',quote:'Availability is confirmed by the workshop team.'}])).toBe(true);
 });
 it('does not mistake dependency statements or operational review verbs for trust absence',()=>{
  expect(hasUnsupportedAuditTrustAbsence('This plan requires no new software. Review counts remain unknown.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('No one reviews the baseline log during holidays.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('Improve the booking flow without changing customer reviews.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('Do not assume an absence of customer reviews.',sources)).toBe(false);
 });
 it('separates collection coverage from actual trust absence and catches does-not-contain predicates',()=>{
  for(const coverage of ['No evidence was collected of customer reviews or independent trust signals.','No data were collected about customer reviews; those facts remain unknown.'])expect(hasUnsupportedAuditTrustAbsence(coverage,sources),coverage).toBe(false);
  for(const claim of ['Captured HTML does not contain independent trust signals such as customer testimonials or third-party review embeds.','No evidence was collected of reviews, but customer reviews are absent.','No data were collected about reviews; the website does not contain testimonials.'])expect(hasUnsupportedAuditTrustAbsence(claim,sources),claim).toBe(true);
 });
 it('permits a local caution about implying missing reviews without hiding asserted absence',()=>{
  expect(hasUnsupportedAuditTrustAbsence('These existing explanations are useful trust content; adding unverified claims or implying missing reviews could mislead riders.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('Claiming missing testimonials may be misleading.',sources)).toBe(false);
  expect(hasUnsupportedAuditTrustAbsence('Implying missing reviews could mislead riders, but customer reviews are absent.',sources)).toBe(true);
  expect(hasUnsupportedAuditTrustAbsence('Implying missing reviews could mislead riders and customer reviews are absent.',sources)).toBe(true);
  expect(hasUnsupportedAuditTrustAbsence('Customer reviews are missing and could mislead riders.',sources)).toBe(true);
 });
});
describe('audit private absence governing predicates',()=>{
 it('admits coordinated supplied-data coverage and proposed software/dependency events',()=>{
  for(const text of ['No analytics, conversion rates, retention data, or traffic figures were supplied.','These proposed checks proceed without adding unneeded software.','Without a verified baseline, future improvements cannot be measured accurately.','Without baselines, the owner could compare only hypotheses rather than measured changes.'])expect(hasUnsupportedAuditPrivateAbsence(text),text).toBe(false);
 });
 it('keeps independent negatives visible beside legitimate coverage and dependency spans',()=>{
  for(const text of ['No analytics, conversion rates, or traffic figures were supplied, but no CRM exists.','No software is installed, and no analytics or baseline data were supplied.','Without a verified baseline, future improvements cannot be measured, but no measurement baseline exists.','These checks proceed without adding unneeded software or analytics.','The shop operates without a measurement baseline.','No post-service follow-up process, reminder system, or customer contact consent records are visible in the captured pages.'])expect(hasUnsupportedAuditPrivateAbsence(text),text).toBe(true);
 });
 it('distinguishes assumed-absence cautions and unsupported-measurement constraints from actual absence',()=>{
  expect(hasUnsupportedAuditPrivateAbsence('It keeps the owner focused on verified gaps rather than assumed missing analytics.')).toBe(false);
  expect(hasUnsupportedAuditPrivateAbsence('Owner has a one-page plan covering outcomes with no unsupported baselines or thresholds.')).toBe(false);
  expect(hasUnsupportedAuditPrivateAbsence('Ask the owner to list current tools, logs, reports, and who maintains them.')).toBe(false);
  expect(hasUnsupportedAuditPrivateAbsence('It keeps the owner focused on verified gaps rather than assumed missing analytics, but no CRM exists.')).toBe(true);
  expect(hasUnsupportedAuditPrivateAbsence('The report has no unsupported baselines, but the workshop has no measurement baseline.')).toBe(true);
  expect(hasUnsupportedAuditPrivateAbsence('The workshop has no measurement baseline or analytics.')).toBe(true);
  expect(hasUnsupportedAuditPrivateAbsence('Rather than assumed missing analytics, analytics are actually absent.')).toBe(true);
 });
});
it('keeps commercial placeholders neutral rather than anchoring unknown commitments',()=>{
 expect(hasAnchoredAuditCommercialPlaceholder('Repairs typically take [verified same-day or next-day].')).toBe(true);
 expect(hasAnchoredAuditCommercialPlaceholder('Repairs typically take [verified turnaround].')).toBe(false);
});
describe('audit proposed outreach permission sequencing',()=>{
 const actual=['Verify existing phone, email, or SMS tools currently used to reach customers after service.','Confirm owner capacity for seasonal maintenance volume and customer contact preferences.','Draft a one-sentence post-service reminder script using verified tools and owner-confirmed timing.','Test the reminder with three recent customers and log responses before broader rollout.'];
 it('rejects the actual reminder pilot because preferences are not permission',()=>expect(validateAuditCustomerOutreach(actual)).toEqual({valid:false,actionIndex:3,error:'permission_before_outreach_required'}));
 it('permits verification and exclusions before real contact',()=>expect(validateAuditCustomerOutreach(['Verify recorded customer permission and contact preferences. Exclude declined, withdrawn and unverified contacts.','Draft a seasonal reminder.','Test the reminder with three recent customers.'])).toEqual({valid:true}));
 it('permits a clearly gated consent-only pilot',()=>expect(validateAuditCustomerOutreach(['Only test the reminder with customers whose recorded opt-in is verified, excluding declined, withdrawn and unverified contacts.'])).toEqual({valid:true}));
 it('rejects checking permission after sending',()=>expect(validateAuditCustomerOutreach(['Send a reminder to customers, then verify recorded permission and exclude declined, withdrawn and unverified contacts.'])).toMatchObject({valid:false,actionIndex:0}));
 it('requires exclusions in addition to verified permission',()=>expect(validateAuditCustomerOutreach(['Verify recorded customer permission.','Test the reminder with three recent customers.'])).toMatchObject({valid:false,actionIndex:1}));
 it('allows drafts, internal delivery tests and asking permission in person',()=>expect(validateAuditCustomerOutreach(['Draft an email reminder for recent customers.','Test the reminder internally using dummy customer records.','Ask customers in person for permission and record affirmative opt-in.'])).toEqual({valid:true}));
 it('distinguishes preparing existing email tools from emailing real recipients',()=>{
  expect(validateAuditCustomerOutreach(['Verify existing phone and email tools currently used with customers.'])).toEqual({valid:true});
  expect(validateAuditCustomerOutreach(['Email the seasonal reminder to recent customers.'])).toMatchObject({valid:false,actionIndex:0});
 });
 it('separates internal tests and unsent drafts from customer recipients',()=>{
  expect(validateAuditCustomerOutreach(['Send the reminder to a staff-only sandbox inbox using dummy customer records.'])).toEqual({valid:true});
  expect(validateAuditCustomerOutreach(['Draft a reminder for customers; do not send it.'])).toEqual({valid:true});
  expect(validateAuditCustomerOutreach(['Test the reminder internally, then pilot it with three recent customers.'])).toMatchObject({valid:false,actionIndex:0});
  expect(validateAuditCustomerOutreach(['Send a reminder to customers, do not send it to declined or unverified contacts.'])).toMatchObject({valid:false,actionIndex:0});
 });
 it('does not let an internal draft label excuse external sending',()=>expect(validateAuditCustomerOutreach(['Draft an internal reminder, then send it to customers.'])).toMatchObject({valid:false,actionIndex:0}));
 it('recognizes an external pilot group and still requires permission records and exclusions',()=>{
  expect(validateAuditCustomerOutreach(['Send the confirmed reminder to the verified-permission pilot group.'])).toMatchObject({valid:false,actionIndex:0});
  expect(validateAuditCustomerOutreach(['Verify recorded customer permission for the intended channel and purpose. Exclude declined, withdrawn and unverified contacts.','Send the confirmed reminder to the verified-permission pilot group.'])).toEqual({valid:true});
  expect(validateAuditCustomerOutreach(['Send the reminder to a staff-only sandbox inbox using dummy customer records.'])).toEqual({valid:true});
 });
 it('recognizes direct contact with a qualified pilot group without requiring a reminder noun',()=>{
  for(const contact of ['If all gates pass, contact only the eligible pilot group.','Workshop owner contacts only the eligible verified-permission pilot group through existing tools after all gates pass.']){
   expect(validateAuditCustomerOutreach([contact]),contact).toMatchObject({valid:false,actionIndex:0});
   expect(validateAuditCustomerOutreach(['Verify recorded customer permission for the intended channel and purpose; exclude declined, withdrawn and unverified contacts.',contact]),contact).toEqual({valid:true});
  }
 });
});

describe('audit external pilot execution prerequisites',()=>{
 it('does not mistake permission/exclusions plus replacement for a complete actual pilot',()=>{
  const actions=['Verify recorded customer permission; exclude declined, withdrawn and unverified contacts.','Draft reminder copy, test internally with staff, and replace all placeholders before external sending.','Send only to the verified-permission pilot group and record delivery responses.'];
  expect(validateAuditCustomerOutreach(actions)).toEqual({valid:true});
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:2,missing:expect.arrayContaining(['channel_and_purpose','factual_copy','timing_and_capacity','tested_reply_receipt','approved_copy','placeholder_replacement'])});
 });
 it('admits a complete owner-confirmed, receipt-tested checklist before contact',()=>{
  expect(validateAuditCustomerOutreach(auditFixturePilotActions())).toEqual({valid:true});
  expect(validateAuditCustomerPilot(auditFixturePilotActions())).toEqual({valid:true});
 });
 it.each([
  ['channel_and_purpose',0,'Verify recorded customer permission using existing tools; exclude declined, withdrawn and unverified contacts.'],
  ['factual_copy',1,'Confirm owner timing and capacity; perform an owner-authorized reply-route test and confirm destination receipt and ownership.'],
  ['timing_and_capacity',1,'Confirm factual copy values against owner records; perform an owner-authorized reply-route test and confirm destination receipt and ownership.'],
  ['tested_reply_receipt',1,'Confirm factual copy values against owner records and owner timing/capacity; inspect a screenshot of the reply route.'],
  ['approved_copy',2,'Replace every placeholder with confirmed facts or omit unverified details; test internally with staff.'],
  ['placeholder_replacement',2,'Owner approves final copy; test internally with staff.'],
  ['internal_test',2,'Owner approves final copy; replace every placeholder with confirmed facts or omit unverified details.'],
 ] as const)('requires %s as an executable prerequisite', (missing,index,replacement)=>{
  const actions=auditFixturePilotActions();actions[index]=replacement;
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining([missing])});
 });
 it('does not borrow late checks or a negated pre-send instruction',()=>{
  const actions=auditFixturePilotActions(),send=actions.pop()!;
  expect(validateAuditCustomerPilot([send,...actions])).toMatchObject({valid:false,actionIndex:0});
  actions[2]='Owner does not approve final copy; do not replace all placeholders with confirmed facts; do not test internally with staff.';
  expect(validateAuditCustomerPilot([...actions,send])).toMatchObject({valid:false,missing:expect.arrayContaining(['approved_copy','placeholder_replacement','internal_test'])});
 });
 it('associates a negated factual check with its own predicate rather than a later positive timing check',()=>{
  const actions=auditFixturePilotActions();actions[1]='Owner does not verify the message facts or contact details against records and confirms timing and capacity; perform an owner-authorized reply-route test and confirm destination receipt and ownership.';
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining(['factual_copy'])});
  actions[1]='Owner cannot verify factual copy against records and also confirms timing and capacity; perform an owner-authorized reply-route test and confirm destination receipt and ownership.';
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining(['factual_copy'])});
 });
 it.each([
  ['timing_and_capacity',1,'Confirm factual copy values against owner records; owner does not yet confirm timing and capacity; perform an owner-authorized reply-route test and confirm destination receipt and ownership.'],
  ['factual_copy',1,'Do not actually verify factual copy against owner records and owner confirms timing and capacity; perform an owner-authorized reply-route test and confirm destination receipt and ownership.'],
  ['tested_reply_receipt',1,'Confirm factual copy values against owner records and owner timing/capacity; never independently test the owner-authorized reply route with destination receipt and ownership.'],
  ['placeholder_replacement',2,'Owner approves final copy; no need to first replace all placeholders with confirmed facts; test internally with staff.'],
 ] as const)('does not let a modifier-separated negative supply %s',(missing,index,replacement)=>{
  const actions=auditFixturePilotActions();actions[index]=replacement;
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining([missing])});
 });
 it.each([
  ['tested_reply_receipt',1,'Confirm factual copy values against owner records and owner timing/capacity; no owner-authorized reply-route test is needed; confirm destination receipt and ownership.'],
  ['internal_test',2,'Owner approves final copy; replace every placeholder with confirmed facts or omit unverified details; no internal staff test is needed.'],
 ] as const)('does not mistake a negated test noun for the %s action',(missing,index,replacement)=>{
  const actions=auditFixturePilotActions();actions[index]=replacement;
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining([missing])});
 });
 it.each([
  ['internal_test',2,'Owner approves final copy; replace every placeholder with confirmed facts or omit them; an internal test with staff is not required.'],
  ['tested_reply_receipt',1,'Confirm factual copy values against owner records and owner timing/capacity; an owner-authorized reply-route test is not needed; confirm destination receipt and ownership.'],
 ] as const)('does not count a post-nominal waived test as %s',(missing,index,replacement)=>{
  const actions=auditFixturePilotActions();actions[index]=replacement;
  expect(validateAuditCustomerOutreach(actions)).toEqual({valid:true});
  expect(validateAuditCustomerPilot(actions)).toEqual({valid:false,actionIndex:3,missing:[missing]});
 });
 it('keeps required nominal tests and affirmative staff tests as readiness instructions',()=>{
  const actions=auditFixturePilotActions();actions[1]='Confirm factual copy values against owner records and owner timing/capacity; an owner-authorized reply-route test is required; confirm destination receipt and ownership.';
  actions[2]='Owner approves final copy; replace every placeholder with confirmed facts or omit them; an internal test with staff is required before customer contact.';
  expect(validateAuditCustomerPilot(actions)).toEqual({valid:true});
  actions[2]='Owner approves final copy; replace every placeholder with confirmed facts or omit them; perform an internal test with staff.';
  expect(validateAuditCustomerPilot(actions)).toEqual({valid:true});
 });
 it.each([
  ['approved_copy',2,'Owner does not need to approve final copy; replace every placeholder with confirmed facts or omit unverified details; test internally with staff.'],
  ['internal_test',2,'Owner approves final copy; replace every placeholder with confirmed facts or omit unverified details; owner is not required to test the reminder internally with staff.'],
  ['factual_copy',1,'Do not bother to confirm factual message values against owner records; owner confirms timing and capacity; perform an owner-authorized reply-route test and confirm destination receipt and ownership.'],
  ['tested_reply_receipt',1,'Confirm factual copy values against owner records and owner timing/capacity; perform an owner-authorized reply-route test; confirm destination receipt and ownership only after sending to customers.'],
 ] as const)('rejects the independently reproduced modal or future-contact %s bypass',(missing,index,replacement)=>{
  const actions=auditFixturePilotActions();actions[index]=replacement;
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining([missing])});
 });
 it('allows receipt after an authorized internal staff/dummy test and keeps affirmative noun-negative checks',()=>{
  const actions=auditFixturePilotActions();actions[1]='Verify factual copy details against owner records and confirm no unverified details remain; owner confirms timing and capacity; perform an owner-authorized reply-route test; confirm destination receipt and ownership after sending to a staff-only sandbox inbox using dummy customer records.';
  expect(validateAuditCustomerPilot(actions)).toEqual({valid:true});
 });
 it('keeps unsent drafts and staff-only tests separate from actual customer contact',()=>{
  expect(validateAuditCustomerPilot(['Draft an unsent reminder for customers; do not send it.','Send the reminder to a staff-only sandbox inbox using dummy customer records.'])).toEqual({valid:true});
  expect(validateAuditCustomerPilot(['Test the reminder internally, then pilot it with three recent customers.'])).toMatchObject({valid:false,actionIndex:0});
 });
 it('holds the actual conditional pilot contact when the reminder destination and final wording are not confirmed',()=>{
  const actions=['Ask the owner which current tools and customer records exist and whether recorded permission is available for follow-up contact.','Identify eligible verified-permission customers and exclude declined, withdrawn, and unverified contacts.','Confirm timing, service details, and capacity; replace every placeholder and test the reply route with a staff or dummy record.','If all gates pass, contact only the eligible pilot group and record delivery, replies, opt-outs, and resulting appointments.'];
  expect(validateAuditCustomerPilot(actions)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining(['tested_reply_receipt','approved_copy'])});
  const roadmap=['Workshop owner verifies current customer records and recorded permission for the intended follow-up channel and purpose.','Workshop owner identifies eligible verified-permission customers and excludes declined, withdrawn, and unverified contacts.','Workshop owner confirms timing, service details, and capacity; tests the reply route with a staff or dummy record.','Workshop owner contacts only the eligible verified-permission pilot group through existing tools after all gates pass.'];
  expect(validateAuditCustomerOutreach(roadmap)).toEqual({valid:true});
  expect(validateAuditCustomerPilot(roadmap)).toMatchObject({valid:false,actionIndex:3,missing:expect.arrayContaining(['tested_reply_receipt','approved_copy'])});
  const complete=auditFixturePilotActions();complete[3]=actions[3];
  expect(validateAuditCustomerPilot(complete)).toEqual({valid:true});
 });
});
