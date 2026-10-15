const express = require('express');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const rawFiles = require('../services/rawFiles');
const router = express.Router();
router.use(auth);
async function owns(userId, deviceId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId || '')) return false;
  const [rows] = await pool.execute('SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?', [userId, deviceId]);
  return rows.length > 0;
}
router.get('/sessions/pending', async (req, res) => {
  try {
    if (!(await owns(req.user.id, req.query.deviceId))) return res.status(403).json({errcode:403,msg:'请先绑定此设备'});
    const pending = [];
    for (const row of await rawFiles.sessions(req.query.deviceId)) {
      try { await fs.access(row.referencePath); }
      catch (err) {
        if (err.code !== 'ENOENT') throw err;
        const {referencePath, rawPath, ...publicRow} = row;
        pending.push(publicRow);
      }
      if (pending.length >= 100) break;
    }
    res.json({errcode:0,data:pending});
  } catch (err) { console.error('list reference sessions:',err); res.status(500).json({errcode:500,msg:'读取原始帧清单失败'}); }
});
router.put('/sessions/:id/reference', async (req, res) => {
  let temporary;
  try {
    const {deviceId, subjectId, referenceSbp:sbp, referenceDbp:dbp, referenceHr:hr} = req.body || {};
    if (!(await owns(req.user.id, deviceId))) return res.status(403).json({errcode:403,msg:'请先绑定此设备'});
    if (!/^[a-f0-9]{64}$/.test(req.params.id) || !/^[A-Za-z0-9_-]{1,64}$/.test(subjectId || '') ||
        ![sbp,dbp,hr].every(Number.isInteger) || sbp<60 || sbp>260 || dbp<30 || dbp>160 || sbp<=dbp || hr<25 || hr>250)
      return res.status(400).json({errcode:400,msg:'真值参数无效'});
    const row = (await rawFiles.sessions(deviceId)).find(s => s.id === req.params.id);
    if (!row) return res.status(404).json({errcode:404,msg:'找不到当前设备的原始帧'});
    const hash = crypto.createHash('sha256').update(await fs.readFile(row.rawPath)).digest('hex');
    if (hash !== row.id) return res.status(409).json({errcode:409,msg:'原始帧哈希不一致，请检查文件'});
    const label = {schemaVersion:1,frameSha256:row.id,file:row.file,deviceId,subjectId,
      referenceSbp:sbp,referenceDbp:dbp,referenceHr:hr,referenceTime:new Date().toISOString(),
      labeledBy:req.user.id,source:'manual-cuff-reference',featureExtractionStatus:'not-extracted'};
    temporary = row.referencePath + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(label,null,2), {flag:'wx'});
    await fs.rename(temporary,row.referencePath);
    res.json({errcode:0,msg:'真值标注已保存',data:label});
  } catch (err) { console.error('save reference:',err); res.status(500).json({errcode:500,msg:'保存真值失败'}); }
  finally { if (temporary) await fs.unlink(temporary).catch(()=>{}); }
});
module.exports = router;
