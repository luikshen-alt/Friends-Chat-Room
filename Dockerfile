# ===== 多阶段构建 Dockerfile =====
# 企业实践：多阶段构建减小镜像体积，使用非 root 用户运行，利用缓存层加速构建
# 面试话术：
#   "多阶段构建把编译依赖和运行依赖分开，最终镜像只有运行时需要的文件。
#    用 node:22-alpine 做基础镜像，体积小、启动快，适合容器化部署。"

# ---- 第一阶段：构建阶段 ----
FROM node:22-alpine AS builder

WORKDIR /app

# 仅复制依赖文件（利用 Docker 缓存层，package.json 不变则跳过 npm install）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- 第二阶段：运行阶段 ----
FROM node:22-alpine AS runner

# 创建非 root 用户（安全：不以 root 运行容器）
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# 从构建阶段复制生产依赖
COPY --from=builder /app/node_modules ./node_modules

# 复制应用代码
COPY server.js database.js pokerRules.js ./
COPY middleware/ ./middleware/
COPY public/ ./public/

# 复制配置文件
COPY .env.example ./.env

# 创建必要的目录
RUN mkdir -p public/uploads/avatars logs && chown -R appuser:appgroup /app

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/health',r=>{process.exit(r.statusCode===200?0:1)})"

# 以非 root 用户启动
CMD ["node", "server.js"]
