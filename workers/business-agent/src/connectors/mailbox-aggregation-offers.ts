import {z} from 'zod';
import type {Actor} from '../env';
import {HttpError} from '../http';
export type AggregationTerms={streamId:string;messageId:string;receipt:string;payloadHash:string;credits:number;period:string;sectionCount:number};
type Offer={id:string;user_id:string;terms:string;expires:number};
const expired=()=>new HttpError(409,'aggregation_offer_expired','Review the aggregation cost again.');
/** Private, expiring consent terms. No model calls or credit reservations. */
export class MailboxAggregationOffers {
  constructor(private storage:DurableObjectStorage){}
  initialize(){this.storage.sql.exec('CREATE TABLE IF NOT EXISTS mailbox_aggregation_offers(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,terms TEXT NOT NULL,expires INTEGER NOT NULL)');}
  prepare(actor:Actor,terms:AggregationTerms){
    const serialized=JSON.stringify(terms),now=Date.now();
    const offer=this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM mailbox_aggregation_offers WHERE expires<=?',now);
      const prior=this.storage.sql.exec<Offer>('SELECT * FROM mailbox_aggregation_offers WHERE user_id=? AND terms=?',actor.userId,serialized).toArray()[0];
      if(prior)return prior;
      if(this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM mailbox_aggregation_offers').one().n>=10)
        throw new HttpError(429,'aggregation_offer_limit','Too many analysis reviews are open. Try again in ten minutes.');
      const item={id:crypto.randomUUID(),user_id:actor.userId,terms:serialized,expires:now+600000};
      this.storage.sql.exec('INSERT INTO mailbox_aggregation_offers VALUES(?,?,?,?)',item.id,item.user_id,item.terms,item.expires);return item;
    });
    return {offerId:offer.id,expiresAt:new Date(offer.expires).toISOString(),textCredits:terms.credits,sectionCount:terms.sectionCount,
      scope:'combine_completed_sections' as const,includesSectionAnalysis:false as const,authorizesExternalActions:false as const};
  }
  read(actor:Actor,id:string){
    if(!z.string().uuid().safeParse(id).success)throw expired();
    const offer=this.storage.sql.exec<Offer>('SELECT * FROM mailbox_aggregation_offers WHERE id=? AND user_id=?',id,actor.userId).toArray()[0];
    if(!offer||offer.expires<=Date.now())throw expired();
    return JSON.parse(offer.terms) as AggregationTerms;
  }
}
