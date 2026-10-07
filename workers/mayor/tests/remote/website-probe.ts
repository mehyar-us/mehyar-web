// Remote-preview-only probe. Fixed public URL; no database, credentials, or user data.
import {fetchWebsite} from '../../src/website';
export default {async fetch(){
 const start=Date.now();
 try{
  const page=await fetchWebsite('https://mehyar.us/','https://mayor.mehyar.us');
  return Response.json({ok:true,url:page.url,title:page.title,characters:page.excerpt.length,containsMehyar:/mehyar/i.test(page.excerpt),durationMs:Date.now()-start});
 }catch(error){return Response.json({ok:false,message:error instanceof Error?error.message:'failed'},{status:502});}
}};
