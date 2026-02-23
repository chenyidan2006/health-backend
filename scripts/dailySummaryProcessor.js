#!/usr/bin/env node
//定时任务脚本 scripts/dailySummaryProcessor.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const logger = require('../utils/logger');
const { processDeviceDailyData } = require('../utils/dailySummaryHelper');

async function run() {
  // 默认处理昨天，可通过命令行参数指定日期，如：node dailySummaryProcessor.js 2025-03-20
  let targetDate = process.argv[2];
  if (!targetDate) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    targetDate = yesterday.toISOString().split('T')[0];
  }

  logger.info(`开始执行每日汇总处理器，日期: ${targetDate}`);

  try {
    // 获取该日期所有设备
    const [devices] = await pool.execute(
      `SELECT DISTINCT device_id FROM processed_health_data WHERE date = ?`,
      [targetDate]
    );

    logger.info(`找到 ${devices.length} 个设备的数据`);

    const results = [];
    for (const row of devices) {
      const deviceId = row.device_id;
      try {
        const result = await processDeviceDailyData(pool, deviceId, targetDate);
        results.push({ deviceId, success: true, data: result });
        logger.info(`设备 ${deviceId} 处理成功，记录数: ${result.records}`);
      } catch (err) {
        logger.error(`设备 ${deviceId} 处理失败:`, err.message);
        results.push({ deviceId, success: false, error: err.message });
      }
    }

    // 如果没有设备数据，尝试更新现有未完成的汇总（略，可根据需要实现）
    // ...

    logger.info(`每日汇总处理完成，成功: ${results.filter(r => r.success).length}, 失败: ${results.filter(r => !r.success).length}`);
    process.exit(0);
  } catch (err) {
    logger.error('每日汇总处理器执行失败:', err);
    process.exit(1);
  }
}

run();