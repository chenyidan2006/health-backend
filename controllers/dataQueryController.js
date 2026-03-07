// controllers/dataQueryController.js
const pool = require('../config/db');

exports.getHourlyRange = async (req, res) => {
	a=b;
  console.log('🔥🔥🔥 getHourlyRange 控制器被调用');
  try {
    // 从 token 获取用户ID（已由中间件挂载到 req.user）
    const userId = req.user.id;
    const { deviceId, date } = req.query;
    console.log('请求参数:', { userId, deviceId, date });

    if (!date) {
      return res.status(400).json({ errcode: 400, msg: '缺少日期参数' });
    }

    // 构建 SQL 查询
    let sql = `
      SELECT HOUR(measure_time) as hour,
             heart_rate, systolic_bp, diastolic_bp, spo2
      FROM user_health_data
      WHERE user_id = ? AND DATE(measure_time) = ?
    `;
    const params = [userId, date];
    if (deviceId) {
      sql += ' AND device_id = ?';
      params.push(deviceId);
    }
    sql += ' ORDER BY measure_time ASC';

    console.log('执行 SQL:', sql);
    console.log('参数:', params);

    const [rows] = await pool.execute(sql, params);
    console.log('查询到记录数:', rows.length);

    if (rows.length === 0) {
      // 返回全空数据
      const emptyData = [];
      for (let hour = 0; hour < 24; hour++) {
        emptyData.push({
          hour,
          heart_rate: { min: null, max: null },
          systolic_bp: { min: null, max: null },
          diastolic_bp: { min: null, max: null },
          spo2: { min: null, max: null },
          count: 0
        });
      }
      return res.json({ errcode: 0, msg: '无数据', data: emptyData });
    }

    // 按小时分组计算极值
    const hourlyMap = {};
    for (let hour = 0; hour < 24; hour++) {
      hourlyMap[hour] = { heart: [], sys: [], dia: [], spo2: [] };
    }

    rows.forEach(row => {
      const hour = row.hour;
      if (row.heart_rate) hourlyMap[hour].heart.push(row.heart_rate);
      if (row.systolic_bp) hourlyMap[hour].sys.push(row.systolic_bp);
      if (row.diastolic_bp) hourlyMap[hour].dia.push(row.diastolic_bp);
      if (row.spo2) hourlyMap[hour].spo2.push(row.spo2);
    });

    const hourlyRange = [];
    for (let hour = 0; hour < 24; hour++) {
      const data = hourlyMap[hour];
      hourlyRange.push({
        hour,
        heart_rate: {
          min: data.heart.length ? Math.min(...data.heart) : null,
          max: data.heart.length ? Math.max(...data.heart) : null
        },
        systolic_bp: {
          min: data.sys.length ? Math.min(...data.sys) : null,
          max: data.sys.length ? Math.max(...data.sys) : null
        },
        diastolic_bp: {
          min: data.dia.length ? Math.min(...data.dia) : null,
          max: data.dia.length ? Math.max(...data.dia) : null
        },
        spo2: {
          min: data.spo2.length ? Math.min(...data.spo2) : null,
          max: data.spo2.length ? Math.max(...data.spo2) : null
        },
        count: data.heart.length
      });
    }

    res.json({ errcode: 0, msg: '获取每小时极值成功', data: hourlyRange });
  } catch (err) {
    console.error('控制器异常:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};