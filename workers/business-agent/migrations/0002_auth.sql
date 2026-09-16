-- Dedicated business-agent identity only. No legacy payment tables or bindings.
CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_session_userId_idx ON auth_session(userId);
CREATE TABLE IF NOT EXISTS auth_account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(providerId, accountId)
);
CREATE INDEX IF NOT EXISTS auth_account_userId_idx ON auth_account(userId);
CREATE TABLE IF NOT EXISTS auth_verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx ON auth_verification(identifier);
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_provider_grants (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('google', 'microsoft')),
  account_id TEXT NOT NULL,
  tenant_scope TEXT NOT NULL DEFAULT '',
  ciphertext TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  granted_scopes TEXT NOT NULL,
  selected_capabilities TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('authorized', 'reconnect_required', 'revoked')),
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, provider, account_id, tenant_scope)
);
CREATE INDEX IF NOT EXISTS auth_provider_grants_tenant_idx ON auth_provider_grants(tenant_scope, user_id);
