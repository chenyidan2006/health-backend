const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const {getCode,delCode} = require('../utils/redis');
const router = express.Router();
const attempts = new Map();
function allowReset(key) {
  const now=Date.now();
  for(const [id,row] of attempts) if(row.expires<=now) attempts.delete(id);
  const row=attempts.get(key)||{count:0,expires:now+15*60000};
  row.count++; attempts.set(key,row); return row.count<=5;
}
router.post('/reset-password', async (req,res) => {
  try {
    const {phone,code,newPassword} = req.body || {};
    if (!allowReset(req.ip+':'+String(phone))) return res.status(429).json({errcode:429,msg:'尝试次数过多，请稍后重试'});
    if (!/^1[3-9]\d{9}$/.test(phone||'') || !/^\d{6}$/.test(code||'') || typeof newPassword!=='string' || newPassword.length<6 || newPassword.length>72)
      return res.status(400).json({errcode:400,msg:'请填写手机号、六位验证码和6至72个字符的新密码'});
    if (await getCode(phone)!==code) return res.status(400).json({errcode:400,msg:'验证码错误或已过期'});
    await delCode(phone);
    const hash=await bcrypt.hash(newPassword,10);
    const [result]=await pool.execute('UPDATE users SET password = ? WHERE phone = ?',[hash,phone]);
    if (!result.affectedRows) return res.status(400).json({errcode:400,msg:'该手机号尚未注册'});
    res.json({errcode:0,msg:'密码已重置，请重新登录'});
  } catch(err) { console.error('reset-password:',err); res.status(500).json({errcode:500,msg:'重置失败'}); }
});

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:0}}).single('avatar');
function imageExtension(bytes) {
  if(bytes.length>8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if(bytes.length>3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'jpg';
  if(bytes.length>12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return 'webp';
  return null;
}
router.post('/avatar',auth,(req,res)=>{
  upload(req,res,async error=>{
    let file;
    try {
      if(error) return res.status(400).json({errcode:400,msg:'请选择2 MB以内的一张图片'});
      const extension=req.file && imageExtension(req.file.buffer);
      if(!extension) return res.status(400).json({errcode:400,msg:'仅支持 PNG、JPEG、WebP 图片'});
      const name=crypto.randomUUID()+'.'+extension;
      const folder=path.join(__dirname,'../data/avatars');
      await fs.mkdir(folder,{recursive:true}); file=path.join(folder,name);
      await fs.writeFile(file,req.file.buffer,{flag:'wx'});
      const avatar='/avatars/'+name;
      const [result]=await pool.execute('UPDATE users SET avatar = ? WHERE id = ?',[avatar,req.user.id]);
      if(!result.affectedRows) {await fs.unlink(file);return res.status(404).json({errcode:404,msg:'账号不存在'});}
      res.json({errcode:0,data:{avatar}});
    } catch(err) {
      if(file) await fs.unlink(file).catch(()=>{});
      console.error('avatar:',err);res.status(500).json({errcode:500,msg:'头像保存失败'});
    }
  });
});
module.exports={router,imageExtension};
