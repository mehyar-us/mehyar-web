import {it,expect,vi} from 'vitest';
import {searchPlacesText,getPlaceDetails,placesApiKey} from '../src/places';
import {buildPlaceConfirmCard,confirmPlace,normalizePlaceCategory,onboardingQuestionsForVertical,onboardingProgressForVertical} from '../src/onboarding';
import type {PlaceCard} from '../src/places';

const KEY='test-places-key';

function mockFetch(payload:unknown,ok=true){
 return vi.fn(async()=>({ok,json:async()=>payload}));
}

const searchFixture={
 places:[
  {id:'ChIJaaa111',displayName:{text:'Sharp Cuts Barbershop'},formattedAddress:'123 Main St, Brooklyn, NY 11209',
   nationalPhoneNumber:'(718) 555-0100',
   regularOpeningHours:{weekdayDescriptions:['Monday: 9:00 AM – 5:00 PM','Tuesday: 9:00 AM – 5:00 PM']},
   photos:[{name:'places/ChIJaaa111/photos/photoA'}],primaryType:'hair_salon'},
  {id:'ChIJbbb222',displayName:{text:'Sharp Cuts Too'},formattedAddress:'45 5th Ave, Brooklyn, NY 11209',
   nationalPhoneNumber:'(718) 555-0200',
   regularOpeningHours:{weekdayDescriptions:['Monday: 10:00 AM – 6:00 PM']},
   photos:[{name:'places/ChIJbbb222/photos/photoB'}],primaryType:'barber_shop'},
  // Missing a name: dropped, never surfaces as a candidate.
  {id:'ChIJccc333',formattedAddress:'Nowhere',primaryType:'hair_salon'},
 ],
};

const placeCard:PlaceCard={
 placeId:'ChIJaaa111',name:'Sharp Cuts Barbershop',address:'123 Main St, Brooklyn, NY 11209',
 phone:'(718) 555-0100',hours:['Monday: 9:00 AM – 5:00 PM','Tuesday: 9:00 AM – 5:00 PM'],
 photoUrl:'https://places.googleapis.com/v1/places/ChIJaaa111/photos/photoA/media?maxWidthPx=640&key=test-places-key',
 category:'hair_salon',
};

it('searchPlacesText degrades to placesEnabled:false when the key is absent',async()=>{
 for(const key of [undefined,null,'','   ']){
  const result=await searchPlacesText('barbershop brooklyn',key,mockFetch(searchFixture));
  expect(result).toEqual({placesEnabled:false,places:[]});
 }
});

it('searchPlacesText never throws: network failure and HTTP errors degrade',async()=>{
 const failing=vi.fn(async()=>{throw new Error('boom');});
 expect(await searchPlacesText('x',KEY,failing)).toEqual({placesEnabled:false,places:[]});
 expect(await searchPlacesText('x',KEY,mockFetch({},false))).toEqual({placesEnabled:false,places:[]});
 expect(await searchPlacesText('   ',KEY,mockFetch(searchFixture))).toEqual({placesEnabled:false,places:[]});
});

it('searchPlacesText parses a fixture envelope into trimmed PlaceCards (max 5)',async()=>{
 const fetchImpl=mockFetch(searchFixture);
 const result=await searchPlacesText('barbershop',KEY,fetchImpl);
 expect(result.placesEnabled).toBe(true);
 expect(result.places).toHaveLength(2); // the nameless entry is dropped
 const [first]=result.places;
 expect(first).toMatchObject({
  placeId:'ChIJaaa111',name:'Sharp Cuts Barbershop',address:'123 Main St, Brooklyn, NY 11209',
  phone:'(718) 555-0100',category:'hair_salon',
 });
 expect(first.hours).toEqual(['Monday: 9:00 AM – 5:00 PM','Tuesday: 9:00 AM – 5:00 PM']);
 expect(first.photoUrl).toContain('/media?maxWidthPx=640');
 // The request asks ONLY for the fields the card renders (data minimization).
 const [,options]=fetchImpl.mock.calls[0] as [string,RequestInit];
 const headers=options.headers as Record<string,string>;
 expect(headers['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.regularOpeningHours.weekdayDescriptions,places.photos,places.primaryType');
 const body=JSON.parse(options.body as string);
 expect(body.maxResultCount).toBe(5);
 expect(body.textQuery).toBe('barbershop');
});

it('searchPlacesText caps candidates at 5',async()=>{
 const many={places:Array.from({length:9},(_,i)=>({id:`id${i}`,displayName:{text:`Shop ${i}`},primaryType:'store'}))};
 const result=await searchPlacesText('shop',KEY,mockFetch(many));
 expect(result.places).toHaveLength(5);
});

it('getPlaceDetails returns null without a key and parses a fixture with one',async()=>{
 expect(await getPlaceDetails('ChIJaaa111',undefined,mockFetch(searchFixture))).toBeNull();
 expect(await getPlaceDetails('ChIJaaa111','',mockFetch(searchFixture))).toBeNull();
 const details=await getPlaceDetails('ChIJaaa111',KEY,mockFetch(searchFixture.places[0]));
 expect(details).toMatchObject({placeId:'ChIJaaa111',name:'Sharp Cuts Barbershop',category:'hair_salon'});
 expect(details?.photoUrl).toContain('/media?maxWidthPx=640');
 const failing=vi.fn(async()=>{throw new Error('boom');});
 expect(await getPlaceDetails('ChIJaaa111',KEY,failing)).toBeNull();
});

it('placesApiKey trims and rejects blanks',()=>{
 expect(placesApiKey({GOOGLE_PLACES_API_KEY:'  abc  '})).toBe('abc');
 expect(placesApiKey({GOOGLE_PLACES_API_KEY:'   '})).toBeUndefined();
 expect(placesApiKey({})).toBeUndefined();
 expect(placesApiKey(null)).toBeUndefined();
});

it('buildPlaceConfirmCard maps the card the UI renders',()=>{
 const card=buildPlaceConfirmCard(placeCard);
 expect(card.title).toBe('Is this you?');
 expect(card).toMatchObject({
  placeId:'ChIJaaa111',name:'Sharp Cuts Barbershop',address:'123 Main St, Brooklyn, NY 11209',
  phone:'(718) 555-0100',
 });
 expect(card.hoursSummary).toBe('Monday: 9:00 AM – 5:00 PM\nTuesday: 9:00 AM – 5:00 PM');
 expect(card.photoUrl).toContain('/media?');
});

it('confirmPlace maps categories to verticals with conversational follow-ups',()=>{
 const cases:Array<[string,string|null,string|null]>=[
  ['hair_salon','salon',"So you're a hair salon — cuts, color, or both?"],
  // Adjacent trades route through the honest suggestion (never direct) — loop-1 fix
  ['barber_shop',null,null],
  ['restaurant','restaurant',"So you're a restaurant — dine-in, takeout, or both?"],
  ['pizzeria',null,null],
  ['plumber','plumbing_hvac',"So you're a plumbing/HVAC shop — residential, commercial, or both?"],
  ['hvac_contractor','plumbing_hvac',"So you're a plumbing/HVAC shop — residential, commercial, or both?"],
  ['dentist','dental',"So you're a dental office — general, cosmetic, or both?"],
  ['car_repair','auto_repair',"So you're an auto repair shop — repairs, maintenance, or both?"],
  ['book_store',null,null],
  ['',null,null],
 ];
 for(const [category,vertical,question] of cases){
  const patch=confirmPlace({},{...placeCard,category});
  expect(patch.vertical,category).toBe(vertical);
  expect(patch.followUpQuestion,category).toBe(question);
 }
 const patch=confirmPlace({},{...placeCard,category:undefined as unknown as string});
 expect(patch.vertical).toBeNull();
 expect(patch.followUpQuestion).toBeNull();
});

it('normalizePlaceCategory converts Google primary types to hint format',()=>{
 expect(normalizePlaceCategory('hair_salon')).toBe('hair salon');
 expect(normalizePlaceCategory('Car_Repair')).toBe('car repair');
 expect(normalizePlaceCategory(undefined)).toBe('');
});

it('confirmPlace builds the profile patch from the place',()=>{
 const patch=confirmPlace({name:'Old name'},placeCard);
 expect(patch.name).toBe('Sharp Cuts Barbershop');
 expect(patch.address).toBe('123 Main St, Brooklyn, NY 11209');
 expect(patch.phone).toBe('(718) 555-0100');
 expect(patch.hours).toBe('Monday: 9:00 AM – 5:00 PM\nTuesday: 9:00 AM – 5:00 PM');
 expect(patch.vertical).toBe('salon');
});

it('onboardingQuestionsForVertical returns vertical sets, falling back to the generic 7',()=>{
 const salon=onboardingQuestionsForVertical('salon');
 expect(salon.length).toBeGreaterThan(0);
 expect(salon[0][1]).toContain('cuts');
 const restaurant=onboardingQuestionsForVertical('restaurant');
 expect(restaurant[0][1]).toContain('serve');
 for(const vertical of ['plumbing_hvac','dental','auto_repair']){
  expect(onboardingQuestionsForVertical(vertical).length).toBeGreaterThan(0);
 }
 const generic=onboardingQuestionsForVertical(undefined);
 expect(generic).toHaveLength(7);
 expect(generic[0][0]).toBe('name');
 expect(onboardingQuestionsForVertical('other')).toHaveLength(7);
 expect(onboardingQuestionsForVertical('not-a-vertical')).toHaveLength(7);
});

it('onboardingProgressForVertical skips confirmed fields and reports a total',()=>{
 const empty=onboardingProgressForVertical({},'salon');
 expect(empty.missing).toContain('services');
 expect(empty.nextQuestion).toContain('cuts');
 expect(empty.total).toBe(onboardingQuestionsForVertical('salon').length);
 const partial=onboardingProgressForVertical({services:['Cuts'],staff:['Jo']},'salon');
 expect(partial.missing).not.toContain('services');
 expect(partial.missing).not.toContain('staff');
 expect(partial.missing).toContain('hours');
 expect(partial.basicsComplete).toBe(false);
});
