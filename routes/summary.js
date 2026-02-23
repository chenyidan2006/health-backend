const express = require('express');
const router = express.Router();
const summaryController = require('../controllers/summaryController');

router.post('/run', summaryController.runDailySummary);

module.exports = router;