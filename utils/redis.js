// utils/redis.js
//存储验证码
const redis = require('redis');
const redisUrl = process.env.REDIS_URL || 'redis://:StrongPassword123!@127.0.0.1:6379';

// 创建 Redis 客户端
const client = redis.createClient({ url: redisUrl });

// 监听连接事件
client.on('error', (err) => {
  console.error('Redis 连接错误:', err);
});

client.on('connect', () => {
  console.log('Redis 连接成功');
});

// 连接 Redis（4.x 需要手动调用 connect）
(async () => {
  try {
    await client.connect();
  } catch (err) {
    console.error('Redis 连接失败:', err);
  }
})();

const setCode = async (phone, code, ttl = 300) => {
  await client.setEx(`sms:${phone}`, ttl, code);
};

const getCode = async (phone) => {
  return await client.get(`sms:${phone}`);
};

module.exports = { client, setCode, getCode };