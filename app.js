const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { connectDB } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3002;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET 必须通过环境变量配置，且长度至少为 32 个字符');
}

const allowedOrigins = (process.env.CORS_ORIGINS ||
  'http://localhost:8080,http://localhost:5173,https://chenyidan2006.github.io')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // 原生 App、服务间调用通常没有 Origin；浏览器请求只接受明确列出的来源。
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));
app.options('*', cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 路由挂载
app.use('/api/user', require('./routes/user'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/data', require('./routes/data'));

// AI 路由（可选，找不到就跳过）
try {
  app.use('/api/ai', require('./routes/ai'));
} catch (e) {
  console.log('AI 路由未加载');
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// 启动
async function startServer() {
  await connectDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 健康数据服务启动于端口: ${PORT}`);
  });
}
startServer();
