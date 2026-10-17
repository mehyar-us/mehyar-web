import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';

/* WS1 build 1 (2026-10-16): the shared mobile header pattern for
 * /sales + /pricing (both serve sales.css). At phone width the
 * sticky header must hold one brand/actions row plus a single-line
 * scrollable nav strip — never the three-row wrap (rot298 input 4). */
const css=readFileSync(new URL('../web/sales.css',import.meta.url),'utf8');
const mobile=css.slice(css.indexOf('@media (max-width:760px)'));

describe('WS1 mobile header pattern (sales.css)',()=>{
 it('has the <=760px header block',()=>{
  expect(css).toContain('@media (max-width:760px)');
  expect(mobile).toContain('.site-header nav{order:3');
 });
 it('nav is one nowrap scrollable strip, never a wrap',()=>{
  expect(mobile).toContain('flex-wrap:nowrap');
  expect(mobile).toContain('overflow-x:auto');
  expect(mobile).toContain('white-space:nowrap');
 });
 it('brand compacts: subline hidden, icon shrunk, CTAs right-aligned',()=>{
  expect(mobile).toContain('.brand small{display:none}');
  expect(mobile).toContain('.brand img{width:32px;height:32px}');
  expect(mobile).toContain('.header-ctas{gap:0.85rem;margin-left:auto}');
 });
});
