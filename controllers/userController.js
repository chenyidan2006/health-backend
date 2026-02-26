const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { generateToken } = require('../utils/jwt');
const { sendSms } = require('../utils/sms');
const { setCode, getCode } = require('../utils/redis');

// 生成6位随机验证码
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// ==================== 公开接口 ====================

// 发送验证码
exports.sendSms = async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json({ errcode: 1, msg: '手机号不能为空' });
  const code = generateCode(); // 使用统一的生成函数
  try {
    // 存储到 Redis，5分钟过期
    await setCode(phone, code);
    // TODO: 集成真实短信服务商（如阿里云、腾讯云等）
    console.log(`向 ${phone} 发送验证码: ${code}`);
    res.json({ errcode: 0, msg: '验证码发送成功' });
  } catch (err) {
    console.error('发送验证码错误:', err);
    res.json({ errcode: 2, msg: '验证码发送失败' });
  }
};

// 手机号验证码登录
exports.loginBySms = async (req, res) => {
  const { phone, smsCode } = req.body;
  if (!phone || !smsCode) {
    return res.json({ errcode: 1, msg: '参数不完整' });
  }
  const storedCode = await getCode(phone);
  if (!storedCode || storedCode !== smsCode) {
    return res.json({ errcode: 2, msg: '验证码错误或已过期' });
  }
  try {
    const [users] = await pool.execute('SELECT * FROM users WHERE phone = ?', [phone]);
    let user = users[0];
    if (!user) {
      // 首次手机号登录，自动注册
      const [result] = await pool.execute(
        'INSERT INTO users (phone, nickname, created_at) VALUES (?, ?, NOW())',
        [phone, phone]
      );
      user = { id: result.insertId, phone, is_guest: 0 };
    }
    const token = generateToken(user);
    await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    delete user.password;
    res.json({ errcode: 0, data: { token, user } });
  } catch (err) {
    console.error('手机号登录错误:', err);
    res.json({ errcode: 3, msg: '服务器错误' });
  }
};

// 微信登录（小程序）- 功能开发中
exports.wechatLogin = async (req, res) => {
  // 检查是否配置了有效的微信 AppID 和 Secret
  const appId = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;
  if (!appId || !secret || appId === 'your_appid' || secret === 'your_secret') {
    return res.json({ errcode: 1001, msg: '微信登录功能暂未开放，请使用其他方式登录' });
  }

  const { code } = req.body;
  if (!code) {
    return res.json({ errcode: 1, msg: 'code 不能为空' });
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
  try {
    const response = await axios.get(url);
    const { openid, unionid } = response.data;
    if (!openid) {
      return res.json({ errcode: 2, msg: '微信登录失败' });
    }
    const [users] = await pool.execute('SELECT * FROM users WHERE wechat_openid = ?', [openid]);
    let user = users[0];
    if (!user) {
      const [result] = await pool.execute(
        'INSERT INTO users (wechat_openid, nickname, created_at) VALUES (?, ?, NOW())',
        [openid, '微信用户']
      );
      user = { id: result.insertId, wechat_openid: openid, is_guest: 0 };
    }
    const token = generateToken(user);
    await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    delete user.password;
    res.json({ errcode: 0, data: { token, user } });
  } catch (err) {
    console.error('微信登录错误:', err);
    res.json({ errcode: 3, msg: '服务器错误' });
  }
};

// QQ登录 - 功能开发中（暂未实现）
exports.qqLogin = async (req, res) => {
  // 检查是否配置了有效的 QQ AppID 和 Secret（这里以环境变量为例）
  const appId = process.env.QQ_APPID;
  const secret = process.env.QQ_SECRET;
  if (!appId || !secret || appId === 'your_qq_appid' || secret === 'your_qq_secret') {
    return res.json({ errcode: 1001, msg: 'QQ登录功能暂未开放，请使用其他方式登录' });
  }

  // 如果已配置，则实现具体逻辑（需根据QQ互联API调整）
  // 此处先返回开发中提示
  res.json({ errcode: 1001, msg: 'QQ登录功能暂未开放，请使用其他方式登录' });
};

// 游客登录
exports.guestLogin = async (req, res) => {
  try {
    const guestName = 'guest_' + Date.now() + Math.random().toString(36).substr(2, 4);
    const [result] = await pool.execute(
      'INSERT INTO users (username, nickname, is_guest, created_at) VALUES (?, ?, 1, NOW())',
      [guestName, '游客']
    );
    const user = { id: result.insertId, username: guestName, is_guest: 1 };
    const token = generateToken(user);
    res.json({ errcode: 0, data: { token, user } });
  } catch (err) {
    console.error('游客登录错误:', err);
    res.json({ errcode: 1, msg: '游客登录失败' });
  }
};

// 手机号注册（需要验证码）
exports.register = async (req, res) => {
  const { phone, password, smsCode } = req.body;
  if (!phone || !password || !smsCode) {
    return res.json({ errcode: 1, msg: '参数不完整' });
  }
  const storedCode = await getCode(phone);
  if (!storedCode || storedCode !== smsCode) {
    return res.json({ errcode: 2, msg: '验证码错误或已过期' });
  }
  try {
    const [exists] = await pool.execute('SELECT id FROM users WHERE phone = ?', [phone]);
    if (exists.length > 0) {
      return res.json({ errcode: 3, msg: '手机号已注册' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (phone, password, created_at) VALUES (?, ?, NOW())',
      [phone, hashedPassword]
    );
    const user = { id: result.insertId, phone };
    const token = generateToken(user);
    res.json({ errcode: 0, data: { token, user } });
  } catch (err) {
    console.error('注册错误:', err);
    res.json({ errcode: 4, msg: '服务器错误' });
  }
};

// 用户名/手机号+密码登录
exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.json({ errcode: 1, msg: '用户名和密码不能为空' });
  }
  try {
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE username = ? OR phone = ?',
      [username, username]
    );
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.json({ errcode: 2, msg: '用户名或密码错误' });
    }
    const token = generateToken(user);
    await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    delete user.password;
    res.json({ errcode: 0, data: { token, user } });
  } catch (err) {
    console.error('登录错误:', err);
    res.json({ errcode: 3, msg: '服务器错误' });
  }
};

// ==================== 需要认证的接口 ====================

// 获取个人信息
exports.getProfile = async (req, res) => {
  const userId = req.user.id;
  try {
    const [users] = await pool.execute(
      'SELECT id, username, phone, nickname, avatar, gender, height, weight, is_guest, created_at FROM users WHERE id = ?',
      [userId]
    );
    if (users.length === 0) {
      return res.json({ errcode: 1, msg: '用户不存在' });
    }
    res.json({ errcode: 0, data: users[0] });
  } catch (err) {
    console.error('获取个人信息错误:', err);
    res.json({ errcode: 2, msg: '服务器错误' });
  }
};

// 更新个人资料
exports.updateProfile = async (req, res) => {
  const userId = req.user.id;
  const { nickname, avatar, gender, height, weight, phone, email } = req.body;
  try {
    await pool.execute(
      `UPDATE users SET
        nickname = COALESCE(?, nickname),
        avatar = COALESCE(?, avatar),
        gender = COALESCE(?, gender),
        height = COALESCE(?, height),
        weight = COALESCE(?, weight),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        updated_at = NOW()
       WHERE id = ?`,
      [nickname, avatar, gender, height, weight, phone, email, userId]
    );
    res.json({ errcode: 0, msg: '更新成功' });
  } catch (err) {
    console.error('更新资料错误:', err);
    res.json({ errcode: 2, msg: '服务器错误' });
  }
};

// 修改密码
exports.changePassword = async (req, res) => {
  const userId = req.user.id;
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.json({ errcode: 1, msg: '旧密码和新密码不能为空' });
  }
  try {
    const [rows] = await pool.execute('SELECT password FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.json({ errcode: 2, msg: '用户不存在' });
    }
    const isMatch = await bcrypt.compare(oldPassword, rows[0].password);
    if (!isMatch) {
      return res.json({ errcode: 3, msg: '旧密码错误' });
    }
    const hashedNew = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashedNew, userId]);
    res.json({ errcode: 0, msg: '密码修改成功' });
  } catch (err) {
    console.error('修改密码错误:', err);
    res.json({ errcode: 4, msg: '服务器错误' });
  }
};