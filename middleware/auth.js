// middleware/auth.js
const { verifyToken } = require('../utils/jwt');

module.exports = async (req, res, next) => {
  console.log('🔥 authMiddleware 被触发');
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ errcode: 1, msg: '未提供认证令牌' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ errcode: 2, msg: '令牌无效或已过期' });
  }
  req.user = decoded;
  console.log('✅ 用户认证通过，ID:', decoded.id);
  next();
};