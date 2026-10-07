import {it,expect} from 'vitest';
import {checkoutAvailability,normalizeAuditIntake,publicAuditUrl,receiptPresentation,safeCheckoutUrl,safeReportUrl,validAuditToken} from '../web/audit-main';

const fields={contactName:'  Morgan Owner  ',email:'MORGAN@example.com',businessName:' Local Studio ',website:'example.com',goals:'Make booking easier',acceptedTerms:true};
it('prepares the real checkout intake and supports authorized document links without fake uploads',()=>{
 expect(normalizeAuditIntake({...fields,notes:'  Weekday appointments  ',links:'https://example.com/book\nhttps://docs.example.com/brief\nhttps://example.com/book'})).toEqual({contactName:'Morgan Owner',email:'morgan@example.com',businessName:'Local Studio',website:'https://example.com/',goals:'Make booking easier',notes:'Weekday appointments',links:['https://example.com/book','https://docs.example.com/brief'],acceptedTerms:true});
 expect(normalizeAuditIntake(fields)).not.toHaveProperty('notes');expect(normalizeAuditIntake(fields)).not.toHaveProperty('links');
});
it('requires explicit terms, valid contact details and bounded supporting material',()=>{
 for(const change of [{acceptedTerms:false},{email:'invalid'},{businessName:''},{contactName:'A'},{goals:'Short'},{website:'https://example.com/?private=query'},{goals:'x'.repeat(2001)},{notes:'x'.repeat(3001)},{links:Array.from({length:6},(_,index)=>`https://example.com/${index}`).join('\n')}])expect(()=>normalizeAuditIntake({...fields,...change})).toThrow();
 for(const url of ['javascript:alert(1)','ftp://example.com','https://name:secret@example.com','http://localhost:3000','https://example.local','https://example.test','http://127.0.0.1','https://10.1.2.3','https://example.com:8443','https://-invalid.example.com','https://invalid-.example.com','https://'+('a'.repeat(64))+'.com','https://private.onion'])expect(()=>publicAuditUrl(url)).toThrow();
});
it('enables checkout only for a verified $330 USD one-time offer and distinguishes test payments',()=>{
 const offer={offer:{name:'Business audit',priceCents:33000,currency:'USD',payment:'one_time'},available:true,mode:'live' as const,message:null};
 expect(checkoutAvailability(offer)).toMatchObject({available:true,test:false,label:'Continue to checkout · $330'});
 expect(checkoutAvailability({...offer,mode:'test'})).toMatchObject({available:true,test:true,label:'Continue to test checkout'});
 expect(checkoutAvailability({...offer,available:false})).toMatchObject({available:false,label:'Checkout unavailable'});
 expect(checkoutAvailability({...offer,mode:null}).available).toBe(false);
 for(const change of [{priceCents:32900},{currency:'EUR'},{payment:'subscription'}])expect(checkoutAvailability({...offer,offer:{...offer.offer,...change}}).available).toBe(false);
});
it('does not turn a paid request into a finished report or a test receipt into a live purchase',()=>{
 const receipt={orderId:'order',paymentStatus:'paid' as const,fulfillmentStatus:'queued' as const,priceCents:33000,currency:'USD',paidAt:'2026-10-03T15:00:00Z',mode:'live' as const};
 expect(receiptPresentation(receipt)).toMatchObject({payment:'Payment confirmed',fulfillment:'Audit request received',test:false});
 expect(receiptPresentation(receipt).summary).not.toContain('report is marked ready');
 expect(receiptPresentation({...receipt,mode:'test'})).toMatchObject({payment:'Test payment confirmed',test:true});
 expect(receiptPresentation({...receipt,mode:'test'}).summary).toContain('does not confirm a live purchase');
 expect(receiptPresentation({...receipt,paymentStatus:'pending',fulfillmentStatus:'awaiting_payment'}).summary).toContain('not been confirmed');
 expect(receiptPresentation({...receipt,fulfillmentStatus:'report_ready'}).summary).toContain('report is marked ready');
 expect(receiptPresentation({...receipt,fulfillmentStatus:'needs_review'}).fulfillment).toBe('Generation needs attention');
 expect(receiptPresentation({...receipt,paymentStatus:'refunded'}).summary).toContain('recorded as refunded');
});
it.each(['live','test'] as const)('makes a paid needs-review receipt actionable without promising completion (%s)',mode=>{
 const receipt={orderId:'private-request-id',paymentStatus:'paid' as const,fulfillmentStatus:'needs_review' as const,priceCents:33000,currency:'USD',paidAt:'2026-10-03T15:00:00Z',reportAvailable:false,mode};
 const presentation=receiptPresentation(receipt);
 expect(presentation).toMatchObject({payment:mode==='test'?'Test payment confirmed':'Payment confirmed',fulfillment:'Generation needs attention',supportUrl:'https://mehyar.us/contact'});
 expect(presentation.summary).toContain('payment is confirmed');
 expect(presentation.summary).toContain('A reviewed report is unavailable');
 expect(presentation.summary).toContain('Your request needs attention');
 expect(presentation.summary).not.toMatch(/will appear|automatic|retry|refund|human|within/i);
 if(mode==='test')expect(presentation.summary).toContain('does not confirm a live purchase');
 const destination=new URL(presentation.supportUrl!);
 expect(destination.search).toBe('');expect(destination.hash).toBe('');
 expect(presentation.supportUrl).not.toContain(receipt.orderId);
});
it.each(['pending','failed','expired','refunded'] as const)('preserves %s payment status independently of a generation hold',paymentStatus=>{
 const receipt={orderId:'order',paymentStatus,fulfillmentStatus:'needs_review' as const,priceCents:33000,currency:'USD',paidAt:null,reportAvailable:false,mode:'live' as const};
 const presentation=receiptPresentation(receipt);
 expect(presentation.supportUrl).toBeNull();
 expect(presentation.summary).not.toContain('payment is confirmed');
 expect(presentation.summary).not.toContain('report availability will appear');
 const expected={pending:'not been confirmed',failed:'did not complete',expired:'checkout has expired',refunded:'recorded as refunded'}[paymentStatus];
 expect(presentation.summary).toContain(expected);
});
it('validates Stripe redirects, report protocols and private receipt tokens',()=>{
 expect(safeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_123')).toContain('checkout.stripe.com');
 for(const url of ['https://checkout.stripe.com.evil.test/pay','https://evil.test','http://checkout.stripe.com','javascript:alert(1)'])expect(()=>safeCheckoutUrl(url)).toThrow();
 expect(safeReportUrl('https://reports.example.com/private/report.pdf')).toContain('report.pdf');
 expect(safeReportUrl('javascript:alert(1)')).toBeNull();expect(safeReportUrl('https://user:secret@example.com/report')).toBeNull();
 expect(validAuditToken('a'.repeat(64))).toBe(true);expect(validAuditToken('tiny')).toBe(false);expect(validAuditToken('a'.repeat(64)+'?email=private@example.com')).toBe(false);
});
