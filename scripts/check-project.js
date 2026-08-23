const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..'),publicDir=path.join(root,'public');
const required=['index.html','app.js','style.css','manifest.webmanifest','service-worker.js','terms.html','privacy.html','refund-policy.html','shipping-policy.html','pricing.html','contact.html','data-safety.html','delete-account.html','icons/icon-192.png','icons/icon-512.png'];
for(const file of required){if(!fs.existsSync(path.join(publicDir,file)))throw new Error(`Missing required file: ${file}`)}

JSON.parse(fs.readFileSync(path.join(publicDir,'manifest.webmanifest'),'utf8'));
new vm.Script(fs.readFileSync(path.join(publicDir,'app.js'),'utf8'),{filename:'app.js'});
new vm.Script(fs.readFileSync(path.join(publicDir,'service-worker.js'),'utf8'),{filename:'service-worker.js'});
new vm.Script(fs.readFileSync(path.join(publicDir,'legal.js'),'utf8'),{filename:'legal.js'});
new vm.Script(fs.readFileSync(path.join(publicDir,'delete-account.js'),'utf8'),{filename:'delete-account.js'});
new vm.Script(fs.readFileSync(path.join(root,'server.js'),'utf8'),{filename:'server.js'});

const html=fs.readFileSync(path.join(publicDir,'index.html'),'utf8'),ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);
const duplicates=ids.filter((id,index)=>ids.indexOf(id)!==index);if(duplicates.length)throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);
const appJs=fs.readFileSync(path.join(publicDir,'app.js'),'utf8'),usedIds=[...appJs.matchAll(/\$\('([^']+)'\)/g)].map(match=>match[1]);
const missing=[...new Set(usedIds.filter(id=>!ids.includes(id)))];if(missing.length)throw new Error(`app.js references missing HTML ids: ${missing.join(', ')}`);

const manifest=JSON.parse(fs.readFileSync(path.join(publicDir,'manifest.webmanifest'),'utf8'));
if(manifest.start_url!=='/'||manifest.display!=='standalone')throw new Error('PWA manifest start/display configuration is invalid.');
console.log(`PASS: ${required.length} required files, ${ids.length} unique UI ids, JavaScript syntax and PWA manifest.`);
