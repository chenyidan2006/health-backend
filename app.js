// app.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// 引入路由
const dataRoutes = require('./routes/data');
const userRoutes = require('./routes/user');

app.use('/api/user', userRoutes);
app.use('/api/data', dataRoutes); // 确保这里挂载了数据路由
console.log('dataRoutes 类型:', typeof dataRoutes); // 应该是 function
console.log('dataRoutes 是否有路由?', dataRoutes.stack ? dataRoutes.stack.length : 0);

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Redis 连接成功'); // 模拟，实际连接在别处
});