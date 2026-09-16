import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {storeProviderGrant,decryptCredential,revokeProviderGrant,type ProviderCredential} from '../src/auth/vault';
import {connectorCredential,connectionAuthorizationStamp} from '../src/connectors/credentials';
import {GOOGLE_MAIL_OPERATIONS} from '../src/connectors/google-mail';
import {MICROSOFT_MAIL_OPERATIONS} from '../src/connectors/microsoft-mail';
import {connectedCalendars} from '../src/connectors/calendar-access';
import {digest} from '../src/http';
const e={...env,GOOGLE_CLIENT_ID:'fixture-google',GOOGLE_CLIENT_SECRET:'fixture-google-secret',MICROSOFT_CLIENT_ID:'fixture-ms',MICROSOFT_CLIENT_SECRET:'fixture-ms-secret'} as unknown as Env;
async function fixture(provider:'google'|'microsoft'='google',fresh=false) {
  const userId=crypto.randomUUID();
  await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)').bind(userId,'Fixture',`${userId}@example.test`,Date.now(),Date.now()).run();
  const tenant=await createTenant(e,userId,{name:'Credential fixture'},crypto.randomUUID());
  const actor={userId,tenantId:tenant.id},binding={userId,tenantId:tenant.id,provider,accountId:crypto.randomUUID()};
  const granted=provider==='google'?['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send']:['Mail.Read','Mail.Send'];
  const credential:ProviderCredential={accountEmail:'work@example.test',accessToken:'fixture-old-access',refreshToken:'fixture-old-refresh',
    accessTokenExpiresAt:new Date(Date.now()+(fresh?3600000:-60000)).toISOString(),grantedScopes:granted};
  const id=await storeProviderGrant(e,binding,credential,[]);
  return {actor,binding,id,credential,provider,operation:provider==='google'?GOOGLE_MAIL_OPERATIONS.reply:MICROSOFT_MAIL_OPERATIONS.reply};
}
const response=(extra:Record<string,unknown>={})=>Response.json({access_token:'fixture-new-access',token_type:'Bearer',expires_in:3600,...extra});
describe('server credential renewal',()=>{
  it('keeps authorization identity stable on token refresh but changes it on renewed consent',async()=>{
    const f=await fixture();const before=await connectionAuthorizationStamp(e,f.actor,f.id,f.provider,f.operation);
    await connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>response());
    expect(await connectionAuthorizationStamp(e,f.actor,f.id,f.provider,f.operation)).toBe(before);
    await storeProviderGrant(e,f.binding,{...f.credential,accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString()},[]);
    expect(await connectionAuthorizationStamp(e,f.actor,f.id,f.provider,f.operation)).not.toBe(before);
    await revokeProviderGrant(e,f.actor.userId,f.id,f.actor.tenantId);
    await expect(connectionAuthorizationStamp(e,f.actor,f.id,f.provider,f.operation)).rejects.toMatchObject({code:'connection_unavailable'});
  });
  it('withholds a calendar page when consent changes during its provider read',async()=>{
    const f=await fixture('google',true),credential={...f.credential,grantedScopes:['https://www.googleapis.com/auth/calendar.calendarlist.readonly']};
    await storeProviderGrant(e,f.binding,credential,['calendar_read']);let calls=0;
    await expect(connectedCalendars({...e,GOOGLE_ENABLED_CAPABILITIES:'calendar_read'},f.actor,f.id,'google',async()=>{
      calls++;await storeProviderGrant(e,f.binding,credential,['calendar_read']);return Response.json({items:[{id:'private-calendar',summary:'Private',accessRole:'owner'}],nextPageToken:'next'});
    })).rejects.toMatchObject({code:'calendar_authorization_changed'});expect(calls).toBe(1);
  });
  it.each(['google','microsoft'] as const)('collects later %s calendar pages without exposing provider cursors',async provider=>{
    const f=await fixture(provider,true);let calls=0;
    await storeProviderGrant(e,f.binding,{...f.credential,grantedScopes:provider==='google'?['https://www.googleapis.com/auth/calendar.calendarlist.readonly']:['Calendars.Read']},['calendar_read']);
    const result=await connectedCalendars({...e,GOOGLE_ENABLED_CAPABILITIES:'calendar_read',MICROSOFT_ENABLED_CAPABILITIES:'calendar_read'},f.actor,f.id,provider,async input=>{
      calls++;const url=new URL(String(input));
      if(calls===2)expect(url.searchParams.get(provider==='google'?'pageToken':'$skiptoken')).toBe('private-cursor');
      return provider==='google'?Response.json({items:[{id:`calendar-${calls}`,summary:'Work',accessRole:'owner'}],...(calls===1?{nextPageToken:'private-cursor'}:{})})
        :Response.json({value:[{id:`calendar-${calls}`,name:'Work',canEdit:true}],...(calls===1?{'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/calendars?$skiptoken=private-cursor'}:{})});
    });
    expect(calls).toBe(2);expect(result.calendars.map(c=>c.id)).toEqual(['calendar-1','calendar-2']);expect(result.incomplete).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-cursor');
  });
  it('treats a crashed refresh lease as uncertain instead of repeating token rotation',async()=>{
    const f=await fixture();
    const row=await e.AGENT_DB.prepare('SELECT ciphertext FROM auth_provider_grants WHERE id=?').bind(f.id).first<{ciphertext:string}>();
    await e.AGENT_DB.prepare("INSERT INTO agent_credential_refreshes(grant_id,credential_hash,lease_token,status,started_at,expires_at) VALUES (?,?,?,'running',?,?)")
      .bind(f.id,await digest(row!.ciphertext),crypto.randomUUID(),'2020-01-01T00:00:00.000Z','2020-01-01T00:01:00.000Z').run();
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{throw new Error('must not repeat');})).rejects.toMatchObject({code:'refresh_uncertain'});
    expect(await e.AGENT_DB.prepare('SELECT status FROM auth_provider_grants WHERE id=?').bind(f.id).first()).toMatchObject({status:'reconnect_required'});
  });
  it('reads Microsoft calendar choices through the same credential boundary',async()=>{
    const f=await fixture('microsoft',true);
    await storeProviderGrant(e,f.binding,{...f.credential,grantedScopes:['Calendars.Read']},['calendar_read']);
    const result=await connectedCalendars({...e,MICROSOFT_ENABLED_CAPABILITIES:'calendar_read'},f.actor,f.id,'microsoft',async(input)=>{
      expect(String(input)).toContain('https://graph.microsoft.com/v1.0/me/calendars');
      return Response.json({value:[{id:'work-calendar',name:'Appointments',canEdit:true}]});
    });
    expect(result).toEqual({calendars:[{id:'work-calendar',name:'Appointments',canWrite:true}],incomplete:false});
  });
  it.each(['pause','revoke'] as const)('withholds results after %s during a calendar read',async change=>{
    const f=await fixture('google',true);let paused=false;
    await storeProviderGrant(e,f.binding,{...f.credential,grantedScopes:['https://www.googleapis.com/auth/calendar.calendarlist.readonly']},['calendar_read']);
    await expect(connectedCalendars({...e,GOOGLE_ENABLED_CAPABILITIES:'calendar_read'},f.actor,f.id,'google',async()=>{
      if(change==='pause')paused=true;else await revokeProviderGrant(e,f.actor.userId,f.id,f.actor.tenantId);
      return Response.json({items:[{id:'private-calendar',summary:'Private',accessRole:'owner'}]});
    },()=>paused)).rejects.toMatchObject({code:change==='pause'?'agent_paused':'connection_unavailable'});
  });
  it('connects the calendar picker to private credentials and returns only normalized account data',async()=>{
    const f=await fixture('google',true);
    await storeProviderGrant(e,f.binding,{...f.credential,grantedScopes:['https://www.googleapis.com/auth/calendar.calendarlist.readonly']},['calendar_read']);
    const result=await connectedCalendars({...e,GOOGLE_ENABLED_CAPABILITIES:'calendar_read'},f.actor,f.id,'google',async(input,init)=>{
      expect(String(input)).toContain('https://www.googleapis.com/calendar/v3/users/me/calendarList');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-old-access');
      return Response.json({items:[{id:'calendar-one',summary:'Business appointments',timeZone:'America/New_York',accessRole:'owner'}],nextPageToken:'next-private-cursor'});
    });
    expect(result).toEqual({calendars:[{id:'calendar-one',name:'Business appointments',timeZone:'America/New_York',canWrite:true}],incomplete:true});
    expect(JSON.stringify(result)).not.toMatch(/fixture-old|next-private-cursor/);
    await expect(connectedCalendars(e,f.actor,f.id,'google',async()=>{throw new Error('unexpected request');})).rejects.toMatchObject({code:'calendar_not_ready'});
  });
  it.each(['google','microsoft'] as const)('renews %s with the fixed endpoint and encrypted rotated tokens',async provider=>{
    const f=await fixture(provider);let calls=0;
    const auth=await connectorCredential(e,f.actor,f.id,provider,f.operation,async(input,init)=>{
      calls++;expect(String(input)).toBe(provider==='google'?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token');
      expect(init?.redirect).toBe('error');expect(new URLSearchParams(init?.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
      return response({refresh_token:'fixture-rotated-refresh',refresh_token_expires_in:86400});
    });
    expect(auth).toMatchObject({accessToken:'fixture-new-access',accountEmail:'work@example.test'});
    expect(auth).not.toHaveProperty('refreshToken');
    const row=await e.AGENT_DB.prepare('SELECT ciphertext FROM auth_provider_grants WHERE id=?').bind(f.id).first<{ciphertext:string}>();
    expect(row!.ciphertext).not.toContain('fixture-rotated-refresh');
    const stored=await decryptCredential(row!.ciphertext,f.binding,e.TOKEN_ENCRYPTION_KEY!);
    expect(stored.refreshToken).toBe('fixture-rotated-refresh');expect(Date.parse(stored.refreshTokenExpiresAt!)).toBeGreaterThan(Date.now());
    expect(await connectorCredential(e,f.actor,f.id,provider,f.operation,async()=>{throw new Error('unnecessary refresh');})).toEqual(auth);
    expect(calls).toBe(1);
  });
  it('uses a fresh token without sending a refresh request',async()=>{
    const f=await fixture('google',true);
    expect((await connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{throw new Error('unexpected network');})).accessToken).toBe('fixture-old-access');
  });
  it('persists narrowed scopes and rejects the no-longer-authorized operation',async()=>{
    const f=await fixture();
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>response({scope:'https://www.googleapis.com/auth/gmail.readonly'})))
      .rejects.toMatchObject({code:'insufficient_scope'});
    const row=await e.AGENT_DB.prepare('SELECT granted_scopes,status FROM auth_provider_grants WHERE id=?').bind(f.id).first();
    expect(row).toMatchObject({granted_scopes:JSON.stringify(['https://www.googleapis.com/auth/gmail.readonly']),status:'authorized'});
  });
  it('never widens an earlier grant from an unexpected refresh scope',async()=>{
    const f=await fixture();
    const auth=await connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>response({scope:f.credential.grantedScopes.join(' ')+' https://www.googleapis.com/auth/drive'}));
    expect(auth.grantedScopes).toEqual(f.credential.grantedScopes);
  });
  it('serializes concurrent refresh attempts',async()=>{
    const f=await fixture();let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve);
    const first=connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{entered();await hold;return response();});
    await started;
    try {await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{throw new Error('duplicate refresh');})).rejects.toMatchObject({code:'refresh_in_progress'});}
    finally{release();}await first;
  });
  it('does not restore a grant revoked while renewal is in flight',async()=>{
    const f=await fixture();
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{
      await revokeProviderGrant(e,f.actor.userId,f.id,f.actor.tenantId);return response();
    })).rejects.toMatchObject({code:'connection_unavailable'});
    expect(await e.AGENT_DB.prepare('SELECT status,ciphertext FROM auth_provider_grants WHERE id=?').bind(f.id).first()).toMatchObject({status:'revoked',ciphertext:''});
  });
  it('does not overwrite newer user consent with an older refresh result',async()=>{
    const f=await fixture();
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{
      await storeProviderGrant(e,f.binding,{...f.credential,accessToken:'new-consent-access',refreshToken:'new-consent-refresh'},[]);return response();
    })).rejects.toMatchObject({code:'credential_changed'});
    const row=await e.AGENT_DB.prepare('SELECT ciphertext,status FROM auth_provider_grants WHERE id=?').bind(f.id).first<{ciphertext:string;status:string}>();
    expect(row!.status).toBe('authorized');expect((await decryptCredential(row!.ciphertext,f.binding,e.TOKEN_ENCRYPTION_KEY!)).accessToken).toBe('new-consent-access');
  });
  it('marks an ambiguous renewal for reconnect and never blindly retries',async()=>{
    const f=await fixture();let calls=0;
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{calls++;throw new Error('fixture-sensitive-provider-response');})).rejects.toMatchObject({code:'refresh_uncertain'});
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>{calls++;return response();})).rejects.toMatchObject({code:'connection_unavailable'});
    expect(calls).toBe(1);
    const row=await e.AGENT_DB.prepare('SELECT status FROM agent_credential_refreshes WHERE grant_id=?').bind(f.id).first();expect(row?.status).toBe('uncertain');
  });
  it('rejects tenant substitution and revoked credential-owner membership before network access',async()=>{
    const f=await fixture(),other=await fixture();const transport:typeof fetch=async()=>{throw new Error('unexpected network');};
    await expect(connectorCredential(e,other.actor,f.id,f.provider,f.operation,transport)).rejects.toMatchObject({code:'connection_unavailable'});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,transport)).rejects.toMatchObject({code:'workspace_not_found'});
  });
  it('handles invalid_grant and does not recycle its rejected refresh token on consent',async()=>{
    const f=await fixture();
    await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>Response.json({error:'invalid_grant'},{status:400}))).rejects.toMatchObject({code:'reconnect_required'});
    await storeProviderGrant(e,f.binding,{...f.credential,refreshToken:undefined},[]);
    const row=await e.AGENT_DB.prepare('SELECT status FROM auth_provider_grants WHERE id=?').bind(f.id).first();expect(row?.status).toBe('reconnect_required');
  });
  it('bounds token response size and rejects malformed expiry',async()=>{
    for(const payload of [{access_token:'x'.repeat(70000)},{expires_in:-1}]) {
      const f=await fixture();
      await expect(connectorCredential(e,f.actor,f.id,f.provider,f.operation,async()=>response(payload))).rejects.toMatchObject({code:'refresh_uncertain'});
    }
  });
});
