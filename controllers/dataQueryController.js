// controllers/dataQueryController.js
const pool = require('../config/db');
const logger = require('../utils/logger');

// 空汇总模板（保持与原接口一致）
function getEmptySummary(date) {
  return {
    date,
    overallBalance: null,
    vitalSigns: null,
    activityLevel: null,
    relaxationState: null,
    avgHeartRate: null,
    avgSystolic: null,
    avgDiastolic: null,
    avgSpo2: null,
    bpHistory: { systolic: [], diastolic: [] },
    heartRateHistory: [],
    spo2History: [],
    totalRecords: 0,
    lastUpdate: null
  };
}

function generateEmptyHourlyRange() {
  const data = [];
  for (let hour = 0; hour < 24; hour++) {
    data.push({
      hour,
      heart_rate: { min: null, max: null },
      systolic_bp: { min: null, max: null },
      diastolic_bp: { min: null, max: null },
      spo2: { min: null, max: null },
      count: 0
    });
  }
  return data;
}

/**
 * 获取指定日期每小时的极值（用于圆柱图）
 */
exports.getHourlyRange = async (req, res) => {
  console.log('🔥🔥🔥 getHourlyRange 控制器被调用');
  try {
    const userId = req.user.id;
    const { deviceId, date } = req.query;
    console.log('请求参数:', { userId, deviceId, date });

    if (!date) return res.status(400).json({ errcode: 400, msg: '缺少日期参数' });

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
      return res.json({ errcode: 0, msg: '无数据', data: generateEmptyHourlyRange() });
    }

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
    console.error('getHourlyRange 异常:', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 获取每日汇总
 */
exports.getDailySummary = async (req, res) => {
  console.log('🔥🔥🔥 getDailySummary 被调用');
  try {
    const userId = req.user.id;
    const { deviceId, date } = req.query;
    console.log('请求参数:', { userId, deviceId, date });
    if (!date) return res.status(400).json({ errcode: 400, msg: '缺少日期参数' });

    let sql = `
      SELECT measure_time, heart_rate, systolic_bp, diastolic_bp, spo2
      FROM user_health_data
      WHERE user_id = ? AND DATE(measure_time) = ?
    `;
    const params = [userId, date];
    if (deviceId) {
      sql += ' AND device_id = ?';
      params.push(deviceId);
    }
    sql += ' ORDER BY measure_time ASC';

    const [rows] = await pool.execute(sql, params);
    console.log('查询到记录数:', rows.length);

    if (rows.length === 0) {
      return res.json({ errcode: 0, msg: '无数据', data: getEmptySummary(date) });
    }

    const heartRates = rows.map(r => r.heart_rate).filter(v => v !== null);
    const systolics = rows.map(r => r.systolic_bp).filter(v => v !== null);
    const diastolics = rows.map(r => r.diastolic_bp).filter(v => v !== null);
    const spo2s = rows.map(r => r.spo2).filter(v => v !== null);

    const avgHeartRate = heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : null;
    const avgSystolic = systolics.length ? Math.round(systolics.reduce((a, b) => a + b, 0) / systolics.length) : null;
    const avgDiastolic = diastolics.length ? Math.round(diastolics.reduce((a, b) => a + b, 0) / diastolics.length) : null;
    const avgSpo2 = spo2s.length ? Math.round(spo2s.reduce((a, b) => a + b, 0) / spo2s.length) : null;

    const hourlyMap = {};
    rows.forEach(row => {
      const hour = new Date(row.measure_time).getHours();
      if (!hourlyMap[hour]) {
        hourlyMap[hour] = { heart: [], sys: [], dia: [], spo2: [] };
      }
      if (row.heart_rate) hourlyMap[hour].heart.push(row.heart_rate);
      if (row.systolic_bp) hourlyMap[hour].sys.push(row.systolic_bp);
      if (row.diastolic_bp) hourlyMap[hour].dia.push(row.diastolic_bp);
      if (row.spo2) hourlyMap[hour].spo2.push(row.spo2);
    });

    const hourlyAverages = [];
    for (let hour = 0; hour < 24; hour++) {
      const data = hourlyMap[hour];
      hourlyAverages[hour] = {
        hour,
        avg_heart_rate: data && data.heart.length ? Math.round(data.heart.reduce((a, b) => a + b, 0) / data.heart.length) : null,
        avg_systolic_bp: data && data.sys.length ? Math.round(data.sys.reduce((a, b) => a + b, 0) / data.sys.length) : null,
        avg_diastolic_bp: data && data.dia.length ? Math.round(data.dia.reduce((a, b) => a + b, 0) / data.dia.length) : null,
        avg_spo2: data && data.spo2.length ? Math.round(data.spo2.reduce((a, b) => a + b, 0) / data.spo2.length) : null
      };
    }

    const response = {
      date,
      overallBalance: null,
      vitalSigns: null,
      activityLevel: null,
      relaxationState: null,
      avgHeartRate,
      avgSystolic,
      avgDiastolic,
      avgSpo2,
      bpHistory: {
        systolic: hourlyAverages.map(h => h.avg_systolic_bp),
        diastolic: hourlyAverages.map(h => h.avg_diastolic_bp)
      },
      heartRateHistory: hourlyAverages.map(h => h.avg_heart_rate),
      spo2History: hourlyAverages.map(h => h.avg_spo2),
      totalRecords: rows.length,
      lastUpdate: rows.length ? rows[rows.length - 1].measure_time : null
    };

    const today = new Date().toISOString().split('T')[0];
    if (date === today) {
      response.realtime = await exports.getRealtimeData(userId, deviceId);
    }

    res.json({ errcode: 0, msg: '获取数据成功', data: response });
  } catch (err) {
    console.error('getDailySummary 失败', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 获取实时数据（最近几分钟）
 */
exports.getRealtimeData = async (userId, deviceId, minutes = 10) => {
  const cutoffTime = new Date(Date.now() - minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');

  let sql = `
    SELECT heart_rate, systolic_bp, diastolic_bp, spo2, measure_time as timestamp
    FROM user_health_data
    WHERE user_id = ? AND measure_time >= ?
  `;
  const params = [userId, cutoffTime];
  if (deviceId) {
    sql += ' AND device_id = ?';
    params.push(deviceId);
  }
  sql += ' ORDER BY measure_time ASC';

  const [rows] = await pool.execute(sql, params);

  const realtimeData = {
    heart_rate: [],
    systolic_bp: [],
    diastolic_bp: [],
    spo2: [],
    timestamps: []
  };
  rows.forEach(row => {
    realtimeData.heart_rate.push(row.heart_rate);
    realtimeData.systolic_bp.push(row.systolic_bp);
    realtimeData.diastolic_bp.push(row.diastolic_bp);
    realtimeData.spo2.push(row.spo2);
    realtimeData.timestamps.push(row.timestamp);
  });
  return realtimeData;
};

// 实时数据接口（单独）
exports.getRealtimeDataHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, minutes = 10 } = req.query;
    const data = await exports.getRealtimeData(userId, deviceId, parseInt(minutes));
    res.json({ errcode: 0, msg: '获取实时数据成功', data, lastUpdate: new Date() });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 获取可用日期列表（有数据的日期）
 */
exports.getAvailableDates = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, limit = 30 } = req.query;

    let sql = `
      SELECT DISTINCT DATE(measure_time) as date
      FROM user_health_data
      WHERE user_id = ?
    `;
    const params = [userId];
    if (deviceId) {
      sql += ' AND device_id = ?';
      params.push(deviceId);
    }
    sql += ' ORDER BY date DESC LIMIT ?';
    params.push(parseInt(limit));

    const [rows] = await pool.execute(sql, params);
    const dates = rows.map(r => r.date);
    res.json({ errcode: 0, msg: '获取日期列表成功', dates });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 获取设备状态（基于最新数据时间）
 */
exports.getDeviceStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.query;

    let sql = `
      SELECT measure_time as timestamp
      FROM user_health_data
      WHERE user_id = ?
    `;
    const params = [userId];
    if (deviceId) {
      sql += ' AND device_id = ?';
      params.push(deviceId);
    }
    sql += ' ORDER BY measure_time DESC LIMIT 1';

    const [recentRows] = await pool.execute(sql, params);

    const today = new Date().toISOString().split('T')[0];
    let countSql = `
      SELECT COUNT(*) as count
      FROM user_health_data
      WHERE user_id = ? AND DATE(measure_time) = ?
    `;
    const countParams = [userId, today];
    if (deviceId) {
      countSql += ' AND device_id = ?';
      countParams.push(deviceId);
    }
    const [countRows] = await pool.execute(countSql, countParams);

    const lastUpdate = recentRows.length > 0 ? recentRows[0].timestamp : null;
    const dataDelay = lastUpdate ? Math.round((Date.now() - new Date(lastUpdate).getTime()) / 60000) : null;
    const isConnected = dataDelay !== null && dataDelay < 5;

    res.json({
      errcode: 0,
      msg: '获取设备状态成功',
      data: {
        deviceId: deviceId || 'unknown',
        lastUpdate,
        dataDelay,
        isConnected,
        todayRecords: countRows[0].count,
        todayStatus: countRows[0].count > 0 ? 'active' : 'inactive'
      }
    });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

/**
 * 获取历史趋势（指定日期范围、指定指标）
 */
exports.getHistoryTrend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, startDate, endDate, metric = 'heart_rate' } = req.query;

    let start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 86400000);
    let end = endDate ? new Date(endDate) : new Date();
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    let sql = `
      SELECT DATE(measure_time) as date,
             AVG(heart_rate) as avg_heart_rate,
             AVG(systolic_bp) as avg_systolic_bp,
             AVG(diastolic_bp) as avg_diastolic_bp,
             AVG(spo2) as avg_spo2
      FROM user_health_data
      WHERE user_id = ? AND DATE(measure_time) BETWEEN ? AND ?
    `;
    const params = [userId, startStr, endStr];
    if (deviceId) {
      sql += ' AND device_id = ?';
      params.push(deviceId);
    }
    sql += ' GROUP BY DATE(measure_time) ORDER BY date ASC';

    const [rows] = await pool.execute(sql, params);

    const trendData = rows.map(r => ({
      date: r.date,
      value: getMetricValue(r, metric),
      overall_balance: null
    }));

    res.json({ errcode: 0, msg: '获取历史趋势成功', data: trendData });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

function getMetricValue(row, metric) {
  switch (metric) {
    case 'heart_rate': return row.avg_heart_rate ? Math.round(row.avg_heart_rate) : null;
    case 'systolic_bp': return row.avg_systolic_bp ? Math.round(row.avg_systolic_bp) : null;
    case 'diastolic_bp': return row.avg_diastolic_bp ? Math.round(row.avg_diastolic_bp) : null;
    case 'spo2': return row.avg_spo2 ? Math.round(row.avg_spo2) : null;
    default: return null;
  }
}