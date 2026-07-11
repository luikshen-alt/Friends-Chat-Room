/**
 * 请求参数校验模块
 * 企业实践：用 express-validator 对所有外部输入做"白名单式"校验
 * 面试话术：
 *   "永远不要信任用户输入。我在所有 API 入口都加了参数校验，
 *    包括类型、长度、格式。TypeScript 只能做编译时检查，
 *    运行时校验必须用 Joi/Zod/express-validator 这类库。"
 */
const { body, query, param, validationResult } = require('express-validator');

/**
 * 校验结果中间件 —— 如果校验不通过，直接返回 400
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '参数错误',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// ===== 用户相关校验 =====

const registerRules = [
  body('username')
    .trim().isLength({ min: 2, max: 20 }).withMessage('账号需 2-20 个字符')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('账号只能包含字母、数字和下划线'),
  body('password')
    .isLength({ min: 6, max: 100 }).withMessage('密码需 6-100 个字符'),
  body('nickname')
    .trim().isLength({ min: 1, max: 20 }).withMessage('昵称需 1-20 个字符'),
  body('invitationCode')
    .trim().isLength({ min: 6, max: 6 }).withMessage('邀请码为 6 位数字'),
];

const loginRules = [
  body('username').trim().notEmpty().withMessage('请输入账号'),
  body('password').notEmpty().withMessage('请输入密码'),
];

const nicknameRules = [
  body('username').trim().notEmpty().withMessage('缺少用户名'),
  body('nickname').trim().isLength({ min: 1, max: 20 }).withMessage('昵称需 1-20 个字符'),
];

const passwordRules = [
  body('username').trim().notEmpty().withMessage('缺少用户名'),
  body('oldPassword').notEmpty().withMessage('请输入旧密码'),
  body('newPassword').isLength({ min: 6, max: 100 }).withMessage('新密码需 6-100 个字符'),
];

// ===== 好友相关校验 =====

const friendActionRules = [
  body('userA').trim().notEmpty().withMessage('缺少参数'),
  body('userB').trim().notEmpty().withMessage('缺少参数')
    .custom((value, { req }) => value !== req.body.userA).withMessage('不能操作自己'),
];

const friendRequestIdRules = [
  body('id').isInt({ min: 1 }).withMessage('无效的申请 ID'),
  body('username').trim().notEmpty().withMessage('缺少用户名'),
];

const remarkRules = [
  body('owner').trim().notEmpty().withMessage('缺少参数'),
  body('target').trim().notEmpty().withMessage('缺少参数'),
  body('remark').optional().isString().isLength({ max: 40 }).withMessage('备注最长 40 个字符'),
];

// ===== 聊天相关校验 =====

const privateMessageRules = [
  body('from_user').trim().notEmpty().withMessage('缺少发送者'),
  body('to_user').trim().notEmpty().withMessage('缺少接收者'),
  body('content').notEmpty().withMessage('消息不能为空'),
];

const privateHistoryRules = [
  query('userA').trim().notEmpty().withMessage('缺少参数'),
  query('userB').trim().notEmpty().withMessage('缺少参数'),
];

const readRules = [
  body('username').trim().notEmpty().withMessage('缺少用户名'),
  body('peer').trim().notEmpty().withMessage('缺少参数'),
];

// ===== 搜索校验 =====

const searchRules = [
  query('q').trim().isLength({ min: 1, max: 50 }).withMessage('搜索关键词需 1-50 字符'),
];

// ===== 扑克游戏校验 =====

const pokerCreateRules = [
  body('username').trim().notEmpty().withMessage('缺少用户名'),
];

const pokerJoinRules = [
  body('roomId').trim().notEmpty().withMessage('缺少房间号'),
  body('username').trim().notEmpty().withMessage('缺少用户名'),
];

const pokerPlayRules = [
  body('roomId').trim().notEmpty().withMessage('缺少房间号'),
  body('username').trim().notEmpty().withMessage('缺少用户名'),
  body('cardIds').isArray({ min: 1 }).withMessage('请选择要出的牌'),
];

// ===== 管理后台校验 =====

const deleteUserRules = [
  body('username').trim().notEmpty().withMessage('缺少用户名'),
];

module.exports = {
  validate,
  registerRules,
  loginRules,
  nicknameRules,
  passwordRules,
  friendActionRules,
  friendRequestIdRules,
  remarkRules,
  privateMessageRules,
  privateHistoryRules,
  readRules,
  searchRules,
  pokerCreateRules,
  pokerJoinRules,
  pokerPlayRules,
  deleteUserRules,
};
