import type { BusinessAgent } from './agent';

export interface Env {
  AGENT_DB: D1Database;
  BUSINESS_AGENTS: DurableObjectNamespace<BusinessAgent>;
  ARTIFACTS: R2Bucket;
  APP_ORIGIN: string;
  ENVIRONMENT: 'local' | 'staging' | 'production';
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  GOOGLE_ENABLED_CAPABILITIES?: string;
  MICROSOFT_ENABLED_CAPABILITIES?: string;
  AI?: Ai;
  AI_ENABLED?: string;
  AI_GATEWAY_ID?: string;
  COMMERCE_ENABLED?: string;
  EXTERNAL_ACTIONS_ENABLED?: string;
  AGENT_STRIPE_SECRET_KEY?: string;
  AGENT_STRIPE_WEBHOOK_SECRET?: string;
  AGENT_STRIPE_ACCOUNT_ID?: string;
  AGENT_STRIPE_PRICE_MAP?: string;
  AGENT_STRIPE_PORTAL_CONFIGURATION?: string;
}

export type Role = 'owner' | 'manager' | 'staff' | 'billing' | 'viewer' | 'support';
export interface Actor { userId: string; tenantId: string; }
export interface Tenant {
  id: string; name: string; website: string; goal: string; agent_name: string;
  owner_id: string; status: string; plan_id: string; trial_expires_at: string;
  created_at: string; updated_at: string;
}
