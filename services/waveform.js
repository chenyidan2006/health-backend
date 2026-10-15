const fs = require('fs/promises');
const path = require('path');
// Same biquad coefficients and odd reflection as frame_fix_convert_plot(3).m.
function biquad(x, b, a) {
  const y = new Float64Array(x.length);
  for(let i=0;i<x.length;i++) y[i]=b[0]*x[i]+(i>0?b[1]*x[i-1]-a[1]*y[i-1]:0)+(i>1?b[2]*x[i-2]-a[2]*y[i-2]:0);
  return y;
}
function zeroPhase(x, fsHz, fc, q, highpass) {
  const w=2*Math.PI*fc/fsHz, c=Math.cos(w), al=Math.sin(w)/(2*q), norm=1+al;
  const b=highpass?[(1+c)/2,-(1+c),(1+c)/2]:[(1-c)/2,1-c,(1-c)/2];
  const a=[1,-2*c/norm,(1-al)/norm];
  const pad=Math.min(Math.floor(x.length/2),Math.max(50,Math.ceil(20*2*q/w)));
  const extended=new Float64Array(x.length+2*pad);
  for(let i=0;i<pad;i++) {extended[i]=2*x[0]-x[pad-i];extended[pad+x.length+i]=2*x[x.length-1]-x[x.length-2-i];}
  extended.set(x,pad);
  const y=biquad(biquad(extended,b.map(v=>v/norm),a).reverse(),b.map(v=>v/norm),a).reverse();
  return y.slice(pad,pad+x.length);
}
function envelope(values, fsHz, limit=1200) {
  const points=[]; const stride=Math.max(1,Math.ceil(values.length/(limit/2)));
  for(let i=0;i<values.length;i+=stride) {
    let lo=i,hi=i;
    for(let j=i;j<Math.min(values.length,i+stride);j++){if(values[j]<values[lo])lo=j;if(values[j]>values[hi])hi=j;}
    for(const index of [...new Set([lo,hi])].sort((a,b)=>a-b)) points.push({time:Number((index/fsHz).toFixed(6)),value:Number((values[index]*1000).toFixed(6))});
  }
  return points;
}
function parse(buf) {
  const end=buf.indexOf(10); if(end<0 || end>256) throw Error('Invalid header');
  const header=buf.subarray(0,end+1).toString('ascii');
  if(!header.startsWith('#ADS8688')) throw Error('Invalid frame');
  const get=k=>Number(header.match(new RegExp('(?:^|\\s)'+k+'=(\\d+)'))?.[1]);
  const count=get('blk')*get('nblk'), rate=get('rate'), channels=get('ch');
  if(!Number.isSafeInteger(count)||count<100||count>2000000||!(rate>200)||![1,2].includes(channels)) throw Error('Invalid frame parameters');
  if(!buf.subarray(end+1+count*2).toString('ascii').startsWith('#END')) throw Error('Truncated frame');
  // MATLAB default blockSel=0: display complete stream at its declared rate.
  const range=header.match(/range=(0x[\da-f]+)/i)?.[1];
  const spans={0:20.48,1:10.24,2:5.12,3:2.56,4:10.24,5:5.12};
  const code=Number(range); if(!(code in spans)) throw Error('Unsupported ADC range');
  const span=spans[code], offset=code>=4?0:span/2;
  let skip=buf.readUInt16LE(end+1)===65535?1:0;
  const raw=new Float64Array(count-skip);
  for(let i=skip;i<count;i++) raw[i-skip]=buf.readUInt16LE(end+1+i*2)/65535*span-offset;
  const mean=raw.reduce((a,b)=>a+b,0)/raw.length;
  const ac=raw.map(v=>v-mean); let filtered=raw;
  const qs=[1/(2*Math.cos(Math.PI/8)),1/(2*Math.cos(3*Math.PI/8))];
  for(const q of qs) filtered=zeroPhase(filtered,rate,100,q,true);
  for(const q of qs) filtered=zeroPhase(filtered,rate,0.45*rate,q,false);
  const zoom=filtered.slice(0,Math.min(3200,filtered.length));
  const statistics=signalStatistics(filtered);
  return {sampleRate:rate,channels:1,legacyHeaderChannels:channels,samples:raw.length,duration:raw.length/rate,unit:'mV',statistics,filter:{low:100,high:0.45*rate,order:4,zeroPhase:true},raw:envelope(ac,rate),filtered:envelope(filtered,rate),zoom:envelope(zoom,rate),displayChannel:'continuous-single-channel'};
}
function signalStatistics(values){let min=Infinity,max=-Infinity,sum=0;for(const value of values){min=Math.min(min,value);max=Math.max(max,value);sum+=value*value;}return {peakToPeak:(max-min)*1000,rms:Math.sqrt(sum/values.length)*1000};}
let cache = new Map();
async function latest(deviceId) {
  // services/ is nested under health-backend/health-backend. In production the
  // receiver is a Desktop sibling; the source bundle has one additional nested
  // raw-receiver directory. Prefer an explicit RAW_DATA_DIR, then support both.
  const directory=await require('./rawFiles').directory();
  if(!directory) return null;
  let names; try {names=await fs.readdir(directory);} catch(err){if(err.code==='ENOENT')return null;throw err;}
  const candidates=[];
  for(const name of names.filter(n=>/^raw_.*\.bin\.json$/.test(n))) {
    let meta; try {meta=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));} catch {continue;}
    if(meta.device_id!==deviceId || path.basename(meta.file || '')!==meta.file || !/^raw_.*\.bin$/.test(meta.file)) continue;
    const file=path.join(directory,meta.file);
    let stat; try {stat=await fs.stat(file);} catch {continue;}
    const parsedTime=Date.parse(meta.received_at || '');
    candidates.push({meta,file,stat,time:Number.isFinite(parsedTime)?parsedTime:stat.mtimeMs});
  }
  if(!candidates.length) return null;
  candidates.sort((a,b)=>b.time-a.time || b.stat.mtimeMs-a.stat.mtimeMs);
  const {meta,file,stat}=candidates[0], key=file+'|'+stat.mtimeMs;
  if(cache.has(key)) return cache.get(key);
  const receivedAt=Number.isFinite(Date.parse(meta.received_at || ''))
    ? new Date(meta.received_at).toISOString()
    : new Date(stat.mtimeMs).toISOString();
  const result={...parse(await fs.readFile(file)),file:meta.file,receivedAt,deviceId};
  cache=new Map([[key,result]]);return result;
}
module.exports={parse,envelope,zeroPhase,latest,signalStatistics};
