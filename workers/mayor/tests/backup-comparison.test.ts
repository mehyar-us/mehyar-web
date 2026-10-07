import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
const tables='CREATE TABLE parent(id TEXT); CREATE TABLE child(parent_id TEXT REFERENCES parent(id));';
const index='CREATE UNIQUE INDEX parent_identity ON parent(id);';
function compare(source:string,restored:string){
 const root=mkdtempSync(join(tmpdir(),'mayor-backup-test-'));
 try{
  const a=join(root,'source.sql'),b=join(root,'restored.sql'),report=join(root,'report.json');
  writeFileSync(a,source);writeFileSync(b,restored);
  const result=spawnSync(process.execPath,['scripts/compare-backups.mjs',a,b,report],{encoding:'utf8'});
  return {status:result.status,error:result.stderr,report:existsSync(report)?JSON.parse(readFileSync(report,'utf8')):null};
 }finally{
  const target=resolve(root);
  if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('mayor-backup-test-'))throw new Error('Unexpected cleanup path');
  rmSync(target,{recursive:true,force:true});
 }
}
it('validates a populated export whose referenced unique index follows inserted data',()=>{
 const data="INSERT INTO parent VALUES('p'); INSERT INTO child VALUES('p');";
 const result=compare(tables+index+data,tables+data+index);
 expect(result.status).toBe(0);expect(result.report).toMatchObject({equal:true,tableCount:2,rowCount:2});
});
it('still rejects foreign key violations even when both snapshots match',()=>{
 const broken=tables+index+"INSERT INTO child VALUES('missing');";
 const result=compare(broken,broken);
 expect(result.status).toBe(1);expect(result.error).toContain('foreign key violations');expect(result.report).toBeNull();
});
it('rejects changed contents even when both snapshots have valid references',()=>{
 const data=(id:string)=>`INSERT INTO parent VALUES('${id}'); INSERT INTO child VALUES('${id}');`;
 const result=compare(tables+index+data('a'),tables+data('b')+index);
 expect(result.status).toBe(1);expect(result.error).toContain('row contents differ');expect(result.report).toBeNull();
});
it('ignores row ordering, redacts report values and detects missing rows',()=>{
 const schema='CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT);';
 const source=schema+"INSERT INTO items VALUES(1,'first'),(2,'second');";
 const reordered=compare(source,schema+"INSERT INTO items VALUES(2,'second'),(1,'first');");
 expect(reordered.status).toBe(0);expect(reordered.report).toMatchObject({equal:true,tableCount:1,rowCount:2});
 expect(JSON.stringify(reordered.report)).not.toContain('first');
 expect(compare(source,schema+"INSERT INTO items VALUES(1,'first');").status).toBe(1);
});
