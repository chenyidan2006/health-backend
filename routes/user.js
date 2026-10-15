const express = require('express');
const router = express.Router();
router.use(require('./accountExtras').router);
const userController = require('../controllers/userController');
console.log('userController 导出的方法:', Object.keys(userController)); 
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
// 获取当前用户的设备列表
router.get('/devices', authMiddleware, userController.getUserDevices);
// 搜索设备
router.get('/devices/search', authMiddleware, userController.searchDevices);
// 绑定新设备
router.post('/devices/bind', authMiddleware, userController.bindDevice);
// 解绑设备
router.delete('/devices/:deviceId', authMiddleware, userController.unbindDevice);

module.exports = router;
