
const fs=require('fs'),path=require('path');
const P='C:/Users/Yhwhy/.dsh/profiles/desktop';
const pj=JSON.parse(fs.readFileSync(path.join(P,'package.json'),'utf8'));
const bundles=(pj.dsh&&pj.dsh.profile&&pj.dsh.profile.bundles)||[];
console.log('bundles:',bundles.length);
for(const b of bundles){
  const dir=path.join(P,'node_modules',b);
  const row={bundle:b,exists:fs.existsSync(dir)};
  if(row.exists){
    try{const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
      row.version=p.version;
      const exp=p.exports||{};
      const main=(exp['.']&&(exp['.'].default||exp['.'].require||exp['.'].import))||p.main;
      row.main=main;
      row.mainExists = main? fs.existsSync(path.join(dir,main)) : 'n/a';
      const patchKey=Object.keys(exp).find(k=>/cordis\.patch/.test(k));
      row.patchKey=patchKey||null;
      row.patchExists=patchKey?fs.existsSync(path.join(dir,exp[patchKey])):null;
      const clientKey=Object.keys(exp).find(k=>/^\.\/client$/.test(k));
      row.client=clientKey?(fs.existsSync(path.join(dir,exp[clientKey].default||exp[clientKey]))?'ok':'MISSING'):null;
    }catch(e){row.error=String(e.message);}
  }
  console.log(JSON.stringify(row));
}

