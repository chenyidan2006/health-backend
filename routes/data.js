// routes/data.js
const express = require('express');
const router = express.Router();
const dataQueryController = require('../controllers/dataQueryController');
const authMiddleware = require('../middleware/auth');

// 所有数据查询都需要认证
router.get('/daily-summary', authMiddleware, dataQueryController.getDailySummary);
router.get('/hourly-range', authMiddleware, dataQueryController.getHourlyRange);
router.get('/realtime', authMiddleware, dataQueryController.getRealtimeDataHandler);
router.get('/available-dates', authMiddleware, dataQueryController.getAvailableDates);
router.get('/device/status', authMiddleware, dataQueryController.getDeviceStatus);
router.get('/history-trend', authMiddleware, dataQueryController.getHistoryTrend);
router.get('/range-records', authMiddleware, dataQueryController.getRangeRecords);

module.exports = router;