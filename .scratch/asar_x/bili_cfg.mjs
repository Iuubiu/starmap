
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
const i = s.indexOf('function loadConfigFile(');
console.log(s.slice(i, i + 900));
console.log('=== configCache refs ===');
let k = -1, c = 0;
while ((k = s.indexOf('configCache', k + 1)) !== -1 && c < 4) { c++; console.log(s.slice(Math.max(0,k-200), k+240)); console.log('...'); }
