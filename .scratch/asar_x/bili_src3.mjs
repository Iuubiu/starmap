import fs from 'node:fs';
const F = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(F, 'utf8');
const names = ['DOOMED_PROBE_ABSOLUTE_BYTES', 'DOOMED_PROBE_BYTES_PER_TOKEN', 'MIN_ASSUMED_WINDOW_TOKENS', 'AUTO_FOLD_TARGET_MIN', 'CODEX_COMPACT_HEALTH_RATIO'];
for (const n of names) {
  let i = s.indexOf(n + '=');
  if (i < 0) i = s.indexOf(n + ' =');
  console.log('### ' + n + ' @' + i + ' -> ' + (i >= 0 ? s.slice(i, i + 160) : 'not found'));
}
// find function estimateCoreMessagesUpper
let j = s.indexOf('function estimateCoreMessagesUpper');
console.log('\n### estimateCoreMessagesUpper @' + j);
console.log(s.slice(j, j + 900));
j = s.indexOf('function estimateCoreMessages(');
console.log('\n### estimateCoreMessages @' + j);
console.log(s.slice(j, j + 900));
