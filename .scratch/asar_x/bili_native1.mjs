
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js';
const s = fs.readFileSync(p, 'utf8');
console.log('size', s.length);
let i = s.indexOf('billion-context.json');
console.log('--- ctx ---');
console.log(s.slice(Math.max(0, i - 1500), i + 700));
