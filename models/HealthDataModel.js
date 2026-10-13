// models/HealthDataModel.js
const pool = require('../config/db');

class HealthDataModel {
  // 某用户某设备某天的所有记录
  static async findByUserAndDate(userId, date, deviceId = null) {
    let sql = `SELECT measure_time as timestamp, heart_rate, systolic_bp, diastolic_bp, spo2
               FROM user_health_data WHERE user_id = ? AND DATE(measure_time) = ?`;
    const params = [userId, date];
    if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
    sql += ' ORDER BY measure_time ASC';
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  // 某用户某天按小时聚合
  static async getHourlyRange(userId, date, deviceId = null) {
    let sql = `SELECT HOUR(measure_time) as hour, heart_rate, systolic_bp, diastolic_bp, spo2
               FROM user_health_data WHERE user_id = ? AND DATE(measure_time) = ?`;
    const params = [userId, date];
    if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  // 实时数据
  static async getRealtimeData(userId, deviceId = null, minutes = 10) {
    const cutoff = new Date(Date.now() - minutes * 60000)
      .toISOString().slice(0, 19).replace('T', ' ');
    let sql = `SELECT heart_rate, systolic_bp, diastolic_bp, spo2, measure_time as timestamp
               FROM user_health_data WHERE user_id = ? AND measure_time >= ?`;
    const params = [userId, cutoff];
    if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
    sql += ' ORDER BY measure_time ASC';
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  // 有数据的日期列表
  static async getAvailableDates(userId, deviceId = null, limit = 30) {
    let sql = `SELECT DISTINCT DATE(measure_time) as date FROM user_health_data WHERE user_id = ?`;
    const params = [userId];
    if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
    sql += ' ORDER BY date DESC LIMIT ?';
    params.push(parseInt(limit));
    const [rows] = await pool.execute(sql, params);
    return rows.map(r => r.date);
  }

  // 最新记录时间
  static async getLatestRecordTime(userId, deviceId = null) {
    let sql = `SELECT measure_time as timestamp FROM user_health_data WHERE user_id = ?`;
    const params = [userId];
    if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
    sql += ' ORDER BY measure_time DESC LIMIT 1';
    const [rows] = await pool.execute(sql, params);
    return rows[0] ? rows[0].timestamp : null;
  }

  // 某天记录数
  static async getTodayRecordCount(userId, date, deviceId = null) {
    let sql = `SELECT COUNT(*) as count FROM user_health_data WHERE user_id = ? AND DATE(measure_time) = ?`;
    const params = [userId, date];
    if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
    const [rows] = await pool.execute(sql, params);
    return rows[0].count;
  }

  // 历史趋势
	static async getHistoryTrend(userId, startDate, endDate, deviceId = null, metric = 'heart_rate') {
	  const metricMap = {
		heart_rate: 'heart_rate',
		systolic_bp: 'systolic_bp',
		diastolic_bp: 'diastolic_bp',
		spo2: 'spo2'
	  };
	  const col = metricMap[metric] || 'heart_rate';
	  let sql = `SELECT DATE(measure_time) as date, AVG(${col}) as avg_value
				 FROM user_health_data WHERE user_id = ? AND DATE(measure_time) BETWEEN ? AND ?`;
	  const params = [userId, startDate, endDate];
	  if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
	  sql += ' GROUP BY DATE(measure_time) ORDER BY date ASC';
	  const [rows] = await pool.execute(sql, params);
	  // 直接返回 date + value，控制器里直接用 row.value
	  return rows.map(r => ({ date: r.date, value: r.avg_value }));
	}

  // 范围记录
  static async getRangeRecords(userId, startDate, endDate, deviceId = null) {
    let sql = `SELECT DATE_FORMAT(measure_time, '%Y-%m-%d %H:%i:%s') as measure_time,
                      heart_rate, systolic_bp, diastolic_bp, spo2
               FROM user_health_data
               WHERE user_id = ? AND measure_time >= ?
                 AND measure_time < DATE_ADD(?, INTERVAL 1 DAY)`;
    const params = [userId, startDate, endDate];
    if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
    sql += ' ORDER BY measure_time DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    return rows;
  }
}

module.exports = HealthDataModel;
