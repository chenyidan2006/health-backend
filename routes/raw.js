const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/health-data', uploadController.uploadHealthData);

// 新增：接收 ESP32 原始二进制流
router.post('/raw',
  express.raw({ type: 'application/octet-stream', limit: '2mb' }),
  (req, res) => {
    const len = req.body ? req.body.length : 0;
    console.log(`收到 ESP32 原始数据: ${len} 字节`);
    // req.body 是 Buffer，可以在这里解析并写库
    // 例如：解析成 心率/血压/血氧后 INSERT INTO user_health_data
    res.json({ errcode: 0, msg: 'received', bytes: len });
  }
);

module.exports = router;