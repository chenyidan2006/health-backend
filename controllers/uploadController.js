// controllers/uploadController.js
const pool = require('../config/db');
const logger = require('../utils/logger');

/**
 * 接收处理后的健康数据并存储到 user_health_data 表
 * 请求体示例（推荐 4G 模块用这种，不传 userId）:
 * {
 *   "deviceId": "ESP32_001",
 *   "measureTime": "2025-04-21T10:30:00.000Z",
 *   "heartRate": 72,
 *   "systolicBp": 118,
 *   "diastolicBp": 78,
 *   "spo2": 98
 * }
 */
exports.uploadHealthData = async (req, res) => {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const { deviceId, measureTime, heartRate, systolicBp, diastolicBp, spo2, userId } = req.body;

    // ---------- 1. 参数校验 ----------
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: deviceId',
        request_id: requestId
      });
    }

    if (!measureTime) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: measureTime',
        request_id: requestId
      });
    }

    if (
      heartRate === undefined &&
      systolicBp === undefined &&
      diastolicBp === undefined &&
      spo2 === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: '至少提供一个健康指标(heartRate/systolicBp/diastolicBp/spo2)',
        request_id: requestId
      });
    }

    // 校验时间格式
    const parsedTime = new Date(measureTime);
    if (isNaN(parsedTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'measureTime 格式错误，应为 ISO 8601 字符串',
        request_id: requestId
      });
    }

    // ---------- 2. 确定数据归属的 userId ----------
    let finalUserId = userId;

    // 如果请求没传 userId，就根据 deviceId 查绑定的用户
    if (!finalUserId) {
      const [devRows] = await pool.execute(
        'SELECT user_id FROM user_devices WHERE device_id = ?',
        [deviceId]
      );
      if (devRows.length > 0) {
        finalUserId = devRows[0].user_id;
      }
    }

    if (!finalUserId) {
      logger.warn(`设备未绑定用户, deviceId=${deviceId}, requestId=${requestId}`);
      return res.status(400).json({
        success: false,
        message: '无法确定数据归属（设备未绑定用户），请先在 App 中绑定设备',
        request_id: requestId
      });
    }

    // ---------- 3. 插入数据到 user_health_data ----------
    const insertSql = `
      INSERT INTO user_health_data
      (user_id, device_id, measure_time, heart_rate, systolic_bp, diastolic_bp, spo2, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const params = [
      finalUserId,                                 // ✅ 用 finalUserId，不是 userId
      deviceId,
      parsedTime,                                  // ✅ 用 Date 对象，MySQL 会自动格式化
      heartRate ?? null,
      systolicBp ?? null,
      diastolicBp ?? null,
      spo2 ?? null
    ];

    const [result] = await pool.execute(insertSql, params);

    // Let the APP's device page show that this bound device is actively
    // producing real algorithm results.
    await pool.execute(
      'UPDATE user_devices SET last_active = NOW(), status = 1 WHERE user_id = ? AND device_id = ?',
      [finalUserId, deviceId]
    );

    logger.info(
      `健康数据存储成功, id=${result.insertId}, device=${deviceId}, user=${finalUserId}, requestId=${requestId}`
    );

    // ---------- 4. 返回成功响应 ----------
    res.json({
      success: true,
      message: '数据已存储',
      data: {
        id: result.insertId,
        userId: finalUserId,
        deviceId,
        measureTime: parsedTime.toISOString(),
        heartRate: heartRate ?? null,
        systolicBp: systolicBp ?? null,
        diastolicBp: diastolicBp ?? null,
        spo2: spo2 ?? null
      },
      request_id: requestId,
      processing_time_ms: Date.now() - startTime
    });
  } catch (error) {
    logger.error(`存储健康数据失败, requestId=${requestId}`, error);
    res.status(500).json({
      success: false,
      message: error.message || '服务器内部错误',
      request_id: requestId
    });
  }
};
