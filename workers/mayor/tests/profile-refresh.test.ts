import {expect,it} from 'vitest';
import {composeVerticalDescription,profileRefreshPreview} from '../src/profile-refresh';

it('composes a description from the vertical and saved onboarding answers',()=>{
 const description=composeVerticalDescription('salon',{
  services:['cuts','color','nails'],locations:['123 Main St'],hours:'Mon–Fri 9–6',
 });
 expect(description).toContain('Hair salon / Barbershop');
 expect(description).toContain('cuts, color, nails');
 expect(description).toContain('123 Main St');
 expect(description).toContain('Mon–Fri 9–6');
});

it('falls back to the bare label when no answers are saved',()=>{
 expect(composeVerticalDescription('restaurant',{})).toBe('Restaurant.');
 expect(composeVerticalDescription('dental',{services:[]})).toBe('Dental office.');
});

it('returns null when no real vertical is set',()=>{
 expect(profileRefreshPreview({})).toBeNull();
 expect(profileRefreshPreview({vertical:'other'})).toBeNull();
 expect(profileRefreshPreview({vertical:'bogus'})).toBeNull();
});

it('flags stale description and industry as changes, nothing else',()=>{
 const preview=profileRefreshPreview({
  vertical:'salon',
  description:'an agency serving small businesses and enterprises across finance, healthcare, pharmaceuticals',
  industry:'Agency',
  services:['cuts'],
 });
 expect(preview).not.toBeNull();
 expect(preview!.vertical).toBe('salon');
 expect(preview!.changes.map(c=>c.field).sort()).toEqual(['description','industry']);
 const industry=preview!.changes.find(c=>c.field==='industry')!;
 expect(industry.from).toBe('Agency');expect(industry.to).toBe('Hair salon / Barbershop');
 const description=preview!.changes.find(c=>c.field==='description')!;
 expect(description.from).toContain('agency serving small businesses');
 expect(description.to).toContain('Hair salon / Barbershop');
 expect(description.to).toContain('cuts');
});

it('reports no changes when the profile already matches the vertical',()=>{
 const first=profileRefreshPreview({vertical:'plumbing_hvac',services:['drain cleaning']})!;
 expect(first.changes.length).toBe(2);
 const applied={vertical:'plumbing_hvac' as const,services:['drain cleaning'],description:first.description,industry:first.industry};
 const second=profileRefreshPreview(applied)!;
 expect(second.changes).toEqual([]);
});

it('keeps the composed description within the schema limit',()=>{
 const long='x'.repeat(5000);
 const description=composeVerticalDescription('salon',{services:[long],hours:long});
 expect(description.length).toBeLessThanOrEqual(2000);
});
