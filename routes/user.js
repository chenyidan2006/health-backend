const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

// 公开接口
router.post('/register', userController.register);               // 手机号注册
router.post('/login', userController.login);                     // 用户名/手机号+密码登录
router.post('/sendSms', userController.sendSms);                  // 发送验证码
router.post('/loginBySms', userController.loginBySms);            // 手机号验证码登录
router.post('/wechatLogin', userController.wechatLogin);          // 微信登录
router.post('/qqLogin', userController.qqLogin);                  // QQ登录
router.post('/guestLogin', userController.guestLogin);            // 游客登录

// 需要认证的接口
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);
router.post('/change-password', authMiddleware, userController.changePassword);
router.get('/devices', authMiddleware, userController.getUserDevices);

module.exports = router;