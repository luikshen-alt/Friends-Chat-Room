# ===== 多阶段构建 Dockerfile =====
# 阶段1：构建 React 前端
# 阶段2：安装后端依赖
# 阶段3：运行（仅包含运行时需要的文件）

# ---- 阶段1：构建前端 ----
FROM node:22-alpine AS client-builder
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 阶段2：后端依赖 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- 阶段3：运行 ----
FROM node:22-alpine AS runner

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app

# 后端依赖
COPY --from=deps /app/node_modules ./node_modules
# 前端构建产物
COPY --from=client-builder /app/client/dist ./client/dist
# 源码
COPY server.js database.js pokerRules.js ./
COPY middleware/ ./middleware/
COPY public/ ./public/
# 配置模板（运行时需挂载真实 .env）
COPY .env.example ./

# 创建数据目录
RUN mkdir -p public/uploads/avatars logs data && chown -R appuser:appgroup /app

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/health',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "server.js"]
