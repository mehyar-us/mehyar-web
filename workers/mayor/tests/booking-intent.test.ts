import {it,expect} from 'vitest';
import {asksNewBooking,isBookingConfirmation} from '../src/booking-intent';
it.each(['Book an appointment tomorrow','Can you please schedule a meeting?','Prepare a disposable integration-test appointment called test','I would like to book an appointment'])('recognizes explicit booking %s',text=>expect(asksNewBooking(text)).toBe(true));
it.each(['Do not book an appointment','Cancel my appointment','Reschedule my appointment','Set up appointment rules','Create scheduling policy for appointments','What appointments do I have?','Read my website'])('leaves other intentions to their existing paths: %s',text=>expect(asksNewBooking(text)).toBe(false));

it.each(['Yes, book it.','Book it','Confirm the appointment'])('recognizes only explicit booking confirmation: %s',text=>expect(isBookingConfirmation(text)).toBe(true));
it.each(['yes','Yes, book it tomorrow instead','Do not book it','Book it?','Yes, save my business details'])('does not broaden confirmation: %s',text=>expect(isBookingConfirmation(text)).toBe(false));