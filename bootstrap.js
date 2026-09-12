const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const crypto=require('crypto');
const http=require('http');
const ROOT=__dirname;
const PAYLOAD=path.join(ROOT,'payload','verified');
const RUNTIME=path.join(ROOT,'.runtime');
const PARTS=['00','01','02a','02b','03','04','05','06','07a','07b0','07b1','07b2','07b3','08'];
function s(buf,a,n){return buf.subarray(a,a+n).toString('utf8').replace(/\0.*$/,'').trim()}
function o(buf,a,n){const v=s(buf,a,n).replace(/[^0-7]/g,'');return v?parseInt(v,8):0}
function target(rel){const root=path.resolve(RUNTIME);const t=path.resolve(root,rel);if(t!==root&&!t.startsWith(root+path.sep))throw new Error('Unsafe archive path');return t}
function untar(tar){fs.rmSync(RUNTIME,{recursive:true,force:true});fs.mkdirSync(RUNTIME,{recursive:true});let p=0;while(p+512<=tar.length){const h=tar.subarray(p,p+512);if(h.every(b=>b===0))break;const name=s(h,0,100),prefix=s(h,345,155),full=(prefix?prefix+'/':'')+name,size=o(h,124,12),type=String.fromCharCode(h[156]||48);const bits=full.split('/').filter(Boolean);const rel=bits[0]==='infinite-realms-max-v0.4'?bits.slice(1).join('/'):full;const start=p+512;if(rel){const t=target(rel);if(type==='5'||full.endsWith('/'))fs.mkdirSync(t,{recursive:true});else if(type==='0'||type==='\0'){fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,tar.subarray(start,start+size));}}p=start+Math.ceil(size/512)*512;}}
const b64=PARTS.map(n=>fs.readFileSync(path.join(PAYLOAD,n),'utf8').replace(/\s+/g,'')).join('');
const gz=Buffer.from(b64,'base64');
const sha=crypto.createHash('sha256').update(gz).digest('hex');
if(gz.length!==48049||sha!=='44c70ea04e50366283e0faa0fba03c8fff3c8f590eabaa0f0ad69ef0ca6ef6c1')throw new Error(`Runtime integrity check failed: ${gz.length} bytes ${sha}`);
untar(zlib.gunzipSync(gz));
const handler=require(path.join(RUNTIME,'server.js'));
const port=Number(process.env.PORT||3000);
http.createServer(handler).listen(port,'0.0.0.0',()=>console.log('Infinite Realms Max online on port '+port));
