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
  store.set(key, code);
  // 设置定时器自动删除
  setTimeout(() => {
    store.delete(key);
    console.log(`验证码 ${key} 已过期删除`);
  }, ttl * 1000);
  console.log(`验证码已存储: ${key} = ${code}, 有效期 ${ttl} 秒`);
};

/**
 * 获取验证码
 * @param {string} phone 手机号
 * @returns {string|null} 验证码或 null
 */
const getCode = async (phone) => {
  const key = `sms:${phone}`;
  const code = store.get(key) || null;
  console.log(`获取验证码 ${key}: ${code}`);
  return code;
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