/**
 * PM2 进程管理配置
 * 企业实践：PM2 提供进程守护（崩溃自动重启）、集群模式（利用多核 CPU）、零停机热更新
 * 面试话术：
 *   "Node.js 是单线程的，一个进程崩了全站就挂了。
 *    我用 PM2 cluster 模式启动多个进程实例，既能利用多核 CPU，
 *    又有进程守护——一个 worker 崩了 PM2 会自动拉起，用户无感知。"
 *
 * 用法：
 *   开发: pm2 start ecosystem.config.js --env development
 *   生产: pm2 start ecosystem.config.js --env production
 *   重启: pm2 reload ecosystem.config.js
 *   监控: pm2 monit
 *   开机自启: pm2 startup && pm2 save
 */
module.exports = {
  apps: [{
    name: 'local-chat-app',
    script: './server.js',

    // 集群模式：'max' = CPU 核心数（生产环境）
    // 开发环境用 1 个实例方便调试
    instances: process.env.NODE_ENV === 'production' ? 'max' : 1,
    exec_mode: 'cluster',

    // 内存熔断：超过 500MB 自动重启
    max_memory_restart: '500M',

    // 监听文件变化自动重启（仅开发环境）
    watch: process.env.NODE_ENV !== 'production' ? ['server.js', 'database.js', 'pokerRules.js', 'middleware'] : false,
    ignore_watch: ['node_modules', 'public/uploads', '*.db', 'logs'],

    // 环境变量
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },

    // 日志配置
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // 优雅关闭：给进程 5 秒处理完当前请求
    kill_timeout: 5000,

    // 启动失败自动重试
    max_restarts: 10,
    restart_delay: 4000,
  }],
};
