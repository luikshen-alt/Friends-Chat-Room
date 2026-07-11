/**
 * 全局错误处理模块
 * 企业实践：区分"操作错误"（expected，如用户输入不合法）和"程序错误"（bug，如未处理的异常）
 *   - 操作错误 → 返回友好的错误信息给客户端
 *   - 程序错误 → 返回通用错误信息，不泄露内部细节
 * 面试话术：
 *   "线上错误不能直接把 stack trace 返回给用户，那样会泄露服务器路径和代码逻辑。
 *    我区分了操作错误和程序错误：操作错误返回具体消息帮用户纠正；
 *    程序错误只返回'服务器内部错误'+ requestId，方便用户反馈时定位。"
 */
const logger = require('./logger');

/**
 * 自定义应用错误类
 * 标记 isOperational 来区分"可预期的用户错误"和"代码 bug"
 */
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // 标记：这是预期内的错误
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 处理中间件 —— 将未匹配的路由转为错误
 * 必须放在所有路由之后、全局错误处理之前
 */
function notFoundHandler(req, res, next) {
  next(new AppError(`未找到路径: ${req.originalUrl}`, 404));
}

/**
 * 全局错误处理中间件（4 个参数，Express 自动识别）
 * 【关键】必须放在所有路由和中间件之后
 */
function globalErrorHandler(err, req, res, _next) {
  // 记录完整错误信息（内部日志，不发给客户端）
  logger.error({
    err,
    requestId: res.getHeader('x-request-id'),
    method: req.method,
    url: req.originalUrl,
  }, '未处理异常');

  // 区分操作错误和程序错误
  if (err.isOperational) {
    // 预期内的错误：返回具体消息
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message,
    });
  }

  // 非预期错误（代码 bug）：只返回通用消息，不泄露细节
  return res.status(500).json({
    success: false,
    message: '服务器内部错误，请稍后重试',
    requestId: res.getHeader('x-request-id'), // 方便用户联系支持时提供
  });
}

module.exports = { AppError, notFoundHandler, globalErrorHandler };
