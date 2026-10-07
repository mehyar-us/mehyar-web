import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const canonical=value=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?{integer:item.toString()}:item instanceof Uint8Array?{blob:Buffer.from(item).toString('hex')}:item);
function inspect(path){
 const db=new DatabaseSync(':memory:');
 try{
  // D1 exports may recreate referenced unique indexes after table data. Disable
  // enforcement only while loading; validate every FK after the full schema is
  // present. Otherwise populated composite references fail before index creation.
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(readFileSync(path,'utf8'));
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup contains foreign key violations.');
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all();
  const tables={};
  for(const {name} of schema.filter(item=>item.type==='table')){
   const query=db.prepare(`SELECT * FROM ${quote(name)}`);query.setReadBigInts(true);
   const rows=query.all().map(canonical).sort();
   tables[name]={rows:rows.length,hash:hash(JSON.stringify(rows))};
  }
  return {schemaHash:hash(canonical(schema)),tables};
 }finally{db.close();}
}
try{
 const [original,restored,report]=process.argv.slice(2);
 if(!original||!restored||!report)throw new Error('Usage: compare-backups.mjs original.sql restored.sql report.json');
 const expected=inspect(original),actual=inspect(restored);
 if(canonical(expected)!==canonical(actual))throw new Error('Restored schema or row contents differ from the exported snapshot.');
 const result={verifiedAt:new Date().toISOString(),equal:true,tableCount:Object.keys(expected.tables).length,rowCount:Object.values(expected.tables).reduce((sum,table)=>sum+table.rows,0),...expected};
 writeFileSync(report,JSON.stringify(result,null,2));
 console.log(JSON.stringify({equal:true,tableCount:result.tableCount,rowCount:result.rowCount}));
}catch(error){console.error(error instanceof Error?error.message:'Backup comparison failed.');process.exitCode=1;}
