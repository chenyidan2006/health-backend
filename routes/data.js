const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataQueryController');

router.get('/dailySummary', dataController.getDailySummary);
router.get('/realtime', dataController.getRealtimeDataHandler);
router.get('/availableDates', dataController.getAvailableDates);
router.get('/deviceStatus', dataController.getDeviceStatus);
router.get('/historyTrend', dataController.getHistoryTrend);

module.exports = router;