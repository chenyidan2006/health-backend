const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const express=require('express');
const bcrypt=require('bcryptjs');
process.env.JWT_SECRET='synthetic-test-secret-not-for-deployment-20261015';
let changedPassword, avatarPath;
const fakePool={execute:async(sql,args)=>{
  if(sql.includes('COALESCE(?, nickname)')) {assert.ok(args.every(value=>value!==undefined));return [{affectedRows:1}];}
  if(sql.startsWith('SELECT id FROM user_devices')) return [args[0]===1&&args[1]==='SYNTHETIC_001'?[{id:1}]:[]];
  if(sql.startsWith('UPDATE users SET password')) {changedPassword=args[0];return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE users SET avatar')) {avatarPath=path.join(__dirname,'../data',args[0]);return [{affectedRows:1}];}
  throw Error('Unexpected SQL in isolated test: '+sql);
}};
const dbPath=require.resolve('../config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakePool};
const {generateToken}=require('../utils/jwt');
const {setCode,getCode}=require('../utils/redis');

test('repaired pages use working, ownership-checked interfaces without a real database',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'smi-repair-test-'));
  process.env.RAW_DATA_DIR=directory;
  const header=Buffer.from('#ADS8688 v1 rate=40000 secs=8 blk=2000 nblk=160 ch=2 range=0x02 code=u16le\r\n');
  const payload=Buffer.alloc(640000);
  for(let i=0;i<320000;i++) payload.writeUInt16LE(Math.round(30000+1000*Math.sin(i/20)),i*2);
  const frame=Buffer.concat([header,payload,Buffer.from('#END\r\n')]);
  const file='raw_synthetic_640000.bin', sha256=crypto.createHash('sha256').update(frame).digest('hex');
  await fs.writeFile(path.join(directory,file),frame);
  await fs.writeFile(path.join(directory,file+'.json'),JSON.stringify({file,device_id:'SYNTHETIC_001',received_at:new Date().toISOString(),sha256}));
  const app=express();app.use(express.json());
  app.use('/api/data',require('../routes/data'));
  app.use('/api/training',require('../routes/training'));
  app.use('/api/user',require('../routes/user'));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const headers={Authorization:'Bearer '+generateToken({id:1,is_guest:0})};
  try {
    await t.test('profile save accepts omitted avatar and email',async()=>{
      assert.equal((await fetch(base+'/api/user/profile',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({nickname:'Synthetic',height:170})})).status,200);
    });
    await t.test('waveform requires login and binding, ignores legacy ch=2',async()=>{
      assert.equal((await fetch(base+'/api/data/waveform?deviceId=SYNTHETIC_001')).status,401);
      assert.equal((await fetch(base+'/api/data/waveform?deviceId=OTHER',{headers})).status,403);
      const result=await (await fetch(base+'/api/data/waveform?deviceId=SYNTHETIC_001',{headers})).json();
      assert.equal(result.errcode,0);assert.equal(result.data.channels,1);assert.equal(result.data.samples,320000);assert.equal(result.data.duration,8);
    });
    await t.test('cuff reference persists next to exact frame and is removed from pending list',async()=>{
      const url=base+'/api/training/sessions/pending?deviceId=SYNTHETIC_001';
      const pending=await (await fetch(url,{headers})).json();
      assert.equal(pending.data.length,1);assert.equal(pending.data[0].id,sha256);assert.equal(pending.data[0].rawPath,undefined);
      const endpoint=base+'/api/training/sessions/'+sha256+'/reference';
      const data={deviceId:'SYNTHETIC_001',subjectId:'TEST_P001',referenceSbp:120,referenceDbp:80,referenceHr:75};
      const request={method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)};
      assert.equal((await fetch(endpoint,{...request,body:JSON.stringify({...data,referenceDbp:130})})).status,400);
      assert.equal((await fetch(endpoint,request)).status,200);
      const label=JSON.parse(await fs.readFile(path.join(directory,file+'.reference.json'),'utf8'));
      assert.equal(label.frameSha256,sha256);assert.equal(label.referenceSbp,120);assert.equal(label.featureExtractionStatus,'not-extracted');
      assert.equal((await (await fetch(url,{headers})).json()).data.length,0);
      const other={Authorization:'Bearer '+generateToken({id:2,is_guest:0})};
      assert.equal((await fetch(url,{headers:other})).status,403);
    });
    await t.test('password reset validates and consumes one-time code',async()=>{
      await setCode('13800000000','123456');
      const request={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000000',code:'123456',newPassword:'synthetic-password'})};
      assert.equal((await fetch(base+'/api/user/reset-password',request)).status,200);
      assert.equal(await bcrypt.compare('synthetic-password',changedPassword),true);
      assert.equal((await fetch(base+'/api/user/reset-password',request)).status,400);
      await setCode('13800000001','123456',-1);assert.equal(await getCode('13800000001'),null);
    });
    await t.test('avatar accepts PNG and rejects SVG regardless of declared MIME',async()=>{
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
      const form=new FormData();form.append('avatar',new Blob([png],{type:'image/png'}),'pixel.png');
      const response=await fetch(base+'/api/user/avatar',{method:'POST',headers,body:form});
      assert.equal(response.status,200);assert.ok((await response.json()).data.avatar.startsWith('/avatars/'));
      const invalid=new FormData();invalid.append('avatar',new Blob(['<svg/>'],{type:'image/png'}),'bad.png');
      assert.equal((await fetch(base+'/api/user/avatar',{method:'POST',headers,body:invalid})).status,400);
    });
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    if(avatarPath) await fs.unlink(avatarPath).catch(()=>{});
    await fs.rm(directory,{recursive:true,force:true});
  }
});
