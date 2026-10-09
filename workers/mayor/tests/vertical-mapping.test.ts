import {describe,it,expect} from 'vitest';
import {
 ADJACENT_VERTICAL_MAP,
 MODE_LABELS,
 suggestVertical,
 verticalSuggestionFraming,
 verticalMappingNote,
} from '../src/vertical-mapping';

describe('crew6b: adjacent vertical map',()=>{
 it('every map entry resolves by its key',()=>{
  for(const [key,entry] of Object.entries(ADJACENT_VERTICAL_MAP)){
   const suggestion=suggestVertical(key);
   expect(suggestion,'key '+key).not.toBeNull();
   expect(suggestion!.vertical).toBe(entry.match);
   expect(suggestion!.reason).toBe(entry.reason);
   expect(suggestion!.trade.length).toBeGreaterThan(0);
  }
 });
 it('every entry maps to a real vertical (never "other") and has a mode label',()=>{
  for(const [key,entry] of Object.entries(ADJACENT_VERTICAL_MAP)){
   expect(entry.match,'key '+key).not.toBe('other');
   expect(MODE_LABELS[entry.match],'key '+key).toBeTruthy();
  }
 });
 it('reasons are non-empty and honest ("Closest" or "don\'t have")',()=>{
  for(const [key,entry] of Object.entries(ADJACENT_VERTICAL_MAP)){
   expect(entry.reason.length,'key '+key).toBeGreaterThan(20);
   expect(entry.reason,'key '+key).toMatch(/closest|don't have/i);
  }
 });
 it('matches Places category strings',()=>{
  expect(suggestVertical('electrician')?.vertical).toBe('plumbing_hvac');
  expect(suggestVertical('car_detailing')?.vertical).toBe('auto_repair');
  expect(suggestVertical('tattoo_shop')?.vertical).toBe('salon');
  expect(suggestVertical('pizza_restaurant')?.vertical).toBe('restaurant');
  expect(suggestVertical('locksmith')?.vertical).toBe('plumbing_hvac');
 });
 it('matches owner free-text descriptions',()=>{
  expect(suggestVertical("I'm an electrician")?.vertical).toBe('plumbing_hvac');
  expect(suggestVertical('I run a barbershop')?.vertical).toBe('salon');
  expect(suggestVertical('We do lawn care and landscaping')?.vertical).toBe('plumbing_hvac');
  expect(suggestVertical('Mobile pet vet clinic')?.vertical).toBe('dental');
  expect(suggestVertical('HOUSE PAINTERS')?.vertical).toBe('plumbing_hvac');
  expect(suggestVertical('electricians')?.trade).toBe('electrician');
 });
 it('returns null for genuinely unmappable trades',()=>{
  expect(suggestVertical('taco truck')).toBeNull();
  expect(suggestVertical('flower delivery')).toBeNull();
  expect(suggestVertical('real estate agency')).toBeNull();
  expect(suggestVertical('house cleaning')).toBeNull();
  expect(suggestVertical('')).toBeNull();
  expect(suggestVertical(null)).toBeNull();
  expect(suggestVertical(undefined)).toBeNull();
 });
 it('framing names the missing trade and the honest mode',()=>{
  const suggestion=suggestVertical('electrician')!;
  const framing=verticalSuggestionFraming(suggestion);
  expect(framing).toContain(`We don't have "${suggestion.trade}" yet`);
  expect(framing).toContain('plumbing/HVAC mode');
  expect(framing).toContain(suggestion.reason);
 });
 it('mapping note shows "using X mode" only for mapped verticals',()=>{
  const note=verticalMappingNote({vertical:'plumbing_hvac',verticalMappedFrom:'electrician'})!;
  expect(note).toContain('Using plumbing/HVAC mode');
  expect(note).toContain('mapped from "electrician"');
  expect(verticalMappingNote({vertical:'plumbing_hvac'})).toBeNull();
  expect(verticalMappingNote({vertical:'plumbing_hvac',verticalMappedFrom:'  '})).toBeNull();
  expect(verticalMappingNote({vertical:'other',verticalMappedFrom:'electrician'})).toBeNull();
  expect(verticalMappingNote({})).toBeNull();
 });
});
