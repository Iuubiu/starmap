import fs from 'node:fs';
const F = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(F, 'utf8');
const i = s.indexOf('even at the densest');
console.log(s.slice(Math.max(0, i - 2600), i + 200));
