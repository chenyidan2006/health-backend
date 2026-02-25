//D:/code/app/appprogram/health-backend/routes/upload.js
const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/', uploadController.uploadPulseData);

module.exports = router;