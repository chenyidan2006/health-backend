-- 仅用于从旧版数据库升级：旧版 user_devices 缺少下面两列。
-- 脚本会逐列检查，可在 MySQL 5.7/8.x 重复执行，不会删除已有数据。

USE health_monitor;

SET @add_status_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_devices' AND COLUMN_NAME = 'status') = 0,
  'ALTER TABLE user_devices ADD COLUMN status TINYINT NOT NULL DEFAULT 0 COMMENT ''0离线 1在线'' AFTER device_name',
  'SELECT ''user_devices.status already exists'' AS migration_info'
);
PREPARE add_status_stmt FROM @add_status_sql;
EXECUTE add_status_stmt;
DEALLOCATE PREPARE add_status_stmt;

SET @add_last_active_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_devices' AND COLUMN_NAME = 'last_active') = 0,
  'ALTER TABLE user_devices ADD COLUMN last_active DATETIME DEFAULT NULL COMMENT ''最近一次上传时间'' AFTER status',
  'SELECT ''user_devices.last_active already exists'' AS migration_info'
);
PREPARE add_last_active_stmt FROM @add_last_active_sql;
EXECUTE add_last_active_stmt;
DEALLOCATE PREPARE add_last_active_stmt;
