//controllers/dataQueryController.js（数据查询）
//D:/code/app/appprogram/health-backend/controllers/dataQueryController.js
const pool = require('../config/db');
const logger = require('../utils/logger');

// 空汇总模板
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

// 获取指定日期每小时的极值（用于圆柱图）
exports.getHourlyRange = async (req, res) => {
  try {
    const { deviceId = 'ESP32_001', date } = req.query;
    if (!date) return res.status(400).json({ errcode: 400, msg: '缺少日期参数' });

    // 查询该日期所有 processed_health_data
    const [rows] = await pool.execute(
      `SELECT hour, heart_rate, systolic_bp, diastolic_bp, spo2
       FROM processed_health_data
       WHERE device_id = ? AND date = ?
       ORDER BY hour ASC`,
      [deviceId, date]
    );

    // 按小时分组计算极值
    const hourlyMap = {};
    for (let hour = 0; hour < 24; hour++) {
      hourlyMap[hour] = {
        hour,
        heart_rates: [],
        systolic_bps: [],
        diastolic_bps: [],
        spo2s: []
      };
    }

    rows.forEach(row => {
      const h = row.hour;
      if (row.heart_rate) hourlyMap[h].heart_rates.push(row.heart_rate);
      if (row.systolic_bp) hourlyMap[h].systolic_bps.push(row.systolic_bp);
      if (row.diastolic_bp) hourlyMap[h].diastolic_bps.push(row.diastolic_bp);
      if (row.spo2) hourlyMap[h].spo2s.push(row.spo2);
    });

    const hourlyRange = [];
    for (let hour = 0; hour < 24; hour++) {
      const data = hourlyMap[hour];
      hourlyRange.push({
        hour,
        heart_rate: {
          min: data.heart_rates.length ? Math.min(...data.heart_rates) : null,
          max: data.heart_rates.length ? Math.max(...data.heart_rates) : null
        },
        systolic_bp: {
          min: data.systolic_bps.length ? Math.min(...data.systolic_bps) : null,
          max: data.systolic_bps.length ? Math.max(...data.systolic_bps) : null
        },
        diastolic_bp: {
          min: data.diastolic_bps.length ? Math.min(...data.diastolic_bps) : null,
          max: data.diastolic_bps.length ? Math.max(...data.diastolic_bps) : null
        },
        spo2: {
          min: data.spo2s.length ? Math.min(...data.spo2s) : null,
          max: data.spo2s.length ? Math.max(...data.spo2s) : null
        },
        count: data.heart_rates.length
      });
    }

    res.json({
      errcode: 0,
      msg: '获取每小时极值成功',
      data: hourlyRange
    });
  } catch (err) {
    logger.error('getHourlyRange 失败', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

// 获取每日汇总
exports.getDailySummary = async (req, res) => {
  try {
    const { deviceId = 'ESP32_001', date } = req.query;
    if (!date) return res.status(400).json({ errcode: 400, msg: '缺少日期参数' });

    const [rows] = await pool.execute(
      `SELECT * FROM daily_summary WHERE device_id = ? AND date = ?`,
      [deviceId, date]
    );

    if (rows.length === 0) {
      return res.json({ errcode: 0, msg: '无数据', data: getEmptySummary(date) });
    }

    const s = rows[0];
    const hourlyData = typeof s.hourly_data === 'string' ? JSON.parse(s.hourly_data) : s.hourly_data;
    const hourlyAverages = hourlyData.map(h => ({
      hour: h.hour,
      avg_heart_rate: h.avg_heart_rate || 0,
      avg_systolic_bp: h.avg_systolic_bp || 0,
      avg_diastolic_bp: h.avg_diastolic_bp || 0,
      avg_spo2: h.avg_spo2 || 0
    }));

    const response = {
      date: s.date,
      overallBalance: s.overall_balance,
      vitalSigns: s.vital_signs_score,
      activityLevel: s.activity_level_score,
      relaxationState: s.relaxation_state_score,
      avgHeartRate: s.avg_heart_rate,
      avgSystolic: s.avg_systolic_bp,
      avgDiastolic: s.avg_diastolic_bp,
      avgSpo2: s.avg_spo2,
      bpHistory: {
        systolic: hourlyAverages.map(h => h.avg_systolic_bp),
        diastolic: hourlyAverages.map(h => h.avg_diastolic_bp)
      },
      heartRateHistory: hourlyAverages.map(h => h.avg_heart_rate),
      spo2History: hourlyAverages.map(h => h.avg_spo2),
      totalRecords: s.total_records,
      lastUpdate: s.last_update
    };

    // 如果是今天，附加实时数据
    const today = new Date().toISOString().split('T')[0];
    if (date === today) {
      response.realtime = await exports.getRealtimeData(deviceId);
    }

    res.json({ errcode: 0, msg: '获取数据成功', data: response });

  } catch (err) {
    logger.error('getDailySummary 失败', err);
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

// 获取实时数据（最近几分钟）
exports.getRealtimeData = async (deviceId, minutes = 10) => {
  const cutoffTime = new Date(Date.now() - minutes * 60000);
  const [rows] = await pool.execute(
    `SELECT heart_rate, systolic_bp, diastolic_bp, spo2, timestamp
     FROM processed_health_data
     WHERE device_id = ? AND timestamp >= ?
     ORDER BY timestamp ASC`,
    [deviceId, cutoffTime]
  );

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
    const { deviceId = 'ESP32_001', minutes = 10 } = req.query;
    const data = await exports.getRealtimeData(deviceId, parseInt(minutes));
    res.json({ errcode: 0, msg: '获取实时数据成功', data, lastUpdate: new Date() });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

// 获取可用日期列表
exports.getAvailableDates = async (req, res) => {
  try {
    const { deviceId = 'ESP32_001', limit = 30 } = req.query;
    const [rows] = await pool.execute(
      `SELECT date FROM daily_summary
       WHERE device_id = ?
       ORDER BY date DESC
       LIMIT ?`,
      [deviceId, parseInt(limit)]
    );
    const dates = rows.map(r => r.date);
    res.json({ errcode: 0, msg: '获取日期列表成功', dates });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

// 获取设备状态
exports.getDeviceStatus = async (req, res) => {
  try {
    const { deviceId = 'ESP32_001' } = req.query;
    const today = new Date().toISOString().split('T')[0];

    const [summaryRows] = await pool.execute(
      `SELECT total_records FROM daily_summary WHERE device_id = ? AND date = ?`,
      [deviceId, today]
    );

    const [recentRows] = await pool.execute(
      `SELECT timestamp FROM processed_health_data
       WHERE device_id = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [deviceId]
    );

    const lastUpdate = recentRows.length > 0 ? recentRows[0].timestamp : null;
    const dataDelay = lastUpdate ? Math.round((Date.now() - new Date(lastUpdate).getTime()) / 60000) : null;
    const isConnected = dataDelay !== null && dataDelay < 5;

    res.json({
      errcode: 0,
      msg: '获取设备状态成功',
      data: {
        deviceId,
        lastUpdate,
        dataDelay,
        isConnected,
        todayRecords: summaryRows.length > 0 ? summaryRows[0].total_records : 0,
        todayStatus: summaryRows.length > 0 ? 'active' : 'inactive'
      }
    });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

// 获取历史趋势
exports.getHistoryTrend = async (req, res) => {
  try {
    const { deviceId = 'ESP32_001', startDate, endDate, metric = 'heart_rate' } = req.query;

    let start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 86400000);
    let end = endDate ? new Date(endDate) : new Date();
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const [rows] = await pool.execute(
      `SELECT date, avg_heart_rate, avg_systolic_bp, avg_diastolic_bp, avg_spo2, overall_balance
       FROM daily_summary
       WHERE device_id = ? AND date BETWEEN ? AND ?
       ORDER BY date ASC`,
      [deviceId, startStr, endStr]
    );

    const trendData = rows.map(r => ({
      date: r.date,
      value: getMetricValue(r, metric),
      overall_balance: r.overall_balance
    }));

    res.json({ errcode: 0, msg: '获取历史趋势成功', data: trendData });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

function getMetricValue(row, metric) {
  switch (metric) {
    case 'heart_rate': return row.avg_heart_rate;
    case 'systolic_bp': return row.avg_systolic_bp;
    case 'diastolic_bp': return row.avg_diastolic_bp;
    case 'spo2': return row.avg_spo2;
    case 'overall_balance': return row.overall_balance;
    default: return 0;
  }
}