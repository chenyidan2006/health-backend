# health-backend

PPG 血管参数测量项目的现役 Node.js + Express + MySQL 后端，默认监听 `3002` 端口。

## 启动

```powershell
Copy-Item .env.example .env
npm install
npm start
```

首次部署前先阅读：

- [数据库创建、迁移、使用与备份](docs/DATABASE_SETUP_AND_USAGE.md)
- [App、算法与后端集成状态](docs/INTEGRATION_STATUS_2026-10-13.md)

本仓库只保存后端服务。服务器接收和 MATLAB 推理程序由 App 主仓库保留版本化快照，并部署在项目的 `算法/服务器部署/` 目录。
