/**
 * 请求上下文模块（AsyncLocalStorage）
 * 企业实践：不通过函数参数"传梯子"，而是用 AsyncLocalStorage 在整个请求生命周期中自动传递 requestId
 * 面试话术："这样每个请求都有唯一 ID，日志里一搜就能看到该请求的完整调用链路"
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('crypto');

const storage = new AsyncLocalStorage();

/**
 * 中间件：为每个请求创建独立上下文，注入 requestId
 */
function requestContextMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  storage.run({ requestId }, () => next());
}

/**
 * 当前请求上下文中的 requestId（可在任何被中间件包裹的代码中调用）
 */
function getRequestId() {
  return storage.getStore()?.requestId;
}

module.exports = { requestContextMiddleware, getRequestId };
