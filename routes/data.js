// routes/data.js

const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataQueryController');
const authMiddleware = require('../middleware/auth');
console.log('dataController 内容:', Object.keys(dataController));

router.get('/test', (req, res) => {
  res.json({ message: 'test ok' });
});
// 所有数据接口都需要认证
router.get('/dailySummary', authMiddleware, dataController.getDailySummary);
router.get('/realtime', authMiddleware, dataController.getRealtimeDataHandler);
router.get('/availableDates', authMiddleware, dataController.getAvailableDates);
router.get('/deviceStatus', authMiddleware, dataController.getDeviceStatus);
router.get('/historyTrend', authMiddleware, dataController.getHistoryTrend);
router.get('/hourlyRange', authMiddleware, dataController.getHourlyRange);

module.exports = router;