const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const router = express.Router();

// CSV 文件存放目录（请根据实际情况修改）
const CSV_DIR = 'C:/SMI_Pulse_Server/';

// 辅助函数：安全地解析文件名，防止路径遍历
function isValidFileName(fileName) {
    // 只允许字母、数字、下划线、点和短横线，并且以 .csv 结尾
    return /^[a-zA-Z0-9_\-]+\.csv$/.test(fileName);
}

// GET /api/csv/files - 获取所有 CSV 文件列表
router.get('/files', (req, res) => {
    fs.readdir(CSV_DIR, (err, files) => {
        if (err) {
            console.error('读取目录失败:', err);
            return res.status(500).json({ error: '无法读取 CSV 目录' });
        }
        // 过滤出 .csv 文件并按名称排序
        const csvFiles = files
            .filter(file => file.toLowerCase().endsWith('.csv') && isValidFileName(file))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); // 自然排序，001 在 002 之前
        res.json(csvFiles);
    });
});

// GET /api/csv/data?file=001.csv&page=1&limit=100 - 获取指定文件的分页数据
router.get('/data', (req, res) => {
    const { file, page = 1, limit = 100 } = req.query;
    if (!file) {
        return res.status(400).json({ error: '缺少 file 参数' });
    }
    // 安全校验：防止路径遍历
    if (!isValidFileName(file)) {
        return res.status(400).json({ error: '非法的文件名' });
    }

    const filePath = path.join(CSV_DIR, file);
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件不存在' });
    }

    const results = [];
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            const total = results.length;
            const start = (page - 1) * limit;
            const end = start + parseInt(limit);
            const paginatedData = results.slice(start, end);

            res.json({
                file,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                data: paginatedData
            });
        })
        .on('error', (err) => {
            console.error('解析 CSV 失败:', err);
            res.status(500).json({ error: '文件读取失败' });
        });
});

module.exports = router;