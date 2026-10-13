# 数据库创建与使用

后端使用 MySQL，默认数据库名为 `health_monitor`，建议使用 MySQL 8.x。数据库保存账号、设备绑定和计算后的健康指标；原始 PPG 波形不写入 MySQL。

## 1. 初始化全新数据库

在 `health-backend` 目录用有管理权限的账号执行初始化：

```powershell
cmd /c "mysql -u root -p < database\init.sql"
```

Linux/macOS shell 可使用 `mysql -u root -p < database/init.sql`。

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

## 2. 创建数据库账号

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

## 3. 升级已有数据库

旧版初始化脚本没有 `user_devices.status` 和 `user_devices.last_active`。先检查：

```sql
USE health_monitor;
SHOW COLUMNS FROM user_devices LIKE 'status';
SHOW COLUMNS FROM user_devices LIKE 'last_active';
```

缺少任意一列时执行：

```powershell
cmd /c "mysql -u root -p < database\migrations\2026-10-13_add_device_status.sql"
```

迁移脚本会逐列检查，已存在的列会跳过，可安全重复执行。正式服务器迁移前仍应先备份。

如果已有数据库缺少 AI 表，可安全重复执行：

```powershell
cmd /c "mysql -u root -p < database\migrations\2026-10-13_add_ai_memory.sql"
```

AI 表不存在时核心测量功能仍可工作，但用户记忆和建议留痕会降级关闭。

## 4. 配置并启动后端

复制示例配置，然后填写本机参数：

```powershell
Copy-Item .env.example .env
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

## 5. 数据如何进入数据库

```text
App 注册/登录 ───────────────► users
App 绑定设备 ────────────────► user_devices
设备波形 → 服务器算法 → 后端 ─► user_health_data
                              └► 更新 user_devices.status / last_active
```

原始波形的 `.bin`、元数据 `.json` 和训练清单位于服务器 `raw-receiver/received/`，不在 MySQL 中。当前数据库也没有“袖带真实血压/训练标签”表；App 中的真值录入页面尚未接通，不能把 `user_health_data` 中的算法预测值当作训练真值。

## 6. 验证

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

检查后端健康状态：

```powershell
Invoke-RestMethod http://127.0.0.1:3002/api/health
```

## 7. 备份与恢复

备份：

```powershell
mysqldump -u root -p --single-transaction --routines --triggers health_monitor > health_monitor_backup.sql
```

恢复前先确认目标环境和备份文件，恢复会把 SQL 中的数据写入目标数据库：

```powershell
cmd /c "mysql -u root -p health_monitor < health_monitor_backup.sql"
```

备份文件可能包含个人健康数据和账号信息，不应提交 GitHub；应加密保存并限制访问。

## 8. 当前仍需改进的数据字段

当前 `user_health_data` 还不能记录 `is_fallback`、`prediction_status` 或失败原因，而服务器算法失败时可能启用兜底预测；当前服务器还固定上传 `spo2=98`。这些值不能直接用于模型训练或医学结论，后续应先扩展数据表和上传接口再采集正式训练数据。
