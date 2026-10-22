import fs from 'node:fs';
const F = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(F, 'utf8');
console.log('file bytes=' + s.length);
const kws = ['preflight_compress_failed', 'no upstream can accept it', 'densest tokenizer', 'core text alone'];
for (const k of kws) {
  let i = -1, n = 0;
  while ((i = s.indexOf(k, i + 1)) >= 0 && n < 3) { n++; console.log('\n### ' + k + ' @' + i); console.log(s.slice(Math.max(0, i - 1800), i + 900)); }
  console.log('-- occurrences of ' + k + ': ' + n);
}
