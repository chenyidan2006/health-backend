const HealthDataModel = require('../models/HealthDataModel');
const logger = require('../utils/logger');

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

function getMetricValue(row, metric) {
  switch (metric) {
    case 'heart_rate': return row.avg_heart_rate ? Math.round(row.avg_heart_rate) : null;
    case 'systolic_bp': return row.avg_systolic_bp ? Math.round(row.avg_systolic_bp) : null;
    case 'diastolic_bp': return row.avg_diastolic_bp ? Math.round(row.avg_diastolic_bp) : null;
    case 'spo2': return row.avg_spo2 ? Math.round(row.avg_spo2) : null;
    default: return null;
  }
}

function generateMockDailySummary(date) {
  const avgHeartRate = Math.floor(65 + Math.random() * 20);
  const avgSystolic = Math.floor(105 + Math.random() * 20);
  const avgDiastolic = Math.floor(65 + Math.random() * 15);
  const avgSpo2 = Math.round(96 + Math.random() * 4 * 10) / 10;
  
  const hourlyAverages = [];
  for (let hour = 0; hour < 24; hour++) {
    hourlyAverages.push({
      hour,
      avg_heart_rate: hour >= 6 && hour <= 22 ? Math.floor(60 + Math.random() * 30) : Math.floor(50 + Math.random() * 20),
      avg_systolic_bp: hour >= 6 && hour <= 22 ? Math.floor(100 + Math.random() * 30) : Math.floor(90 + Math.random() * 20),
      avg_diastolic_bp: hour >= 6 && hour <= 22 ? Math.floor(60 + Math.random() * 25) : Math.floor(55 + Math.random() * 15),
      avg_spo2: Math.round(95 + Math.random() * 5 * 10) / 10
    });
  }

  return {
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
    totalRecords: Math.floor(200 + Math.random() * 100),
    lastUpdate: new Date().toISOString().replace('T', ' ').substr(0, 19)
  };
}

function generateMockHourlyRange(date) {
  const hourlyRange = [];
  for (let hour = 0; hour < 24; hour++) {
    const isDaytime = hour >= 6 && hour <= 22;
    const baseHeart = isDaytime ? 65 : 55;
    const baseSys = isDaytime ? 105 : 95;
    const baseDia = isDaytime ? 65 : 60;
    
    hourlyRange.push({
      hour,
      heart_rate: { 
        min: Math.floor(baseHeart + Math.random() * 10), 
        max: Math.floor(baseHeart + Math.random() * 20 + 10) 
      },
      systolic_bp: { 
        min: Math.floor(baseSys + Math.random() * 10), 
        max: Math.floor(baseSys + Math.random() * 20 + 10) 
      },
      diastolic_bp: { 
        min: Math.floor(baseDia + Math.random() * 8), 
        max: Math.floor(baseDia + Math.random() * 15 + 8) 
      },
      spo2: { 
        min: Math.round((95 + Math.random() * 2) * 10) / 10, 
        max: Math.round((97 + Math.random() * 3) * 10) / 10 
      },
      count: isDaytime ? Math.floor(8 + Math.random() * 6) : Math.floor(2 + Math.random() * 4)
    });
  }
  return hourlyRange;
}

function generateMockRealtimeData() {
  const data = {
    heart_rate: [],
    systolic_bp: [],
    diastolic_bp: [],
    spo2: [],
    timestamps: []
  };
  
  const now = Date.now();
  for (let i = 10; i >= 0; i--) {
    const timestamp = new Date(now - i * 480000);
    data.heart_rate.push(Math.floor(65 + Math.random() * 25));
    data.systolic_bp.push(Math.floor(100 + Math.random() * 25));
    data.diastolic_bp.push(Math.floor(60 + Math.random() * 20));
    data.spo2.push(Math.round((95 + Math.random() * 5) * 10) / 10);
    data.timestamps.push(timestamp.toISOString().replace('T', ' ').substr(0, 19));
  }
  
  return data;
}

function generateMockDeviceStatus(deviceId) {
  return {
    deviceId: deviceId || 'ESP32_001',
    lastUpdate: new Date().toISOString().replace('T', ' ').substr(0, 19),
    dataDelay: Math.floor(Math.random() * 2),
    isConnected: true,
    todayRecords: Math.floor(150 + Math.random() * 100),
    todayStatus: 'active'
  };
}

function generateMockHistoryTrend(startDate, endDate, metric) {
  const trendData = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const metricConfig = {
    heart_rate: { base: 72, variance: 15, trend: (d) => Math.sin(d / 3) * 5 },
    systolic_bp: { base: 118, variance: 12, trend: (d) => Math.cos(d / 2) * 4 },
    diastolic_bp: { base: 76, variance: 8, trend: (d) => Math.sin(d / 4) * 3 },
    spo2: { base: 97.5, variance: 1.5, trend: (d) => Math.cos(d / 5) * 0.5 }
  };
  
  const config = metricConfig[metric] || metricConfig.heart_rate;
  let dayOffset = 0;
  
  while (start <= end) {
    const dateStr = start.toISOString().split('T')[0];
    // 周末因素：周末心率可能稍低
    const weekendFactor = (start.getDay() === 0 || start.getDay() === 6) ? 0.97 : 1.0;
    // 趋势因素：模拟长期趋势
    const trendFactor = config.trend(dayOffset);
    // 随机波动
    const randomFactor = (Math.random() - 0.5) * config.variance * 2;
    
    let value = config.base + trendFactor + randomFactor;
    
    if (metric === 'spo2') {
      value = Math.min(100, Math.max(94, value));
      value = Number(value.toFixed(1));
    } else {
      value = Math.round(value * weekendFactor);
    }
    
    trendData.push({
      date: dateStr,
      value
    });
    
    start.setDate(start.getDate() + 1);
    dayOffset++;
  }
  
  return trendData;
}

function generateMockRangeRecords(startDate, endDate) {
  const records = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  while (start <= end) {
    const dayRecords = Math.floor(80 + Math.random() * 40);
    for (let i = 0; i < dayRecords; i++) {
      const hour = Math.floor(Math.random() * 24);
      const minute = Math.floor(Math.random() * 60);
      const second = Math.floor(Math.random() * 60);
      
      const timestamp = new Date(start);
      timestamp.setHours(hour, minute, second);
      
      records.push({
        heart_rate: Math.floor(55 + Math.random() * 35),
        systolic_bp: Math.floor(90 + Math.random() * 40),
        diastolic_bp: Math.floor(60 + Math.random() * 25),
        spo2: Math.round((95 + Math.random() * 5) * 10) / 10,
        timestamp: timestamp.toISOString().replace('T', ' ').substr(0, 19)
      });
    }
    start.setDate(start.getDate() + 1);
  }
  
  return records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

exports.getDailySummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, date } = req.query;
    
    if (!date) return res.status(400).json({ errcode: 400, msg: '缺少日期参数' });
    const rows = await HealthDataModel.findByUserAndDate(userId, date, deviceId);
    
    if (rows.length === 0) {
      return res.json({ errcode: 0, msg: '该日期暂无真实数据', data: getEmptySummary(date) });
    }
    
    let totalHeart = 0, totalSys = 0, totalDia = 0, totalSpo2 = 0;
    let heartCount = 0, sysCount = 0, diaCount = 0, spo2Count = 0;
    
    rows.forEach(row => {
      if (row.heart_rate !== null && row.heart_rate !== undefined) {
        totalHeart += row.heart_rate;
        heartCount++;
      }
      if (row.systolic_bp !== null && row.systolic_bp !== undefined) {
        totalSys += row.systolic_bp;
        sysCount++;
      }
      if (row.diastolic_bp !== null && row.diastolic_bp !== undefined) {
        totalDia += row.diastolic_bp;
        diaCount++;
      }
      if (row.spo2 !== null && row.spo2 !== undefined) {
        totalSpo2 += row.spo2;
        spo2Count++;
      }
    });
    
    const avgHeartRate = heartCount ? Math.round(totalHeart / heartCount) : null;
    const avgSystolic = sysCount ? Math.round(totalSys / sysCount) : null;
    const avgDiastolic = diaCount ? Math.round(totalDia / diaCount) : null;
    const avgSpo2 = spo2Count ? Math.round(totalSpo2 / spo2Count) : null;
    
    const hourlyAverages = [];
    for (let hour = 0; hour < 24; hour++) {
      hourlyAverages.push({
        hour,
        avg_heart_rate: null,
        avg_systolic_bp: null,
        avg_diastolic_bp: null,
        avg_spo2: null
      });
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
      bpHistory: { systolic: hourlyAverages.map(h => h.avg_systolic_bp), diastolic: hourlyAverages.map(h => h.avg_diastolic_bp) },
      heartRateHistory: hourlyAverages.map(h => h.avg_heart_rate),
      spo2History: hourlyAverages.map(h => h.avg_spo2),
      totalRecords: rows.length,
      lastUpdate: rows.length ? rows[rows.length-1].timestamp : null
    };
    
    res.json({ errcode: 0, msg: '获取数据成功', data: response });
  } catch (err) {
    console.error('getDailySummary 失败', err);
    res.status(500).json({ errcode: 500, msg: '读取真实数据失败' });
  }
};

exports.getHourlyRange = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, date } = req.query;
    
    if (!date) return res.status(400).json({ errcode: 400, msg: '缺少日期参数' });
    const rows = await HealthDataModel.getHourlyRange(userId, date, deviceId);
    
    if (rows.length === 0) {
      return res.json({ errcode: 0, msg: '该日期暂无真实数据', data: generateEmptyHourlyRange() });
    }
    
    const hourlyMap = {};
    for (let hour = 0; hour < 24; hour++) hourlyMap[hour] = { heart: [], sys: [], dia: [], spo2: [] };
    
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
        heart_rate: { min: data.heart.length ? Math.min(...data.heart) : null, max: data.heart.length ? Math.max(...data.heart) : null },
        systolic_bp: { min: data.sys.length ? Math.min(...data.sys) : null, max: data.sys.length ? Math.max(...data.sys) : null },
        diastolic_bp: { min: data.dia.length ? Math.min(...data.dia) : null, max: data.dia.length ? Math.max(...data.dia) : null },
        spo2: { min: data.spo2.length ? Math.min(...data.spo2) : null, max: data.spo2.length ? Math.max(...data.spo2) : null },
        count: data.heart.length
      });
    }
    
    res.json({ errcode: 0, msg: '获取每小时极值成功', data: hourlyRange });
  } catch (err) {
    console.error('getHourlyRange 异常:', err);
    res.status(500).json({ errcode: 500, msg: '读取真实数据失败' });
  }
};

exports.getRealtimeDataHandler = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, minutes = 10 } = req.query;
    
    const rows = await HealthDataModel.getRealtimeData(userId, deviceId, parseInt(minutes));
    
    if (rows.length === 0) {
      return res.json({ errcode: 0, msg: '暂无最近真实数据', data: null, lastUpdate: null });
    }

    const row = rows[rows.length - 1];
    res.json({
      errcode: 0,
      msg: '获取实时数据成功',
      data: {
        heart_rate: row.heart_rate,
        systolic_bp: row.systolic_bp,
        diastolic_bp: row.diastolic_bp,
        spo2: row.spo2,
        measure_time: row.timestamp
      },
      lastUpdate: row.timestamp
    });
  } catch (err) {
    console.error('getRealtimeDataHandler 异常:', err);
    res.status(500).json({ errcode: 500, msg: '读取真实数据失败' });
  }
};

exports.getAvailableDates = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, limit = 30 } = req.query;
    const dates = await HealthDataModel.getAvailableDates(userId, deviceId, parseInt(limit));
    res.json({ errcode: 0, msg: '获取日期列表成功', dates });
  } catch (err) {
    res.status(500).json({ errcode: 500, msg: err.message });
  }
};

exports.getDeviceStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId } = req.query;
    
    const lastUpdate = await HealthDataModel.getLatestRecordTime(userId, deviceId);
    const today = new Date().toISOString().split('T')[0];
    const todayRecords = await HealthDataModel.getTodayRecordCount(userId, today, deviceId);
    const dataDelay = lastUpdate ? Math.round((Date.now() - new Date(lastUpdate).getTime()) / 60000) : null;
    const isConnected = dataDelay !== null && dataDelay < 5;
    
    if (!lastUpdate) {
      return res.json({ errcode: 0, msg: '暂无设备数据', data: { deviceId: deviceId || null, lastUpdate: null, dataDelay: null, isConnected: false, todayRecords: 0, todayStatus: 'inactive' } });
    }
    
    res.json({
      errcode: 0,
      msg: '获取设备状态成功',
      data: {
        deviceId: deviceId || 'unknown',
        lastUpdate,
        dataDelay,
        isConnected,
        todayRecords,
        todayStatus: todayRecords > 0 ? 'active' : 'inactive'
      }
    });
  } catch (err) {
    console.error('getDeviceStatus 异常:', err);
    res.status(500).json({ errcode: 500, msg: '读取设备状态失败' });
  }
};

exports.getHistoryTrend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, startDate, endDate, metric = 'heart_rate' } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ errcode: 400, msg: '缺少起始或结束日期' });
    }
    
    const rows = await HealthDataModel.getHistoryTrend(userId, startDate, endDate, deviceId, metric);
    
    if (rows.length === 0) return res.json({ errcode: 0, data: [] });
    
    const trendData = rows.map(row => ({
      date: row.date,
      value: row.value != null ? Math.round(row.value) : null
    }));
    
    res.json({ errcode: 0, data: trendData });
  } catch (err) {
    console.error('getHistoryTrend error:', err);
    res.status(500).json({ errcode: 500, msg: '读取真实趋势失败' });
  }
};

exports.getRangeRecords = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deviceId, startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ errcode: 400, msg: '缺少起始或结束日期' });
    }
    
    const rows = await HealthDataModel.getRangeRecords(userId, startDate, endDate, deviceId);
    
    if (rows.length === 0) return res.json({ errcode: 0, data: [] });
    
    res.json({ errcode: 0, data: rows });
  } catch (err) {
    console.error('getRangeRecords error:', err);
    res.status(500).json({ errcode: 500, msg: '读取真实记录失败' });
  }
};
