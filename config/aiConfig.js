// config/aiConfig.js
// AI 相关配置集中管理：全部可用环境变量覆盖，切换模型/参数不需要改代码。
// 版本：2026-10-10.1
require('dotenv').config();

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
  apiKey: process.env.DEEPSEEK_API_KEY || '',

  // 日常建议用轻量模型；将来做复杂分析（周报等）再切重模型
  model: process.env.AI_MODEL || 'deepseek-flash',
  modelHeavy: process.env.AI_MODEL_HEAVY || 'deepseek-v4-pro',

  // 思考模式：off | low | high | max
  // 重要：deepseek-flash 默认【开启】思考模式且 effort=high。
  // 健康建议不需要思维链，开启会显著抬高输出 token 成本；
  // 而且思考模式下 temperature 不生效（官方文档明确说明）。
  // 所以默认关闭。
  thinking: (process.env.AI_THINKING || 'off').toLowerCase(),

  timeout: num(process.env.AI_TIMEOUT, 30000),
  maxTokensReport: num(process.env.AI_MAX_TOKENS_REPORT, 1500),
  maxTokensChat: num(process.env.AI_MAX_TOKENS_CHAT, 800),
  temperatureReport: num(process.env.AI_TEMPERATURE_REPORT, 0.5),
  temperatureChat: num(process.env.AI_TEMPERATURE_CHAT, 0.7),

  // 用 JSON 输出模式，替代"正则从自由文本里抠 JSON"的做法
  useJsonMode: (process.env.AI_JSON_MODE || 'on').toLowerCase() !== 'off',

  promptVersion: process.env.AI_PROMPT_VERSION || '2026-10-10.2',

  // 记忆注入配额
  memoryLimit: num(process.env.AI_MEMORY_LIMIT, 8),
  memoryMaxChars: num(process.env.AI_MEMORY_MAX_CHARS, 800),
  trendDaysShort: num(process.env.AI_TREND_DAYS_SHORT, 7),
  trendDaysLong: num(process.env.AI_TREND_DAYS_LONG, 30),

  // 危险值硬阈值：由规则判定并强制提示，不依赖模型输出
  danger: {
    systolicHigh: num(process.env.AI_DANGER_SBP_HIGH, 180),
    diastolicHigh: num(process.env.AI_DANGER_DBP_HIGH, 110),
    systolicLow: num(process.env.AI_DANGER_SBP_LOW, 85),
    diastolicLow: num(process.env.AI_DANGER_DBP_LOW, 50),
    spo2Low: num(process.env.AI_DANGER_SPO2_LOW, 90),
    heartRateHigh: num(process.env.AI_DANGER_HR_HIGH, 120),
    heartRateLow: num(process.env.AI_DANGER_HR_LOW, 45)
  }
};
