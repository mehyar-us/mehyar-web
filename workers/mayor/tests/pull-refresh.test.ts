import {describe,expect,it} from 'vitest';
import {createPullRefresh,PULL_REFRESH_THRESHOLD,type PullRefreshGuard} from '../web/pull-refresh';

const allowed:PullRefreshGuard={allowed:true};
const start={x:100,y:100,touches:1,id:7,scrollY:0,interactive:false};
const touch=(x:number,y:number,touches=1,id=7)=>({x,y,touches,id});

describe('pull-to-refresh gesture state',()=>{
 it('waits for the downward threshold and consumes a release once',()=>{
  const pull=createPullRefresh();expect(pull.start(start,allowed)).toBe(true);
  expect(pull.move(touch(100,108),allowed)).toEqual({phase:'idle',distance:8,preventDefault:false});
  expect(pull.move(touch(100,109),allowed)).toEqual({phase:'pulling',distance:9,preventDefault:true});
  expect(pull.move(touch(100,100+PULL_REFRESH_THRESHOLD-1),allowed).phase).toBe('pulling');
  expect(pull.end(allowed)).toBe(false);
  pull.start(start,allowed);expect(pull.move(touch(100,100+PULL_REFRESH_THRESHOLD),allowed).phase).toBe('armed');
  expect(pull.end(allowed)).toBe(true);expect(pull.snapshot().phase).toBe('refreshing');expect(pull.end(allowed)).toBe(false);
 });

 it('disarms when the finger retreats below the threshold and bounds visual distance',()=>{
  const pull=createPullRefresh();pull.start(start,allowed);
  expect(pull.move(touch(100,500),allowed).distance).toBe(120);
  expect(pull.move(touch(100,140),allowed).phase).toBe('pulling');expect(pull.end(allowed)).toBe(false);
 });

 it('permanently cancels a horizontal or upward gesture until a new touch starts',()=>{
  for(const canceled of [touch(180,150),touch(100,99)]){
   const pull=createPullRefresh();pull.start(start,allowed);expect(pull.move(canceled,allowed).preventDefault).toBe(false);
   expect(pull.move(touch(100,220),allowed).phase).toBe('idle');expect(pull.end(allowed)).toBe(false);
   pull.start(start,allowed);pull.move(touch(110,180),allowed);expect(pull.end(allowed)).toBe(true);
  }
 });

 it('rejects scrolling, controls, multiple touches and invalid coordinates at start',()=>{
  for(const input of [{...start,scrollY:1},{...start,interactive:true},{...start,touches:2},{...start,x:NaN}]){
   const pull=createPullRefresh();expect(pull.start(input,allowed)).toBe(false);pull.move(touch(100,220),allowed);expect(pull.end(allowed)).toBe(false);
  }
 });

 it('cancels armed movement on multitouch, replacement fingers or touchcancel',()=>{
  for(const canceled of [touch(100,220,2),touch(100,220,1,8)]){
   const pull=createPullRefresh();pull.start(start,allowed);pull.move(touch(100,190),allowed);
   expect(pull.move(canceled,allowed).phase).toBe('idle');expect(pull.end(allowed)).toBe(false);
  }
  const pull=createPullRefresh();pull.start(start,allowed);pull.move(touch(100,190),allowed);
  expect(pull.cancel()).toEqual({phase:'idle',distance:0,preventDefault:false});expect(pull.end(allowed)).toBe(false);
  pull.start(start,allowed);pull.move(touch(100,190),allowed);expect(pull.end(allowed,1)).toBe(false);
 });

 it('checks current access and external busy state throughout the gesture',()=>{
  for(const guard of [{allowed:false},{allowed:true,busy:true}]){
   const pull=createPullRefresh();expect(pull.start(start,guard)).toBe(false);
   pull.start(start,allowed);pull.move(touch(100,190),allowed);expect(pull.move(touch(100,195),guard).phase).toBe('idle');
   expect(pull.end(allowed)).toBe(false);
   pull.start(start,allowed);pull.move(touch(100,190),allowed);expect(pull.end(guard)).toBe(false);
   pull.start(start,allowed);pull.move(touch(100,190),allowed);expect(pull.end(allowed)).toBe(true);
  }
 });

 it('keeps refresh locked through new gestures and cancellation, then accepts a fresh gesture after finish',()=>{
  const pull=createPullRefresh();pull.start(start,allowed);pull.move(touch(100,190),allowed);expect(pull.end(allowed)).toBe(true);
  expect(pull.start(start,allowed)).toBe(false);expect(pull.cancel().phase).toBe('refreshing');expect(pull.end(allowed)).toBe(false);
  expect(pull.finish()).toEqual({phase:'idle',distance:0,preventDefault:false});
  pull.start(start,allowed);pull.move(touch(100,190),allowed);expect(pull.end(allowed)).toBe(true);pull.finish();
  expect(pull.end(allowed)).toBe(false);
 });
});
