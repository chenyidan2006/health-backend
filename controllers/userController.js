const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// 注册
exports.register = async (req, res) => {
  try {
    const { username, password, nickname, phone, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ errcode: 400, msg: '用户名和密码不能为空' });
    }

    // 检查用户名是否已存在
    const [existing] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ errcode: 400, msg: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 插入新用户
    const [result] = await pool.execute(
      `INSERT INTO users (username, password, nickname, phone, email, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [username, hashedPassword, nickname || username, phone || null, email || null]
    );

    res.json({ errcode: 0, msg: '注册成功', data: { userId: result.insertId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ errcode: 500, msg: '服务器错误' });
  }
};

// 登录
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ errcode: 400, msg: '用户名和密码不能为空' });
    }

    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ errcode: 401, msg: '用户名或密码错误' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ errcode: 401, msg: '用户名或密码错误' });
    }

    // 生成 JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 更新最后登录时间
    await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    res.json({
      errcode: 0,
      msg: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          avatar: user.avatar,
          gender: user.gender,
          birthday: user.birthday,
          height: user.height,
          weight: user.weight,
          phone: user.phone,
          email: user.email
        }
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ errcode: 500, msg: '服务器错误' });
  }
};

// 获取个人资料
exports.getProfile = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, nickname, avatar, gender, birthday, height, weight, phone, email, created_at
       FROM users WHERE id = ?`,
      [req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ errcode: 404, msg: '用户不存在' });
    }
    res.json({ errcode: 0, msg: '获取成功', data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ errcode: 500, msg: '服务器错误' });
  }
};

// 更新个人资料
exports.updateProfile = async (req, res) => {
  try {
    const { nickname, avatar, gender, birthday, height, weight, phone, email } = req.body;
    const [result] = await pool.execute(
      `UPDATE users SET
        nickname = COALESCE(?, nickname),
        avatar = COALESCE(?, avatar),
        gender = COALESCE(?, gender),
        birthday = COALESCE(?, birthday),
        height = COALESCE(?, height),
        weight = COALESCE(?, weight),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        updated_at = NOW()
       WHERE id = ?`,
      [nickname, avatar, gender, birthday, height, weight, phone, email, req.userId]
    );
    res.json({ errcode: 0, msg: '更新成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ errcode: 500, msg: '服务器错误' });
  }
};

// 修改密码
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ errcode: 400, msg: '旧密码和新密码不能为空' });
    }

    const [rows] = await pool.execute('SELECT password FROM users WHERE id = ?', [req.userId]);
    if (rows.length === 0) {
      return res.status(404).json({ errcode: 404, msg: '用户不存在' });
    }

    const isMatch = await bcrypt.compare(oldPassword, rows[0].password);
    if (!isMatch) {
      return res.status(401).json({ errcode: 401, msg: '旧密码错误' });
    }

    const hashedNew = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashedNew, req.userId]);
    res.json({ errcode: 0, msg: '密码修改成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ errcode: 500, msg: '服务器错误' });
  }
};