// routes/ai.js - AI 建议与记忆相关路由
// 版本：2026-10-10.1
//
// 相对改造前的变化：
//   1) 用户档案不再只取 birthday —— 昵称/性别/身高/体重/BMI 一并读出来（memoryService.getUserProfile）
//   2) 注入长期记忆与近 7/30 天趋势（memoryService.loadAdviceContext）
//   3) 真正使用前端传来的 language（改造前后端直接丢弃）
//   4) 返回体新增 usedFallback / promptVersion / usage，前端可以明确标注"这是 AI 还是本地兜底"
//   5) 每次生成写一条 ai_advice_log，便于成本核算与效果对比
//   6) 新增记忆的查看 / 新增 / 删除，以及建议反馈
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { generateHealthAdvice } = require('../services/aiService');
const memoryService = require('../services/memoryService');
const pool = require('../config/db');
const logger = require('../utils/logger');

/**
 * 获取 AI 健康建议
 * POST /api/ai/health-advice
 * 请求体: { deviceId, date?, language?, wellness? }
 */
router.post('/health-advice', authMiddleware, async (req, res) => {
  try {
    const { deviceId, language, wellness } = req.body || {};
    const userId = req.user.id;

    if (!deviceId) {
      return res.json({ errcode: 1, msg: '缺少设备ID' });
    }

    // 1) 上下文：完整用户档案 + 长期记忆 + 近期趋势
    const context = await memoryService.loadAdviceContext(userId, deviceId);
    context.language = language || 'zh';
    context.wellness = sanitizeWellness(wellness);
    const actualAge = Number.isFinite(context.profile.age) ? context.profile.age : 30;

    // 2) 始终读取这个用户、这个设备最新的一条数据库记录。
    // 不按日期过滤，也不区分模型结果或兜底结果；只要已经写库就是有效的最新数据。
    const [rows] = await pool.execute(
      `SELECT
         id,
         heart_rate          AS avg_heart_rate,
         systolic_bp         AS avg_systolic_bp,
         diastolic_bp        AS avg_diastolic_bp,
         spo2                AS avg_spo2,
         DATE_FORMAT(measure_time, '%Y-%m-%d') AS measurement_date,
         DATE_FORMAT(measure_time, '%Y-%m-%d %H:%i:%s') AS measurement_time
       FROM user_health_data
       WHERE user_id = ? AND device_id = ?
       ORDER BY measure_time DESC, id DESC
       LIMIT 1`,
      [userId, deviceId]
    );

    if (!rows[0]) {
      return res.json({ errcode: 1, msg: '还没有可分析的健康测量数据' });
    }

    const latestRow = rows[0];
    const targetDate = latestRow.measurement_date;
    const measurementTime = latestRow.measurement_time;

    // 3) 组装 healthData
    const healthData = {
      avg_heart_rate: latestRow.avg_heart_rate == null ? null : Number(latestRow.avg_heart_rate),
      avg_systolic_bp: latestRow.avg_systolic_bp == null ? null : Number(latestRow.avg_systolic_bp),
      avg_diastolic_bp: latestRow.avg_diastolic_bp == null ? null : Number(latestRow.avg_diastolic_bp),
      avg_spo2: latestRow.avg_spo2 == null ? null : Number(latestRow.avg_spo2),
      date: targetDate,
      measurementTime,
      actualAge,
      language: context.language
    };
    context.measurementDate = targetDate;
    context.measurementTime = measurementTime;
    context.usedLatestMeasurement = true;

    // 4) 调用 AI
    logger.info(`Generating AI advice for user=${userId}, device=${deviceId}, date=${targetDate}`);
    const advice = await generateHealthAdvice(healthData, context);

    if (advice.usedFallback) {
      logger.warn(`AI advice fell back to local rules for user=${userId}: ${advice.fallbackReason || 'unknown'}`);
    }

    // 5) 留痕（失败不影响主流程）
    const adviceId = await memoryService.logAdvice({
      userId,
      kind: 'report',
      inputSnapshot: {
        deviceId,
        date: targetDate,
        measurementId: latestRow.id,
        measurementTime,
        usedLatestMeasurement: context.usedLatestMeasurement,
        wellness: context.wellness,
        healthData: { ...healthData },
        profile: context.profile,
        memoryKeys: (context.memories || []).map((m) => m.key_name),
        trendWindows: (context.trend && context.trend.windows ? context.trend.windows : []).map((w) => w.days)
      },
      output: advice,
      model: advice.model,
      promptVersion: advice.promptVersion,
      usedFallback: advice.usedFallback
    });

    // 6) 记忆被用到就打点，便于将来做"新鲜度"排序
    if (context.memories && context.memories.length) {
      memoryService.touchMemories(userId, context.memories.map((m) => m.key_name)).catch(() => {});
    }

    res.json({
      errcode: 0,
      msg: 'success',
      data: {
        deviceId,
        date: targetDate,
        measurementId: latestRow.id,
        measurementTime,
        usedLatestMeasurement: context.usedLatestMeasurement,
        adviceId,
        // 显式告诉前端这次是 AI 生成还是本地兜底 —— 终结"静默兜底"
        usedFallback: Boolean(advice.usedFallback),
        promptVersion: advice.promptVersion || null,
        model: advice.model || null,
        usage: advice.usage || null,
        healthData: {
          avg_heart_rate: healthData.avg_heart_rate,
          avg_systolic_bp: healthData.avg_systolic_bp,
          avg_diastolic_bp: healthData.avg_diastolic_bp,
          avg_spo2: healthData.avg_spo2,
          actualAge
        },
        advice,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('AI advice error:', error);
    res.json({ errcode: 1, msg: '生成建议失败: ' + error.message });
  }
});

function boundedNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
}

function sanitizeWellness(value) {
  const input = value && typeof value === 'object' ? value : {};
  const quality = ['Poor', 'Fair', 'Good', 'Excellent'].includes(input.sleepQuality)
    ? input.sleepQuality
    : null;
  return {
    waterMl: boundedNumber(input.waterMl, 0, 10000),
    caffeineMg: boundedNumber(input.caffeineMg, 0, 2000),
    sleepMinutes: boundedNumber(input.sleepMinutes, 0, 1440),
    sleepQuality: quality,
    meals: boundedNumber(input.meals, 0, 15),
    vegetables: boundedNumber(input.vegetables, 0, 20),
    fruits: boundedNumber(input.fruits, 0, 20),
    steps: boundedNumber(input.steps, 0, 100000),
    exerciseMinutes: boundedNumber(input.exerciseMinutes, 0, 1440)
  };
}

/**
 * 建议反馈
 * POST /api/ai/advice/:id/feedback  body: { feedback: 1 | 0 }
 */
router.post('/advice/:id/feedback', authMiddleware, async (req, res) => {
  try {
    const result = await memoryService.setAdviceFeedback(
      req.user.id,
      req.params.id,
      req.body ? req.body.feedback : null
    );
    if (!result.ok) return res.json({ errcode: 1, msg: '反馈保存失败', data: result });
    res.json({ errcode: 0, msg: '感谢反馈' });
  } catch (error) {
    logger.error('AI advice feedback error:', error);
    res.json({ errcode: 1, msg: '反馈保存失败' });
  }
});

/**
 * 长期记忆：查看
 * GET /api/ai/memory
 */
router.get('/memory', authMiddleware, async (req, res) => {
  try {
    const list = await memoryService.listMemories(req.user.id);
    res.json({ errcode: 0, msg: 'success', data: list, ready: await memoryService.tablesReady() });
  } catch (error) {
    logger.error('AI memory list error:', error);
    res.json({ errcode: 1, msg: '读取记忆失败' });
  }
});

/**
 * 长期记忆：新增 / 更新
 * POST /api/ai/memory  body: { kind, keyName, value, confidence? }
 */
router.post('/memory', authMiddleware, async (req, res) => {
  try {
    const { kind, keyName, value, confidence } = req.body || {};
    const result = await memoryService.upsertMemory(req.user.id, {
      kind,
      keyName,
      value,
      source: 'user',
      confidence: Number(confidence) || 100
    });
    if (!result.ok) {
      const msg = result.reason === 'tables_missing'
        ? '记忆功能尚未初始化，请先执行数据库迁移'
        : '记忆内容无效';
      return res.json({ errcode: 1, msg });
    }
    res.json({ errcode: 0, msg: '已记住' });
  } catch (error) {
    logger.error('AI memory upsert error:', error);
    res.json({ errcode: 1, msg: '保存记忆失败' });
  }
});

/**
 * 长期记忆：删除
 * DELETE /api/ai/memory/:id
 */
router.delete('/memory/:id', authMiddleware, async (req, res) => {
  try {
    const result = await memoryService.deleteMemory(req.user.id, req.params.id);
    if (!result.ok) return res.json({ errcode: 1, msg: '删除失败或记录不存在' });
    res.json({ errcode: 0, msg: '已删除' });
  } catch (error) {
    logger.error('AI memory delete error:', error);
    res.json({ errcode: 1, msg: '删除记忆失败' });
  }
});

module.exports = router;
