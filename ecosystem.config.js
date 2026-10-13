module.exports = {
  apps: [{
    name: 'health-backend',          // 应用名称(与之前 pm2 list 中一致)
    script: './app.js',              // 入口文件
    max_memory_restart: '512M',      // 内存超过 512MB 自动重启
    node_args: '--max-old-space-size=512', // V8 内存限制
    instances: 1,                    // 单实例
    exec_mode: 'fork',               // fork 模式
    env: {
      NODE_ENV: 'production'
    }
  }]
}