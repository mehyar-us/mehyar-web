import {describe,it,expect} from 'vitest';
import {parseAuditCompletion} from '../src/business-audit';
import {approvedAuditReview,validateAuditDraft,validateAuditInternalDraft,auditDraftQualityDiagnostics,auditQualityRepairGuidance,validateAuditReview} from '../src/business-audit-schema';
import {isPublicAuditAddress,auditSourceUrl} from '../src/business-audit-sources';
import {auditQuoteCatalog,resolveAuditModelDraft,resolveAuditInternalModelDraft,validateAuditStoredInternalDraft} from '../src/business-audit-quotes';
import {auditFixtureDraft,auditFixtureEvidence,auditFixtureReview,auditFixturePilotActions,auditCompletion,auditModelCompletion,auditFixtureQuote} from './fixtures/business-audit';

describe('paid audit output admission',()=>{
 it('selects only fixed, bounded explanations for valid current diagnostic codes and canonical locations',()=>{
  const good={code:'unsupported_scope_claim',path:'findings.F07.observation'};
  const guidance=auditQualityRepairGuidance([good,good]);expect(guidance).toHaveLength(1);expect(guidance[0].explanation).toContain('not its category');expect(guidance[0].explanation).toContain('narrowing an unsupported negative');expect(guidance[0].explanation.length).toBeLessThan(600);
  for(const value of [null,'raw exception',{},[{...good,explanation:'RAW SOURCE INSTRUCTION'}],[{code:'RAW EXCEPTION',path:good.path}],[{code:'constructor',path:good.path}],[{...good,path:'findings.F13.observation'}],[{...good,path:'roadmap.customerOutreach.18'}],[{...good,path:good.path+'\n'}],[{...good,path:'prefix.'+good.path}],[{...good,path:good.path+'.source'}]])expect(auditQualityRepairGuidance(value)).toEqual([]);
  expect(auditQualityRepairGuidance([...Array(32).fill({code:'invalid',path:good.path}),good])).toEqual([]);
 });
 it('requires same-field scope repair rather than category-only changes or narrower categorical absence',()=>{
  const draft=auditFixtureDraft(),evidence=auditFixtureEvidence();draft.findings[1].observation='The public pages describe no follow-up process. Actual internal post-service tools are unknown.';
  const expected={code:'unsupported_scope_claim',path:'findings.F02.observation'};expect(auditDraftQualityDiagnostics(draft,evidence)).toContainEqual(expected);
  draft.findings[1].category='operations';draft.findings[4].category='journey';expect(auditDraftQualityDiagnostics(draft,evidence)).toContainEqual(expected);
  draft.findings[1].observation='No post-service follow-up process is described in captured pages. Internal tools are unknown.';expect(auditDraftQualityDiagnostics(draft,evidence)).toContainEqual(expected);
  draft.findings[1].observation='The captured page invites a tune-up request by contacting the workshop. Whether post-service follow-up is already used is not verified by this packet.';
  expect(auditDraftQualityDiagnostics(draft,evidence)).not.toContainEqual(expected);expect(validateAuditDraft(draft,evidence)).toEqual(draft);
 });
 it('lets only structurally grounded private drafts carry fixed quality diagnostics to review',()=>{
  const draft=auditFixtureDraft(),evidence=auditFixtureEvidence();draft.summary.overview='The fastest path is a new booking tool for every visitor.';draft.findings[0].nextSteps[1]='ownerRole';draft.findings[2].observation='Captured HTML does not contain independent trust signals or customer testimonials.';
  const model=parseAuditCompletion(auditModelCompletion(draft));expect(resolveAuditInternalModelDraft(model,evidence)).toEqual(draft);expect(validateAuditStoredInternalDraft(draft,evidence)).toEqual(draft);expect(()=>resolveAuditModelDraft(model,evidence)).toThrow();expect(()=>validateAuditDraft(draft,evidence)).toThrow();
  const diagnostics=auditDraftQualityDiagnostics(draft,evidence);expect(diagnostics).toEqual(expect.arrayContaining([{code:'action_placeholder',path:'findings.F01.nextSteps.1'},{code:'unsupported_scope_claim',path:'summary.overview'},{code:'unsupported_trust_absence',path:'findings.F03.observation'}]));expect(JSON.stringify(diagnostics)).not.toContain(draft.summary.overview);expect(diagnostics.length).toBeLessThanOrEqual(32);
 });
 it('never uses internal-draft admission to waive literal citations, null baselines, mapping or concise bounds',()=>{
  const evidence=auditFixtureEvidence();const legacy=auditFixtureDraft();for(const phase of legacy.roadmap)phase.deliverables=phase.deliverables.map(action=>action.replace(/^\[[^\]]+\] /,''));expect(()=>validateAuditInternalDraft(legacy,evidence)).toThrow('roadmap_references_invalid');expect(validateAuditDraft(legacy,evidence,{repairInput:true})).toEqual(legacy);
  for(const mutate of [(draft:any)=>{draft.summary.overview='x'.repeat(701);},(draft:any)=>{draft.findings[0].citations=Array(4).fill(draft.findings[0].citations[0]);},(draft:any)=>{draft.findings[0].measurement.currentBaseline=12;}]){const draft=auditFixtureDraft();mutate(draft);expect(()=>resolveAuditInternalModelDraft(parseAuditCompletion(auditModelCompletion(draft)),evidence)).toThrow('model_output_invalid');}
  const unsupported=auditFixtureDraft();unsupported.findings[0].citations[0].quote='An invented source claim with no literal support.';expect(()=>validateAuditInternalDraft(unsupported,evidence)).toThrow('unsupported_citation');
 });
 it('accepts only complete structured modern choices, never a legacy fallback or truncated answer',()=>{
  expect(parseAuditCompletion(auditCompletion({approved:true}))).toEqual({approved:true});
  for(const value of [{response:'{"approved":true}'},{choices:[{finish_reason:'length',message:{content:'{"approved":true}'}}]},{choices:[{finish_reason:'stop',message:{content:'```json\n{}\n```'}}]},{choices:[{finish_reason:'stop',message:{content:'',reasoning_content:'{"approved":true}'}}]},{choices:[{finish_reason:'stop',message:{content:'{}',refusal:'unavailable'}}]},{choices:[{finish_reason:'stop',message:{content:'{}',tool_calls:[{id:'send_message'}]}}]}])expect(()=>parseAuditCompletion(value)).toThrow('model_output_invalid');
 });
 it('rejects unsupported quotations and broken execution-plan references',()=>{
  const draft=auditFixtureDraft(),evidence=auditFixtureEvidence();expect(validateAuditDraft(draft,evidence)).toEqual(draft);
  draft.findings[0].citations[0].quote='This invented claim never appeared in the source.';expect(()=>validateAuditDraft(draft,evidence)).toThrow('unsupported_citation');
  const broken=auditFixtureDraft();broken.roadmap[0].findingIds=['F12'];expect(()=>validateAuditDraft(broken,evidence)).toThrow('model_output_invalid');
 });
 it('refuses invented current metrics or incomplete scope',()=>{
  const draft=auditFixtureDraft();(draft.findings[0].measurement as any).currentBaseline=38;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow();
  const incomplete=auditFixtureDraft();incomplete.findings[5].category='offer';expect(()=>validateAuditDraft(incomplete,auditFixtureEvidence())).toThrow();
 });
 it('resolves only literal server-listed quote IDs, never paraphrases or nearest matches',()=>{
  const evidence=auditFixtureEvidence(),catalog=auditQuoteCatalog(evidence);expect(catalog[0].quotes[0]).toEqual({quoteId:'Q01',quote:auditFixtureQuote});const model=parseAuditCompletion(auditModelCompletion(auditFixtureDraft())) as any;expect(resolveAuditModelDraft(model,evidence)).toEqual(auditFixtureDraft());model.findings[0].citations[0].quoteId='Q64';expect(()=>resolveAuditModelDraft(model,evidence)).toThrow('unsupported_citation');model.findings[0].citations[0]={sourceId:'S1',quote:'A paraphrase or reordered sentence'};expect(()=>resolveAuditModelDraft(model,evidence)).toThrow('model_output_invalid');
 });
 it('keeps each source sentence separate and bounds catalog spans to exact captured prose',()=>{
  const evidence=auditFixtureEvidence();evidence.sources[0].excerpt='The turnaround depends on parts availability. A tune-up includes a safety check and basic cleaning. '+('A long realistic service sentence with multiple word boundaries and no invented facts '.repeat(8))+'.';const quotes=auditQuoteCatalog(evidence)[0].quotes;expect(quotes[0].quote).toBe('The turnaround depends on parts availability.');expect(quotes[1].quote).toBe('A tune-up includes a safety check and basic cleaning.');for(const quote of quotes){expect(quote.quote.length).toBeLessThanOrEqual(400);expect(evidence.sources[0].excerpt.includes(quote.quote)).toBe(true);}
 });
 it('rejects invented publishable numeric commitments while accepting explicit placeholders',()=>{
  for(const promise of ['Tune-ups cost $75–$95.','Most repairs are ready within 24h.','Book a 30 minute appointment.','Return every three months for your service plan.','Save 20% on seasonal tune-ups.']){const draft=auditFixtureDraft();draft.findings[0].copyExample=promise;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('unsupported_copy_promise');}const draft=auditFixtureDraft();draft.findings[0].copyExample='Tune-ups start at [confirmed price]. Ask us about [verified turnaround].';expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);
 });
 it('keeps stored reports compatible while admitting only concise new model drafts',()=>{
  const evidence=auditFixtureEvidence(),draft=auditFixtureDraft();
  const extended={...draft,findings:[...draft.findings,...draft.findings.slice(0,3).map((finding,index)=>({...finding,id:`F0${index+7}`}))]};
  expect(validateAuditDraft(extended,evidence).findings).toHaveLength(9);
  expect(()=>resolveAuditModelDraft(parseAuditCompletion(auditModelCompletion(extended)),evidence)).toThrow('model_output_invalid');
  const verbose=auditFixtureDraft();verbose.findings[0].nextSteps[0]='Verify the existing owner process before changing it. '.repeat(6).trim();
  expect(validateAuditDraft(verbose,evidence)).toEqual(verbose);
  expect(()=>resolveAuditModelDraft(parseAuditCompletion(auditModelCompletion(verbose)),evidence)).toThrow('model_output_invalid');
 });
 it('does not admit JSON Schema keywords as report or reviewer data',()=>{
  const model=parseAuditCompletion(auditModelCompletion(auditFixtureDraft())) as any;model.type='object';expect(()=>resolveAuditModelDraft(model,auditFixtureEvidence())).toThrow('model_output_invalid');
  expect(()=>validateAuditReview({...auditFixtureReview(),type:'object'},auditFixtureDraft())).toThrow('model_output_invalid');
 });
 it('does not invent numerical success thresholds when the performance baseline is unknown',()=>{
  for(const target of ['Qualified inquiries grow by >20% within 60 days.','Response compliance is above 90%.','Request handoffs require <3 steps.','Reply within 24 hours for every request.','Schedule more than 5 appointments.']){const draft=auditFixtureDraft();draft.findings[0].measurement.successSignal=target;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('unsupported_measurement_target');}
  const draft=auditFixtureDraft();draft.findings[0].measurement.howToCollect='Count qualified requests and scheduled appointments over the first 14 days, then discuss the baseline with the owner.';draft.findings[0].measurement.successSignal='A verified baseline followed by an owner-agreed feasible target';expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);
 });
 it('rejects schema-label action stubs even when citations and the review are otherwise valid',()=>{
  for(const stub of ['ownerRole','[ownerRole]','nextSteps','findingIds','deliverables','placeholder']){const draft=auditFixtureDraft();draft.findings[0].nextSteps[1]=stub;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('action_placeholder');}
  const draft=auditFixtureDraft();draft.roadmap[0].deliverables[0]='[F01,F04] ownerRole';expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('action_placeholder');
  expect(validateAuditDraft(draft,auditFixtureEvidence(),{repairInput:true})).toEqual(draft);
 });
 it('blocks broad unmeasured absence and outcome claims while preserving explicit public scope and unknowns',()=>{
  for(const claim of ['Complete absence of analytics and verified intake handoffs.','The fastest path to more appointments is repairing the form.','The highest-return opportunity is a new booking tool.','The contact path reduces conversion to zero.','No analytics or submission tracking is present.']){const draft=auditFixtureDraft();draft.summary.overview=claim;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('unsupported_scope_claim');}
  const draft=auditFixtureDraft();draft.findings[0].observation='No analytics were detected in the captured public HTML. The existing internal analytics setup is unknown.';expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);
 });
 it('distinguishes an action requiring no new software from actual missing-tool claims',()=>{
  for(const plan of ['These proposed verification actions require no new software.','This proposed owner checklist needs no new software.']){const draft=auditFixtureDraft();draft.summary.startingPoint=plan;expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);}
  for(const claim of ['These actions require no new software, because no CRM exists.','The proposed checklist needs no new software, but analytics are missing.','No new software is present.','These actions require no new software. No analytics are installed.']){const draft=auditFixtureDraft();draft.summary.startingPoint=claim;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('unsupported_scope_claim');}
 });
 it('admits local software-cost avoidance without hiding mixed actual private absence',()=>{
  for(const plan of ['These proposed checks can proceed without premature software investment.','These actions can proceed without buying new software.','No new software investment is needed for this proposed check.','These proposed checks can proceed without additional software purchases.','These proposed checks can proceed without installing new software.','These proposed checks can proceed without software investment.']){const draft=auditFixtureDraft();draft.summary.biggestOpportunity=plan;expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);}
  for(const claim of ['These checks can proceed without premature software investment, but analytics are missing.','These checks can proceed without buying new software; no CRM is installed.','No new software investment is needed for this check, because no internal software exists.','These checks proceed without premature software investment or analytics.','These checks proceed without additional software purchases, but no CRM exists.','These checks proceed without installing new software, but internal handoffs are missing.','These checks proceed without software investment or analytics.']){const draft=auditFixtureDraft();draft.summary.biggestOpportunity=claim;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('unsupported_scope_claim');}
 });
 it('never lets an unrelated unknown or public clause excuse actual tool absence',()=>{
  for(const claim of ['No software is installed, but the measurement baseline is unknown.','No software is installed and the measurement baseline is unknown.','The measurement baseline is unknown; no CRM exists.','No CRM is installed, while the captured public HTML contains a contact link.','Analytics are missing, but internal handoff details were not supplied.']){const draft=auditFixtureDraft();draft.summary.overview=claim;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('unsupported_scope_claim');}
  const draft=auditFixtureDraft();draft.summary.overview='The current software and measurement baseline are unknown. No internal software information was supplied to this audit.';expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);
 });
 it('treats private baseline existence as unknown rather than inferring it from public omissions',()=>{
  for(const claim of ['No measurement baseline exists.','The current performance baseline is missing.','The measurement baseline does not exist.','No measurement baseline exists in the captured public HTML.','No measurement baseline exists, but the existing tools are unknown.','The measurement baseline is not available.','Baseline data are not available to this audit, but no CRM exists.','Baseline data are not available to this audit, but no measurement baseline exists.']){const draft=auditFixtureDraft();draft.summary.overview=claim;expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('unsupported_scope_claim');}
  for(const unknown of ['No baseline data were supplied to this audit.','No measurement baseline has been provided.','No baseline data supplied.','The existing measurement baseline is unknown, and baseline information was not provided.','It is unknown whether no measurement baseline exists.','Baseline data are unavailable to this audit; verify current owner records first.','Baseline data are not available to this audit.']){const draft=auditFixtureDraft();draft.summary.overview=unknown;expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);}
 });
 it('requires checking existing tools as the first action before recommending private tool installation',()=>{
  const draft=auditFixtureDraft();draft.findings[5].recommendation='Install analytics and tag contact actions to establish a baseline.';expect(()=>validateAuditDraft(draft,auditFixtureEvidence())).toThrow('existing_tools_unverified');draft.findings[5].nextSteps[0]='Verify the existing analytics and tracking tools with the owner before changing software.';expect(validateAuditDraft(draft,auditFixtureEvidence())).toEqual(draft);
 });
 it('accepts an explicit owner inventory while still rejecting requests to install without checking',()=>{
  const draft=auditFixtureDraft(),evidence=auditFixtureEvidence();draft.findings[5].recommendation='Install analytics only after the owner verifies the current tools and confirms a reporting gap.';
  for(const inventory of ['Ask the owner to list current tools, logs, reports, and who maintains them.','Ask the owner to describe existing analytics and reporting tools.','Ask owner to identify current tracking systems.']){draft.findings[5].nextSteps[0]=inventory;expect(validateAuditDraft(draft,evidence)).toEqual(draft);}
  for(const instruction of ['Ask the owner to install current analytics tools.','Ask the owner to list possible software purchases.','List current tools for the owner to purchase.']){draft.findings[5].nextSteps[0]=instruction;expect(()=>validateAuditDraft(draft,evidence)).toThrow('existing_tools_unverified');}
 });
 it('requires durable exact roadmap mappings for new/final output and restricts legacy to repair input',()=>{
  const draft=auditFixtureDraft(),evidence=auditFixtureEvidence();
  expect(validateAuditDraft(draft,evidence).roadmap[0].deliverables[0]).toBe('[F01,F04] One verified customer request walkthrough.');
  const legacy=auditFixtureDraft();for(const phase of legacy.roadmap)phase.deliverables=phase.deliverables.map(action=>action.replace(/^\[[^\]]+\] /,''));
  expect(()=>validateAuditDraft(legacy,evidence)).toThrow('roadmap_references_invalid');expect(validateAuditDraft(legacy,evidence,{repairInput:true})).toEqual(legacy);
  legacy.roadmap[0].deliverables[0]='[F01,F04] One verified customer request walkthrough.';expect(()=>validateAuditDraft(legacy,evidence,{repairInput:true})).toThrow('roadmap_references_invalid');
  const wrong=auditFixtureDraft();wrong.roadmap[0].findingIds=['F01','F04'];expect(()=>validateAuditDraft(wrong,evidence,{repairInput:true})).toThrow('roadmap_references_invalid');
  const unknown=auditFixtureDraft();unknown.roadmap[0].deliverables[0]='[F12] Owner verifies the current intake.';expect(()=>validateAuditDraft(unknown,evidence,{repairInput:true})).toThrow('roadmap_references_invalid');
 });
 it('rejects ungrounded trust absence and customer pilots before recorded permission/exclusions',()=>{
  const trust=auditFixtureDraft();trust.findings[2].observation='No public response-time commitment or independent trust signals were detected in the captured HTML.';expect(()=>validateAuditDraft(trust,auditFixtureEvidence())).toThrow('unsupported_trust_absence');
  const outreach=auditFixtureDraft();outreach.findings[1].nextSteps=['Verify existing phone and email tools currently used with customers.','Confirm customer contact preferences and owner capacity.','Test the reminder with three recent customers.'];expect(()=>validateAuditDraft(outreach,auditFixtureEvidence())).toThrow('customer_permission_unverified');
  outreach.findings[1].nextSteps.splice(1,1,'Verify recorded customer opt-in and exclude declined, withdrawn and unverified contacts.');expect(()=>validateAuditDraft(outreach,auditFixtureEvidence())).toThrow('customer_pilot_unverified');
  outreach.findings[1].nextSteps=auditFixturePilotActions();expect(validateAuditDraft(outreach,auditFixtureEvidence())).toEqual(outreach);
  const anchored=auditFixtureDraft();anchored.findings[0].copyExample='Typical repair: [verified same-day or next-day].';expect(()=>validateAuditDraft(anchored,auditFixtureEvidence())).toThrow('unsupported_copy_promise');
 });
 it('does not let a success signal substitute for executable pre-send checks and applies the same rule to mapped roadmap actions',()=>{
  const draft=auditFixtureDraft(),evidence=auditFixtureEvidence();draft.findings[1].nextSteps=['Verify recorded customer permission for the chosen channel and purpose; exclude declined, withdrawn and unverified contacts.','Send the reminder to the verified-permission pilot group.'];draft.findings[1].measurement.successSignal='Owner confirms copy facts, timing, capacity, destination receipt and internal test completion';
  expect(auditDraftQualityDiagnostics(draft,evidence)).toContainEqual({code:'customer_pilot_unverified',path:'findings.F02.nextSteps.1'});
  draft.findings[1].nextSteps=auditFixturePilotActions();draft.roadmap[2].findingIds=['F02'];draft.roadmap[2].deliverables=['[F02] Verify recorded customer permission for the selected channel and purpose; exclude declined, withdrawn and unverified contacts.','[F02] Send the reminder to the verified-permission pilot group.'];
  expect(auditDraftQualityDiagnostics(draft,evidence)).toContainEqual({code:'customer_pilot_unverified',path:'roadmap.customerOutreach.5'});
  draft.roadmap[2].deliverables=auditFixturePilotActions().map(action=>'[F02] '+action);expect(validateAuditDraft(draft,evidence)).toEqual(draft);
 });
 it('keeps a structurally valid post-nominal test waiver private while final quality rejects it',()=>{
  const draft=auditFixtureDraft(),evidence=auditFixtureEvidence();draft.findings[1].nextSteps=auditFixturePilotActions();draft.findings[1].nextSteps[2]='Owner approves final copy; replace every placeholder with confirmed facts or omit them; an internal test with staff is not required.';
  expect(validateAuditStoredInternalDraft(draft,evidence)).toEqual(draft);
  expect(auditDraftQualityDiagnostics(draft,evidence)).toContainEqual({code:'customer_pilot_unverified',path:'findings.F02.nextSteps.3'});
  expect(()=>validateAuditDraft(draft,evidence)).toThrow('customer_pilot_unverified');
  draft.findings[1].nextSteps[2]='Owner approves final copy; replace every placeholder with confirmed facts or omit them; an internal test with staff is required before customer contact.';
  expect(auditDraftQualityDiagnostics(draft,evidence)).toEqual([]);expect(validateAuditDraft(draft,evidence)).toEqual(draft);
 });
 it('requires independent review agreement beyond an approved flag',()=>{
  const draft=auditFixtureDraft(),review=auditFixtureReview();expect(approvedAuditReview(validateAuditReview(review,draft))).toBe(true);
  review.verification.scopeHonesty=false;expect(approvedAuditReview(review)).toBe(false);review.verification.scopeHonesty=true;
  review.issues=[{findingId:'F01',severity:'major',message:'An unsupported business performance conclusion requires correction.',suggestedFix:'Remove the unsupported conclusion and label the actual baseline unknown.'}];expect(approvedAuditReview(review)).toBe(false);
  review.issues[0].findingId='F12';expect(()=>validateAuditReview(review,draft)).toThrow();
 });
});
describe('public audit network boundary',()=>{
 it('blocks private, reserved, transition, and malformed DNS addresses',()=>{
  for(const address of ['127.0.0.1','10.0.0.1','172.31.1.1','192.168.3.1','169.254.169.254','100.64.0.1','0.0.0.0','192.0.2.3','198.18.0.1','198.51.100.2','203.0.113.4','224.0.0.1','999.1.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::1','2001::1','3fff::1','2001:::1','2001:4860::1%eth0'])expect(isPublicAuditAddress(address),address).toBe(false);
  for(const address of ['1.1.1.1','8.8.8.8','104.16.1.2','2001:4860:4860::8888','2606:4700:4700::1111'])expect(isPublicAuditAddress(address),address).toBe(true);
 });
 it('upgrades ordinary HTTP and rejects credential, private, query, or custom-port URLs',()=>{
  expect(auditSourceUrl('http://business.com/about#hours','https://mayor.mehyar.us').href).toBe('https://business.com/about');
  for(const value of ['http://127.0.0.1','https://2130706433','https://[::1]','https://a.internal','https://user:password@business.com','https://business.com:8443','https://business.com/?token=secret','https://mayor.mehyar.us'])expect(()=>auditSourceUrl(value,'https://mayor.mehyar.us')).toThrow('unsafe_source');
 });
});
