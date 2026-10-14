# MySQL 数据库讲解、建表与使用

后端使用 MySQL，默认数据库名为 `health_monitor`，建议使用 MySQL 8.x。数据库保存账号、设备绑定和计算后的健康指标；原始激光自混合干涉（LSMI）波形不写入 MySQL。

本文不使用一键部署脚本。命令按“检查 MySQL → 登录 → 建库建表 → 创建应用账号 → 配置后端 → 查询与维护”的顺序列出，可逐条执行并核对结果。

## 0. 先理解数据库保存什么

```text
users (1)
  ├──< user_devices (N)
  ├──< user_health_data (N)
  ├──< user_memory (N)
  ├──< ai_advice_log (N)
  └──< ai_chat_sessions (N) ──< ai_chat_messages (N)
```

- `users.id` 是用户主键。
- `user_devices.user_id` 指向用户；`device_id` 全库唯一，一个设备同一时间只能绑定一个用户。
- `user_health_data.user_id` 指向用户，同时保存 `device_id`，便于按用户、设备和时间查询。
- 删除用户时，带外键的设备、测量和 AI 数据会通过 `ON DELETE CASCADE` 一并删除，因此不要直接在生产库随意执行 `DELETE FROM users`。
- 原始波形约 640,000 字节/帧，保存在 `raw-receiver/received/*.bin`；MySQL 只保存算法算出的结构化指标。

## 1. 检查 MySQL

查看客户端版本：

```powershell
mysql --version
```

Windows 查看 MySQL 服务名和状态：

```powershell
Get-Service -Name '*MySQL*'
```

如果服务名是常见的 `MySQL80` 且尚未运行，以管理员 PowerShell 执行：

```powershell
Start-Service MySQL80
```

登录并确认服务器版本：

```powershell
mysql -u root -p
```

进入 MySQL 后执行：

```sql
SELECT VERSION();
SHOW VARIABLES LIKE 'character_set_server';
SHOW VARIABLES LIKE 'collation_server';
```

输入 `EXIT;` 返回 PowerShell。

## 2. 初始化全新数据库

先进入后端目录：

```powershell
Set-Location D:\你的路径\health-backend
mysql -u root -p
```

在 MySQL 提示符中逐条执行：

```sql
SOURCE database/init.sql;
USE health_monitor;
SHOW TABLES;
```

Windows 的 `SOURCE` 也可以使用绝对路径；建议用正斜杠：

```sql
SOURCE D:/你的路径/health-backend/database/init.sql;
```

`database/init.sql` 会创建数据库、三个核心业务表和四个可选 AI 表，但不会删除旧表、清空数据或创建带固定密码的账号：

| 表 | 用途 |
| --- | --- |
| `users` | 手机号/微信用户、资料、密码哈希与登录时间 |
| `user_devices` | 用户与设备的绑定、在线状态和最后上传时间 |
| `user_health_data` | 每次测量的时间、心率、收缩压、舒张压和血氧 |
| `user_memory` | AI 使用的用户长期记忆 |
| `ai_advice_log` | AI 报告输入、输出、模型、兜底和反馈记录 |
| `ai_chat_sessions` | AI 对话会话（当前预留） |
| `ai_chat_messages` | AI 对话消息（当前预留） |

## 3. 建表语句如何理解

每张表的核心结构都在 [`../database/init.sql`](../database/init.sql)。以测量表为例：

```sql
CREATE TABLE IF NOT EXISTS user_health_data (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  measure_time DATETIME NOT NULL,
  heart_rate SMALLINT UNSIGNED DEFAULT NULL,
  systolic_bp SMALLINT UNSIGNED DEFAULT NULL,
  diastolic_bp SMALLINT UNSIGNED DEFAULT NULL,
  spo2 TINYINT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_measure (user_id, measure_time),
  KEY idx_device_measure (device_id, measure_time),
  CONSTRAINT fk_health_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- `PRIMARY KEY` 唯一标识一条测量。
- `AUTO_INCREMENT` 自动生成递增编号。
- `NOT NULL` 表示业务必须提供该值。
- `KEY idx_user_measure` 加速“某用户按时间查询”的 App 页面。
- `FOREIGN KEY` 防止写入一个根本不存在的用户。
- `IF NOT EXISTS` 使全新初始化可以重复执行，但不会自动修改已经存在的旧表结构；旧库升级要使用迁移脚本。

查看 MySQL 实际保存的建表语句：

```sql
USE health_monitor;
SHOW CREATE TABLE users\G
SHOW CREATE TABLE user_devices\G
SHOW CREATE TABLE user_health_data\G
```

## 4. 创建数据库账号

先登录 MySQL：

```powershell
mysql -u root -p
```

然后创建应用专用账号。请自行替换强密码，不要把真实密码提交到 Git：

```sql
CREATE USER IF NOT EXISTS 'health_app'@'localhost' IDENTIFIED BY '请替换为强密码';
GRANT SELECT, INSERT, UPDATE, DELETE ON health_monitor.* TO 'health_app'@'localhost';
FLUSH PRIVILEGES;
```

如果后端与 MySQL 不在同一台机器，需要按实际来源主机创建账号，并同时配置防火墙和 MySQL TLS；不要直接把 root 账号给应用使用。

验证权限：

```sql
SHOW GRANTS FOR 'health_app'@'localhost';
```

退出 root，再用应用账号测试登录：

```powershell
mysql -u health_app -p health_monitor
```

登录后执行：

```sql
SELECT DATABASE();
SHOW TABLES;
```

## 5. 升级已有数据库

旧版初始化脚本没有 `user_devices.status` 和 `user_devices.last_active`。先检查：

```sql
USE health_monitor;
SHOW COLUMNS FROM user_devices LIKE 'status';
SHOW COLUMNS FROM user_devices LIKE 'last_active';
```

缺少任意一列时，在 MySQL 中执行：

```sql
SOURCE database/migrations/2026-10-13_add_device_status.sql;
```

迁移脚本会逐列检查，已存在的列会跳过，可安全重复执行。正式服务器迁移前仍应先备份。

如果已有数据库缺少 AI 表，可安全重复执行：

```sql
SOURCE database/migrations/2026-10-13_add_ai_memory.sql;
```

AI 表不存在时核心测量功能仍可工作，但用户记忆和建议留痕会降级关闭。

## 6. 配置并启动后端

每条命令单独执行：

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm start
```

关键配置如下：

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=health_app
DB_PASSWORD=你的真实强密码
DB_NAME=health_monitor
DB_TIMEZONE=+08:00
PORT=3002
JWT_SECRET=你的长随机字符串
```

`.env` 已被 Git 忽略，不能上传。后端成功连接数据库后监听 `3002`；服务器算法通过 `POST /api/upload/health-data` 写入结果，App 通过 `/api/data/*` 和 `/api/user/*` 使用数据。

另开 PowerShell 验证后端：

```powershell
Invoke-RestMethod http://127.0.0.1:3002/api/health
```

## 7. 数据如何进入数据库

```text
App 注册/登录 ───────────────► users
App 绑定设备 ────────────────► user_devices
设备波形 → 服务器算法 → 后端 ─► user_health_data
                              └► 更新 user_devices.status / last_active
```

原始波形的 `.bin`、元数据 `.json` 和训练清单位于服务器 `raw-receiver/received/`，不在 MySQL 中。当前数据库也没有“袖带真实血压/训练标签”表；App 中的真值录入页面尚未接通，不能把 `user_health_data` 中的算法预测值当作训练真值。

## 8. 日常查看与使用

检查表结构和数据量：

```sql
USE health_monitor;
SHOW TABLES;
DESCRIBE users;
DESCRIBE user_devices;
DESCRIBE user_health_data;
DESCRIBE user_memory;
DESCRIBE ai_advice_log;
SELECT COUNT(*) AS users_count FROM users;
SELECT COUNT(*) AS devices_count FROM user_devices;
SELECT COUNT(*) AS measurements_count FROM user_health_data;
SELECT * FROM user_health_data ORDER BY measure_time DESC LIMIT 10;
```

查看用户、绑定设备和最新测量之间的关系：

```sql
SELECT
  u.id AS user_id,
  u.phone,
  d.device_id,
  d.status,
  d.last_active
FROM users AS u
LEFT JOIN user_devices AS d ON d.user_id = u.id
ORDER BY u.id DESC;
```

按设备查看最近 20 条测量：

```sql
SELECT
  device_id,
  measure_time,
  systolic_bp,
  diastolic_bp,
  heart_rate,
  spo2
FROM user_health_data
WHERE device_id = 'ESP32_001'
ORDER BY measure_time DESC
LIMIT 20;
```

按天统计测量次数：

```sql
SELECT
  DATE(measure_time) AS measure_date,
  COUNT(*) AS measurement_count
FROM user_health_data
GROUP BY DATE(measure_time)
ORDER BY measure_date DESC;
```

检查某设备是否已经绑定：

```sql
SELECT *
FROM user_devices
WHERE device_id = 'ESP32_001';
```

正常业务数据应通过后端 API 写入，不建议手工 `INSERT`，因为后端还负责查找设备所属用户并更新设备在线状态。算法写库请求示例：

```powershell
$body = @{
  deviceId = 'ESP32_001'
  measureTime = (Get-Date).ToUniversalTime().ToString('o')
  systolicBp = 125
  diastolicBp = 82
  heartRate = 78
  spo2 = 98
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3002/api/upload/health-data `
  -ContentType 'application/json' `
  -Body $body
```

这条命令会写入数据库，且其中 `spo2=98` 只是当前链路的占位值。只应在测试账号和测试设备上执行。

## 9. 备份与恢复

备份：

```powershell
mysqldump -u root -p --single-transaction --routines --triggers health_monitor > health_monitor_backup.sql
```

恢复前先确认目标环境和备份文件，恢复会把 SQL 中的数据写入目标数据库：

```powershell
cmd /c "mysql -u root -p health_monitor < health_monitor_backup.sql"
```

备份文件可能包含个人健康数据和账号信息，不应提交 GitHub；应加密保存并限制访问。

查看备份文件是否生成：

```powershell
Get-Item .\health_monitor_backup.sql
```

恢复前先创建空数据库并确认当前连接目标。恢复操作会写入数据，不要在未备份的生产库上试验。

## 10. 常见问题

### `mysql` 不是内部或外部命令

MySQL 的 `bin` 目录没有加入 PATH。可使用安装目录中的完整路径，例如：

```powershell
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' --version
```

### `Access denied for user`

检查 `.env` 中的 `DB_USER/DB_PASSWORD` 是否与 `CREATE USER` 完全一致，并用 root 执行：

```sql
SHOW GRANTS FOR 'health_app'@'localhost';
```

### `ECONNREFUSED 127.0.0.1:3306`

检查 MySQL 服务：

```powershell
Get-Service -Name '*MySQL*'
```

同时确认 `.env` 中 `DB_HOST=localhost`、`DB_PORT=3306`。

### App 能登录但看不到设备数据

依次检查：

```sql
SELECT * FROM user_devices WHERE device_id = 'ESP32_001';
SELECT * FROM user_health_data WHERE device_id = 'ESP32_001' ORDER BY measure_time DESC LIMIT 5;
```

固件的 `X-Device-Id`、算法上传的 `deviceId` 和 App 绑定的设备号必须完全一致。

## 11. 当前仍需改进的数据字段

当前 `user_health_data` 还不能记录 `is_fallback`、`prediction_status` 或失败原因，而服务器算法失败时可能启用兜底预测；当前服务器还固定上传 `spo2=98`。这些值不能直接用于模型训练或医学结论，后续应先扩展数据表和上传接口再采集正式训练数据。
