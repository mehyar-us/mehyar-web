import {z} from 'zod';
import type {AuthEnv} from './capabilities';
import {decryptCredential,requireConnectorManager,type CredentialBinding} from './vault';

/** A provider-confirmed display label only; never infer it from the login user. */
export async function grantAccountEmail(env:AuthEnv,binding:CredentialBinding,ciphertext:string,status:string):Promise<string|null>{
  if(!env.TOKEN_ENCRYPTION_KEY||status==='revoked')return null;
  try{
    if(binding.tenantId)await requireConnectorManager(env,binding.tenantId,binding.userId);
    const credential=await decryptCredential(ciphertext,binding,env.TOKEN_ENCRYPTION_KEY);
    const email=z.string().max(254).pipe(z.email()).safeParse(credential.accountEmail);
    if(binding.tenantId)await requireConnectorManager(env,binding.tenantId,binding.userId);
    return email.success?email.data:null;
  }catch{return null;}
}
