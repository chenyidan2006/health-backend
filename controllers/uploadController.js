//D:/code/app/appprogram/health-backend/controllers/uploadController.js
//controllers/uploadController.js（上传处理）
const pool = require('../config/db');
const logger = require('../utils/logger');
const pythonRunner = require('../utils/pythonRunner');
const { calculateHealthScores } = require('../utils/healthScore');
const { updateDailySummary } = require('../utils/dailySummaryHelper');
require('dotenv').config();
const BYPASS_PYTHON = process.env.BYPASS_PYTHON === 'true';

// ----- 输入验证（完整移植自原云函数）-----
function validateInput(body) {
  logger.debug('验证输入数据');

  if (!body || typeof body !== 'object') {
    throw { code: 400, message: '请求数据无效或为空' };
  }

  const { deviceId, timestamp, voltage_values, sampling_rate, duration, metadata, bypassPython, rawDataId } = body;

  if (!voltage_values || !Array.isArray(voltage_values)) {
    throw { code: 400, message: '缺少有效的电压数据 (voltage_values)' };
  }

  const MIN_LENGTH = 100;   // 可配置
  const MAX_LENGTH = 10000; // 可配置
  if (voltage_values.length < MIN_LENGTH) {
    throw { code: 400, message: `电压数据长度不足，至少需要 ${MIN_LENGTH} 个点，当前: ${voltage_values.length}` };
  }
  if (voltage_values.length > MAX_LENGTH) {
    throw { code: 400, message: `电压数据长度过长，最多支持 ${MAX_LENGTH} 个点，当前: ${voltage_values.length}` };
  }

  // 检查电压值范围（抽样前100个）
  for (let i = 0; i < Math.min(voltage_values.length, 100); i++) {
    const val = voltage_values[i];
    if (typeof val !== 'number' || isNaN(val)) {
      throw { code: 400, message: `电压数据包含非数值: 索引 ${i}, 值: ${val}` };
    }
    if (val < 0 || val > 3.3) {
      logger.warn(`电压值超出建议范围: ${val} (0-3.3V)`);
    }
  }

  let finalSamplingRate = sampling_rate || 125;
  if (finalSamplingRate < 50 || finalSamplingRate > 50000) {
    throw { code: 400, message: `采样率无效: ${finalSamplingRate} (范围: 50-500)` };
  }

  const finalDeviceId = deviceId || 'ESP32_001';
  const finalTimestamp = timestamp ? new Date(timestamp) : new Date();
  if (isNaN(finalTimestamp.getTime())) {
    logger.warn('时间戳无效，使用当前时间');
    finalTimestamp = new Date();
  }

  logger.info('输入验证通过', {
    deviceId: finalDeviceId,
    dataLength: voltage_values.length,
    samplingRate: finalSamplingRate,
    timestamp: finalTimestamp.toISOString()
  });

  return {
    deviceId: finalDeviceId,
    timestamp: finalTimestamp,
    voltage_values,
    sampling_rate: finalSamplingRate,
    duration: duration || Math.round(voltage_values.length / finalSamplingRate),
    metadata: metadata || {},
    rawDataId,
    bypassPython: bypassPython || false
  };
}

// 存储处理后的健康数据
async function storeProcessedData(deviceId, timestamp, rawDataId, healthData, requestId) {
  const dateStr = timestamp.toISOString().split('T')[0];
  const [result] = await pool.execute(
    `INSERT INTO processed_health_data
     (device_id, timestamp, raw_data_id, date, hour, minute, second,
      heart_rate, systolic_bp, diastolic_bp, spo2,
      algorithm_used, confidence_score, feature_count, processing_time_ms,
      algorithm_version, parameters, debug_info,
      raw_data_length, raw_sampling_rate, raw_duration,
      request_id, created_at, processing_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [
      deviceId,
      timestamp,
      rawDataId,
      dateStr,
      timestamp.getHours(),
      timestamp.getMinutes(),
      timestamp.getSeconds(),
      healthData.heart_rate,
      healthData.systolic_bp,
      healthData.diastolic_bp,
      healthData.spo2,
      healthData.algorithm || 'python_full',
      healthData.confidence || 0.5,
      healthData.feature_count || 0,
      healthData.processing_time || 0,
      healthData.algorithm_version || '1.0.0',
      healthData.parameters ? JSON.stringify(healthData.parameters) : null,
      healthData.debug_info ? JSON.stringify(healthData.debug_info) : null,
      healthData.raw_data_length || null,
      healthData.raw_sampling_rate || null,
      healthData.raw_duration || null,
      requestId,
      Date.now()
    ]
  );
  return result.insertId;
}

// 主控制器
exports.uploadPulseData = async (req, res) => {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    const validated = validateInput(req.body);
    const { deviceId, timestamp, voltage_values, sampling_rate, duration, metadata, rawDataId, bypassPython } = validated;

    // 1. 存储原始数据
    const [rawInsert] = await pool.execute(
      `INSERT INTO raw_pulse_data
       (device_id, timestamp, voltage_values, sampling_rate, duration, data_length, metadata, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        deviceId,
        timestamp,
        JSON.stringify(voltage_values),
        sampling_rate,
        duration,
        voltage_values.length,
        metadata ? JSON.stringify(metadata) : null,
        requestId
      ]
    );
    const newRawDataId = rawInsert.insertId;
    logger.info(`原始数据存储成功, ID: ${newRawDataId}`);
	// 如果开启了 BYPASS_PYTHON，直接返回模拟数据
	if (BYPASS_PYTHON) {
	  console.log('🚀 BYPASS_PYTHON 已开启，使用模拟数据');
	  const mockHealthData = {
	    heart_rate: 72,
	    systolic_bp: 118,
	    diastolic_bp: 78,
	    spo2: 97,
	    confidence: 0.85,
	    algorithm: 'mock',
	    feature_count: 0,
	    processing_time: 0
	  };
	
	  // 存储处理数据（模拟）
	  const processedId = await storeProcessedData(
	    deviceId,
	    timestamp,
	    newRawDataId,
	    mockHealthData,
	    requestId
	  );
	
	  // 更新原始数据状态
	  await pool.execute(
	    `UPDATE raw_pulse_data SET processed=1, processing_status='success', processed_id=?, updated_at=NOW() WHERE id=?`,
	    [processedId, newRawDataId]
	  );
	
	  // 异步更新每日汇总
	  updateDailySummary(deviceId, timestamp, mockHealthData, newRawDataId, processedId).catch(console.error);
	
	  // 计算评分并返回
	  const scores = require('../utils/healthScore').calculateHealthScores(mockHealthData);
	  return res.json({
	    success: true,
	    timestamp: timestamp.toISOString(),
	    heart_rate: mockHealthData.heart_rate,
	    systolic_bp: mockHealthData.systolic_bp,
	    diastolic_bp: mockHealthData.diastolic_bp,
	    spo2: mockHealthData.spo2,
	    algorithm: 'mock',
	    raw_data_id: newRawDataId,
	    processed_id: processedId,
	    processing_time_ms: Date.now() - startTime,
	    scores
	  });
	}
    // 2. 跳过Python处理（测试用）
    if (bypassPython) {
      const defaultHealth = {
        heart_rate: 75,
        systolic_bp: 120,
        diastolic_bp: 80,
        spo2: 97,
        confidence: 0.3,
        algorithm: 'bypass'
      };
      const processedId = await storeProcessedData(deviceId, timestamp, newRawDataId, defaultHealth, requestId);
      await pool.execute(
        `UPDATE raw_pulse_data SET processed=1, processing_status='bypassed', processed_id=?, updated_at=NOW() WHERE id=?`,
        [processedId, newRawDataId]
      );
      // 异步更新汇总
      updateDailySummary(deviceId, timestamp, defaultHealth, newRawDataId, processedId).catch(err => {
        logger.error('异步更新每日汇总失败', err);
      });

      const scores = calculateHealthScores(defaultHealth);
      return res.json({
        success: true,
        timestamp: timestamp.toISOString(),
        heart_rate: defaultHealth.heart_rate,
        systolic_bp: defaultHealth.systolic_bp,
        diastolic_bp: defaultHealth.diastolic_bp,
        spo2: defaultHealth.spo2,
        algorithm: 'bypass',
        raw_data_id: newRawDataId,
        processed_id: processedId,
        processing_time_ms: Date.now() - startTime,
        scores
      });
    }

    // 3. 执行Python算法
    let pythonResult;
    try {
      pythonResult = await pythonRunner.executeWithRetry({
        voltage_values,
        sampling_rate,
        deviceId,
        rawDataId: newRawDataId,
        timestamp: timestamp.toISOString(),
        requestId,
        metadata
      });
    } catch (pythonErr) {
      await pool.execute(
        `UPDATE raw_pulse_data SET processed=0, processing_status='failed', error_message=?, updated_at=NOW() WHERE id=?`,
        [pythonErr.message, newRawDataId]
      );
      throw pythonErr;
    }

    if (!pythonResult.success) {
      throw new Error(pythonResult.error || 'Python算法返回失败');
    }

    const healthData = pythonResult.data;
    if (!healthData.heart_rate || !healthData.systolic_bp || !healthData.diastolic_bp || !healthData.spo2) {
      throw new Error('Python返回的健康数据不完整');
    }

    // 4. 存储处理结果
    const processedId = await storeProcessedData(deviceId, timestamp, newRawDataId, healthData, requestId);

    // 5. 更新原始数据状态
    await pool.execute(
      `UPDATE raw_pulse_data SET processed=1, processing_status='success', processed_id=?, updated_at=NOW() WHERE id=?`,
      [processedId, newRawDataId]
    );

    // 6. 异步更新每日汇总
    updateDailySummary(deviceId, timestamp, healthData, newRawDataId, processedId).catch(err => {
      logger.error('异步更新每日汇总失败', err);
    });

    // 7. 返回响应
    const scores = calculateHealthScores(healthData);
    res.json({
      success: true,
      timestamp: timestamp.toISOString(),
      heart_rate: healthData.heart_rate,
      systolic_bp: healthData.systolic_bp,
      diastolic_bp: healthData.diastolic_bp,
      spo2: healthData.spo2,
      algorithm: healthData.algorithm || 'python_full',
      confidence: healthData.confidence || 0.5,
      raw_data_id: newRawDataId,
      processed_id: processedId,
      processing_time_ms: Date.now() - startTime,
      python_execution_time: pythonResult.executionTime || 0,
      scores
    });

  } catch (error) {
    logger.error('上传处理失败', error);
    const statusCode = (error.code && typeof error.code === 'number') ? error.code : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || '服务器内部错误',
      request_id: requestId
    });
  }
};