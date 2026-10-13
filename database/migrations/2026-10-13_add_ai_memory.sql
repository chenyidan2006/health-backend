-- 为已有数据库补充可选的 AI 记忆、建议日志和对话表。
-- 全部使用 IF NOT EXISTS，可重复执行且不会删除已有数据。

USE health_monitor;

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
