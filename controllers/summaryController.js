//D:/code/app/appprogram/health-backend/controllers/summaryController.js
//controllers/summaryController.js（手动触发每日汇总）
const pool = require('../config/db');
const logger = require('../utils/logger');
const { processDeviceDailyData } = require('../utils/dailySummaryHelper'); // 需要单独实现

// 手动触发每日汇总处理
exports.runDailySummary = async (req, res) => {
  const { date } = req.body;
  const targetDate = date || new Date(Date.now() - 86400000).toISOString().split('T')[0];

  try {
    logger.info(`手动触发每日汇总处理器，日期: ${targetDate}`);

    // 获取该日期所有设备
    const [devices] = await pool.execute(
      `SELECT DISTINCT device_id FROM processed_health_data WHERE date = ?`,
      [targetDate]
    );

    const results = [];
    for (const row of devices) {
      const deviceId = row.device_id;
      try {
        const result = await processDeviceDailyData(pool, deviceId, targetDate);
        results.push({ deviceId, success: true, data: result });
      } catch (e) {
        logger.error(`处理设备 ${deviceId} 失败:`, e);
        results.push({ deviceId, success: false, error: e.message });
      }
    }

    res.json({
      success: true,
      date: targetDate,
      results,
      totalDevices: devices.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};