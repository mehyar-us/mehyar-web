import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = JSON.parse(readFileSync(new URL('./legacy-baseline.json', import.meta.url),'utf8'));
const failures = [];
const present=[];
for(const path of Object.keys(baseline.files)) {
  if(!existsSync(resolve(root,path))) failures.push(`${path}: removed`);
  else present.push(path);
}
// Git's normal line-ending filters make the invariant portable across Windows and Linux.
const hashes=execFileSync('git',['hash-object','--stdin-paths'],{cwd:root,encoding:'utf8',input:present.map(p=>JSON.stringify(p)).join('\n')+'\n'}).trim().split(/\r?\n/);
present.forEach((path,index)=>{if(hashes[index]!==baseline.files[path])failures.push(`${path}: changed`);});
// Ignore existing local build caches, but catch staged and untracked new source in old paths.
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','--',...baseline.protectedDirectories],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
for(const path of paths) if(path && !(path in baseline.files)) failures.push(`${path}: new file inside protected legacy boundary`);
if (failures.length) {console.error('Legacy payment/deployment boundary changed:\n'+failures.join('\n'));process.exitCode=1;}
else console.log(`Protected ${Object.keys(baseline.files).length} legacy files: unchanged from ${baseline.commit}.`);
