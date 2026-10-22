/**
 * Crew 6e — honest fit check tests.
 *
 * assessFit is deterministic (pure function, no model calls): the same
 * answers always produce the same verdict. The bar is conservative: 'poor'
 * only when all three signals are explicit — no appointments, a
 * walk-up/transient model, and low/no inbound call volume.
 */
import {describe,it,expect} from 'vitest';
import {assessFit,fitAnswersFromProfile,honestFitMessage,HONEST_FIT_KEY_SENTENCE} from '../src/fit-check';
import {honestFitStep} from '../src/onboarding';

/** The generic core question set, fully answered. */
const completeBasics = {
  name:'Test Business',
  locations:['Brooklyn, NY'],
  hours:'Mon-Fri 9am-5pm',
  timeZone:'America/New_York',
  staff:['Just me'],
};

describe('assessFit',()=>{
  it('flags taco-truck-shaped answers as poor with honest reasons',()=>{
    const result=assessFit({
      industry:'Taco truck',
      services:['tacos','burritos','quesadillas'],
      bookingModel:'Walk-up only. Order at the window, no phone orders, no appointments.',
    });
    expect(result.fit).toBe('poor');
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons.join(' ').toLowerCase()).toContain('appointment');
    expect(result.reasons.join(' ').toLowerCase()).toContain('walk-up');
    expect(result.reasons.join(' ').toLowerCase()).toContain('call');
  });

  it('flags dry-cleaner-shaped answers as poor',()=>{
    const result=assessFit({
      industry:'Dry cleaner',
      services:['dry cleaning','wash and fold'],
      bookingModel:'Walk-up counter service. Customers drop off and pick up. No appointments, nobody calls ahead.',
    });
    expect(result.fit).toBe('poor');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('rates salon-shaped answers as good',()=>{
    const result=assessFit({
      industry:'Hair salon',
      vertical:'salon',
      services:['cuts','color'],
      appointmentTypes:['Haircut — 45 min','Color — 2 hr'],
      bookingModel:'Clients call to book and reschedule.',
    });
    expect(result.fit).toBe('good');
  });

  it('rates a phone-driven trade with no formal appointments as good',()=>{
    const result=assessFit({
      industry:'Plumbing',
      services:['drain cleaning','water heaters'],
      bookingModel:'People call for quotes and we schedule the job over the phone.',
    });
    expect(result.fit).toBe('good');
  });

  it('returns uncertain on thin signals instead of turning the business away',()=>{
    const result=assessFit({industry:'Business consulting',services:['strategy sessions']});
    expect(result.fit).toBe('uncertain');
  });

  it('returns uncertain on mixed signals (walk-up retail that answers the phone)',()=>{
    const result=assessFit({
      industry:'Clothing boutique',
      services:['womens clothing'],
      bookingModel:'Customers walk in; we answer the phone for questions about sizing.',
    });
    expect(result.fit).toBe('uncertain');
  });

  it('is conservative: walk-up model WITH appointments is served, not flagged',()=>{
    const result=assessFit({
      industry:'Food truck',
      services:['tacos'],
      appointmentTypes:['Catering booking — 2 hr'],
      bookingModel:'Walk-up lunch service plus catering bookings by phone.',
    });
    expect(result.fit).toBe('good');
  });

  it('flags a food-truck place category as poor even with no text answers',()=>{
    const result=assessFit(fitAnswersFromProfile({name:'Taco Truck',hours:'Mon-Fri 11am-8pm'},'food_truck'));
    expect(result.fit).toBe('poor');
  });

  it('stays uncertain for a laundry place category (order-status calls exist)',()=>{
    const result=assessFit(fitAnswersFromProfile({name:'Speedy Laundry',hours:'Daily 7am-9pm'},'laundry'));
    expect(result.fit).toBe('uncertain');
  });

  it('is deterministic: same answers, same verdict',()=>{
    const answers={industry:'Taco truck',bookingModel:'Walk-up only, no phone orders, no appointments.'};
    expect(assessFit(answers)).toEqual(assessFit(answers));
  });
});

describe('honestFitMessage',()=>{
  it('carries the key sentence verbatim in spirit',()=>{
    const message=honestFitMessage({fit:'poor',reasons:['No appointments are offered.']});
    expect(message).toContain(HONEST_FIT_KEY_SENTENCE);
    expect(message).toContain("I'd rather tell you than sell you");
  });

  it('states what the product is for, lists the reasons, and offers both exits',()=>{
    const message=honestFitMessage({fit:'poor',reasons:['Reason one.','Reason two.']});
    expect(message).toContain('The Mayor is built for businesses that live on appointments and calls');
    expect(message).toContain('Reason one.');
    expect(message).toContain('Reason two.');
    expect(message.toLowerCase()).toContain('continue anyway');
    expect(message.toLowerCase()).toContain('not now');
    // No guilt copy on the continue path.
    expect(message.toLowerCase()).not.toContain('waste');
    expect(message.toLowerCase()).not.toContain('are you sure');
  });
});

describe('fitAnswersFromProfile',()=>{
  it('maps profile fields and passes the place category through',()=>{
    const answers=fitAnswersFromProfile(
      {industry:'Taco truck',services:['tacos'],appointmentTypes:[],hours:'11-8'},
      'taco_truck',
    );
    expect(answers.industry).toBe('Taco truck');
    expect(answers.services).toEqual(['tacos']);
    expect(answers.placeCategory).toBe('taco_truck');
    expect(answers.bookingModel).toBeNull();
  });
});

describe('honestFitStep',()=>{
  const tacoProfile={...completeBasics,industry:'Taco truck',services:['tacos'],
    description:'Walk-up only. Order at the window, no phone orders, no appointments.'};
  const salonProfile={...completeBasics,industry:'Hair salon',vertical:'salon',services:['cuts'],
    appointmentTypes:['Haircut — 45 min']};

  it('returns null when an assessment is already stored (never nag again)',()=>{
    const step=honestFitStep({...tacoProfile,fitAssessment:{fit:'poor' as const,reasons:['r'],assessedAt:'2026-10-09T00:00:00.000Z',source:'answers' as const}});
    expect(step).toBeNull();
  });

  it('returns null while core questions are still unanswered',()=>{
    expect(honestFitStep({industry:'Taco truck'})).toBeNull();
    expect(honestFitStep({...tacoProfile,timeZone:''})).toBeNull();
  });

  it('returns the assessment and the honest message for a completed poor fit',()=>{
    const step=honestFitStep(tacoProfile);
    expect(step).not.toBeNull();
    expect(step!.assessment.fit).toBe('poor');
    expect(step!.assessment.source).toBe('answers');
    expect(step!.message).toContain("I'd rather tell you than sell you");
  });

  it('stores good/uncertain too, but with no message to deliver',()=>{
    const step=honestFitStep(salonProfile);
    expect(step).not.toBeNull();
    expect(step!.assessment.fit).toBe('good');
    expect(step!.message).toBeNull();
  });
});
