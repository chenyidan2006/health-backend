// utils/jwt.js
const jwt = require('jsonwebtoken');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET 未配置或长度不足 32 个字符');
  }
  return secret;
}

exports.generateToken = (user) => {
  return jwt.sign(
    { id: user.id, isGuest: user.is_guest },
    getSecret(),
    { expiresIn: '7d' }
  );
};

exports.verifyToken = (token) => {
  try {
    return jwt.verify(token, getSecret());
  } catch (err) {
    return null;
  }
};
