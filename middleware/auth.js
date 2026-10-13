const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'health_monitor_auth_secret';

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ errcode: -1, msg: '未授权' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT verify failed:', err.message);
    return res.status(401).json({ errcode: -1, msg: '无效的token' });
  }
}

module.exports = authMiddleware;
