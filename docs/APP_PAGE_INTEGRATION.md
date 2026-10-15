# App 页面配套接口（2026-10-15）

此次只接通页面依赖的接口；没有数据库迁移，不修改测量表结构，不清理已有数据库记录。

## 手工更新

```powershell
cd D:\project\PPG\App\appprogram\health-backend
$env:PATH = 'D:\project\PPG\工具\运行环境\node-v22.14.0-win-x64;' + $env:PATH
npm ci
```

保留已有.env；在.env中设置原始帧目录，接收服务与后端必须指向同一个目录：

```text
RAW_DATA_DIR=D:\project\PPG\算法\服务器部署\raw-receiver\received
```

```powershell
npm test
npm start
```

如果用PM2，请按已有进程名手工重启，不要同时运行第二份监听3002的后端。部署到其他目录必须填写RAW_DATA_DIR；默认相对路径只为兼容现有本地结构。

## 接口与文件

| 接口 | 鉴权 | 行为 |
| --- | --- | --- |
| GET /api/data/waveform?deviceId=… | JWT+绑定关系 | 读取最新原始帧，返回40 kHz连续单通道显示数据；ch=2仅保留为legacyHeaderChannels |
| GET /api/training/sessions/pending?deviceId=… | JWT+绑定关系 | 最多100条待标注原始帧，不返回服务器路径 |
| PUT /api/training/sessions/:sha256/reference | JWT+绑定关系 | 保存人工袖带值；重新计算原始帧哈希，拒绝被改动的文件 |
| POST /api/user/avatar | JWT | multipart字段avatar，最多2 MB，校验PNG/JPEG/WebP文件头 |
| POST /api/user/reset-password | 六位一次性验证码 | 6至72字符密码；当前验证码在服务器控制台获取；15分钟内每IP/手机号最多5次尝试 |

真值请求示例：

```json
{"deviceId":"ESP32_001","subjectId":"P001","referenceSbp":120,"referenceDbp":80,"referenceHr":75}
```

标注保存在 `raw_*.bin.reference.json`，不是MySQL预测记录。文件记录frameSha256、匿名subjectId、参考血压/心率、录入时间和labeledBy。featureExtractionStatus固定为not-extracted，表示尚未提取特征。已标注帧从pending中消失；原始帧不变。

头像保存到 `data/avatars/UUID.ext`，沿用users已有avatar字段保存 `/avatars/UUID.ext`，静态地址可读取。换头像不会自动删除之前的图片，后续可单独清理孤立文件。

## 隔离测试与边界

`npm test`使用模拟数据库、合成帧和临时目录，不读取真实.env、不连接MySQL、不调用AI。覆盖个人资料缺字段、鉴权与绑定、单通道波形、真值标注和错误输入、重置码一次性消费、图片格式拒绝。

重置密码后现有JWT仍按原7天规则有效；本次没有增加撤销令牌表。短信服务商、微信/QQ平台凭据、正式HTTPS和设备上传接口加固仍待独立处理。
