# 血管参数测量系统后端

激光自混合干涉（LSMI）血管参数测量项目的现役 Node.js + Express + MySQL 后端，默认监听 `3002` 端口。它接收服务器算法计算后的健康指标，为 App 提供账号、设备绑定、趋势数据和 AI 健康报告接口。

## 启动

```powershell
Copy-Item .env.example .env
npm install
npm start
```

首次部署前先阅读：

- [MySQL 讲解、逐步建表、查询、迁移与备份](docs/DATABASE_SETUP_AND_USAGE.md)
- [端口、算法写库与 App 接口关系](docs/PORTS_AND_INTEGRATION.md)

本仓库只保存后端服务。App、ESP32 固件、服务器接收与 MATLAB 推理程序位于 [`laser-self-mixing-vascular-monitoring`](https://github.com/chenyidan2006/laser-self-mixing-vascular-monitoring)。

## 接口状态

- 已接通：`POST /api/upload/health-data`、`/api/data/*`、`/api/user/*`。
- 尚未接通：袖带血压真值采集 `/api/training`，因此目前不能保存真值与原始波形的对应关系。
- 已知限制：服务器算法失败时可能上传兜底血压；当前表结构无法区分兜底值。服务器上传的 `spo2=98` 仍是占位值，不是血氧算法结果。

## 端口关系

- `3002`：本后端，供算法写入预测结果、App 登录和查询。
- `3306`：MySQL，只应允许本机或内网访问。
- `3000`：另一个仓库中的原始 SMI 帧接收器，不属于本后端。
- 算法是本地 Python/MATLAB 子进程，不额外监听端口。

## 安全说明

- `.env`、数据库备份、日志、原始波形和 `node_modules` 均不进入 Git。
- `JWT_SECRET` 必须在环境变量中设置为至少 32 个字符；服务不会再使用公开的默认密钥。
- 浏览器跨域来源通过 `CORS_ORIGINS` 配置，多个来源用英文逗号分隔。
- `POST /api/upload/health-data` 当前依靠网络侧访问控制保护；正式公网部署前应增加设备级认证和限流。

这是竞赛和科研原型，不是医疗器械，输出结果不能用于诊断。
