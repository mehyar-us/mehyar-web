import {it,expect} from 'vitest';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {verifyProviderIdToken} from 'better-auth/oauth2';
import {microsoftVerifier} from '../src/auth/microsoft-verifier';
it('verifies Microsoft keys without alg while rejecting wrong nonce, issuer, audience and signature',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='fixture';delete jwk.alg;
 const provider=microsoftVerifier('test-client','test-secret',createLocalJWKSet({keys:[jwk]}));
 const tenant='9188040d-6c67-4c5b-b112-36a304b66dad';
 const sign=(claims:Record<string,unknown>={})=>new SignJWT({tid:tenant,nonce:'expected',...claims}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience('test-client').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const token=await sign();expect(await verifyProviderIdToken(provider,token,'expected')).toBe(true);
 expect(await verifyProviderIdToken(provider,token,'wrong')).toBe(false);
 expect(await verifyProviderIdToken(provider,await sign({tid:'different'}),'expected')).toBe(false);
 expect(await verifyProviderIdToken(microsoftVerifier('other-client','test',createLocalJWKSet({keys:[jwk]})),token,'expected')).toBe(false);
 const other=await generateKeyPair('RS256');const otherJwk=await exportJWK(other.publicKey);otherJwk.kid='fixture';
 expect(await verifyProviderIdToken(microsoftVerifier('test-client','test',createLocalJWKSet({keys:[otherJwk]})),token,'expected')).toBe(false);
});
