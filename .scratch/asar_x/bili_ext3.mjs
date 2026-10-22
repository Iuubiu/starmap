
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
function count(k){let i=-1,c=0;while((i=s.indexOf(k,i+1))!==-1)c++;return c;}
for (const k of ['autoFoldEngaged(','autoFoldActive(','AUTO_FOLD_BACKOFF_MS','summarizePendingRanges','externalSummary.summarize','plan.summarize','targets[0]','summaryPlan']) console.log(k, count(k));
console.log('--- autoFoldBackoffActive ---');
let i = -1, c = 0;
while ((i = s.indexOf('autoFoldBackoffActive', i + 1)) !== -1 && c < 4) { c++; console.log(s.slice(Math.max(0,i-260), i+320)); console.log('...'); }
