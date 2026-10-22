
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
const names = new Set();
for (const m of s.matchAll(/function ([A-Za-z0-9_$]*[Ff]old[A-Za-z0-9_$]*)\(/g)) names.add(m[1]);
console.log('fold fns:', [...names].join(', '));
const ii = new Set();
for (const m of s.matchAll(/function ([A-Za-z0-9_$]*(?:External|Summary)[A-Za-z0-9_$]*)\(/g)) ii.add(m[1]);
console.log('summary fns:', [...ii].join(', '));
