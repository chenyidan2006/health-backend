// utils/jwt.js
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'health_monitor_auth_secret';

exports.generateToken = (user) => {
  return jwt.sign(
    { id: user.id, isGuest: user.is_guest },
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