import type { AuthEnv } from './auth/capabilities';
import type { MayorVoice } from './voice';
import type {MayorPhone} from './phone-voice';
export interface Env extends AuthEnv {
  AI: Ai;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  MAYOR_VOICE: DurableObjectNamespace<MayorVoice>;
  MAYOR_PHONE: DurableObjectNamespace<MayorPhone>;
  PHONE_TEST_ENABLED?:string;
  TELNYX_OAUTH_ENABLED?:string;
  TELNYX_CLIENT_ID?:string;
  TELNYX_CLIENT_SECRET?:string;
  TELNYX_OAUTH_SCOPES?:string;
  MAYOR_EMAIL?:SendEmail;
  MAYOR_EMAIL_FROM?:string;
  MAYOR_STRIPE_MODE?: 'test' | 'live';
  MAYOR_STRIPE_SECRET_KEY?: string;
  MAYOR_STRIPE_WEBHOOK_SECRET?: string;
  MAYOR_STRIPE_PRICE_ID?: string;
  MAYOR_STRIPE_CREDIT_PRICE_SMALL?: string;
  MAYOR_STRIPE_CREDIT_PRICE_MEDIUM?: string;
  MAYOR_STRIPE_CREDIT_PRICE_LARGE?: string;
  MAYOR_STRIPE_PORTAL_CONFIGURATION?: string;
  MAYOR_STRIPE_ACCOUNT_ID?: string;
  MAYOR_STRIPE_AUDIT_PRICE_ID?: string;
  MAYOR_AUDIT_STATUS_SECRET?: string;
  /** Crew 6f Instagram DM — DARK until Meta App Review approves instagram_manage_messages.
   *  INSTAGRAM_DM_ENABLED must be '1' to activate; unset/anything-else = dark. */
  INSTAGRAM_DM_ENABLED?:string;
  INSTAGRAM_VERIFY_TOKEN?:string;
  INSTAGRAM_PAGE_TOKEN?:string;
  /** Dark-stage page→tenant map: '{"<pageId>":"<tenantId>"}'. Replaced by a D1
   *  connection table + OAuth connect flow at light-up. */
  INSTAGRAM_DM_TENANT_MAP?:string;
  MAYOR_AUDIT_ALLOWED_ORIGINS?: string;
  MAYOR_AUDIT_OPERATOR_USER_IDS?: string;
  MAYOR_AUDIT_FULFILLMENT_READY?: string;
  MAYOR_AUDIT_MODEL?: string;
  MAYOR_AUDIT_INFERENCE_MODE?: string;
  ENVIRONMENT: string;
  ASSETS?: Fetcher;
}
export type Role = 'owner' | 'manager' | 'staff' | 'viewer' | 'billing';
export interface Actor { userId: string; tenantId: string; }
export interface Tenant { id: string; name: string; status: string; created_at: string; }
