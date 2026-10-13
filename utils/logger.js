//D:/code/app/appprogram/health-backend/utils/logger.js
//utils/logger.js(结构化日志)
const dotenv = require('dotenv');
dotenv.config();

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;

function log(level, message, data = null) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...(data && { data: typeof data === 'object' ? JSON.stringify(data) : data })
  };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

module.exports = {
  debug: (msg, data) => log('debug', msg, data),
  info: (msg, data) => log('info', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  error: (msg, err) => log('error', msg, err?.message || err)
};