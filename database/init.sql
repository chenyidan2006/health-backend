-- 1. 创建新数据库
CREATE DATABASE health_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2. 创建专用应用用户（不要用 root 连接应用！）
CREATE USER 'health_app'@'localhost' IDENTIFIED BY 'bjut@1234';

-- 3. 只授予必要权限
GRANT SELECT, INSERT, UPDATE, DELETE ON health_monitor.* TO 'health_app'@'localhost';
FLUSH PRIVILEGES;

-- 4. 确认创建成功
SHOW DATABASES;
SELECT User, Host FROM mysql.user WHERE User='health_app';

-- 创建用户表
USE health_monitor;

DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  password VARCHAR(255) DEFAULT NULL COMMENT 'bcrypt 哈希后的密码',
  wechat_openid VARCHAR(64) DEFAULT NULL COMMENT '微信 openid',
  nickname VARCHAR(50) DEFAULT NULL COMMENT '昵称',
  avatar VARCHAR(255) DEFAULT NULL COMMENT '头像 URL',
  gender TINYINT DEFAULT 0 COMMENT '0未知 1男 2女',
  birthday DATE DEFAULT NULL,
  height DECIMAL(5,2) DEFAULT NULL COMMENT '身高 cm',
  weight DECIMAL(5,2) DEFAULT NULL COMMENT '体重 kg',
  email VARCHAR(100) DEFAULT NULL,
  is_guest TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否游客',
  last_login DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_phone (phone),
  UNIQUE KEY uk_wechat_openid (wechat_openid),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 用户设备绑定表
CREATE TABLE user_devices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  device_id VARCHAR(64) NOT NULL COMMENT '设备唯一标识',
  device_name VARCHAR(50) DEFAULT NULL COMMENT '设备别名',
  bind_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_device_id (device_id),
  KEY idx_user_id (user_id),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户设备绑定表';

-- 健康数据表
CREATE TABLE user_health_data (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  measure_time DATETIME NOT NULL COMMENT '测量时间',
  heart_rate SMALLINT UNSIGNED DEFAULT NULL COMMENT '心率 bpm',
  systolic_bp SMALLINT UNSIGNED DEFAULT NULL COMMENT '收缩压 mmHg',
  diastolic_bp SMALLINT UNSIGNED DEFAULT NULL COMMENT '舒张压 mmHg',
  spo2 TINYINT UNSIGNED DEFAULT NULL COMMENT '血氧饱和度 %',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_measure (user_id, measure_time),
  KEY idx_device_measure (device_id, measure_time),
  KEY idx_measure_time (measure_time),
  CONSTRAINT fk_health_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户健康数据表';