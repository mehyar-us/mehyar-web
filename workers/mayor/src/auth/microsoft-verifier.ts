import {microsoft} from 'better-auth/social-providers';
import {createRemoteJWKSet, type JWTHeaderParameters} from 'jose';

const microsoftKeys=createRemoteJWKSet(new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'));
/** Microsoft omits JWK.alg; jose resolves the algorithm from the signed JWT header. */
export function microsoftVerifier(clientId:string,clientSecret:string,keys:(header:JWTHeaderParameters)=>Promise<CryptoKey|Uint8Array>=microsoftKeys){
 const provider=microsoft({clientId,clientSecret,tenantId:'common',disableDefaultScope:true,scope:['openid','profile','email'],disableProfilePhoto:true});
 return {...provider,idToken:{...provider.idToken,jwks:keys,algorithms:['RS256']}};
}
