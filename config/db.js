// config/db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'health_monitor',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  // Use China local wall-clock time consistently and do not let JSON
  // serialization silently convert MySQL DATETIME values back to UTC.
  timezone: process.env.DB_TIMEZONE || '+08:00',
  dateStrings: true
});

module.exports = pool;

// 启动时测试连接
module.exports.connectDB = async () => {
  const conn = await pool.getConnection();
  conn.release();               // release 是同步方法，不加 await
  console.log('✅ MySQL 连接成功');
};
