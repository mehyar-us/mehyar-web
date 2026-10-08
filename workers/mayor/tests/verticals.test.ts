import {describe,it,expect} from 'vitest';
import {VERTICAL_PROFILES,verticalProfile,detectVerticalFromCategory,verticalSchema} from '../src/verticals';

describe('vertical profiles',()=>{
 it('has 5 launch profiles plus other',()=>{
  expect(Object.keys(VERTICAL_PROFILES)).toEqual(['salon','restaurant','plumbing_hvac','dental','auto_repair','other']);
 });
 it('every profile has a text-back template with {business} and opt-out',()=>{
  for(const profile of Object.values(VERTICAL_PROFILES)){
   expect(profile.textbackTemplate).toContain('{business}');
   expect(profile.textbackTemplate).toContain('STOP');
   expect(profile.textbackTemplate.length).toBeLessThan(320);
  }
 });
 it('salon template is salon-aware',()=>{
  expect(VERTICAL_PROFILES.salon.textbackTemplate).toContain('appointment');
  expect(VERTICAL_PROFILES.salon.vocabulary.booking).toBe('appointment');
 });
 it('restaurant template is restaurant-aware',()=>{
  expect(VERTICAL_PROFILES.restaurant.textbackTemplate).toContain('table');
  expect(VERTICAL_PROFILES.restaurant.vocabulary.booking).toBe('reservation');
 });
 it('plumbing template asks about urgency',()=>{
  expect(VERTICAL_PROFILES.plumbing_hvac.textbackTemplate.toLowerCase()).toContain('urgent');
 });
 it('falls back to other for unknown vertical',()=>{
  expect(verticalProfile('nonsense').vertical).toBe('other');
  expect(verticalProfile(undefined).vertical).toBe('other');
  expect(verticalProfile(null).vertical).toBe('other');
 });
 it('detects vertical from Places category',()=>{
  expect(detectVerticalFromCategory('Hair Salon')).toBe('salon');
  expect(detectVerticalFromCategory('Barber Shop')).toBe('salon');
  expect(detectVerticalFromCategory('Italian Restaurant')).toBe('restaurant');
  expect(detectVerticalFromCategory('Plumber')).toBe('plumbing_hvac');
  expect(detectVerticalFromCategory('Dental Clinic')).toBe('dental');
  expect(detectVerticalFromCategory('Auto Repair Shop')).toBe('auto_repair');
  expect(detectVerticalFromCategory('Book Store')).toBeNull();
  expect(detectVerticalFromCategory(null)).toBeNull();
 });
 it('schema rejects unknown verticals',()=>{
  expect(verticalSchema.safeParse('salon').success).toBe(true);
  expect(verticalSchema.safeParse('spaceship').success).toBe(false);
 });
});
