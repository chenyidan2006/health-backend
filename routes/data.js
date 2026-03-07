// routes/data.js
const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataQueryController');
const authMiddleware = require('../middleware/auth');

// 重要：确保路由路径正确
router.get('/hourlyRange', authMiddleware, dataController.getHourlyRange);

module.exports = router;