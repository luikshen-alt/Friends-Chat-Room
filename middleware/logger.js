/**
 * 结构化日志模块
 * 企业实践：用 pino 替代 console.log，支持 JSON 格式输出（可被 ELK/Datadog 等日志平台消费）
 * 面试话术："线上日志需要结构化，方便用 grep/jq 查询和接入日志平台"
 */
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // 开发环境输出人类可读格式，生产环境输出 JSON（方便日志平台收集）
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  // 自动从 AsyncLocalStorage 注入 requestId（全链路追踪）
  mixin() {
    const { getRequestId } = require('./requestContext');
    const requestId = getRequestId();
    return requestId ? { requestId } : {};
  },
  // 对敏感字段进行脱敏处理
  redact: {
    paths: ['password', 'oldPassword', 'newPassword', 'token', 'authorization', 'cookie'],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
