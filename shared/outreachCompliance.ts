export type OutreachChannel = "email" | "sms" | "voice" | "social" | "mail";

export type ConsentStatus =
  | "unknown"
  | "service_request"
  | "marketing_opt_in"
  | "sms_opt_in"
  | "revoked"
  | "stop"
  | "opt_out"
  | "complaint"
  | "legal"
  | "invalid";

export type RiskTier = "low" | "medium" | "high" | "prohibited";

export type SuppressionReason =
  | "opt_out"
  | "stop"
  | "bounce"
  | "complaint"
  | "manual"
  | "legal"
  | "invalid";

export type SuppressionMatch = {
  type: "email" | "phone" | "domain" | "business" | "person";
  reason: SuppressionReason;
  channel?: OutreachChannel;
};

export type CampaignApprovalInput = {
  channel: OutreachChannel;
  sourceUrl?: string | null;
  channelEligible: boolean;
  consentStatus: ConsentStatus;
  riskTier: RiskTier;
  manualApprovalStatus?: "approved" | "pending" | "rejected" | null;
  suppressionMatches?: SuppressionMatch[];
  hasOptOutLanguage: boolean;
  hasPhysicalAddressOrManualOneToOne: boolean;
  subjectIsAccurate: boolean;
  copyContainsSensitiveAsk: boolean;
  auditLogWritable: boolean;
  dailyCapExceeded: boolean;
};

export type CampaignApprovalDecision = {
  approved: boolean;
  riskTier: RiskTier;
  blockReasons: string[];
};

const BLOCKING_CONSENT_STATUSES: ConsentStatus[] = [
  "revoked",
  "stop",
  "opt_out",
  "complaint",
  "legal",
  "invalid",
];

export function evaluateCampaignApproval(input: CampaignApprovalInput): CampaignApprovalDecision {
  const blockReasons: string[] = [];

  if (input.suppressionMatches?.length) {
    blockReasons.push("suppression_match");
  }

  if (!input.sourceUrl) {
    blockReasons.push("missing_source_url");
  }

  if (!input.channelEligible) {
    blockReasons.push("channel_not_eligible");
  }

  if (BLOCKING_CONSENT_STATUSES.includes(input.consentStatus)) {
    blockReasons.push(`blocked_consent_status:${input.consentStatus}`);
  }

  if ((input.channel === "sms" || input.channel === "voice") && input.consentStatus !== "sms_opt_in") {
    blockReasons.push("sms_voice_requires_explicit_opt_in");
  }

  if (input.riskTier === "high" && input.manualApprovalStatus !== "approved") {
    blockReasons.push("high_risk_requires_manual_approval");
  }

  if (input.riskTier === "prohibited") {
    blockReasons.push("prohibited_risk_tier");
  }

  if (!input.hasOptOutLanguage) {
    blockReasons.push("missing_opt_out_language");
  }

  if (!input.hasPhysicalAddressOrManualOneToOne) {
    blockReasons.push("missing_commercial_email_footer_address_decision");
  }

  if (!input.subjectIsAccurate) {
    blockReasons.push("misleading_subject_or_copy");
  }

  if (input.copyContainsSensitiveAsk) {
    blockReasons.push("sensitive_data_request_blocked");
  }

  if (!input.auditLogWritable) {
    blockReasons.push("audit_log_unavailable");
  }

  if (input.dailyCapExceeded) {
    blockReasons.push("daily_cap_exceeded");
  }

  return {
    approved: blockReasons.length === 0,
    riskTier: input.riskTier,
    blockReasons,
  };
}

export function classifyConsentForInboundRequest(marketingOptIn: boolean): ConsentStatus {
  return marketingOptIn ? "marketing_opt_in" : "service_request";
}

export function isSuppressionReason(value: string): value is SuppressionReason {
  return ["opt_out", "stop", "bounce", "complaint", "manual", "legal", "invalid"].includes(value);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.replace(/[^+\d]/g, "");
}
