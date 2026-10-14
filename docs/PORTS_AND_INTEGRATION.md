# 端口与系统集成

## 服务边界

本仓库只运行业务后端，默认监听 TCP `3002`。原始 SMI 波形不是直接上传到这里，而是先发送到主仓库的 `raw-receiver`（TCP `3000`）；算法处理完成后才把结构化结果写入本后端。

```text
ESP32 ──POST :3000/api/upload/raw──> raw-receiver
                                           │ Python + MATLAB，本地进程
                                           ▼
                                  POST :3002/api/upload/health-data
                                           │
App ──登录/设备/数据查询 :3002──────────────┤
                                           ▼
                                      MySQL :3306
```

## 端口表

| 端口 | 服务 | 调用方 | 建议 |
| --- | --- | --- | --- |
| `3002` | `health-backend/app.js` | App、服务器算法 | App 直连时开放；生产环境优先通过 HTTPS 443 反代 |
| `3306` | MySQL | 仅本后端 | 不向公网开放 |
| `3000` | 主仓库的 `raw-receiver` | ESP32 | 不由本仓库启动；当前固件直连时需要开放或反代 |
| `5173/8080` | 本地 H5 开发服务器 | 浏览器调试 | 仅用于 CORS 允许列表，不是生产后端端口 |

## 算法写库接口

`frame_pipeline.py` 默认向下面的地址发请求：

```text
POST http://127.0.0.1:3002/api/upload/health-data
```

JSON 示例：

```json
{
  "deviceId": "ESP32_001",
  "measureTime": "2026-10-14T12:00:00Z",
  "systolicBp": 125,
  "diastolicBp": 82,
  "heartRate": 78,
  "spo2": 98
}
```

`deviceId` 必须已绑定到 App 用户。当前接口依靠服务器网络隔离，没有设备密钥；部署到公网前应增加服务间令牌、请求签名或至少防火墙来源限制和限流。`spo2=98` 是占位值，不代表真实血氧测量。

如果算法和后端不在同一台机器，通过算法环境变量覆盖地址：

```powershell
$env:HEALTH_BACKEND_URL = 'http://<backend-host>:3002/api/upload/health-data'
```

## App 使用的接口

现役 App 的 `src/config/api.js` 指向 `3002`，主要接口包括：

| 类型 | 方法与路径 | 是否需要登录令牌 |
| --- | --- | --- |
| 健康检查 | `GET /api/health` | 否 |
| 注册/登录 | `POST /api/user/register`、`POST /api/user/login` | 否 |
| 游客登录 | `POST /api/user/guestLogin` | 否 |
| 用户资料 | `GET/PUT /api/user/profile` | 是 |
| 设备列表/绑定 | `GET /api/user/devices`、`POST /api/user/devices/bind` | 是 |
| 设备解绑 | `DELETE /api/user/devices/:deviceId` | 是 |
| 实时数据 | `GET /api/data/realtime` | 是 |
| 历史趋势 | `GET /api/data/history-trend` | 是 |
| 区间记录 | `GET /api/data/range-records` | 是 |
| 每日/小时汇总 | `GET /api/data/daily-summary`、`GET /api/data/hourly-range` | 是 |
| AI 健康建议 | `POST /api/ai/health-advice` | 是 |

登录成功后，App 在 `Authorization: Bearer <JWT>` 中携带令牌。浏览器 H5 还必须满足 `CORS_ORIGINS`；原生 App 和服务器间调用通常没有 `Origin`。

## 启动与验证

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少填写 DB_* 和长度不少于 32 的 JWT_SECRET
npm install
npm start
Invoke-RestMethod http://127.0.0.1:3002/api/health
```

启动时先连接 MySQL，数据库不可用会导致服务无法正常提供数据功能。建库、迁移和备份步骤见 [DATABASE_SETUP_AND_USAGE.md](DATABASE_SETUP_AND_USAGE.md)。

## 推荐网络策略

1. MySQL `3306` 只允许本机或服务器内网。
2. 原始接收 `3000` 只允许设备出口 IP，或经带设备认证的 HTTPS 网关。
3. App API `3002` 通过 Nginx/Caddy 暴露为 HTTPS `443`，避免 App 直接使用明文 HTTP。
4. 算法与后端同机时继续使用 `127.0.0.1:3002`，无需绕公网。
5. 云安全组、系统防火墙和反向代理三处规则保持一致。
