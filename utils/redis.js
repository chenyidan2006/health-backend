// utils/redis.js - 内存存储版本(仅开发测试用,无需安装Redis)
const store = new Map(); // 存储验证码: key = sms:手机号, value = 验证码

/**
 * 存储验证码到内存
 * @param {string} phone 手机号
 * @param {string} code 验证码
 * @param {number} ttl 过期时间(秒),默认300秒
 */
const setCode = async (phone, code, ttl = 300) => {
  const key = `sms:${phone}`;
  const now=Date.now();
  for(const [id,row] of store) if(row.expires<=now) store.delete(id);
  store.set(key, {code,expires:now+ttl*1000});
};

/**
 * 获取验证码
 * @param {string} phone 手机号
 * @returns {string|null} 验证码或 null
 */
const getCode = async (phone) => {
  const key = `sms:${phone}`;
  const row = store.get(key);
  if(!row || row.expires<=Date.now()){store.delete(key);return null;}
  return row.code;
};

/**
 * 删除验证码（验证成功后调用，保证一次性）
 * @param {string} phone 手机号
 */
const delCode = async (phone) => {
  const key = `sms:${phone}`;
  store.delete(key);
  console.log(`验证码 ${key} 已删除`);
};

module.exports = { setCode, getCode, delCode };
