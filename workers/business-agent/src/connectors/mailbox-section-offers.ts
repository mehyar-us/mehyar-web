import {z} from 'zod';
import type {Actor} from '../env';
import {HttpError} from '../http';
export type SectionTerms={streamId:string;messageId:string;receipt:string;sourceHash:string;period:string;sectionCount:number;indices:number[]};
type Offer={id:string;user_id:string;terms:string;expires:number};
const expired=()=>new HttpError(409,'section_offer_expired','Review the section analysis cost again.');
/** Private approval for a fixed set of source-bound sections, excluding aggregation. */
export class MailboxSectionOffers {
  constructor(private storage:DurableObjectStorage){}
  initialize(){this.storage.sql.exec('CREATE TABLE IF NOT EXISTS mailbox_section_offers(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,terms TEXT NOT NULL,expires INTEGER NOT NULL)');}
  prepare(actor:Actor,terms:SectionTerms){
    const serialized=JSON.stringify(terms),now=Date.now();
    const offer=this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM mailbox_section_offers WHERE expires<=?',now);
      const prior=this.storage.sql.exec<Offer>('SELECT * FROM mailbox_section_offers WHERE user_id=? AND terms=?',actor.userId,serialized).toArray()[0];
      if(prior)return prior;
      if(this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM mailbox_section_offers').one().n>=10)
        throw new HttpError(429,'section_offer_limit','Too many analysis reviews are open. Try again in ten minutes.');
      const item={id:crypto.randomUUID(),user_id:actor.userId,terms:serialized,expires:now+600000};
      this.storage.sql.exec('INSERT INTO mailbox_section_offers VALUES(?,?,?,?)',item.id,item.user_id,item.terms,item.expires);return item;
    });
    return {offerId:offer.id,expiresAt:new Date(offer.expires).toISOString(),textCredits:terms.indices.length,
      sectionCount:terms.sectionCount,remainingSections:terms.indices,scope:'analyze_remaining_sections' as const,
      includesAggregation:false as const,authorizesExternalActions:false as const};
  }
  read(actor:Actor,id:string){
    if(!z.string().uuid().safeParse(id).success)throw expired();
    const offer=this.storage.sql.exec<Offer>('SELECT * FROM mailbox_section_offers WHERE id=? AND user_id=?',id,actor.userId).toArray()[0];
    if(!offer||offer.expires<=Date.now())throw expired();
    return JSON.parse(offer.terms) as SectionTerms;
  }
}
