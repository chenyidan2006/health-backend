//utils/pythonRunner.js（调用 Python 算法，带重试与超时）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
require('dotenv').config();

let pythonCommand = null;
let pythonScriptPath = null;

/**
 * 检查 Python 环境
 */
function checkPythonEnvironment() {
  const commands = ['python3', 'python', 'py'];
  for (const cmd of commands) {
    try {
      require('child_process').execSync(`${cmd} --version`, { stdio: 'ignore' });
      pythonCommand = cmd;
      logger.info(`使用 Python 命令: ${cmd}`);
      return cmd;
    } catch (e) {
      // 继续尝试下一个
    }
  }
  throw new Error('未找到可用的 Python 命令，请安装 Python 并加入 PATH');
}

/**
 * 检查 Python 脚本
 */
function checkPythonScript() {
  const scriptPath = path.resolve(process.env.PYTHON_SCRIPT_PATH || './python/ppg_processor.py');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Python 脚本不存在: ${scriptPath}`);
  }
  pythonScriptPath = scriptPath;
  logger.info(`Python 脚本路径: ${scriptPath}`);
  return scriptPath;
}

/**
 * 执行 Python 算法（单次）
 */
function executeAlgorithm(inputData) {
  return new Promise((resolve, reject) => {
    const cmd = pythonCommand || checkPythonEnvironment();
    const script = pythonScriptPath || checkPythonScript();

    const pythonProcess = spawn(cmd, [script]);
    let stdout = '';
    let stderr = '';

    const inputJson = JSON.stringify(inputData);
    pythonProcess.stdin.write(inputJson);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeoutMs = parseInt(process.env.PYTHON_TIMEOUT) || 15000;
    const timeoutId = setTimeout(() => {
      pythonProcess.kill('SIGTERM');
      reject(new Error(`Python 执行超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        const err = new Error(`Python 进程退出，代码 ${code}`);
        err.stderr = stderr;
        reject(err);
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`解析 Python 输出失败: ${e.message}`));
      }
    });

    pythonProcess.on('error', (err) => reject(err));
  });
}

/**
 * 带重试的执行
 */
async function executeWithRetry(inputData) {
  const maxRetries = parseInt(process.env.PYTHON_MAX_RETRIES) || 3;
  const retryDelay = parseInt(process.env.PYTHON_RETRY_DELAY) || 1000;
  let lastError;

  for (let i = 1; i <= maxRetries; i++) {
    try {
      logger.info(`执行 Python 算法 (尝试 ${i}/${maxRetries})...`);
      return await executeAlgorithm(inputData);
    } catch (err) {
      lastError = err;
      logger.warn(`尝试 ${i} 失败: ${err.message}`);
      if (i < maxRetries) await new Promise(r => setTimeout(r, retryDelay));
    }
  }
  throw lastError;
}

module.exports = {
  executeWithRetry,
  checkPythonEnvironment,
  checkPythonScript
};