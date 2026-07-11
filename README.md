# 朋友聊天室 (Local Chat App)

> 一个支持实时聊天、好友系统和四人扑克对战的 Web 全栈应用。

## 功能

- 🔐 **用户系统** — 注册（邀请码机制）、登录、修改昵称/密码/头像
- 💬 **实时聊天** — 群聊大厅 + 好友私聊，文字/图片消息，未读计数
- 👥 **好友系统** — 搜索用户、好友申请/同意/拒绝、好友备注、删除好友
- 🃏 **四人扑克** — 108 张双副牌，大小王赖子万能牌，炸弹/连对/飞机牌型
- 📱 **移动端适配** — 响应式设计，支持手机/平板，支持 ngrok 公网访问
- 🛡️ **安全体系** — JWT 双 Token 认证、Helmet 安全头、限流、输入校验

## 技术栈

| 层 | 技术 |
|---|------|
| **前端** | React 18 + TypeScript + Vite |
| **后端** | Node.js + Express |
| **实时通信** | WebSocket (ws) |
| **数据库** | SQLite (better-sqlite3) |
| **认证** | JWT Access Token + Refresh Token (HttpOnly Cookie) |
| **安全** | Helmet + CORS + Rate Limiting + express-validator |
| **工具** | pino 日志、PM2 进程管理、Docker 容器化 |

## 项目结构

```
├── server.js              # Express 后端入口
├── database.js            # SQLite 数据层
├── pokerRules.js          # 扑克牌型引擎
├── middleware/            # 中间件（认证/错误处理/日志/校验）
├── client/               # React + TypeScript 前端
│   └── src/
│       ├── api/           # API 客户端封装
│       ├── hooks/         # 自定义 Hooks（useWebSocket）
│       ├── store/         # 状态管理（AuthContext）
│       ├── pages/         # 页面组件
│       └── types/         # TypeScript 类型定义
├── public/               # （保留）原生 HTML 版本前端
├── docs/                 # 项目文档
├── ecosystem.config.js   # PM2 配置
├── Dockerfile            # 容器构建文件
└── docker-compose.yml    # 容器编排
```

## 快速开始

### 环境要求

- **Node.js** >= 18
- **npm** >= 9

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd local-chat-app
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

然后编辑 `.env`，至少修改：
- `JWT_ACCESS_SECRET` — 生成随机字符串
- `JWT_REFRESH_SECRET` — 生成随机字符串
- `ADMIN_PASSWORD` — 改成你自己的管理员密码

```bash
# 生成随机密钥（选一个执行）
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. 安装依赖

```bash
# 后端依赖
npm install

# 前端依赖 + 构建
cd client && npm install && npm run build && cd ..
```

### 4. 启动

```bash
# 开发模式
npm start

# 或使用 PM2（推荐生产环境）
npx pm2 start ecosystem.config.js
```

### 5. 访问

- 用户端: `http://localhost:3000`
- 管理后台: `http://localhost:3000/admin`

## 使用指南

### 首次使用

1. 打开 `http://localhost:3000/admin`，输入管理员密码登录
2. 点击「生成邀请码」，复制 6 位数字
3. 打开 `http://localhost:3000/register`，用邀请码注册账号
4. 登录后即可使用聊天和扑克功能

### 公网访问（手机访问）

项目内置 ngrok 隧道管理，在管理后台点击「启动隧道」即可生成公网地址。

如需使用你自己的 ngrok 账号：

```bash
# 配置 ngrok authtoken（只需一次）
ngrok config add-authtoken <你的token>

# 确认 .env 中 NGROK_PATH 配置正确
```

### 开发模式

```bash
# 终端1：启动后端
npm start

# 终端2：启动前端开发服务器（支持 HMR 热更新）
npm run dev:client
# 访问 http://localhost:5173
```

### Docker 部署

```bash
docker-compose up -d
```

## 项目管理后台

| 功能 | 说明 |
|------|------|
| 邀请码管理 | 生成/查看/删除注册邀请码（有效期 2 分钟） |
| 用户管理 | 查看/删除注册用户 |
| ngrok 隧道 | 启动/停止公网隧道，获取外网访问地址 |



MIT
