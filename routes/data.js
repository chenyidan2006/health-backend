//D:/code/app/appprogram/health-backend/routes/data.js
const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataQueryController');

router.get('/dailySummary', dataController.getDailySummary);
router.get('/realtime', dataController.getRealtimeDataHandler);
router.get('/availableDates', dataController.getAvailableDates);
router.get('/deviceStatus', dataController.getDeviceStatus);
router.get('/historyTrend', dataController.getHistoryTrend);
router.get('/hourlyRange', dataController.getHourlyRange);

module.exports = router;