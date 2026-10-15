// routes/data.js
const express = require('express');
const router = express.Router();
const dataQueryController = require('../controllers/dataQueryController');
const authMiddleware = require('../middleware/auth');
const pool = require('../config/db');
const waveform = require('../services/waveform');
router.get('/waveform', authMiddleware, async (req,res) => {
  try {
    const deviceId = req.query.deviceId;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId || '')) return res.status(400).json({errcode:400,msg:'请选择设备'});
    const [rows] = await pool.execute('SELECT id FROM user_devices WHERE user_id = ? AND device_id = ?', [req.user.id,deviceId]);
    if (!rows.length) return res.status(403).json({errcode:403,msg:'此设备未绑定当前账号'});
    res.json({errcode:0,data:await waveform.latest(deviceId)});
  } catch(err) { console.error('waveform:',err); res.status(500).json({errcode:500,msg:'读取波形失败'}); }
});

// 所有数据查询都需要认证
router.get('/daily-summary', authMiddleware, dataQueryController.getDailySummary);
router.get('/hourly-range', authMiddleware, dataQueryController.getHourlyRange);
router.get('/realtime', authMiddleware, dataQueryController.getRealtimeDataHandler);
router.get('/available-dates', authMiddleware, dataQueryController.getAvailableDates);
router.get('/device/status', authMiddleware, dataQueryController.getDeviceStatus);
router.get('/history-trend', authMiddleware, dataQueryController.getHistoryTrend);
router.get('/range-records', authMiddleware, dataQueryController.getRangeRecords);

module.exports = router;
