import {objectId,type StripeObject} from './stripe';

/** Diagnostic only: the latest unpaid invoice never erases earlier paid access. */
export function paidPeriodFindings(invoice:StripeObject,priceId:string,paidThrough:string|null):string[]{
  if(invoice.status!=='paid')return [];
  if(!Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<0||invoice.amount_remaining!==0)return ['invoice_payment_unverified'];
  if(invoice.currency!=='usd')return ['invoice_currency_mismatch'];
  if(!Array.isArray(invoice.lines?.data)||invoice.lines.has_more!==false)return ['invoice_period_unverified'];
  const matching=invoice.lines.data.filter((line:StripeObject)=>(objectId(line.price)??line.pricing?.price_details?.price)===priceId);
  if(!matching.length)return ['invoice_price_mismatch'];
  const ends=matching.map((line:StripeObject)=>line.period?.end);
  if(ends.some((end:unknown)=>typeof end!=='number'||!Number.isSafeInteger(end)||end<=0||end>8640000000000))return ['invoice_period_unverified'];
  const end=Math.max(...ends)*1000,local=paidThrough?Date.parse(paidThrough):NaN;
  if(!Number.isFinite(local))return ['paid_through_missing'];
  return local<end?['paid_through_behind_invoice']:[];
}
