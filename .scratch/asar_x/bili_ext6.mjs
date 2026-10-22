
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
const words = new Set();
for (const m of s.matchAll(/([A-Za-z0-9_$]{0,20}[Gg]rowth[A-Za-z0-9_$]{0,24})/g)) words.add(m[1]);
console.log([...words].slice(0,60).join(', '));
