// app.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' })); // 支持大 JSON（电压数据）
// 配置 CORS 选项
const corsOptions = {
    origin: ['http://localhost:8081', 'http://127.0.0.1:8081'], // 允许的源
    credentials: true, // 允许携带Cookie
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions)); // 使用 CORS 中间件

// 引入路由
const uploadRoutes = require('./routes/upload');
const dataRoutes = require('./routes/data');
const summaryRoutes = require('./routes/summary');
const csvRoutes = require('./routes/csv');

app.use('/api/upload', uploadRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/csv', csvRoutes); 

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});