/** Reject late results after sign-out or a server-confirmed loss of workspace access. */
export function createWorkspaceAccessGuard(){
 let revision=0,ended=false;
 const failure=()=>new Error('Your workspace access has ended. Reload to check your sign-in and permissions.');
 return {
  capture(){if(ended)throw failure();return revision;},
  assert(captured:number){if(ended||captured!==revision)throw failure();},
  end(){if(!ended){ended=true;revision++;}},
 };
}

export function workspaceAccessWasRejected(path:string,tenantId:string,loggedIn:boolean,error:unknown){
 if(!loggedIn)return false;
 if(error==='authentication_required'||error==='voice_access_expired')return true;
 const businessPath=!!tenantId&&path.startsWith(`/api/businesses/${tenantId}/`);
 return error==='workspace_not_found'||error==='permission_denied'&&(businessPath||path==='/api/voice/session');
}

/** A payment return selects only an existing, server-verified membership. */
export function selectWorkspaceBusiness<T extends {id:string}>(businesses:T[],requestedId:string|null):T|undefined {
 if(!requestedId)return businesses[0];
 const business=businesses.find(item=>item.id===requestedId);
 if(!business)throw new Error('The business for this payment return is not available. Check the signed-in account or contact its owner.');
 return business;
}
