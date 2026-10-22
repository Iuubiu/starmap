
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
function around(key, before = 700, after = 1200, n = 3) {
  let i = -1, c = 0;
  while ((i = s.indexOf(key, i + 1)) !== -1 && c < n) { c++; console.log('---[' + key + ' #' + c + ']---'); console.log(s.slice(Math.max(0,i-before), i+after)); }
}
around('PLUGIN_FOLD_CALLID_PREFIX+', 500, 900, 2);
console.log('=====');
around('__bili', 200, 500, 3);
