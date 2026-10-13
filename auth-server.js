const express = require('express');
const cors = require('cors'); // 引入专业的跨域组件
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量
const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });
console.log('auth-server loaded env:', envPath);

const app = express();
const PORT = 3001;

// ==================== 🛠️ 使用标准的官方中间件放开跨域 ====================
app.use(cors({
  origin: '*',                                    // 允许任何前端源访问
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

// 对所有路径的 OPTIONS 预检请求给予完美支持，彻底解决 CORS 报错拦截
app.options('*', cors());
// ====================================================================

app.use(express.json());

// 挂载原有的认证路由
const authRoutes = require('./routes/auth');
app.use('/api/user', authRoutes);

// 健康检查接口
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-server', timestamp: new Date().toISOString() });
});

// 启动并打印服务状态
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 用户认证服务已在公网成功启动！');
  console.log(`📍 监听端口: ${PORT}`);
  console.log('📋 路由就绪:');
  console.log('   - POST /api/user/sendSms (发送验证码)');
  console.log('   - POST /api/user/register (用户注册)');
  console.log('===================================================');
  console.log('');
});