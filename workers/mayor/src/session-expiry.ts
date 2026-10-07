/** Better Auth writes ISO dates to D1; older sessions may contain epoch milliseconds.
 * Normalize both representations before comparison. Invalid text becomes NULL.
 * This trusted SQL fragment uses the auth_session alias `s` in access predicates.
 */
export const sessionExpiryMillisSql=`(CASE
 WHEN typeof(s.expiresAt) IN ('integer','real') THEN s.expiresAt
 WHEN typeof(s.expiresAt)='text' THEN CAST(ROUND((julianday(s.expiresAt)-2440587.5)*86400000) AS INTEGER)
 ELSE NULL END)`;
