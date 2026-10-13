-- health-backend 全新环境初始化脚本
-- 只创建数据库和业务表，不创建账号、不写入密码，也不会删除已有数据。

CREATE DATABASE IF NOT EXISTS health_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE health_monitor;

CREATE TABLE IF NOT EXISTS users (
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
CREATE TABLE IF NOT EXISTS user_devices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  device_id VARCHAR(64) NOT NULL COMMENT '设备唯一标识',
  device_name VARCHAR(50) DEFAULT NULL COMMENT '设备别名',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0离线 1在线',
  last_active DATETIME DEFAULT NULL COMMENT '最近一次上传时间',
  bind_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_device_id (device_id),
  KEY idx_user_id (user_id),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户设备绑定表';

-- 健康数据表
CREATE TABLE IF NOT EXISTS user_health_data (
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

-- 以下四张表用于可选的 AI 建议、长期记忆和对话留痕。
CREATE TABLE IF NOT EXISTS user_memory (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'context',
  key_name VARCHAR(64) NOT NULL,
  value VARCHAR(500) NOT NULL,
  source VARCHAR(10) NOT NULL DEFAULT 'user',
  confidence TINYINT UNSIGNED NOT NULL DEFAULT 100,
  last_used_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_memory (user_id, kind, key_name),
  KEY idx_user_memory_updated (user_id, updated_at),
  CONSTRAINT fk_memory_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 用户长期记忆';

CREATE TABLE IF NOT EXISTS ai_advice_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind VARCHAR(10) NOT NULL DEFAULT 'report',
  input_snapshot JSON DEFAULT NULL,
  output JSON DEFAULT NULL,
  model VARCHAR(100) DEFAULT NULL,
  prompt_version VARCHAR(50) DEFAULT NULL,
  used_fallback TINYINT(1) NOT NULL DEFAULT 0,
  feedback TINYINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_advice_user_created (user_id, created_at),
  CONSTRAINT fk_advice_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 建议生成日志';

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  title VARCHAR(100) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_chat_session_user (user_id, updated_at),
  CONSTRAINT fk_chat_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 对话会话';

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  metadata JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_message_session (session_id, created_at),
  CONSTRAINT fk_chat_message_session FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 对话消息';
