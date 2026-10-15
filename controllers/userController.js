// controllers/userController.js
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { generateToken, verifyToken } = require('../utils/jwt');
const { setCode, getCode, delCode } = require('../utils/redis');  // 假设 redis.js 增加了 delCode

// 生成6位随机验证码
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// ==================== 公开接口 ====================

/**
 * 发送短信验证码
 * POST /api/user/sendSms
 * body: { phone }
 */
exports.sendSms = async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({ errcode: 1, msg: '手机号格式错误' });
  }
  try {
    const code = generateCode();
    await setCode(phone, code, 300);   // 存入 Redis，5分钟过期
    // TODO: 这里应调用阿里云/腾讯云短信 SDK，现在先打印到控制台
    console.log(`✅ 验证码已发送到 ${phone}: ${code} (有效期5分钟)`);
    res.json({ errcode: 0, msg: '验证码已发送' });
  } catch (err) {
    console.error('发送验证码错误:', err);
    res.json({ errcode: 2, msg: '验证码发送失败' });
  }
};

/**
 * 手机号 + 验证码登录（不存在则自动注册）
 * POST /api/user/loginBySms
 * body: { phone, smsCode }
 */
exports.loginBySms = async (req, res) => {
  const { phone, smsCode } = req.body;
  if (!phone || !smsCode) {
    return res.json({ errcode: 1, msg: '参数不完整' });
  }
  try {
    // 1. 校验验证码
    const storedCode = await getCode(phone);
    if (!storedCode || storedCode !== smsCode) {
      return res.json({ errcode: 2, msg: '验证码错误或已过期' });
    }
    // 2. 验证通过，删除验证码（一次有效）
    await delCode(phone);

    // 3. 查询用户，不存在则自动注册
    const [users] = await pool.execute('SELECT * FROM users WHERE phone = ?', [phone]);
    let user;
    if (users.length === 0) {
      const defaultNickname = '用户' + phone.slice(-4);
      const [result] = await pool.execute(
        'INSERT INTO users (phone, nickname, is_guest, created_at) VALUES (?, ?, 0, NOW())',
        [phone, defaultNickname]
      );
      user = { id: result.insertId, phone, nickname: defaultNickname, is_guest: 0 };
    } else {
      user = users[0];
      await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    }

    // 4. 生成 token
    const token = generateToken({ id: user.id, is_guest: user.is_guest });
    delete user.password;
    res.json({ errcode: 0, msg: '登录成功', data: { token, user } });
  } catch (err) {
    console.error('手机号登录错误:', err);
    res.json({ errcode: 3, msg: '服务器错误' });
  }
};

/**
 * 手机号 + 密码注册
 * POST /api/user/register
 * body: { phone, password }
 */
exports.register = async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ errcode: 400, msg: '手机号和密码不能为空' });
  }
  try {
    // 检查手机号是否已注册
    const [exists] = await pool.execute('SELECT id FROM users WHERE phone = ?', [phone]);
    if (exists.length > 0) {
      return res.status(400).json({ errcode: 400, msg: '手机号已注册' });
    }
    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);
    const defaultNickname = '用户' + phone.slice(-4);
    const [result] = await pool.execute(
      'INSERT INTO users (phone, password, nickname, is_guest, created_at) VALUES (?, ?, ?, 0, NOW())',
      [phone, hashedPassword, defaultNickname]
    );
    const token = generateToken({ id: result.insertId, is_guest: 0 });
    res.json({
      errcode: 0,
      msg: '注册成功',
      data: { userId: result.insertId, token, user: { id: result.insertId, phone, nickname: defaultNickname } }
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ errcode: 400, msg: '手机号已注册' });
    } else {
      console.error('注册错误:', err);
      res.status(500).json({ errcode: 500, msg: err.message });
    }
  }
};

/**
 * 手机号 + 密码登录
 * POST /api/user/login
 * body: { phone, password }
 */
exports.login = async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ errcode: 400, msg: '手机号和密码不能为空' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE phone = ?', [phone]);
    if (rows.length === 0) {
      return res.status(401).json({ errcode: 401, msg: '手机号或密码错误' });
    }
    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ errcode: 401, msg: '手机号或密码错误' });
    }
    await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    const token = generateToken({ id: user.id, is_guest: user.is_guest });
    delete user.password;
    res.json({ errcode: 0, msg: '登录成功', data: { token, user } });
  } catch (err) {
    console.error('登录错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 微信登录（小程序）
 * POST /api/user/wechatLogin
 * body: { code }
 */
exports.wechatLogin = async (req, res) => {
  const appId = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;
  if (!appId || !secret || appId === 'your_appid' || secret === 'your_secret') {
    return res.json({ errcode: 1001, msg: '微信登录功能暂未开放' });
  }

  const { code } = req.body;
  if (!code) return res.json({ errcode: 1, msg: 'code 不能为空' });

  try {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const response = await axios.get(url);
    const { openid } = response.data;
    if (!openid) {
      return res.json({ errcode: 2, msg: '微信登录失败' });
    }

    const [users] = await pool.execute('SELECT * FROM users WHERE wechat_openid = ?', [openid]);
    let user;
    if (users.length === 0) {
      const [result] = await pool.execute(
        'INSERT INTO users (wechat_openid, nickname, is_guest, created_at) VALUES (?, ?, 0, NOW())',
        [openid, '微信用户']
      );
      user = { id: result.insertId, wechat_openid: openid, nickname: '微信用户', is_guest: 0 };
    } else {
      user = users[0];
      await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    }

    const token = generateToken({ id: user.id, is_guest: user.is_guest });
    delete user.password;
    res.json({ errcode: 0, msg: '登录成功', data: { token, user } });
  } catch (err) {
    console.error('微信登录错误:', err);
    res.json({ errcode: 3, msg: '服务器错误' });
  }
};

/**
 * QQ登录 - 暂未实现
 */
exports.qqLogin = async (req, res) => {
  res.json({ errcode: 1001, msg: 'QQ登录功能暂未开放' });
};

/**
 * 游客登录（创建临时账号，phone 为 NULL，is_guest = 1）
 * POST /api/user/guestLogin
 */
exports.guestLogin = async (req, res) => {
  try {
    const guestNickname = '游客' + Date.now().toString().slice(-6);
    const [result] = await pool.execute(
      'INSERT INTO users (nickname, is_guest, created_at) VALUES (?, 1, NOW())',
      [guestNickname]
    );
    const user = { id: result.insertId, nickname: guestNickname, is_guest: 1 };
    const token = generateToken({ id: user.id, is_guest: 1 });
    res.json({ errcode: 0, msg: '游客登录成功', data: { token, user } });
  } catch (err) {
    console.error('游客登录错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

// ==================== 需要认证的接口 ====================

/**
 * 获取个人信息
 * GET /api/user/profile
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      'SELECT id, phone, nickname, avatar, gender, birthday, height, weight, email, is_guest, created_at FROM users WHERE id = ?',
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ errcode: 404, msg: '用户不存在' });
    }
    res.json({ errcode: 0, msg: '获取成功', data: rows[0] });
  } catch (err) {
    console.error('获取个人信息错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 更新个人资料（昵称、头像等）
 * PUT /api/user/profile
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { nickname=null, avatar=null, gender=null, birthday=null, height=null, weight=null, email=null } = req.body || {};
    await pool.execute(
      `UPDATE users SET
        nickname = COALESCE(?, nickname),
        avatar = COALESCE(?, avatar),
        gender = COALESCE(?, gender),
        birthday = COALESCE(?, birthday),
        height = COALESCE(?, height),
        weight = COALESCE(?, weight),
        email = COALESCE(?, email),
        updated_at = NOW()
       WHERE id = ?`,
      [nickname, avatar, gender, birthday, height, weight, email, userId]
    );
    res.json({ errcode: 0, msg: '更新成功' });
  } catch (err) {
    console.error('更新资料错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 修改密码
 * POST /api/user/changePassword
 */
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { oldPassword, newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 72) {
      return res.json({ errcode: 1, msg: '新密码长度应为6至72个字符' });
    }
    const [rows] = await pool.execute('SELECT password FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ errcode: 404, msg: '用户不存在' });
    }
    const isValid = !rows[0].password || (typeof oldPassword==='string' && await bcrypt.compare(oldPassword, rows[0].password));
    if (!isValid) {
      return res.status(401).json({ errcode: 401, msg: '原密码错误' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
    res.json({ errcode: 0, msg: '密码修改成功' });
  } catch (err) {
    console.error('修改密码错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

// ==================== 设备管理 ====================

/**
 * 获取当前用户的所有设备
 * GET /api/user/devices
 */
exports.getUserDevices = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT device_id, device_name, status, last_active, bind_time
       FROM user_devices
       WHERE user_id = ?
       ORDER BY bind_time DESC`,
      [userId]
    );
    res.json({ errcode: 0, msg: '获取成功', data: rows });
  } catch (err) {
    console.error('获取设备列表错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 搜索设备（可选，按关键字查）
 * GET /api/user/devices/search?keyword=xxx
 */
exports.searchDevices = async (req, res) => {
  try {
    const userId = req.user.id;
    const { keyword } = req.query;
    let sql = `SELECT device_id, device_name, status, last_active
               FROM user_devices WHERE user_id = ?`;
    const params = [userId];
    if (keyword) {
      sql += ` AND (device_id LIKE ? OR device_name LIKE ?)`;
      const like = `%${keyword}%`;
      params.push(like, like);
    }
    const [rows] = await pool.execute(sql, params);
    res.json({ errcode: 0, msg: '搜索成功', data: rows });
  } catch (err) {
    console.error('搜索设备错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 绑定设备
 * POST /api/user/bindDevice
 * body: { deviceId, deviceName? }
 */
exports.bindDevice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, deviceName } = req.body;
    if (!deviceId) {
      return res.json({ errcode: 1, msg: 'deviceId 不能为空' });
    }
    // 检查设备是否已被绑定
    const [exist] = await pool.execute(
      'SELECT user_id FROM user_devices WHERE device_id = ?',
      [deviceId]
    );
    if (exist.length > 0) {
      if (exist[0].user_id === userId) {
        return res.json({ errcode: 2, msg: '该设备已绑定到当前账号' });
      }
      return res.json({ errcode: 3, msg: '该设备已被其他用户绑定' });
    }
    // 插入绑定记录
    await pool.execute(
      'INSERT INTO user_devices (user_id, device_id, device_name, bind_time) VALUES (?, ?, ?, NOW())',
      [userId, deviceId, deviceName || `设备${deviceId.slice(-6)}`]
    );
    res.json({ errcode: 0, msg: '绑定成功' });
  } catch (err) {
    console.error('绑定设备错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 解绑设备
 * DELETE /api/user/devices/:deviceId
 */
exports.unbindDevice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.params;
    const [result] = await pool.execute(
      'DELETE FROM user_devices WHERE user_id = ? AND device_id = ?',
      [userId, deviceId]
    );
    if (result.affectedRows === 0) {
      return res.json({ errcode: 1, msg: '未找到该绑定记录' });
    }
    res.json({ errcode: 0, msg: '解绑成功' });
  } catch (err) {
    console.error('解绑设备错误:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};
