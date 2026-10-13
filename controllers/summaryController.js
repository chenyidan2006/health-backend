// controllers/summaryController.js
const logger = require('../utils/logger');
const { processDeviceDailyData } = require('../utils/dailySummaryHelper');
const ProcessedDataModel = require('../models/ProcessedDataModel');

// 手动触发每日汇总处理
exports.runDailySummary = async (req, res) => {
  const { date } = req.body;
  const targetDate = date || new Date(Date.now() - 86400000).toISOString().split('T')[0];

  try {
    logger.info(`手动触发每日汇总处理器,日期: ${targetDate}`);

    // 获取该日期所有设备
    const devices = await ProcessedDataModel.getDistinctDeviceIdsByDate(targetDate);

    const results = [];
    for (const deviceId of devices) {
      try {
        const result = await processDeviceDailyData(null, deviceId, targetDate); // 注意 processDeviceDailyData 可能需要 pool 参数,这里传入 null,内部需适配
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