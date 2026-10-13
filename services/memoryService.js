// services/memoryService.js
// 版本：2026-10-10.1
//
// 记忆服务的唯一职责：把"这个人是谁、经历过什么、最近在变好还是变差"读出来，
// 组装成可以稳定放进提示词的结构；以及把 AI 的建议写回日志。
//
// 两个刻意的设计：
//   1) 全部函数在表不存在时【优雅降级】—— 读返回空、写静默跳过。
//      这样"先发代码、后跑迁移"不会让 AI 功能整体挂掉。
//   2) 读记忆的排序是【确定性】的（kind -> confidence -> key_name），
//      同一用户同一天内反复调用产出完全相同的文本，才能命中 DeepSeek 的前缀缓存。
const pool = require('../config/db');
const logger = require('../utils/logger');
const cfg = require('../config/aiConfig');

// 表是否已就绪：只探测一次，避免每次请求都查 information_schema
let tablesReadyCache = null;
let degradedWarned = false;

async function tablesReady() {
  if (tablesReadyCache !== null) return tablesReadyCache;
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('user_memory','ai_advice_log','ai_chat_sessions','ai_chat_messages')`
    );
    tablesReadyCache = Number(rows[0] && rows[0].n) >= 4;
  } catch (error) {
    tablesReadyCache = false;
  }
  if (!tablesReadyCache && !degradedWarned) {
    degradedWarned = true;
    logger.warn('AI 记忆表尚未创建，记忆功能暂时降级（请先执行 20261011_ai_chat_memory.sql）');
  }
  return tablesReadyCache;
}

function warnOnce(action, error) {
  if (!degradedWarned) {
    degradedWarned = true;
    logger.warn(`AI 记忆功能降级(${action})：${error.message}`);
  }
}

function toNumber(value) {
  // mysql2 对 DECIMAL 类型返回字符串，必须显式转换
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------- 用户档案

function calcAge(birthday) {
  if (!birthday) return null;
  const birth = new Date(birthday);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

/**
 * 完整用户档案。
 * 注意：改造前 routes/ai.js 只取了 birthday，gender/height/weight/nickname 全部浪费了。
 */
async function getUserProfile(userId) {
  try {
    const [rows] = await pool.execute(
      'SELECT id, nickname, gender, birthday, height, weight FROM users WHERE id = ?',
      [userId]
    );
    if (!rows.length) return { userId };
    const row = rows[0];
    const heightCm = toNumber(row.height);
    const weightKg = toNumber(row.weight);
    let bmi = null;
    if (Number.isFinite(heightCm) && Number.isFinite(weightKg) && heightCm > 0) {
      const meters = heightCm / 100;
      bmi = Number((weightKg / (meters * meters)).toFixed(1));
    }
    return {
      userId,
      nickname: row.nickname || null,
      gender: row.gender === null || row.gender === undefined ? null : Number(row.gender),
      birthday: row.birthday || null,
      age: calcAge(row.birthday),
      heightCm,
      weightKg,
      bmi
    };
  } catch (error) {
    warnOnce('getUserProfile', error);
    return { userId };
  }
}

// ---------------------------------------------------------------- 长期记忆

/**
 * 读取要注入提示词的长期记忆。
 * 排序固定：kind 优先级 -> confidence 降序 -> key_name 升序。
 * 这个排序【不能改】，否则前缀每次都变，DeepSeek 缓存全废。
 */
async function getMemories(userId, options = {}) {
  if (!(await tablesReady())) return [];
  const rawLimit = Number.isFinite(options.limit) ? options.limit : cfg.memoryLimit;
  const limit = Math.max(1, Math.min(50, Math.trunc(rawLimit) || cfg.memoryLimit));
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : cfg.memoryMaxChars;
  try {
    const [rows] = await pool.execute(
      `SELECT kind, key_name, value, confidence
         FROM user_memory
        WHERE user_id = ?
        ORDER BY FIELD(kind,'condition','medication','preference','goal','profile','context'),
                 confidence DESC,
                 key_name ASC
        LIMIT ${Number(limit)}`,
      [userId]
    );
    const picked = [];
    let used = 0;
    for (const row of rows) {
      const text = String(row.value || '');
      if (used + text.length > maxChars && picked.length) break;
      picked.push({
        kind: row.kind,
        key_name: row.key_name,
        value: text,
        confidence: Number(row.confidence) || 0
      });
      used += text.length;
    }
    return picked;
  } catch (error) {
    warnOnce('getMemories', error);
    return [];
  }
}

async function listMemories(userId) {
  if (!(await tablesReady())) return [];
  const [rows] = await pool.execute(
    `SELECT id, kind, key_name, value, source, confidence, updated_at
       FROM user_memory WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC`,
    [userId]
  );
  return rows;
}

async function upsertMemory(userId, { kind, keyName, value, source = 'user', confidence = 100 }) {
  if (!(await tablesReady())) {
    return { ok: false, reason: 'tables_missing' };
  }
  const safeKind = ['profile', 'preference', 'condition', 'medication', 'goal', 'context'].includes(kind) ? kind : 'context';
  const safeKey = String(keyName || '').trim().slice(0, 64);
  const safeValue = String(value || '').trim().slice(0, 500);
  if (!safeKey || !safeValue) return { ok: false, reason: 'invalid' };
  await pool.execute(
    `INSERT INTO user_memory (user_id, kind, key_name, value, source, confidence)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), source = VALUES(source),
                             confidence = VALUES(confidence), updated_at = NOW()`,
    [userId, safeKind, safeKey, safeValue, source === 'ai' ? 'ai' : 'user', Number(confidence) || 100]
  );
  return { ok: true };
}

async function deleteMemory(userId, id) {
  if (!(await tablesReady())) return { ok: false, reason: 'tables_missing' };
  const memoryId = Number(id);
  if (!Number.isSafeInteger(memoryId) || memoryId <= 0) return { ok: false, reason: 'invalid_id' };
  const [result] = await pool.execute(
    'DELETE FROM user_memory WHERE id = ? AND user_id = ?',
    [memoryId, userId]
  );
  return { ok: result.affectedRows > 0 };
}

async function touchMemories(userId, keys) {
  if (!keys || !keys.length) return;
  if (!(await tablesReady())) return;
  try {
    await pool.execute(
      `UPDATE user_memory SET last_used_at = NOW()
        WHERE user_id = ? AND key_name IN (${keys.map(() => '?').join(',')})`,
      [userId, ...keys]
    );
  } catch (error) {
    warnOnce('touchMemories', error);
  }
}

// ---------------------------------------------------------------- 近期趋势

function statsOf(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return { avg: null, max: null, min: null, count: 0 };
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return {
    avg: sum / nums.length,
    max: Math.max(...nums),
    min: Math.min(...nums),
    count: nums.length
  };
}

function windowStats(rows, fromMs, toMs) {
  const slice = rows.filter((r) => {
    const t = r.time;
    return t >= fromMs && t < toMs;
  });
  const pick = (key) => statsOf(slice.map((r) => r[key]));
  const build = (key) => {
    const current = pick(key);
    const previous = statsOf(
      rows.filter((r) => r.time >= fromMs - (toMs - fromMs) && r.time < fromMs).map((r) => r[key])
    );
    let direction = 'flat';
    if (Number.isFinite(current.avg) && Number.isFinite(previous.avg)) {
      const delta = current.avg - previous.avg;
      const threshold = Math.max(1, Math.abs(previous.avg) * 0.03);
      direction = delta > threshold ? 'up' : delta < -threshold ? 'down' : 'flat';
    }
    return { ...current, direction };
  };
  return { hr: build('heart_rate'), sbp: build('systolic_bp'), dbp: build('diastolic_bp'), spo2: build('spo2') };
}

/**
 * 近 7 / 30 天趋势。
 * 数据量很小（每天几次测量），所以直接取原始行在 JS 里算，逻辑比 SQL 条件聚合清楚得多。
 */
async function getHealthTrend(userId, deviceId, options = {}) {
  const shortDays = options.shortDays || cfg.trendDaysShort;
  const longDays = options.longDays || cfg.trendDaysLong;
  try {
    // 天数直接内联为已校验的整数：INTERVAL ? DAY 用占位符在部分 MySQL 版本上不稳，
    // 而这里的值只来自配置，不存在注入风险。
    const scanDays = Math.max(1, Math.min(365, Math.trunc(Number(longDays) * 2) || 60));
    const [rows] = await pool.execute(
      `SELECT measure_time, heart_rate, systolic_bp, diastolic_bp, spo2
         FROM user_health_data
        WHERE user_id = ? AND device_id = ?
          AND measure_time >= DATE_SUB(NOW(), INTERVAL ${scanDays} DAY)
        ORDER BY measure_time ASC
        LIMIT 5000`,
      [userId, deviceId]
    );
    if (!rows.length) return { windows: [] };
    const now = Date.now();
    const day = 86400000;
    const parsed = rows.map((r) => ({
      time: new Date(r.measure_time).getTime(),
      heart_rate: toNumber(r.heart_rate),
      systolic_bp: toNumber(r.systolic_bp),
      diastolic_bp: toNumber(r.diastolic_bp),
      spo2: toNumber(r.spo2)
    }));
    const windows = [shortDays, longDays].map((days) => ({
      days,
      ...windowStats(parsed, now - days * day, now + day)
    }));
    return { windows };
  } catch (error) {
    warnOnce('getHealthTrend', error);
    return { windows: [] };
  }
}

// ---------------------------------------------------------------- 建议留痕与反馈

async function logAdvice({ userId, kind = 'report', inputSnapshot, output, model, promptVersion, usedFallback }) {
  if (!(await tablesReady())) return null;
  try {
    const [result] = await pool.execute(
      `INSERT INTO ai_advice_log (user_id, kind, input_snapshot, output, model, prompt_version, used_fallback)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        kind === 'chat' ? 'chat' : 'report',
        JSON.stringify(inputSnapshot || {}),
        JSON.stringify(output || {}),
        model || null,
        promptVersion || null,
        usedFallback ? 1 : 0
      ]
    );
    return result.insertId;
  } catch (error) {
    warnOnce('logAdvice', error);
    return null;
  }
}

async function setAdviceFeedback(userId, adviceId, feedback) {
  if (!(await tablesReady())) return { ok: false, reason: 'tables_missing' };
  const value = feedback === 1 || feedback === '1' || feedback === true ? 1
    : feedback === 0 || feedback === '0' || feedback === false ? 0 : null;
  if (value === null) return { ok: false, reason: 'invalid_feedback' };
  const id = Number(adviceId);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'invalid_id' };
  const [result] = await pool.execute(
    'UPDATE ai_advice_log SET feedback = ? WHERE id = ? AND user_id = ?',
    [value, id, userId]
  );
  return { ok: result.affectedRows > 0 };
}

/**
 * 一次性把生成建议所需的上下文读齐，供 routes/ai.js 调用。
 */
async function loadAdviceContext(userId, deviceId, options = {}) {
  const [profile, memories, trend] = await Promise.all([
    getUserProfile(userId),
    getMemories(userId, options),
    deviceId ? getHealthTrend(userId, deviceId, options) : Promise.resolve({ windows: [] })
  ]);
  return { profile, memories, trend };
}

module.exports = {
  tablesReady,
  getUserProfile,
  getMemories,
  listMemories,
  upsertMemory,
  deleteMemory,
  touchMemories,
  getHealthTrend,
  logAdvice,
  setAdviceFeedback,
  loadAdviceContext
};
