// utils/jwt.js
//生成和验证 token
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'your-secret-key';

exports.generateToken = (user) => {
  return jwt.sign(
    { id: user.id, phone: user.phone, isGuest: user.is_guest },
    secret,
    { expiresIn: '7d' }
  );
};

exports.verifyToken = (token) => {
  try {
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
};