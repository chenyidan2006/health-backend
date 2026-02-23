//utils/dailySummaryHelper.js（每日汇总更新核心逻辑）
const pool = require('../config/db');
const { calculateHealthScores } = require('./healthScore');

/**
 * 更新或创建每日汇总
 * @param {string} deviceId 设备ID
 * @param {Date} timestamp 数据时间戳
 * @param {Object} healthData 健康数据 {heart_rate, systolic_bp, diastolic_bp, spo2}
 * @param {number} rawDataId 原始数据ID
 * @param {number} processedId 处理数据ID
 */
async function updateDailySummary(deviceId, timestamp, healthData, rawDataId, processedId) {
  const date = timestamp.toISOString().split('T')[0];
  const hour = timestamp.getHours();

  // 1. 查询当天是否存在汇总
  const [summaryRows] = await pool.execute(
    `SELECT * FROM daily_summary WHERE device_id = ? AND date = ?`,
    [deviceId, date]
  );

  if (summaryRows.length === 0) {
    // 创建新的每日汇总
    await createNewDailySummary(deviceId, date, hour, healthData, timestamp);
  } else {
    // 更新现有汇总
    await updateExistingDailySummary(summaryRows[0], hour, healthData, timestamp);
  }
}

async function createNewDailySummary(deviceId, date, hour, healthData, timestamp) {
  // 初始化24小时数据
  const hourlyData = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    total_heart_rate: 0,
    total_systolic_bp: 0,
    total_diastolic_bp: 0,
    total_spo2: 0,
    count: 0,
    avg_heart_rate: 0,
    avg_systolic_bp: 0,
    avg_diastolic_bp: 0,
    avg_spo2: 0
  }));

  // 更新当前小时
  hourlyData[hour] = {
    hour,
    total_heart_rate: healthData.heart_rate,
    total_systolic_bp: healthData.systolic_bp,
    total_diastolic_bp: healthData.diastolic_bp,
    total_spo2: healthData.spo2,
    count: 1,
    avg_heart_rate: healthData.heart_rate,
    avg_systolic_bp: healthData.systolic_bp,
    avg_diastolic_bp: healthData.diastolic_bp,
    avg_spo2: healthData.spo2
  };

  const scores = calculateHealthScores(healthData);

  await pool.execute(
    `INSERT INTO daily_summary (
      device_id, date,
      avg_heart_rate, avg_systolic_bp, avg_diastolic_bp, avg_spo2,
      overall_balance, vital_signs_score, activity_level_score, relaxation_state_score,
      hourly_data, total_records, first_record, last_record, last_update
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deviceId, date,
      healthData.heart_rate,
      healthData.systolic_bp,
      healthData.diastolic_bp,
      healthData.spo2,
      scores.overall_balance,
      scores.vital_signs,
      scores.activity_level,
      scores.relaxation_state,
      JSON.stringify(hourlyData),
      1,
      timestamp,
      timestamp,
      timestamp
    ]
  );
}

async function updateExistingDailySummary(summary, hour, healthData, timestamp) {
  // 解析已有 hourly_data
  let hourlyData = typeof summary.hourly_data === 'string'
    ? JSON.parse(summary.hourly_data)
    : summary.hourly_data;

  // 确保数组存在
  if (!hourlyData || !Array.isArray(hourlyData)) {
    hourlyData = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      total_heart_rate: 0,
      total_systolic_bp: 0,
      total_diastolic_bp: 0,
      total_spo2: 0,
      count: 0,
      avg_heart_rate: 0,
      avg_systolic_bp: 0,
      avg_diastolic_bp: 0,
      avg_spo2: 0
    }));
  }

  const currentHour = hourlyData[hour];
  currentHour.total_heart_rate += healthData.heart_rate;
  currentHour.total_systolic_bp += healthData.systolic_bp;
  currentHour.total_diastolic_bp += healthData.diastolic_bp;
  currentHour.total_spo2 += healthData.spo2;
  currentHour.count += 1;
  currentHour.avg_heart_rate = currentHour.total_heart_rate / currentHour.count;
  currentHour.avg_systolic_bp = currentHour.total_systolic_bp / currentHour.count;
  currentHour.avg_diastolic_bp = currentHour.total_diastolic_bp / currentHour.count;
  currentHour.avg_spo2 = currentHour.total_spo2 / currentHour.count;

  const totalRecords = summary.total_records + 1;
  const newAvgHeartRate = (summary.avg_heart_rate * summary.total_records + healthData.heart_rate) / totalRecords;
  const newAvgSystolic = (summary.avg_systolic_bp * summary.total_records + healthData.systolic_bp) / totalRecords;
  const newAvgDiastolic = (summary.avg_diastolic_bp * summary.total_records + healthData.diastolic_bp) / totalRecords;
  const newAvgSpO2 = (summary.avg_spo2 * summary.total_records + healthData.spo2) / totalRecords;

  const newAvgHealthData = {
    heart_rate: newAvgHeartRate,
    systolic_bp: newAvgSystolic,
    diastolic_bp: newAvgDiastolic,
    spo2: newAvgSpO2
  };
  const newScores = calculateHealthScores(newAvgHealthData);

  await pool.execute(
    `UPDATE daily_summary SET
      avg_heart_rate = ?, avg_systolic_bp = ?, avg_diastolic_bp = ?, avg_spo2 = ?,
      overall_balance = ?, vital_signs_score = ?, activity_level_score = ?, relaxation_state_score = ?,
      hourly_data = ?, total_records = ?, last_record = ?, last_update = ?
     WHERE id = ?`,
    [
      newAvgHeartRate, newAvgSystolic, newAvgDiastolic, newAvgSpO2,
      newScores.overall_balance, newScores.vital_signs, newScores.activity_level, newScores.relaxation_state,
      JSON.stringify(hourlyData),
      totalRecords,
      timestamp,
      timestamp,
      summary.id
    ]
  );
}
/**
 * 处理单个设备的每日数据（用于定时任务或手动触发）
 */
async function processDeviceDailyData(pool, deviceId, date) {
  // 1. 获取该设备当天的所有处理数据
  const [healthRows] = await pool.execute(
    `SELECT heart_rate, systolic_bp, diastolic_bp, spo2, timestamp
     FROM processed_health_data
     WHERE device_id = ? AND date = ?
     ORDER BY timestamp ASC`,
    [deviceId, date]
  );

  if (healthRows.length === 0) {
    throw new Error('该设备当天没有数据');
  }

  // 2. 计算每小时统计数据（复用原有逻辑）
  const hourlyStats = calculateHourlyStatistics(healthRows);
  // 3. 计算全天统计数据
  const dailyStats = calculateDailyStatistics(healthRows);
  // 4. 计算每日评分
  const dailyScores = calculateHealthScores(dailyStats);

  // 5. 准备汇总数据
  const summaryData = {
    deviceId,
    date,
    avg_heart_rate: dailyStats.avg_heart_rate,
    avg_systolic_bp: dailyStats.avg_systolic_bp,
    avg_diastolic_bp: dailyStats.avg_diastolic_bp,
    avg_spo2: dailyStats.avg_spo2,
    min_heart_rate: dailyStats.min_heart_rate,
    max_heart_rate: dailyStats.max_heart_rate,
    min_systolic_bp: dailyStats.min_systolic_bp,
    max_systolic_bp: dailyStats.max_systolic_bp,
    min_diastolic_bp: dailyStats.min_diastolic_bp,
    max_diastolic_bp: dailyStats.max_diastolic_bp,
    min_spo2: dailyStats.min_spo2,
    max_spo2: dailyStats.max_spo2,
    overall_balance: dailyScores.overall_balance,
    vital_signs_score: dailyScores.vital_signs,
    activity_level_score: dailyScores.activity_level,
    relaxation_state_score: dailyScores.relaxation_state,
    hourly_data: JSON.stringify(hourlyStats),
    total_records: healthRows.length,
    first_record: healthRows[0].timestamp,
    last_record: healthRows[healthRows.length - 1].timestamp,
    last_update: new Date(),
    processing_completed: true
  };

  // 6. 检查是否存在汇总记录
  const [existing] = await pool.execute(
    `SELECT id FROM daily_summary WHERE device_id = ? AND date = ?`,
    [deviceId, date]
  );

  if (existing.length > 0) {
    // 更新
    await pool.execute(
      `UPDATE daily_summary SET
        avg_heart_rate = ?, avg_systolic_bp = ?, avg_diastolic_bp = ?, avg_spo2 = ?,
        min_heart_rate = ?, max_heart_rate = ?, min_systolic_bp = ?, max_systolic_bp = ?,
        min_diastolic_bp = ?, max_diastolic_bp = ?, min_spo2 = ?, max_spo2 = ?,
        overall_balance = ?, vital_signs_score = ?, activity_level_score = ?, relaxation_state_score = ?,
        hourly_data = ?, total_records = ?, first_record = ?, last_record = ?, last_update = ?
      WHERE device_id = ? AND date = ?`,
      [
        summaryData.avg_heart_rate, summaryData.avg_systolic_bp, summaryData.avg_diastolic_bp, summaryData.avg_spo2,
        summaryData.min_heart_rate, summaryData.max_heart_rate, summaryData.min_systolic_bp, summaryData.max_systolic_bp,
        summaryData.min_diastolic_bp, summaryData.max_diastolic_bp, summaryData.min_spo2, summaryData.max_spo2,
        summaryData.overall_balance, summaryData.vital_signs_score, summaryData.activity_level_score, summaryData.relaxation_state_score,
        summaryData.hourly_data, summaryData.total_records, summaryData.first_record, summaryData.last_record, summaryData.last_update,
        deviceId, date
      ]
    );
  } else {
    // 插入
    await pool.execute(
      `INSERT INTO daily_summary (
        device_id, date,
        avg_heart_rate, avg_systolic_bp, avg_diastolic_bp, avg_spo2,
        min_heart_rate, max_heart_rate, min_systolic_bp, max_systolic_bp,
        min_diastolic_bp, max_diastolic_bp, min_spo2, max_spo2,
        overall_balance, vital_signs_score, activity_level_score, relaxation_state_score,
        hourly_data, total_records, first_record, last_record, last_update, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        deviceId, date,
        summaryData.avg_heart_rate, summaryData.avg_systolic_bp, summaryData.avg_diastolic_bp, summaryData.avg_spo2,
        summaryData.min_heart_rate, summaryData.max_heart_rate, summaryData.min_systolic_bp, summaryData.max_systolic_bp,
        summaryData.min_diastolic_bp, summaryData.max_diastolic_bp, summaryData.min_spo2, summaryData.max_spo2,
        summaryData.overall_balance, summaryData.vital_signs_score, summaryData.activity_level_score, summaryData.relaxation_state_score,
        summaryData.hourly_data, summaryData.total_records, summaryData.first_record, summaryData.last_record, summaryData.last_update
      ]
    );
  }

  return {
    records: healthRows.length,
    stats: dailyStats,
    scores: dailyScores,
    hourlyCount: hourlyStats.length
  };
}

// 计算每小时统计数据（直接复制自原云函数）
function calculateHourlyStatistics(data) {
  const hourlyMap = {};
  for (let hour = 0; hour < 24; hour++) {
    hourlyMap[hour] = {
      hour,
      heart_rates: [],
      systolic_bps: [],
      diastolic_bps: [],
      spo2s: [],
      count: 0
    };
  }

  data.forEach(item => {
    const hour = new Date(item.timestamp).getHours();
    const stats = hourlyMap[hour];
    stats.heart_rates.push(item.heart_rate || 0);
    stats.systolic_bps.push(item.systolic_bp || 0);
    stats.diastolic_bps.push(item.diastolic_bp || 0);
    stats.spo2s.push(item.spo2 || 0);
    stats.count++;
  });

  const hourlyStats = [];
  for (let hour = 0; hour < 24; hour++) {
    const stats = hourlyMap[hour];
    const avg_heart_rate = stats.count > 0 ? stats.heart_rates.reduce((s, v) => s + v, 0) / stats.count : 0;
    const avg_systolic_bp = stats.count > 0 ? stats.systolic_bps.reduce((s, v) => s + v, 0) / stats.count : 0;
    const avg_diastolic_bp = stats.count > 0 ? stats.diastolic_bps.reduce((s, v) => s + v, 0) / stats.count : 0;
    const avg_spo2 = stats.count > 0 ? stats.spo2s.reduce((s, v) => s + v, 0) / stats.count : 0;

    hourlyStats.push({
      hour,
      avg_heart_rate: Math.round(avg_heart_rate * 10) / 10,
      avg_systolic_bp: Math.round(avg_systolic_bp * 10) / 10,
      avg_diastolic_bp: Math.round(avg_diastolic_bp * 10) / 10,
      avg_spo2: Math.round(avg_spo2 * 10) / 10,
      count: stats.count,
      time_range: `${hour.toString().padStart(2, '0')}:00-${(hour + 1).toString().padStart(2, '0')}:00`
    });
  }
  return hourlyStats;
}

// 计算每日统计数据
function calculateDailyStatistics(data) {
  const heart_rates = [], systolic_bps = [], diastolic_bps = [], spo2s = [];
  data.forEach(item => {
    if (item.heart_rate) heart_rates.push(item.heart_rate);
    if (item.systolic_bp) systolic_bps.push(item.systolic_bp);
    if (item.diastolic_bp) diastolic_bps.push(item.diastolic_bp);
    if (item.spo2) spo2s.push(item.spo2);
  });

  const calc = (arr) => {
    if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      avg: sum / arr.length,
      min: Math.min(...arr),
      max: Math.max(...arr)
    };
  };

  const hr = calc(heart_rates);
  const sys = calc(systolic_bps);
  const dia = calc(diastolic_bps);
  const spo2 = calc(spo2s);

  return {
    avg_heart_rate: Math.round(hr.avg * 10) / 10,
    avg_systolic_bp: Math.round(sys.avg * 10) / 10,
    avg_diastolic_bp: Math.round(dia.avg * 10) / 10,
    avg_spo2: Math.round(spo2.avg * 10) / 10,
    min_heart_rate: Math.round(hr.min),
    max_heart_rate: Math.round(hr.max),
    min_systolic_bp: Math.round(sys.min),
    max_systolic_bp: Math.round(sys.max),
    min_diastolic_bp: Math.round(dia.min),
    max_diastolic_bp: Math.round(dia.max),
    min_spo2: Math.round(spo2.min),
    max_spo2: Math.round(spo2.max)
  };
}

// 记得导出
module.exports = {
  updateDailySummary,
  processDeviceDailyData
};
