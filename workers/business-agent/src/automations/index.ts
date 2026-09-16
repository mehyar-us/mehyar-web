import { CATALOG_VERSION, PLAN_IDS, deepFreeze, getPlan, type MeterId, type PlanId } from "../catalog";

export type AutomationMode = "preview_draft" | "approve_each" | "automatic_policy";
export type Effect = "internal_read" | "internal_write" | "external_read" | "external_write" | "legacy_read";
export type AutomationGroup = "setup" | "front_desk" | "email" | "appointments" | "sales" | "support" | "retention" | "content" | "documents" | "owner_operations" | "product_operations" | "voice" | "whatsapp";
export interface AutomationDefinition {
  readonly id: string; readonly version: string; readonly name: string; readonly group: AutomationGroup;
  readonly trigger: { readonly event: string; readonly trust: "verified_internal_or_provider_event"; readonly tenantRequired: true };
  readonly inputs: readonly string[]; readonly evidenceSources: readonly string[]; readonly permissions: readonly string[];
  readonly eligibility: { readonly plans: readonly PlanId[]; readonly businessAddon?: string; readonly prerequisites: readonly string[] };
  readonly modes: readonly AutomationMode[]; readonly defaultMode: "preview_draft";
  readonly actionSequence: readonly { readonly operation: string; readonly effect: Effect }[];
  readonly limits: { readonly maxActionsPerRun: number; readonly maxRecipientsPerRun: number; readonly requiresBudgetReservation: true; readonly businessHoursPolicy: true; readonly enabledConfigurationsCountAgainstPlan: true; readonly dailyFrequencyPolicyRequired: true };
  readonly approval: { readonly policyVersionRequired: true; readonly perActionRequired: boolean; readonly authorizedBy: "owner_or_permitted_manager"; readonly modelMayGrantAuthority: false };
  readonly receipt: { readonly providerReceiptRequiredForExternalSuccess: true; readonly fields: readonly string[] };
  readonly metering: { readonly meter: MeterId | null; readonly settlement: "completed_generation_or_confirmed_effect"; readonly retriesBillable: false; readonly voiceTextDoubleBilling: false };
  readonly retry: { readonly maxAttempts: number; readonly backoffSeconds: readonly number[]; readonly honorsRetryAfter: true; readonly idempotencyKey: string; readonly ambiguousExternalEffect: "reconcile_then_human_review_never_blind_resend" };
  readonly cancellation: { readonly recheckBeforeEveryEffect: true; readonly onPauseOrRevocation: "cancel_queued_and_stop_new_effects"; readonly alreadyCommittedEffect: "retain_receipt_and_escalate_no_automatic_undo" };
  readonly escalation: { readonly destination: "configured_tenant_human"; readonly reasons: readonly string[] };
  readonly suppressions: readonly string[]; readonly requiredTests: readonly string[];
  readonly legacyAccess: "none" | "read_only"; readonly legacyWritesAllowed: false;
  readonly readiness: { readonly definition: "complete"; readonly executor: "not_implemented"; readonly executionEnabled: false; readonly requiredGates: readonly string[]; readonly evidence: readonly string[] };
}
type Spec = {
  id: string; name: string; group: AutomationGroup; event: string; operation: string; effect: Effect;
  permissions: string[]; inputs?: string[]; sources?: string[]; prerequisites?: string[];
  plans?: readonly PlanId[]; businessAddon?: string; approval?: boolean; meter?: MeterId | null;
  draftOnly?: boolean; legacyRead?: boolean; gates?: string[]; maxActions?: number; lifecycleControl?: boolean;
};
const ALL_MODES: readonly AutomationMode[] = ["preview_draft", "approve_each", "automatic_policy"];
const GROWTH: readonly PlanId[] = ["growth", "operations"];
const commonSuppressions = ["self_reply", "auto_responder_loop", "duplicate_event", "opted_out_recipient", "stale_appointment", "resolved_case", "cold_outbound", "revoked_permission", "paused_tenant"];
const commonTests = ["happy_path_fixture", "permission_denied", "cross_tenant_denied", "duplicate_event", "pause_before_effect", "provider_failure", "retry_exhaustion", "untrusted_content_cannot_authorize", "usage_reserve_settle_release", "legacy_write_denied"];

function define(spec: Spec): AutomationDefinition {
  const external = spec.effect === "external_write";
  const modes: readonly AutomationMode[] = spec.draftOnly ? ["preview_draft"] : spec.approval ? ["preview_draft", "approve_each"] : ALL_MODES;
  return {
    id: spec.id, version: CATALOG_VERSION, name: spec.name, group: spec.group,
    trigger: { event: spec.event, trust: "verified_internal_or_provider_event", tenantRequired: true },
    inputs: ["tenant_id", "actor_or_event_id", "idempotency_key", ...(spec.inputs ?? [])],
    evidenceSources: spec.sources ?? ["owner_approved_business_facts", "tenant_scoped_source_record"],
    permissions: spec.permissions,
    eligibility: { plans: spec.plans ?? PLAN_IDS, ...(spec.businessAddon ? { businessAddon: spec.businessAddon } : {}), prerequisites: [spec.lifecycleControl ? "tenant_exists_including_paused_or_past_due" : "active_or_permitted_trial_entitlement", "verified_tenant_context", ...(external ? ["active_paid_plan", "approved_action_policy", "recipient_and_resource_authorization"] : []), ...(spec.prerequisites ?? [])] },
    modes, defaultMode: "preview_draft",
    actionSequence: [
      { operation: "authorize_tenant_actor_scopes_policy_and_resource", effect: "internal_read" },
      { operation: "check_deduplication_suppression_and_current_state", effect: "internal_read" },
      { operation: "reserve_budget_and_record_proposed_action", effect: "internal_write" },
      { operation: spec.operation, effect: spec.effect },
      { operation: "record_receipt_and_settle_or_release_usage", effect: "internal_write" },
    ],
    limits: { maxActionsPerRun: spec.maxActions ?? 1, maxRecipientsPerRun: external ? 1 : 0, requiresBudgetReservation: true, businessHoursPolicy: true, enabledConfigurationsCountAgainstPlan: true, dailyFrequencyPolicyRequired: true },
    approval: { policyVersionRequired: true, perActionRequired: spec.approval ?? false, authorizedBy: "owner_or_permitted_manager", modelMayGrantAuthority: false },
    receipt: { providerReceiptRequiredForExternalSuccess: true, fields: ["tenant_id", "workflow_version", "policy_version", "source_event", "action_id", "state", "provider_receipt_or_internal_result", "usage_reservation", "timestamps"] },
    metering: { meter: spec.meter === undefined ? "text_ai_credit" : spec.meter, settlement: "completed_generation_or_confirmed_effect", retriesBillable: false, voiceTextDoubleBilling: false },
    retry: { maxAttempts: 3, backoffSeconds: [5, 30, 120], honorsRetryAfter: true, idempotencyKey: "tenant_id:workflow_version:source_event:action_index", ambiguousExternalEffect: "reconcile_then_human_review_never_blind_resend" },
    cancellation: { recheckBeforeEveryEffect: true, onPauseOrRevocation: "cancel_queued_and_stop_new_effects", alreadyCommittedEffect: "retain_receipt_and_escalate_no_automatic_undo" },
    escalation: { destination: "configured_tenant_human", reasons: ["missing_or_conflicting_evidence", "missing_permission", "provider_outage", "ambiguous_effect", "budget_exhausted", "retry_exhausted", "high_risk_judgment", "customer_requests_human"] },
    suppressions: spec.lifecycleControl ? ["duplicate_event", "unverified_event"] : commonSuppressions, requiredTests: [...commonTests, ...(spec.lifecycleControl ? ["control_action_accepted_while_paused_or_past_due", "previous_optout_does_not_suppress_control_action"] : []), ...(external ? ["ambiguous_response_no_duplicate_effect", "provider_receipt_before_success"] : [])],
    legacyAccess: spec.legacyRead ? "read_only" : "none", legacyWritesAllowed: false,
    readiness: { definition: "complete", executor: "not_implemented", executionEnabled: false, requiredGates: ["executor_implemented", "tenant_isolation_tests", "runtime_acceptance_tests", "owner_activation", ...(external ? ["provider_approval", "live_provider_evidence"] : []), ...(spec.gates ?? [])], evidence: [] },
  };
}

/** These are executable contracts awaiting implementations, not simulated successful jobs. */
export const AUTOMATIONS: readonly AutomationDefinition[] = deepFreeze([
  define({ id: "setup.url-research", name: "Research business website", group: "setup", event: "owner_submitted_url", operation: "crawl_bounded_public_site_with_ssrf_and_robots_checks", effect: "external_read", permissions: ["knowledge.import"], inputs: ["website_url", "page_budget"], sources: ["public_site_pages_with_url_timestamp_and_confidence"], prerequisites: ["safe_crawler_ready"], meter: "crawl_page" }),
  define({ id: "setup.business-brief", name: "Build evidence-backed business brief", group: "setup", event: "research_completed", operation: "extract_facts_with_citations_and_owner_confirmation", effect: "internal_write", permissions: ["knowledge.draft"], inputs: ["source_document_ids"] }),
  define({ id: "setup.missing-information", name: "Interview for missing business details", group: "setup", event: "brief_missing_required_facts", operation: "ask_only_unresolved_questions_and_record_answers", effect: "internal_write", permissions: ["knowledge.draft"], inputs: ["missing_fields"] }),
  define({ id: "setup.connector-setup", name: "Guide selected account connections", group: "setup", event: "owner_selected_capabilities", operation: "present_provider_consent_and_record_actual_grants", effect: "internal_write", permissions: ["connections.manage"], inputs: ["selected_capabilities"], prerequisites: ["provider_oauth_ready"], meter: null }),
  define({ id: "setup.first-preview", name: "Preview first configured workflow", group: "setup", event: "owner_requested_preview", operation: "render_proposed_action_without_external_effect", effect: "internal_write", permissions: ["automations.preview"], inputs: ["workflow_id", "fixture_or_authorized_source_id"], draftOnly: true }),
  define({ id: "setup.recovery", name: "Resume interrupted onboarding", group: "setup", event: "owner_resumed_onboarding", operation: "resume_from_persisted_checkpoint_without_repeating_effects", effect: "internal_write", permissions: ["tenant.configure"], meter: null }),

  define({ id: "front-desk.faq", name: "Answer approved business FAQs", group: "front_desk", event: "inbound_customer_question", operation: "answer_from_approved_facts_or_handoff", effect: "external_write", permissions: ["knowledge.read", "channel.reply"], inputs: ["conversation_id", "question"], prerequisites: ["verified_business", "approved_faq_corpus"] }),
  define({ id: "front-desk.intent", name: "Classify inbound intent", group: "front_desk", event: "inbound_customer_message", operation: "classify_intent_with_confidence_and_no_unsupported_claim", effect: "internal_write", permissions: ["conversations.read", "customers.write"] }),
  define({ id: "front-desk.contact", name: "Capture customer contact details", group: "front_desk", event: "customer_shared_contact", operation: "validate_minimum_contact_and_record_consent", effect: "internal_write", permissions: ["customers.write"], inputs: ["contact_fields", "consent_evidence"], meter: null }),
  define({ id: "front-desk.assignment", name: "Assign request to staff", group: "front_desk", event: "qualified_request_created", operation: "route_to_permitted_staff_by_service_and_location", effect: "internal_write", permissions: ["customers.assign"], inputs: ["request_id", "routing_policy"], meter: null }),
  define({ id: "front-desk.handoff", name: "Hand conversation to a human", group: "front_desk", event: "handoff_requested_or_required", operation: "pause_ai_for_thread_and_notify_configured_human", effect: "internal_write", permissions: ["conversations.handoff"], meter: null, lifecycleControl: true }),
  define({ id: "front-desk.after-hours", name: "Take after-hours messages", group: "front_desk", event: "inbound_outside_business_hours", operation: "acknowledge_collect_request_and_queue_staff_followup", effect: "external_write", permissions: ["channel.reply", "customers.write"], prerequisites: ["approved_after_hours_policy"] }),

  define({ id: "email.inquiry-detection", name: "Detect relevant business inquiries", group: "email", event: "verified_mailbox_change", operation: "read_selected_mailbox_delta_and_classify_business_inquiry", effect: "external_read", permissions: ["email.read"], sources: ["authorized_mailbox_delta"], prerequisites: ["mailbox_connected"] }),
  define({ id: "email.summary", name: "Summarize email thread", group: "email", event: "owner_request_or_new_inquiry", operation: "summarize_authorized_thread_with_source_message_ids", effect: "internal_write", permissions: ["email.read"], inputs: ["thread_id"] }),
  define({ id: "email.draft", name: "Draft email response", group: "email", event: "inquiry_requires_response", operation: "draft_response_in_workspace_without_sending", effect: "internal_write", permissions: ["email.read", "drafts.write"], draftOnly: true }),
  define({ id: "email.reply", name: "Send policy-approved email reply", group: "email", event: "approved_reply_or_policy_match", operation: "send_reply_from_authorized_mailbox_with_outbox_receipt", effect: "external_write", permissions: ["email.read", "email.send"], inputs: ["thread_id", "recipient", "approved_body"], prerequisites: ["mailbox_send_grant", "thread_recipient_verified"] }),
  define({ id: "email.attachments", name: "Intake email attachments", group: "email", event: "authorized_inquiry_attachment", operation: "scan_bound_and_extract_allowed_attachment_types", effect: "internal_write", permissions: ["email.read", "documents.import"], inputs: ["attachment_ids"], prerequisites: ["safe_upload_scanning"], gates: ["sensitive_data_review_if_required"] }),
  define({ id: "email.unanswered-followup", name: "Follow up on unanswered inquiry", group: "email", event: "inquiry_response_due", operation: "recheck_resolution_and_send_allowed_single_followup", effect: "external_write", permissions: ["email.read", "email.send"], prerequisites: ["allowed_followup_purpose", "frequency_and_stop_policy"] }),

  define({ id: "appointments.availability", name: "Check approved availability", group: "appointments", event: "appointment_time_requested", operation: "read_live_selected_calendar_and_resource_availability", effect: "external_read", permissions: ["calendar.read"], inputs: ["calendar_ids", "resource_id", "timezone", "duration"], meter: null }),
  define({ id: "appointments.book", name: "Book an appointment", group: "appointments", event: "customer_confirmed_appointment", operation: "lock_resource_recheck_freebusy_create_event_and_record_receipt", effect: "external_write", permissions: ["calendar.read", "calendar.write"], inputs: ["resource_id", "start", "end", "timezone", "verified_customer_id"], prerequisites: ["confirmed_service_duration", "resource_rules", "calendar_connected"], meter: null }),
  define({ id: "appointments.confirmation", name: "Confirm provider-accepted appointment", group: "appointments", event: "appointment_provider_receipt_recorded", operation: "send_confirmation_only_after_provider_commit", effect: "external_write", permissions: ["calendar.read", "channel.reply"], prerequisites: ["provider_booking_receipt"], meter: null }),
  define({ id: "appointments.reminder", name: "Send appointment reminder", group: "appointments", event: "appointment_reminder_due", operation: "recheck_current_event_and_send_permitted_reminder", effect: "external_write", permissions: ["calendar.read", "channel.reply"], prerequisites: ["transactional_contact_permission"], meter: null }),
  define({ id: "appointments.reschedule", name: "Reschedule an appointment", group: "appointments", event: "verified_customer_requested_change", operation: "lock_recheck_and_update_event_with_partial_failure_recovery", effect: "external_write", permissions: ["calendar.read", "calendar.write"], inputs: ["event_id", "new_time", "customer_verification"], prerequisites: ["rescheduling_policy", "resource_rules"], meter: null }),
  define({ id: "appointments.cancel", name: "Cancel an appointment", group: "appointments", event: "verified_cancellation_request", operation: "validate_cancellation_policy_and_approval_then_cancel_event", effect: "external_write", permissions: ["calendar.read", "calendar.write"], approval: true, prerequisites: ["customer_verification", "cancellation_policy"], meter: null }),
  define({ id: "appointments.no-show", name: "Follow up after confirmed no-show", group: "appointments", event: "staff_or_provider_marked_no_show", operation: "send_allowed_rebooking_message_without_inventing_attendance", effect: "external_write", permissions: ["calendar.read", "channel.reply"], prerequisites: ["verified_attendance_source", "followup_consent"] }),
  define({ id: "appointments.waitlist", name: "Offer a valid waitlist opening", group: "appointments", event: "verified_resource_opening", operation: "offer_one_expiring_slot_then_recheck_before_commit", effect: "external_write", permissions: ["calendar.read", "channel.reply"], plans: GROWTH, businessAddon: "advanced-templates", prerequisites: ["waitlist_consent", "resource_capacity_source", "offer_expiry_policy"] }),
  define({ id: "appointments.resources", name: "Coordinate advanced resource rules", group: "appointments", event: "multi_resource_booking_requested", operation: "validate_staff_rooms_capacity_buffers_and_atomic_reservation", effect: "external_write", permissions: ["calendar.read", "calendar.write"], plans: GROWTH, businessAddon: "advanced-templates", prerequisites: ["authoritative_resource_inventory", "resource_locks"], meter: null }),

  define({ id: "sales.qualify", name: "Qualify inbound sales inquiry", group: "sales", event: "new_inbound_lead", operation: "collect_allowed_fit_service_area_and_timeline_fields", effect: "internal_write", permissions: ["customers.read", "customers.write"], prerequisites: ["approved_non_discriminatory_qualification_rules"] }),
  define({ id: "sales.quote-draft", name: "Draft a quote", group: "sales", event: "qualified_quote_request", operation: "draft_quote_from_owner_approved_prices_and_scope", effect: "internal_write", permissions: ["customers.read", "drafts.write"], draftOnly: true, prerequisites: ["approved_price_source"] }),
  define({ id: "sales.proposal-draft", name: "Draft a proposal", group: "sales", event: "proposal_requested", operation: "draft_scope_deliverables_assumptions_and_review_items", effect: "internal_write", permissions: ["customers.read", "drafts.write"], draftOnly: true }),
  define({ id: "sales.estimate-followup", name: "Follow up on open estimate", group: "sales", event: "estimate_followup_due", operation: "recheck_estimate_status_and_send_permitted_followup", effect: "external_write", permissions: ["sales.read", "channel.reply"], prerequisites: ["verified_estimate_source", "consented_followup"] }),
  define({ id: "sales.booking-handoff", name: "Hand qualified lead to scheduling", group: "sales", event: "qualified_lead_requests_appointment", operation: "create_scoped_scheduling_request_without_claiming_booking", effect: "internal_write", permissions: ["customers.read", "calendar.read"], meter: null }),
  define({ id: "sales.nurture", name: "Run opted-in multi-step lead nurture", group: "sales", event: "consented_nurture_step_due", operation: "check_reply_purchase_optout_and_policy_then_send_approved_step", effect: "external_write", permissions: ["customers.read", "channel.marketing"], plans: GROWTH, businessAddon: "advanced-templates", approval: true, prerequisites: ["marketing_consent_evidence", "approved_sequence", "per_recipient_frequency_cap"] }),

  define({ id: "support.order-lookup", name: "Look up an authorized order", group: "support", event: "verified_customer_order_question", operation: "read_order_through_allowlisted_status_adapter", effect: "legacy_read", permissions: ["orders.read"], legacyRead: true, sources: ["verified_read_only_order_source"], prerequisites: ["customer_order_ownership", "verified_order_adapter"], meter: null }),
  define({ id: "support.delivery-status", name: "Explain verified delivery status", group: "support", event: "order_status_available", operation: "draft_status_explanation_without_claiming_unobserved_delivery", effect: "internal_write", permissions: ["orders.read", "drafts.write"], legacyRead: true, draftOnly: true, prerequisites: ["verified_order_source"] }),
  define({ id: "support.new-service-redelivery", name: "Retry new-service delivery", group: "support", event: "authorized_new_service_delivery_retry", operation: "reconcile_new_service_outbox_then_redeliver_if_safe", effect: "external_write", permissions: ["agent_deliverables.read", "agent_deliverables.deliver"], prerequisites: ["new_service_order_only", "verified_customer", "no_legacy_executor"], meter: null }),
  define({ id: "support.complaint", name: "Route complaint to staff", group: "support", event: "complaint_detected", operation: "summarize_context_and_assign_human_owner", effect: "internal_write", permissions: ["conversations.read", "conversations.handoff"] }),
  define({ id: "support.refund-request", name: "Prepare refund request for approval", group: "support", event: "customer_requests_refund", operation: "record_refund_request_and_escalate_no_payment_mutation", effect: "internal_write", permissions: ["orders.read", "support.write"], legacyRead: true, approval: true, prerequisites: ["verified_order_ownership"] }),
  define({ id: "support.review-draft", name: "Draft review response", group: "support", event: "authorized_review_received", operation: "draft_factual_reply_and_flag_sensitive_content", effect: "internal_write", permissions: ["reviews.read", "drafts.write"], draftOnly: true, prerequisites: ["verified_review_source"] }),

  ...([
    ["rebook", "Prompt consented rebooking", "service_rebooking_due", "offer_rebooking_after_checking_visit_and_booking_history"],
    ["renewal", "Remind about a verified renewal", "verified_renewal_due", "send_renewal_reminder_from_authoritative_membership_status"],
    ["winback", "Contact opted-in dormant customers", "consented_dormant_segment_due", "send_owner_approved_winback_with_frequency_and_optout_checks"],
    ["satisfaction", "Request customer satisfaction feedback", "completed_service_feedback_due", "send_single_neutral_feedback_request_without_review_gating"],
  ] as const).map(([id, name, event, operation]) => define({ id: `retention.${id}`, name, event, operation, group: "retention", effect: "external_write", permissions: ["customers.read", "channel.marketing"], plans: GROWTH, businessAddon: "advanced-templates", approval: id === "winback", prerequisites: ["purpose_specific_contact_consent", "verified_customer_activity", "frequency_and_stop_policy"] })),
  define({ id: "retention.optout", name: "Apply opt-out suppression", group: "retention", event: "verified_optout_received", operation: "persist_suppression_and_cancel_matching_queued_messages", effect: "internal_write", permissions: ["consent.write"], meter: null, lifecycleControl: true }),

  ...([
    ["calendar", "Draft business content calendar", "owner_requests_content_plan", "draft_calendar_from_approved_brand_facts"],
    ["captions", "Draft social captions", "content_brief_approved", "draft_caption_variants_with_factual_checks"],
    ["emails", "Draft marketing emails", "owner_requests_email_copy", "draft_copy_without_enrolling_or_sending_to_contacts"],
    ["blog-faq", "Draft blog or FAQ content", "approved_editorial_brief", "draft_sourced_content_for_owner_review"],
  ] as const).map(([id, name, event, operation]) => define({ id: `content.${id}`, name, event, operation, group: "content", effect: "internal_write", permissions: ["knowledge.read", "drafts.write"], plans: GROWTH, businessAddon: "content-production", draftOnly: true })),
  define({ id: "content.asset", name: "Generate approved creative assets", group: "content", event: "approved_creative_brief", operation: "generate_and_quality_check_separately_entitled_creative_asset", effect: "internal_write", permissions: ["assets.generate"], plans: GROWTH, businessAddon: "content-production", approval: true, meter: "creative_post", prerequisites: ["creative_production_entitlement", "licensed_source_assets", "owner_brief_approval"] }),
  define({ id: "content.publish", name: "Publish approved scheduled content", group: "content", event: "approved_post_schedule_due", operation: "recheck_profile_rights_and_provider_approval_then_publish_once", effect: "external_write", permissions: ["social.publish"], plans: GROWTH, businessAddon: "social-publishing", approval: true, meter: "published_post", prerequisites: ["social_publishing_entitlement", "supported_business_profile", "provider_public_posting_approval", "exact_content_and_destination_approval"] }),

  ...([
    ["checklist", "Prepare document intake checklist", "approved_case_intake", "draft_minimum_necessary_document_checklist", "internal_write", ["documents.read", "drafts.write"]],
    ["retrieve", "Retrieve owner-selected files", "owner_selected_file_request", "read_only_allowlisted_files_with_server_side_credentials", "external_read", ["documents.read"]],
    ["extract", "Extract structured form fields", "authorized_document_received", "extract_fields_with_confidence_source_spans_and_review", "internal_write", ["documents.read", "documents.extract"]],
    ["missing-reminder", "Remind about missing documents", "document_deadline_due", "recheck_missing_items_and_send_permitted_reminder", "external_write", ["documents.read", "channel.reply"]],
    ["report", "Generate a private report or PDF", "approved_report_request", "generate_validate_and_store_new_service_private_artifact", "internal_write", ["documents.read", "agent_deliverables.generate"]],
  ] as const).map(([id, name, event, operation, effect, permissions]) => define({ id: `documents.${id}`, name, event, operation, effect, permissions: [...permissions], group: "documents", plans: GROWTH, businessAddon: "advanced-templates", meter: id === "retrieve" ? null : "text_ai_credit", prerequisites: ["selected_file_allowlist", "data_classification"], gates: ["sensitive_data_review_if_required"] })),

  ...([
    ["morning-brief", "Morning owner briefing", "owner_local_morning", "summarize_authorized_schedule_inquiries_and_due_tasks"],
    ["urgent-alert", "Urgent exception alert", "verified_urgent_exception", "route_minimized_actionable_exception_to_owner"],
    ["weekly-results", "Weekly results report", "weekly_report_due", "summarize_observed_results_and_label_missing_evidence"],
    ["workflow-health", "Workflow health report", "health_check_due", "report_failed_degraded_or_blocked_workflows"],
    ["cost-report", "Usage and cost report", "billing_usage_threshold_or_report_due", "report_reserved_settled_and_remaining_allowance_without_rebilling"],
    ["knowledge-refresh", "Suggest business knowledge updates", "source_changed_or_review_due", "propose_cited_fact_changes_for_owner_review"],
  ] as const).map(([id, name, event, operation]) => define({ id: `owner.${id}`, name, event, operation, group: "owner_operations", effect: "internal_write", permissions: [id === "cost-report" ? "usage.read" : "operations.read"], meter: id === "workflow-health" || id === "cost-report" ? null : "text_ai_credit" })),
  define({ id: "owner.recurring-research", name: "Multiple recurring research briefs", group: "owner_operations", event: "approved_research_schedule", operation: "produce_cited_bounded_research_for_owner", effect: "internal_write", permissions: ["knowledge.read", "research.run"], plans: ["operations"], prerequisites: ["approved_research_sources", "research_budget"] }),

  define({ id: "products.monitor", name: "Monitor existing product order status", group: "product_operations", event: "authorized_readonly_monitor_due", operation: "read_verified_legacy_status_without_repair_or_fulfillment", effect: "legacy_read", permissions: ["orders.read"], legacyRead: true, meter: null, sources: ["verified_legacy_read_interface"], prerequisites: ["verified_read_only_adapter", "order_ownership"] }),
  define({ id: "products.support-draft", name: "Draft existing product support response", group: "product_operations", event: "legacy_order_support_needed", operation: "draft_support_using_observed_status_no_legacy_effect", effect: "internal_write", permissions: ["orders.read", "drafts.write"], legacyRead: true, draftOnly: true }),
  define({ id: "products.new-generate", name: "Generate new agent deliverable", group: "product_operations", event: "new_service_entitlement_verified", operation: "run_resumable_new_service_generation_only", effect: "internal_write", permissions: ["agent_deliverables.generate"], prerequisites: ["new_service_order_only", "separate_new_service_entitlement"] }),
  define({ id: "products.new-qa", name: "Check new agent deliverable quality", group: "product_operations", event: "new_service_generation_completed", operation: "validate_required_sections_assets_and_sources_before_ready", effect: "internal_write", permissions: ["agent_deliverables.read", "agent_deliverables.validate"], prerequisites: ["new_service_order_only"] }),
  define({ id: "products.new-delivery", name: "Deliver new agent artifact", group: "product_operations", event: "new_service_artifact_validated", operation: "deliver_private_new_service_link_through_idempotent_outbox", effect: "external_write", permissions: ["agent_deliverables.deliver", "platform_email.send"], prerequisites: ["new_service_order_only", "validated_artifact", "verified_sender"], meter: "platform_email" }),
  define({ id: "products.subscription-renewal", name: "Notify new subscription renewal", group: "product_operations", event: "verified_new_subscription_renewal", operation: "record_new_platform_entitlement_and_send_renewal_notice", effect: "external_write", permissions: ["agent_billing.read", "platform_email.send"], prerequisites: ["new_subscription_event_namespace", "separate_webhook_signature"], meter: "platform_email" }),
  define({ id: "products.subscription-dunning", name: "Notify new subscription payment issue", group: "product_operations", event: "verified_new_subscription_payment_failed", operation: "notify_owner_and_apply_new_plan_grace_policy_without_new_charge", effect: "external_write", permissions: ["agent_billing.read", "platform_email.send"], prerequisites: ["new_subscription_event_namespace", "separate_webhook_signature"], meter: "platform_email" }),

  ...(["voice", "whatsapp"] as const).flatMap((group) => ([
    ["service", "customer-service conversation", "verified_inbound_conversation", "answer_approved_service_questions_and_escalate_uncertainty"],
    ["intake", "lead intake", "verified_inbound_lead", "collect_minimum_lead_details_with_channel_consent"],
    ["scheduling", "scheduling conversation", "customer_requested_scheduling", "coordinate_verified_availability_and_explicit_booking_intent"],
    ["handoff", "human handoff", "customer_or_policy_requested_human", "handoff_with_fallback_if_transfer_fails"],
    ["reminder", "permitted reminder", "authorized_reminder_due", "send_permitted_reminder_with_current_window_and_consent_checks"],
    ["callback", "permitted callback", "customer_requested_callback", "contact_verified_requester_within_consented_window"],
  ] as const).map(([id, name, event, operation]) => define({ id: `${group}.${id}`, name: `${group === "voice" ? "Voice" : "WhatsApp"} ${name}`, group, event, operation, effect: "external_write", permissions: [`${group}.communicate`, ...(id === "scheduling" ? ["calendar.read", "calendar.write"] : [])], inputs: ["verified_channel_identity", "conversation_id"], meter: group === "voice" ? "voice_connected_second" : "whatsapp_provider_cent", prerequisites: group === "voice" ? ["voice_number_and_routing_ready", "regional_call_rules", "human_transfer_destination", ...(id === "callback" || id === "reminder" ? ["explicit_outbound_call_permission"] : [])] : ["whatsapp_number_entitlement", "meta_embedded_signup_ready", "current_service_window_or_approved_template", "whatsapp_optin"], gates: [group === "voice" ? "real_call_acceptance_test" : "real_whatsapp_acceptance_test"] }))),
]);

export interface IndustryPack {
  readonly id: string; readonly name: string; readonly version: string; readonly initialPilot: boolean;
  readonly defaultAutomationIds: readonly string[]; readonly previewAutomationIds: readonly string[];
  readonly requiredFacts: readonly string[]; readonly prerequisites: readonly string[]; readonly prohibitedActions: readonly string[];
  readonly extraReleaseGates: readonly string[]; readonly defaultScope: "business_operations" | "public_faq_only";
  readonly readiness: "definition_ready_executor_and_live_tests_pending";
}
function pack(id: string, name: string, initialPilot: boolean, defaultAutomationIds: string[], requiredFacts: string[], prerequisites: string[], prohibitedActions: string[], extraReleaseGates: string[] = []): IndustryPack {
  return { id, name, version: CATALOG_VERSION, initialPilot, defaultAutomationIds, previewAutomationIds: [], requiredFacts, prerequisites, prohibitedActions, extraReleaseGates, defaultScope: "business_operations", readiness: "definition_ready_executor_and_live_tests_pending" };
}
export const INDUSTRY_PACKS: readonly IndustryPack[] = deepFreeze([
  pack("barbershops-salons", "Barbers and salons", true, ["front-desk.contact", "appointments.availability", "appointments.book", "appointments.reminder", "appointments.reschedule", "retention.rebook", "appointments.waitlist"], ["services", "service_durations", "staff_and_chair_ownership", "deposits", "no_show_rules"], ["authorized_staff_calendar"], ["invent_availability", "unapproved_deposit_charge"]),
  pack("home-services", "Home services", true, ["voice.intake", "sales.qualify", "email.attachments", "sales.booking-handoff", "appointments.book", "sales.estimate-followup"], ["service_area", "job_types", "hazard_escalation", "estimate_rules"], ["job_system_for_dispatch_and_technician_status"], ["autonomous_hazard_diagnosis", "invent_technician_status"]),
  pack("professional-services", "Professional services", true, ["front-desk.contact", "sales.qualify", "documents.checklist", "sales.estimate-followup", "owner.morning-brief"], ["consultation_scope", "confidentiality", "conflict_rules", "professional_escalation"], ["sensitive_document_review"], ["autonomous_legal_tax_financial_or_professional_judgment"]),
  pack("auto-services", "Auto services", false, ["front-desk.contact", "sales.qualify", "sales.booking-handoff", "sales.estimate-followup", "appointments.reminder"], ["vehicle_fields", "service_types", "mechanic_escalation"], ["shop_system_for_live_status"], ["autonomous_diagnosis", "unapproved_repair_scope", "autonomous_safety_advice", "unapproved_prices"]),
  pack("real-estate", "Real estate", false, ["front-desk.faq", "front-desk.assignment", "appointments.book", "sales.nurture"], ["property_ids", "agent_assignment", "showing_rules"], ["authorized_listing_feed", "authorized_crm_feed", "fair_qualification_review"], ["invent_property_availability", "discriminatory_qualification"]),
  pack("restaurants-cafes", "Restaurants and cafés", false, ["front-desk.faq", "front-desk.contact", "sales.qualify", "sales.estimate-followup"], ["menus", "hours", "catering", "private_event_rules"], ["reservation_or_pos_integration_before_commitment"], ["invent_table_inventory", "unverified_order_submission", "infer_allergen_safety"]),
  pack("spas-fitness", "Spas and fitness", false, ["front-desk.contact", "appointments.availability", "appointments.confirmation", "appointments.waitlist", "retention.renewal", "retention.rebook"], ["services", "classes", "trainer_room_rules"], ["integrated_membership_and_class_capacity_before_commitment"], ["invent_capacity", "unapproved_health_advice"]),
  pack("pet-care", "Pet care", false, ["front-desk.contact", "appointments.book", "appointments.reminder", "retention.rebook"], ["services", "minimum_pet_details", "preparation_rules", "pickup_rules"], ["authorized_capacity_source", "permission_for_vaccination_records"], ["autonomous_veterinary_judgment"]),
  pack("retail", "Retail", false, ["front-desk.faq", "front-desk.contact", "support.order-lookup", "sales.nurture"], ["products", "hours", "pickup_rules", "marketing_consent"], ["inventory_order_adapter_before_commitment"], ["invent_stock", "unverified_purchase_or_fulfillment_promise"]),
  { ...pack("clinics-dentists", "Clinics and dentists", false, ["front-desk.faq"], ["approved_public_information", "staff_handoff", "urgent_care_boundary"], ["public_faq_corpus_with_no_patient_data"], ["clinical_judgment", "unreviewed_patient_data_collection", "unreviewed_patient_system_connection"], ["documented_privacy_security_vendor_assessment", "appropriate_contracts", "patient_workflow_live_acceptance"]), defaultScope: "public_faq_only", previewAutomationIds: ["setup.first-preview"] },
]);

export function getAutomation(id: string): AutomationDefinition | undefined { return AUTOMATIONS.find((item) => item.id === id); }
export function getIndustryPack(id: string): IndustryPack | undefined { return INDUSTRY_PACKS.find((item) => item.id === id); }
export function automationCatalog() { return JSON.parse(JSON.stringify({ version: CATALOG_VERSION, automations: AUTOMATIONS, industryPacks: INDUSTRY_PACKS })); }

export interface EligibilityContext {
  readonly planId: string; readonly addonIds?: readonly string[]; readonly grantedPermissions?: readonly string[];
  readonly satisfiedPrerequisites?: readonly string[]; readonly mode: AutomationMode; readonly industryPackId?: string;
}
/** Deny-by-default: a complete definition is never evidence that its executor exists. */
export function evaluateAutomationEligibility(id: string, context: EligibilityContext): { eligible: boolean; executionEnabled: false; reasons: string[] } {
  const definition = getAutomation(id);
  if (!definition) return { eligible: false, executionEnabled: false, reasons: ["unknown_automation"] };
  const reasons: string[] = [];
  const plan = getPlan(context.planId);
  if (!plan) reasons.push("unknown_plan");
  else if (!definition.eligibility.plans.includes(plan.id) && !(plan.id === "business" && definition.eligibility.businessAddon && context.addonIds?.includes(definition.eligibility.businessAddon))) reasons.push("plan_entitlement_missing");
  if (!definition.modes.includes(context.mode)) reasons.push("mode_not_permitted");
  for (const permission of definition.permissions) if (!context.grantedPermissions?.includes(permission)) reasons.push(`permission_missing:${permission}`);
  for (const prerequisite of definition.eligibility.prerequisites) if (!context.satisfiedPrerequisites?.includes(prerequisite)) reasons.push(`prerequisite_missing:${prerequisite}`);
  if (context.industryPackId) {
    const industry = getIndustryPack(context.industryPackId);
    if (!industry) reasons.push("unknown_industry_pack");
    else if (industry.defaultScope === "public_faq_only" && !industry.defaultAutomationIds.includes(id) && !(context.mode === "preview_draft" && industry.previewAutomationIds.includes(id))) reasons.push("clinic_additional_review_required");
  }
  // This catalog intentionally contains no executable implementations or live-provider evidence.
  reasons.push("executor_not_implemented", "live_readiness_not_verified");
  return { eligible: false, executionEnabled: false, reasons };
}
