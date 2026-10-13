const { verifyToken } = require('../utils/jwt');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ errcode: -1, msg: '未授权' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      throw new Error('token verification failed');
    }
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT verify failed:', err.message);
    return res.status(401).json({ errcode: -1, msg: '无效的token' });
  }
}

module.exports = authMiddleware;
