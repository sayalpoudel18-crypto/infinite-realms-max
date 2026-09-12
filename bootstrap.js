const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const http=require('http');
const ROOT=__dirname;
const PAYLOAD=path.join(ROOT,'payload');
const RUNTIME=path.join(ROOT,'.runtime');
function s(buf,a,n){return buf.subarray(a,a+n).toString('utf8').replace(/\0.*$/,'').trim()}
function o(buf,a,n){const v=s(buf,a,n).replace(/[^0-7]/g,'');return v?parseInt(v,8):0}
function target(rel){const root=path.resolve(RUNTIME);const t=path.resolve(root,rel);if(t!==root&&!t.startsWith(root+path.sep))throw new Error('Unsafe archive path');return t}
function untar(tar){fs.rmSync(RUNTIME,{recursive:true,force:true});fs.mkdirSync(RUNTIME,{recursive:true});let p=0;while(p+512<=tar.length){const h=tar.subarray(p,p+512);if(h.every(b=>b===0))break;const name=s(h,0,100),prefix=s(h,345,155),full=(prefix?prefix+'/':'')+name,size=o(h,124,12),type=String.fromCharCode(h[156]||48);const bits=full.split('/').filter(Boolean);const rel=bits[0]==='infinite-realms-max-v0.4'?bits.slice(1).join('/'):full;const start=p+512;if(rel){const t=target(rel);if(type==='5'||full.endsWith('/'))fs.mkdirSync(t,{recursive:true});else if(type==='0'||type==='\0'){fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,tar.subarray(start,start+size));}}p=start+Math.ceil(size/512)*512;}}
const names=fs.readdirSync(PAYLOAD).filter(n=>/^archive\.part\d+$/.test(n)).sort();
if(names.length<9)throw new Error('Incomplete runtime payload: '+names.length+'/9 chunks');
const b64=names.map((n,i)=>{const x=fs.readFileSync(path.join(PAYLOAD,n),'utf8').replace(/\s+/g,'');return i<8?x.slice(0,8000):x}).join('');
untar(zlib.gunzipSync(Buffer.from(b64,'base64')));
const handler=require(path.join(RUNTIME,'server.js'));
const port=Number(process.env.PORT||3000);
http.createServer(handler).listen(port,'0.0.0.0',()=>console.log('Infinite Realms Max online on port '+port));
