import {describe,expect,it} from 'vitest';
import {decryptCredential,encryptCredential,type CredentialBinding} from '../src/auth/vault';
import {auditReceipt} from '../src/billing/audit';

/**
 * Slice 0 pre-checks (blueprint §5, demand: secrets unchanged).
 *
 * The vectors below were generated against the PRE-SLICE (base)
 * implementations of the credential vault (src/auth/vault.ts:
 * AES-256-GCM, AAD bound to the credential binding, `v1.` envelope)
 * and the audit receipt token (src/billing/audit.ts tokenFor +
 * src/http.ts digest), using test-only secret material. Slice 0 does
 * not modify either file (verifiable in the slice diff), and these
 * tests prove the CURRENT code still opens pre-existing material
 * under unchanged secrets: a credential envelope minted before the
 * rebuild decrypts, and a sold audit receipt issued before the rebuild
 * still verifies. No production secret value appears in this file.
 */
const VAULT_KEY_B64='AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const VAULT_BINDING:CredentialBinding={userId:'pre-check-user',provider:'google',accountId:'pre-check-account',tenantId:null};
const VAULT_ENVELOPE='v1.ZGVmZ2hpamtsbW5v.G30SL/LtyReMEsL5cUDaBtbwb6WalLdk2LOPjxWExwca86xnpTeKZGlx/AoSfYwAhM+y6IgN2fTjguYLZ4+YXyPMd4+fJiMr4GCtT37hX2NevsGJoaBJYzeZvbSY658+nsAs16WgVFCS9ABD7xo2O72xm6cpMhFkpMcvB9f0B5+/3HwDs84SM9mCrRv7uEaTr4UO8jKFEx9oJveymjGSjz3Y/rPI8KyzAPd9rcJ2sSTU';
const RECEIPT_VECTOR={
 secret:'slice0-precheck-test-secret',
 orderId:'pre-rebuild-order-0001',
 token:'905341b63db1d818b218bcfebd91081e1fa9da45f2da520cc8da7ac27c1a4acb',
 tokenHash:'bb3560714b2e1eb8f3b7ca4c7f793d024bfce62de34ec166c64b1564e1b3d551',
};

describe('pre-check: credential envelope under the unchanged TOKEN_ENCRYPTION_KEY',()=>{
 it('decrypts a pre-slice envelope (fixed vector)',async()=>{
  const credential=await decryptCredential(VAULT_ENVELOPE,VAULT_BINDING,VAULT_KEY_B64);
  expect(credential.accountEmail).toBe('owner@example.test');
  expect(credential.accessToken).toBe('pre-existing-access-token');
  expect(credential.refreshToken).toBe('pre-existing-refresh-token');
 });

 it('round-trips new envelopes, and fails closed on wrong key or wrong binding',async()=>{
  const sealed=await encryptCredential({accountEmail:'a@b.test',accessToken:'fresh',grantedScopes:[]},VAULT_BINDING,VAULT_KEY_B64);
  expect((await decryptCredential(sealed,VAULT_BINDING,VAULT_KEY_B64)).accessToken).toBe('fresh');
  const wrongKey=btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
  await expect(decryptCredential(sealed,VAULT_BINDING,wrongKey)).rejects.toThrow();
  await expect(decryptCredential(sealed,{...VAULT_BINDING,tenantId:'someone-else'},VAULT_KEY_B64)).rejects.toThrow();
 });
});

describe('pre-check: sold audit receipt under the unchanged MAYOR_AUDIT_STATUS_SECRET',()=>{
 function receiptEnv(){
  const order={id:RECEIPT_VECTOR.orderId,mode:'test',payment_status:'paid',fulfillment_status:'delivered',status_token_hash:RECEIPT_VECTOR.tokenHash,paid_at:'2026-10-15T12:00:00.000Z',report_json:null,report_html:null};
  return {MAYOR_AUDIT_STATUS_SECRET:RECEIPT_VECTOR.secret,MAYOR_STRIPE_MODE:'test',AGENT_DB:{prepare(){return {bind(...args:unknown[]){return {async first(){return args.includes(RECEIPT_VECTOR.tokenHash)?order:null;},async run(){return {success:true,meta:{}};},async all(){return {results:[]};}};}};}}} as never;
 }

 it('verifies a receipt token issued before the rebuild',async()=>{
  const receipt=await auditReceipt(receiptEnv(),RECEIPT_VECTOR.token);
  expect(receipt.orderId).toBe(RECEIPT_VECTOR.orderId);
  expect(receipt.paymentStatus).toBe('paid');
  expect(receipt.priceCents).toBe(33_000);
 });

 it('rejects a wrong token (the proof is not vacuous)',async()=>{
  await expect(auditReceipt(receiptEnv(),'f'.repeat(64))).rejects.toThrow();
 });
});
