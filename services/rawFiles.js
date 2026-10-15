const fs = require('node:fs/promises');
const path = require('node:path');

async function directory() {
  const candidates = process.env.RAW_DATA_DIR ? [path.resolve(process.env.RAW_DATA_DIR)] : [
    path.resolve(__dirname, '../../../../算法/服务器部署/raw-receiver/received'),
    path.resolve(__dirname, '../../raw-receiver/received'),
    path.resolve(__dirname, '../../../raw-receiver/received'),
    path.resolve(__dirname, '../../../raw-receiver/raw-receiver/received')
  ];
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isDirectory()) return candidate; }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  return null;
}

async function sessions(deviceId) {
  const dir = await directory();
  if (!dir) return [];
  const result = [];
  for (const name of await fs.readdir(dir)) {
    if (!/^raw_.*\.bin\.json$/.test(name)) continue;
    let meta;
    try { meta = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')); }
    catch { continue; }
    if (meta.device_id !== deviceId || path.basename(meta.file || '') !== meta.file ||
        !/^raw_[A-Za-z0-9_-]+\.bin$/.test(meta.file) || !/^[a-f0-9]{64}$/.test(meta.sha256 || '')) continue;
    try { if (!(await fs.stat(path.join(dir, meta.file))).isFile()) continue; }
    catch { continue; }
    result.push({ id: meta.sha256, file: meta.file, deviceId, measureTime: meta.received_at,
      referencePath: path.join(dir, meta.file + '.reference.json'), rawPath: path.join(dir, meta.file) });
  }
  return result.sort((a, b) => Date.parse(b.measureTime) - Date.parse(a.measureTime));
}
module.exports = { directory, sessions };
