// services/aiService.js - DeepSeek AI 服务
// 版本：2026-10-10.1
//
// 本次改造的四个要点：
//   1) 提示词外置到 config/prompts/：改话术不用改代码、不用重启（按 mtime 热加载）
//   2) 消息分两层：system 完全静态（利于 DeepSeek 硬盘缓存命中，命中价差 50 倍），
//      user 消息装动态上下文（用户档案 / 长期记忆 / 近期趋势 / 本次数据）
//   3) 所有对外调用统一走 callDeepSeek，返回 usage，便于成本核算
//   4) 危险值由规则硬判定（buildRiskAlerts），不交给模型；任何失败都降级到本地建议，
//      并显式标记 usedFallback，前端不再"静默兜底"
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const cfg = require('../config/aiConfig');

const PROMPT_DIR = path.join(__dirname, '..', 'config', 'prompts');
const promptCache = new Map();

// 内置兜底提示词：模板文件缺失时使用，保证 AI 功能不会因为文件问题整体挂掉。
const FALLBACK_SYSTEM = {
  zh: [
    '你是一位面向家庭场景的健康顾问。用平实口语，给具体、可执行的生活方式建议。',
    '不做诊断、不开药、不判断疾病；数据缺失的指标不要输出，绝不编造数值。',
    '只返回一个 JSON 对象，不要任何解释文字和 markdown 围栏。字段名固定为：',
    'summary, safetyAlert, physiologicalAge{actualAge,physiologicalAge,difference,status,explanation},',
    'indicators[{name,icon,value,status,statusText,advice}], insights[{icon,title,evidence,meaning,status}],',
    'priorities[{icon,title,reason,action,target,when}], followUp{when,measure,success}, overallAdvice。',
    'status 只能取 normal|warning|danger；physiologicalAge.status 只能取 younger|same|older。',
    '充分使用用户消息中的【用户档案】【长期记忆】【近期趋势】，避免与上次建议重复。'
  ].join('\n'),
  en: [
    'You are a family-oriented health advisor. Use plain language and give concrete, actionable lifestyle advice.',
    'Do not diagnose, prescribe or name diseases. Omit metrics absent from the data; never invent values.',
    'Return one JSON object only, with no prose and no markdown fences. Fixed keys:',
    'summary, safetyAlert, physiologicalAge{actualAge,physiologicalAge,difference,status,explanation},',
    'indicators[{name,icon,value,status,statusText,advice}], insights[{icon,title,evidence,meaning,status}],',
    'priorities[{icon,title,reason,action,target,when}], followUp{when,measure,success}, overallAdvice.',
    'status must be normal|warning|danger; physiologicalAge.status must be younger|same|older.',
    'Make real use of 【User profile】【Long-term memory】【Recent trend】 and avoid repeating the previous advice.'
  ].join('\n')
};

const LABELS = {
  zh: {
    profile: '【用户档案】',
    memory: '【长期记忆】',
    trend: '【近期趋势】',
    wellness: '【今日生活记录】',
    data: '【本次数据】',
    language: '【输出语言】',
    nickname: '称呼', gender: '性别', age: '年龄', height: '身高', weight: '体重', bmi: 'BMI',
    unknown: '未提供',
    male: '男', female: '女', other: '未说明',
    date: '数据日期', actualAge: '实际年龄',
    hr: '平均心率', sbp: '平均收缩压', dbp: '平均舒张压', spo2: '平均血氧',
    noMemory: '暂无记录',
    noTrend: '暂无足够历史数据',
    avg: '平均', max: '最高', min: '最低', count: '测量次数',
    trendUp: '较上一周期上升', trendDown: '较上一周期下降', trendFlat: '较上一周期基本持平',
    lastDays: '近{d}天',
    task: '请找出最值得关注的1-3个重点，说明依据，并给出今天能完成的行动。不要为了凑格式重复通用建议。必须返回约定的 JSON 对象。'
  },
  en: {
    profile: '[User profile]',
    memory: '[Long-term memory]',
    trend: '[Recent trend]',
    wellness: '[Today\'s wellness log]',
    data: '[Current data]',
    language: '[Output language]',
    nickname: 'Name', gender: 'Sex', age: 'Age', height: 'Height', weight: 'Weight', bmi: 'BMI',
    unknown: 'not provided',
    male: 'male', female: 'female', other: 'unspecified',
    date: 'Date', actualAge: 'Actual age',
    hr: 'Average heart rate', sbp: 'Average systolic', dbp: 'Average diastolic', spo2: 'Average SpO2',
    noMemory: 'none on record',
    noTrend: 'not enough history',
    avg: 'avg', max: 'max', min: 'min', count: 'measurements',
    trendUp: 'higher than previous period', trendDown: 'lower than previous period', trendFlat: 'roughly flat',
    lastDays: 'last {d} days',
    task: 'Identify the 1-3 points that matter most, explain the evidence, and give actions possible today. Do not repeat generic advice just to fill a template. Return the agreed JSON object.'
  }
};

// ---------------------------------------------------------------- 提示词加载

function normalizeLanguage(language) {
  return String(language || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

function loadPromptTemplate(fileName) {
  const filePath = path.join(PROMPT_DIR, fileName);
  try {
    const stat = fs.statSync(filePath);
    const cached = promptCache.get(fileName);
    if (cached && cached.mtime === stat.mtimeMs) return cached.text;
    const text = fs.readFileSync(filePath, 'utf8');
    promptCache.set(fileName, { mtime: stat.mtimeMs, text });
    return text;
  } catch (error) {
    logger.warn(`提示词模板读取失败(${fileName})，改用内置兜底版本：${error.message}`);
    return null;
  }
}

/**
 * 系统提示词：完全静态，可以长期命中 DeepSeek 的硬盘缓存。
 */
function getSystemPrompt(language) {
  const lang = normalizeLanguage(language);
  return loadPromptTemplate(`system.report.${lang}.txt`) || FALLBACK_SYSTEM[lang];
}

// ---------------------------------------------------------------- 内容装配

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
}

function genderText(gender, lang) {
  const label = LABELS[lang];
  const g = Number(gender);
  if (g === 1) return label.male;
  if (g === 2) return label.female;
  return label.other;
}

function trendLine(label, item, lang) {
  if (!item || !Number.isFinite(item.avg)) return null;
  const L = LABELS[lang];
  const direction = item.direction === 'up' ? L.trendUp : item.direction === 'down' ? L.trendDown : L.trendFlat;
  return `${label}: ${L.avg} ${fmt(item.avg)} / ${L.max} ${fmt(item.max)} / ${L.min} ${fmt(item.min)} (${item.count} ${L.count}), ${direction}`;
}

/**
 * 动态上下文：用户档案 + 长期记忆 + 近期趋势。
 *
 * 注意：这里的顺序和格式必须【确定性】—— 同一用户同一天内反复调用要产出完全相同的文本，
 * 否则会破坏 DeepSeek 的前缀缓存（缓存命中与未命中价格差 50 倍）。
 * 因此：记忆条数与排序由 memoryService 固定，不在这里做随机或时间相关处理。
 */
function buildUserContext(context = {}, language) {
  const lang = normalizeLanguage(language);
  const L = LABELS[lang];
  const { profile, memories, trend, wellness } = context;
  const blocks = [];

  // 1) 用户档案
  const p = profile || {};
  const bits = [];
  if (p.nickname) bits.push(`${L.nickname}: ${p.nickname}`);
  if (p.gender !== undefined && p.gender !== null) bits.push(`${L.gender}: ${genderText(p.gender, lang)}`);
  if (Number.isFinite(p.age)) bits.push(`${L.age}: ${p.age}`);
  if (Number.isFinite(p.heightCm)) bits.push(`${L.height}: ${p.heightCm}cm`);
  if (Number.isFinite(p.weightKg)) bits.push(`${L.weight}: ${p.weightKg}kg`);
  if (Number.isFinite(p.bmi)) bits.push(`${L.bmi}: ${p.bmi}`);
  blocks.push(`${L.profile}\n${bits.length ? bits.join(' / ') : L.unknown}`);

  // 2) 长期记忆（已由 memoryService 固定条数与排序）
  if (Array.isArray(memories) && memories.length) {
    const lines = memories.map((m) => `- [${m.kind}] ${m.key_name}: ${m.value}`);
    blocks.push(`${L.memory}\n${lines.join('\n')}`);
  } else {
    blocks.push(`${L.memory}\n${L.noMemory}`);
  }

  // 3) 近期趋势
  if (trend && Array.isArray(trend.windows) && trend.windows.length) {
    const lines = [];
    trend.windows.forEach((w) => {
      const head = L.lastDays.replace('{d}', w.days);
      [['hr', L.hr], ['sbp', L.sbp], ['dbp', L.dbp], ['spo2', L.spo2]].forEach(([key, label]) => {
        const line = trendLine(`${head} ${label}`, w[key], lang);
        if (line) lines.push(line);
      });
    });
    blocks.push(`${L.trend}\n${lines.length ? lines.join('\n') : L.noTrend}`);
  } else {
    blocks.push(`${L.trend}\n${L.noTrend}`);
  }

  // 4) 用户在健康录入页填写的生活记录。以前这部分没有发送给模型，
  // 导致模型只能围绕心率、血压和血氧反复给通用建议。
  if (wellness && typeof wellness === 'object') {
    const w = wellness;
    const sleepQuality = lang === 'zh'
      ? ({ Poor: '较差', Fair: '一般', Good: '良好', Excellent: '很好' })[w.sleepQuality]
      : w.sleepQuality;
    const lines = [];
    if (Number.isFinite(w.waterMl)) lines.push(`${lang === 'zh' ? '饮水' : 'Water'}: ${w.waterMl} mL`);
    if (Number.isFinite(w.caffeineMg)) lines.push(`${lang === 'zh' ? '咖啡因' : 'Caffeine'}: ${w.caffeineMg} mg`);
    if (Number.isFinite(w.sleepMinutes)) lines.push(`${lang === 'zh' ? '睡眠' : 'Sleep'}: ${Math.floor(w.sleepMinutes / 60)}h ${w.sleepMinutes % 60}min`);
    if (sleepQuality) lines.push(`${lang === 'zh' ? '睡眠感受' : 'Sleep quality'}: ${sleepQuality}`);
    if (Number.isFinite(w.meals)) lines.push(`${lang === 'zh' ? '进餐' : 'Meals'}: ${w.meals}`);
    if (Number.isFinite(w.vegetables)) lines.push(`${lang === 'zh' ? '蔬菜' : 'Vegetable servings'}: ${w.vegetables}`);
    if (Number.isFinite(w.fruits)) lines.push(`${lang === 'zh' ? '水果' : 'Fruit servings'}: ${w.fruits}`);
    if (Number.isFinite(w.steps)) lines.push(`${lang === 'zh' ? '步数' : 'Steps'}: ${w.steps}`);
    if (Number.isFinite(w.exerciseMinutes)) lines.push(`${lang === 'zh' ? '运动' : 'Exercise'}: ${w.exerciseMinutes} min`);
    if (lines.length) blocks.push(`${L.wellness}\n${lines.join('\n')}`);
  }

  return blocks.join('\n\n');
}

/**
 * 本次数据块。
 */
function buildDataBlock(healthData = {}, language) {
  const lang = normalizeLanguage(language);
  const L = LABELS[lang];
  const lines = [
    `${L.data}`,
    `${L.date}: ${healthData.date || 'N/A'}`,
    `${L.actualAge}: ${Number.isFinite(healthData.actualAge) ? `${healthData.actualAge}${lang === 'zh' ? '岁' : 'y'}` : 'N/A'}`,
    `${L.hr}: ${fmt(finiteOrNull(healthData.avg_heart_rate))} bpm`,
    `${L.sbp}: ${fmt(finiteOrNull(healthData.avg_systolic_bp))} mmHg`,
    `${L.dbp}: ${fmt(finiteOrNull(healthData.avg_diastolic_bp))} mmHg`,
    `${L.spo2}: ${fmt(finiteOrNull(healthData.avg_spo2))} %`,
    `${L.language}: ${lang === 'zh' ? '中文' : 'English'}`
  ];
  return lines.join('\n');
}

/**
 * 组装消息：
 *   messages[0] = system  -> 静态提示词（永不变，缓存友好）
 *   messages[1] = user    -> 档案 + 记忆 + 趋势 + 本次数据 + 任务
 * 刻意不用多轮 messages：报告接口是无状态单轮，多轮只会在将来做聊天时引入。
 */
function buildMessages({ healthData, context, language }) {
  const system = getSystemPrompt(language);
  const user = [
    buildUserContext(context, language),
    '',
    buildDataBlock(healthData, language),
    '',
    LABELS[normalizeLanguage(language)].task
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

// ---------------------------------------------------------------- 危险值规则判定

/**
 * 危险值硬提示：由规则判定，不依赖模型。
 * 即使 AI 完全失败、走本地建议，这些提示也必须出现在结果里。
 */
function buildRiskAlerts(data = {}, language = 'zh') {
  const lang = normalizeLanguage(language);
  const alerts = [];
  const sbp = finiteOrNull(data.avg_systolic_bp);
  const dbp = finiteOrNull(data.avg_diastolic_bp);
  const spo2 = finiteOrNull(data.avg_spo2);
  const hr = finiteOrNull(data.avg_heart_rate);
  const d = cfg.danger;

  if (Number.isFinite(sbp) && sbp >= d.systolicHigh) {
    alerts.push(lang === 'en'
      ? `Systolic pressure is ${sbp.toFixed(0)} mmHg, at or above ${d.systolicHigh}. Rest seated for 5 minutes and measure again. If it remains this high, or you have headache, chest discomfort, blurred vision, or nausea, seek medical care promptly.`
      : `收缩压 ${sbp.toFixed(0)} mmHg 已达到 ${d.systolicHigh} 以上。请在安静坐姿下休息 5 分钟后复测一次；如果仍然这么高，或者伴有头痛、胸闷、视物模糊、恶心，请尽快就医。`);
  } else if (Number.isFinite(dbp) && dbp >= d.diastolicHigh) {
    alerts.push(lang === 'en'
      ? `Diastolic pressure is ${dbp.toFixed(0)} mmHg, at or above ${d.diastolicHigh}. Rest and measure again. If it remains high or you feel unwell, seek medical care promptly.`
      : `舒张压 ${dbp.toFixed(0)} mmHg 已达到 ${d.diastolicHigh} 以上。请安静休息后复测；若持续偏高或伴有不适，请尽快就医。`);
  }
  if (Number.isFinite(sbp) && sbp <= d.systolicLow) {
    alerts.push(lang === 'en'
      ? `Systolic pressure is low at ${sbp.toFixed(0)} mmHg. Sit or lie down, stand up slowly, and drink some water. Seek medical care if dizziness, weakness, or dimmed vision keeps recurring.`
      : `收缩压 ${sbp.toFixed(0)} mmHg 偏低。请先坐下或平躺，缓慢起身，适量补充水分；如果反复出现头晕、乏力、眼前发黑，请就医查明原因。`);
  }
  if (Number.isFinite(spo2) && spo2 < d.spo2Low) {
    alerts.push(lang === 'en'
      ? `Blood oxygen is low at ${spo2.toFixed(0)}%. Sit upright, improve ventilation, and take several deep breaths. Seek immediate medical care for shortness of breath, chest discomfort, or blue lips.`
      : `血氧 ${spo2.toFixed(0)}% 偏低。请保持坐位、开窗通风并做几次深呼吸；如有气促、胸闷或口唇发紫，请立即就医。`);
  }
  if (Number.isFinite(hr) && hr >= d.heartRateHigh) {
    alerts.push(lang === 'en'
      ? `Heart rate is high at ${hr.toFixed(0)} bpm. Sit quietly for 5 minutes and measure again. Seek medical care if it stays high at rest or occurs with palpitations or chest discomfort.`
      : `心率 ${hr.toFixed(0)} bpm 偏快。请静坐 5 分钟后复测；若静息状态下仍持续偏快，或伴心悸、胸闷，请就医。`);
  } else if (Number.isFinite(hr) && hr <= d.heartRateLow) {
    alerts.push(lang === 'en'
      ? `Heart rate is low at ${hr.toFixed(0)} bpm. Seek medical assessment if you also have dizziness, weakness, or shortness of breath with activity.`
      : `心率 ${hr.toFixed(0)} bpm 偏慢。如伴随头晕、乏力、活动后气促，请就医评估。`);
  }
  return alerts;
}

// ---------------------------------------------------------------- DeepSeek 调用

/**
 * 唯一的 DeepSeek 出口。
 * @returns {{ok:boolean, content?:string, usage?:object, model?:string, error?:string}}
 */
async function callDeepSeek(messages, options = {}) {
  const model = options.model || cfg.model;
  if (!cfg.apiKey) {
    logger.error('DeepSeek API error:', 'DEEPSEEK_API_KEY 未配置');
    return { ok: false, error: 'DEEPSEEK_API_KEY 未配置', model };
  }

  const body = {
    model,
    messages,
    max_tokens: options.maxTokens || cfg.maxTokensReport,
    stream: false
  };

  // 思考模式：默认关闭。
  // deepseek-flash 默认开启且 effort=high，健康建议不需要思维链；
  // 开启会显著抬高输出 token 成本，并且会让 temperature 失效（官方文档明确说明）。
  const thinking = String(options.thinking || cfg.thinking).toLowerCase();
  if (thinking === 'off' || thinking === 'disabled' || thinking === 'none') {
    body.thinking = { type: 'disabled' };
    body.temperature = options.temperature !== undefined ? options.temperature : cfg.temperatureReport;
  } else {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = ['low', 'high', 'max'].includes(thinking) ? thinking : 'low';
    // 思考模式下 temperature 不生效，这里刻意不发送，避免误导后来人
  }

  if (options.jsonMode && cfg.useJsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await axios.post(cfg.apiUrl, body, {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: options.timeout || cfg.timeout
    });
    const choice = response.data && response.data.choices && response.data.choices[0];
    if (!choice || !choice.message || typeof choice.message.content !== 'string') {
      return { ok: false, error: 'Invalid response from DeepSeek API', model };
    }
    return {
      ok: true,
      content: choice.message.content,
      reasoning: choice.message.reasoning_content || '',
      usage: response.data.usage || null,
      model: response.data.model || model
    };
  } catch (error) {
    const detail = error.response && error.response.data
      ? JSON.stringify(error.response.data).slice(0, 300)
      : error.message;
    logger.error('DeepSeek API error:', `${error.message} | ${detail}`);
    return { ok: false, error: detail, model };
  }
}

// ---------------------------------------------------------------- JSON 解析

function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (inner) {
      return null;
    }
  }
}

/**
 * 收敛模型输出：缺字段补默认值，保证前端渲染不会崩。
 */
function normalizeAdvice(raw, fallbackAge, language = 'zh') {
  const lang = normalizeLanguage(language);
  const advice = raw && typeof raw === 'object' ? raw : {};
  const age = advice.physiologicalAge && typeof advice.physiologicalAge === 'object'
    ? advice.physiologicalAge
    : {};
  const indicators = Array.isArray(advice.indicators) ? advice.indicators : [];
  const lifestyle = Array.isArray(advice.lifestyle) ? advice.lifestyle : [];
  const insights = Array.isArray(advice.insights) ? advice.insights : [];
  const priorities = Array.isArray(advice.priorities) ? advice.priorities : [];
  const followUp = advice.followUp && typeof advice.followUp === 'object' ? advice.followUp : {};
  return {
    summary: typeof advice.summary === 'string' ? advice.summary : '',
    safetyAlert: typeof advice.safetyAlert === 'string' && advice.safetyAlert.trim() ? advice.safetyAlert.trim() : null,
    physiologicalAge: {
      actualAge: typeof age.actualAge === 'string' ? age.actualAge : (lang === 'en' ? `${fallbackAge} years` : `${fallbackAge}岁`),
      physiologicalAge: age.physiologicalAge !== undefined ? String(age.physiologicalAge) : String(fallbackAge),
      difference: age.difference !== undefined ? String(age.difference) : '0',
      status: ['younger', 'same', 'older'].includes(age.status) ? age.status : 'same',
      explanation: typeof age.explanation === 'string' ? age.explanation : ''
    },
    indicators: indicators
      .filter((item) => item && typeof item === 'object' && item.name)
      .map((item) => ({
        name: String(item.name),
        icon: typeof item.icon === 'string' && item.icon ? item.icon : '📌',
        value: item.value !== undefined ? String(item.value) : '',
        status: ['normal', 'warning', 'danger'].includes(item.status) ? item.status : 'normal',
        statusText: typeof item.statusText === 'string' ? item.statusText : '',
        advice: typeof item.advice === 'string' ? item.advice : ''
      })),
    lifestyle: lifestyle
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        category: typeof item.category === 'string' ? item.category : LABELS[lang].unknown,
        icon: typeof item.icon === 'string' && item.icon ? item.icon : '💡',
        tips: Array.isArray(item.tips) ? item.tips.filter((t) => typeof t === 'string') : []
      })),
    insights: insights.slice(0, 3)
      .filter((item) => item && typeof item === 'object' && item.title)
      .map((item) => ({
        icon: typeof item.icon === 'string' && item.icon ? item.icon : '🔎',
        title: String(item.title),
        evidence: typeof item.evidence === 'string' ? item.evidence : '',
        meaning: typeof item.meaning === 'string' ? item.meaning : '',
        status: ['positive', 'neutral', 'attention'].includes(item.status) ? item.status : 'neutral'
      })),
    priorities: priorities.slice(0, 3)
      .filter((item) => item && typeof item === 'object' && item.title)
      .map((item) => ({
        icon: typeof item.icon === 'string' && item.icon ? item.icon : '✓',
        title: String(item.title),
        reason: typeof item.reason === 'string' ? item.reason : '',
        action: typeof item.action === 'string' ? item.action : '',
        target: typeof item.target === 'string' ? item.target : '',
        when: typeof item.when === 'string' ? item.when : ''
      })),
    followUp: {
      when: typeof followUp.when === 'string' ? followUp.when : '',
      measure: typeof followUp.measure === 'string' ? followUp.measure : '',
      success: typeof followUp.success === 'string' ? followUp.success : ''
    },
    overallAdvice: typeof advice.overallAdvice === 'string' ? advice.overallAdvice : '',
    type: 'structured'
  };
}

// ---------------------------------------------------------------- 对外主函数

/**
 * 生成健康建议。
 * @param {Object} healthData - 当日聚合数据（avg_heart_rate 等）
 * @param {Object} [context]  - { profile, memories, trend }
 * @returns {Promise<Object>} 建议对象，并附带 usedFallback / promptVersion / usage / riskAlerts
 */
async function generateHealthAdvice(healthData, context = {}) {
  const language = context.language || healthData.language || 'zh';
  const riskAlerts = buildRiskAlerts(healthData, language);
  const actualAge = Number.isFinite(healthData.actualAge) ? healthData.actualAge : 30;

  let result;
  try {
    const messages = buildMessages({ healthData, context, language });
    result = await callDeepSeek(messages, {
      jsonMode: true,
      temperature: cfg.temperatureReport,
      maxTokens: cfg.maxTokensReport
    });
  } catch (error) {
    logger.error('DeepSeek API error:', error.message);
    result = { ok: false, error: error.message };
  }

  if (result && result.ok) {
    const parsed = extractJsonObject(result.content);
    if (parsed) {
      const advice = normalizeAdvice(parsed, actualAge, language);
      const localStructure = generateLocalAdvice(healthData, language, context.wellness);
      if (!advice.priorities.length) advice.priorities = localStructure.priorities;
      if (!advice.insights.length) advice.insights = localStructure.insights;
      if (!advice.followUp.when) advice.followUp = localStructure.followUp;
      // 规则判定的危险提示优先于模型输出，绝不允许被模型"抹平"
      advice.safetyAlert = riskAlerts.length ? riskAlerts.join(' ') : advice.safetyAlert;
      advice.usedFallback = false;
      advice.promptVersion = cfg.promptVersion;
      advice.model = result.model;
      advice.usage = result.usage;
      advice.riskAlerts = riskAlerts;
      return advice;
    }
    logger.warn('AI返回的不是有效JSON，使用本地建议');
  }

  // 降级：本地规则建议，但仍然带上危险值提示与显式标记
  const local = generateLocalAdvice(healthData, language, context.wellness);
  local.safetyAlert = riskAlerts.length ? riskAlerts.join(' ') : null;
  local.usedFallback = true;
  local.promptVersion = cfg.promptVersion;
  local.model = (result && result.model) || cfg.model;
  local.usage = null;
  local.riskAlerts = riskAlerts;
  if (result && result.error) local.fallbackReason = String(result.error).slice(0, 200);
  return local;
}

// ---------------------------------------------------------------- 本地兜底与生理年龄

/**
 * 根据健康评分计算生理年龄（保留原有算法不变）
 */
function calculatePhysiologicalAge(score, actualAge = 30, language = 'zh') {
  const lang = normalizeLanguage(language);
  let physiologicalAge, difference, status, explanation;

  if (score <= -5) {
    physiologicalAge = actualAge - 5;
    difference = -5;
    status = 'younger';
    explanation = '您的各项健康指标都非常优秀，身体状态比实际年龄年轻5岁左右。继续保持当前的健康生活方式！';
  } else if (score <= -2) {
    physiologicalAge = actualAge - 3;
    difference = -3;
    status = 'younger';
    explanation = '您的健康状况良好，身体状态比实际年龄年轻约3岁。坚持锻炼和健康饮食有助于保持这种状态。';
  } else if (score <= 2) {
    physiologicalAge = actualAge;
    difference = 0;
    status = 'same';
    explanation = '您的健康指标处于正常范围，生理年龄与实际年龄基本相符。保持健康习惯可以延缓衰老。';
  } else if (score <= 5) {
    physiologicalAge = actualAge + 3;
    difference = 3;
    status = 'older';
    explanation = '部分健康指标略高于正常范围，生理年龄比实际年龄大约3岁。通过改善生活方式可以逆转这一趋势。';
  } else if (score <= 10) {
    physiologicalAge = actualAge + 5;
    difference = 5;
    status = 'older';
    explanation = '多项健康指标异常，生理年龄比实际年龄大约5岁。建议及时调整生活习惯，必要时咨询医生。';
  } else {
    physiologicalAge = actualAge + 8;
    difference = 8;
    status = 'older';
    explanation = '健康指标明显异常，生理年龄比实际年龄大约8岁。强烈建议尽快就医并全面调整生活方式。';
  }

  return {
    actualAge: lang === 'en' ? `${actualAge} years` : `${actualAge}岁`,
    physiologicalAge: lang === 'en' ? `${physiologicalAge} years` : `${physiologicalAge}岁`,
    difference: difference > 0 ? `+${difference}` : `${difference}`,
    status,
    explanation: lang === 'en' ? ({
      younger: `Your measurements suggest a physiological age about ${Math.abs(difference)} years younger than your actual age. Keep up your healthy habits.`,
      same: 'Your measurements are generally within the expected range for your age. Keep maintaining healthy habits.',
      older: `Some measurements need attention and suggest a physiological age about ${Math.abs(difference)} years older. Improving daily habits may help.`
    })[status] : explanation
  };
}

/**
 * 本地规则建议（AI 不可用时的降级方案）
 */
function generateLocalAdvice(data = {}, language = 'zh', wellness = {}) {
  const lang = normalizeLanguage(language);
  const pick = (zh, en) => lang === 'en' ? en : zh;
  const avgHeartRate = finiteOrNull(data.avg_heart_rate);
  const avgSystolic = finiteOrNull(data.avg_systolic_bp);
  const avgDiastolic = finiteOrNull(data.avg_diastolic_bp);
  const avgSpo2 = finiteOrNull(data.avg_spo2);
  const actualAge = Number.isFinite(data.actualAge) ? data.actualAge : 30;

  const indicators = [];
  const priorities = [];
  const insights = [];
  let ageScore = 0;

  if (Number.isFinite(avgHeartRate)) {
    let status, statusText, advice;
    if (avgHeartRate < 60) {
      status = 'warning'; statusText = pick('偏低', 'Low');
      advice = pick('适当增加有氧运动，如快走、慢跑等。', 'Consider gradually adding aerobic activity such as brisk walking.');
      ageScore += 2;
    } else if (avgHeartRate > 100) {
      status = 'danger'; statusText = pick('偏高', 'High');
      advice = pick('注意休息，避免过度劳累，必要时咨询医生。', 'Rest, avoid overexertion, and consult a clinician if needed.');
      ageScore += 5;
    } else if (avgHeartRate > 85) {
      status = 'normal'; statusText = pick('正常偏高', 'High-normal');
      advice = pick('心率在正常范围内但偏高，建议适当锻炼增强心肺功能。', 'Your heart rate is within range but near the high end. Regular activity may improve fitness.');
      ageScore += 2;
    } else {
      status = 'normal'; statusText = pick('正常', 'Normal');
      advice = pick('继续保持良好的生活习惯。', 'Keep maintaining healthy daily habits.');
      ageScore -= 2;
    }
    indicators.push({ name: pick('心率', 'Heart rate'), icon: '❤️', value: `${avgHeartRate.toFixed(1)} bpm`, status, statusText, advice });
    insights.push({ icon: '❤️', title: pick('本次心率表现', 'Heart-rate reading'), evidence: `${avgHeartRate.toFixed(1)} bpm`, meaning: advice, status: status === 'normal' ? 'positive' : 'attention' });
    if (status !== 'normal') priorities.push({ score: 90, icon: '❤️', title: pick('安静后复测心率', 'Recheck after resting'), reason: `${avgHeartRate.toFixed(1)} bpm · ${statusText}`, action: pick('坐下安静休息后再测一次', 'Sit quietly, rest, and measure again'), target: pick('休息5分钟后复测', 'Recheck after 5 minutes'), when: pick('现在', 'Now') });
  }

  if (Number.isFinite(avgSystolic) && Number.isFinite(avgDiastolic)) {
    let status, statusText, advice;
    if (avgSystolic > 140 || avgDiastolic > 90) {
      status = 'danger'; statusText = pick('偏高', 'High');
      advice = pick('减少盐分摄入，控制体重，定期监测血压。', 'Reduce salt, maintain a healthy weight, and monitor blood pressure regularly.');
      ageScore += 8;
    } else if (avgSystolic > 120 || avgDiastolic > 80) {
      status = 'warning'; statusText = pick('正常高值', 'Elevated');
      advice = pick('注意饮食清淡，适当运动，预防高血压。', 'Choose lower-salt foods and stay active.');
      ageScore += 3;
    } else if (avgSystolic < 90 || avgDiastolic < 60) {
      status = 'warning'; statusText = pick('偏低', 'Low');
      advice = pick('适当增加营养摄入，避免突然站立。', 'Eat regularly and avoid standing up suddenly.');
      ageScore += 2;
    } else {
      status = 'normal'; statusText = pick('正常', 'Normal');
      advice = pick('继续保持健康的生活方式。', 'Keep maintaining a healthy lifestyle.');
      ageScore -= 3;
    }
    indicators.push({ name: pick('血压', 'Blood pressure'), icon: '🩺', value: `${avgSystolic.toFixed(1)}/${avgDiastolic.toFixed(1)} mmHg`, status, statusText, advice });
    insights.push({ icon: '🩺', title: pick('本次血压表现', 'Blood-pressure reading'), evidence: `${avgSystolic.toFixed(1)}/${avgDiastolic.toFixed(1)} mmHg`, meaning: advice, status: status === 'normal' ? 'positive' : 'attention' });
    if (status !== 'normal') priorities.push({ score: 100, icon: '🩺', title: pick('按规范复测血压', 'Repeat the blood-pressure check'), reason: `${avgSystolic.toFixed(1)}/${avgDiastolic.toFixed(1)} mmHg · ${statusText}`, action: pick('坐直、手臂放松，与心脏同高后再测', 'Sit upright, relax your arm at heart level, and measure again'), target: pick('连续测2次，间隔1分钟', 'Take 2 readings, 1 minute apart'), when: pick('休息5分钟后', 'After resting 5 minutes') });
  }

  if (Number.isFinite(avgSpo2)) {
    let status, statusText, advice;
    if (avgSpo2 < 95) {
      status = 'danger'; statusText = pick('偏低', 'Low');
      advice = pick('保持室内通风，适当进行深呼吸练习。', 'Improve ventilation and take several slow, deep breaths.');
      ageScore += 5;
    } else if (avgSpo2 < 97) {
      status = 'warning'; statusText = pick('略低', 'Slightly low');
      advice = pick('多到户外活动，呼吸新鲜空气。', 'Spend some time outdoors in fresh air.');
      ageScore += 2;
    } else {
      status = 'normal'; statusText = pick('正常', 'Normal');
      advice = pick('呼吸系统状况良好。', 'Your oxygen reading is within the expected range.');
      ageScore -= 2;
    }
    indicators.push({ name: pick('血氧', 'Blood oxygen'), icon: '💨', value: `${avgSpo2.toFixed(1)}%`, status, statusText, advice });
    insights.push({ icon: '🫁', title: pick('本次血氧表现', 'Blood-oxygen reading'), evidence: `${avgSpo2.toFixed(1)}%`, meaning: advice, status: status === 'normal' ? 'positive' : 'attention' });
    if (status !== 'normal') priorities.push({ score: 110, icon: '🫁', title: pick('先复测血氧', 'Recheck blood oxygen'), reason: `${avgSpo2.toFixed(1)}% · ${statusText}`, action: pick('保持坐位、手指温暖且不动，再测一次', 'Sit still, warm your finger, and measure again'), target: pick('获得一次稳定读数', 'Obtain one stable reading'), when: pick('现在', 'Now') });
  }

  const w = wellness && typeof wellness === 'object' ? wellness : {};
  if (Number.isFinite(w.sleepMinutes) && w.sleepMinutes < 420) priorities.push({ score: 65, icon: '🌙', title: pick('今晚补足睡眠', 'Protect tonight\'s sleep'), reason: pick(`昨晚约睡${(w.sleepMinutes / 60).toFixed(1)}小时`, `Last sleep was about ${(w.sleepMinutes / 60).toFixed(1)} hours`), action: pick('把上床时间提前，并在睡前放下手机', 'Move bedtime earlier and put screens away'), target: pick('今晚睡够7小时', 'Aim for 7 hours tonight'), when: pick('睡前1小时开始', 'Start 1 hour before bed') });
  if (Number.isFinite(w.waterMl) && w.waterMl < 1200) priorities.push({ score: 45, icon: '💧', title: pick('分次补足饮水', 'Top up fluids gradually'), reason: pick(`今天已记录${w.waterMl} mL`, `${w.waterMl} mL logged today`), action: pick('分两到三次补水，不要一次大量饮用', 'Drink in two or three smaller servings'), target: pick('今天累计达到1500 mL', 'Reach 1500 mL today'), when: pick('晚饭前完成大部分', 'Finish most before dinner') });
  if (Number.isFinite(w.caffeineMg) && w.caffeineMg > 400) priorities.push({ score: 60, icon: '☕', title: pick('今天停止摄入咖啡因', 'Stop caffeine for today'), reason: pick(`今天约${w.caffeineMg} mg`, `About ${w.caffeineMg} mg today`), action: pick('之后改喝水或无咖啡因饮品', 'Switch to water or a caffeine-free drink'), target: pick('剩余时间不再摄入', 'No more caffeine today'), when: pick('从现在开始', 'Starting now') });
  if (Number.isFinite(w.steps) && w.steps < 5000 && Number.isFinite(avgSpo2) && avgSpo2 >= 95) priorities.push({ score: 35, icon: '🚶', title: pick('安排一次轻松步行', 'Add an easy walk'), reason: pick(`今天已走${w.steps}步`, `${w.steps} steps so far today`), action: pick('选择平路，以能正常说话的速度走', 'Walk on level ground at a conversational pace'), target: pick('连续步行15分钟', 'Walk for 15 minutes'), when: pick('晚饭后30分钟', '30 minutes after dinner') });
  if (!priorities.length) priorities.push({ score: 20, icon: '✅', title: pick('保持今天的节奏', 'Keep today\'s routine'), reason: pick('当前测量和生活记录没有突出问题', 'No standout issue appears in the current readings or log'), action: pick('按平时节奏活动并记录下一次测量', 'Continue your usual routine and save the next reading'), target: pick('完成一次同条件复测', 'Repeat once under similar conditions'), when: pick('明天相近时间', 'At a similar time tomorrow') });
  priorities.sort((a, b) => b.score - a.score);

  return {
    summary: indicators.every((i) => i.status === 'normal')
      ? pick('您的健康状况良好', 'Your measurements look good overall')
      : pick('您的部分健康指标需要关注', 'Some of your measurements need attention'),
    safetyAlert: null,
    physiologicalAge: calculatePhysiologicalAge(ageScore, actualAge, lang),
    indicators,
    insights: insights.slice(0, 3),
    priorities: priorities.slice(0, 3).map(({ score, ...item }) => item),
    followUp: {
      when: pick('明天相近时间，或完成上述行动后', 'At a similar time tomorrow or after the suggested action'),
      measure: pick('重点比较心率、血压、血氧与今天的差异', 'Compare heart rate, blood pressure, and oxygen with today'),
      success: pick('读数更稳定，异常指标向正常范围靠近', 'Readings are steadier and flagged values move toward the expected range')
    },
    lifestyle: [],
    overallAdvice: pick('保持健康的生活方式，定期监测健康指标。如有不适，请及时就医。', 'Maintain healthy habits and check your measurements regularly. Seek medical care if you feel unwell.'),
    usedFallback: true,
    type: 'structured'
  };
}

module.exports = {
  generateHealthAdvice,
  calculatePhysiologicalAge,
  generateLocalAdvice,
  buildRiskAlerts,
  buildUserContext,
  buildDataBlock,
  buildMessages,
  getSystemPrompt,
  normalizeLanguage,
  callDeepSeek
};
