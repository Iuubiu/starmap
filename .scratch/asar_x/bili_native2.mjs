
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js';
const s = fs.readFileSync(p, 'utf8');
let i = s.indexOf('externalSummary');
let c = 0;
while (i !== -1 && c < 3) { c++; console.log('--- #' + c + ' ---'); console.log(s.slice(Math.max(0, i - 300), i + 300)); i = s.indexOf('externalSummary', i + 1); }
console.log('count', (s.match(/externalSummary/g) || []).length);
console.log('providersKey', (s.match(/providers/g) || []).length);
