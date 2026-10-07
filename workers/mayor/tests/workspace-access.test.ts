import {expect,it} from 'vitest';
import {createWorkspaceAccessGuard,workspaceAccessWasRejected,selectWorkspaceBusiness} from '../web/workspace-access';

it('suppresses late private responses and refuses new requests after access ends',async()=>{
 const access=createWorkspaceAccessGuard();let resolve!:(value:string)=>void;
 const response=new Promise<string>(done=>resolve=done),rendered:string[]=[];
 const captured=access.capture();
 const pending=response.then(value=>{access.assert(captured);rendered.push(value);});
 access.end();resolve('private customer data');
 await expect(pending).rejects.toThrow('workspace access has ended');
 expect(rendered).toEqual([]);expect(()=>access.capture()).toThrow('workspace access has ended');
 access.end();expect(()=>access.assert(captured)).toThrow();
});

it('returns to the paid workspace without falling back to another membership',()=>{
 const memberships=[{id:'first-business',role:'staff'},{id:'paid-business',role:'billing'}];
 expect(selectWorkspaceBusiness(memberships,'paid-business')).toBe(memberships[1]);
 expect(selectWorkspaceBusiness(memberships,null)).toBe(memberships[0]);
 expect(()=>selectWorkspaceBusiness(memberships,'removed-business')).toThrow('payment return is not available');
 expect(()=>selectWorkspaceBusiness([],'paid-business')).toThrow();
});

it('permits current requests and only treats authenticated workspace authority loss as terminal',()=>{
 const access=createWorkspaceAccessGuard();expect(()=>access.assert(access.capture())).not.toThrow();
 expect(workspaceAccessWasRejected('/api/businesses/business/tasks','business',true,'permission_denied')).toBe(true);
 expect(workspaceAccessWasRejected('/api/voice/session','business',true,'permission_denied')).toBe(true);
 expect(workspaceAccessWasRejected('/api/businesses/business/conversation','business',true,'voice_access_expired')).toBe(true);
 expect(workspaceAccessWasRejected('/api/businesses/business/overview','business',true,'workspace_not_found')).toBe(true);
 expect(workspaceAccessWasRejected('/api/auth/grants','business',true,'permission_denied')).toBe(false);
 expect(workspaceAccessWasRejected('/api/auth/get-session','',false,'authentication_required')).toBe(false);
 expect(workspaceAccessWasRejected('/api/businesses/business/tasks','business',true,'revision_conflict')).toBe(false);
});
