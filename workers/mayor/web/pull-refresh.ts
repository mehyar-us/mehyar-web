export type PullRefreshGuard={allowed:boolean;busy?:boolean};
export type PullRefreshTouch={x:number;y:number;touches:number;id?:number};
export type PullRefreshStart=PullRefreshTouch&{scrollY:number;interactive:boolean};
export type PullRefreshSnapshot={phase:'idle'|'pulling'|'armed'|'refreshing';distance:number;preventDefault:boolean};

export const PULL_REFRESH_THRESHOLD=72;
const activationDistance=8,maxDistance=120;

/** Pure gesture state; the caller owns live authorization, DOM feedback and fetching. */
export function createPullRefresh(){
 let origin:{x:number;y:number;id:number}|null=null,distance=0,refreshing=false;
 const permitted=(guard:PullRefreshGuard)=>guard.allowed&&!guard.busy&&!refreshing;
 const validTouch=(touch:PullRefreshTouch)=>touch.touches===1&&Number.isFinite(touch.x)&&Number.isFinite(touch.y);
 function resetTracking(){origin=null;distance=0;}
 function snapshot():PullRefreshSnapshot{
  return {phase:refreshing?'refreshing':distance>=PULL_REFRESH_THRESHOLD?'armed':distance>activationDistance?'pulling':'idle',distance,preventDefault:!refreshing&&Boolean(origin)&&distance>activationDistance};
 }
 function start(touch:PullRefreshStart,guard:PullRefreshGuard){
  resetTracking();
  if(!permitted(guard)||!validTouch(touch)||!Number.isFinite(touch.scrollY)||touch.scrollY>0||touch.interactive)return false;
  origin={x:touch.x,y:touch.y,id:touch.id??0};return true;
 }
 function move(touch:PullRefreshTouch,guard:PullRefreshGuard):PullRefreshSnapshot{
  if(!origin)return snapshot();
  if(!permitted(guard)||!validTouch(touch)||(touch.id??0)!==origin.id){resetTracking();return snapshot();}
  const x=Math.abs(touch.x-origin.x),y=touch.y-origin.y;
  if(y<=0||x>Math.abs(y)){resetTracking();return snapshot();}
  distance=Math.min(maxDistance,y);return snapshot();
 }
 function end(guard:PullRefreshGuard,touchesRemaining=0){
  const refresh=Boolean(origin)&&distance>=PULL_REFRESH_THRESHOLD&&touchesRemaining===0&&permitted(guard);
  resetTracking();if(refresh)refreshing=true;return refresh;
 }
 function cancel(){resetTracking();return snapshot();}
 function finish(){refreshing=false;resetTracking();return snapshot();}
 return {start,move,end,cancel,finish,snapshot};
}
