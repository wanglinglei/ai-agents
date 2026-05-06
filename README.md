# Agents

基于 NestJS 的 AI 服务后端，提供用户登录、支付宝授权、验证码、图片上传、LangChain 调用和天气 Agent 查询能力。

## 功能模块

- 用户模块：支持账号注册、账号密码登录、邮箱验证码登录、用户资料查询与更新、管理员用户列表。
- 支付宝授权模块：支持通过支付宝 `authCode` 登录，并获取支付宝用户信息。
- 通用模块：提供健康检查、图形验证码、邮箱验证码和图片上传能力。
- LangChain 模块：提供大模型调用状态检查和基础 prompt 调用接口。
- 天气 Agent 模块：基于 OpenAI 兼容接口和 QWeather 工具查询天气，并生成自然语言出行建议。

## 技术栈

- Node.js + TypeScript
- NestJS 11
- TypeORM + MySQL
- JWT + Passport
- LangChain / OpenAI 兼容接口
- AWS S3 兼容对象存储（缤纷云）

## 环境准备

安装依赖：

```bash
pnpm install
```

在项目根目录创建 `.env`，按需配置以下变量：

```bash
# 服务配置
PORT=3000
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
SESSION_SECRET=your-session-secret

# MySQL
DB_HOST=127.0.0.1
DB_USERNAME=root
DB_PASSWORD=your_password
DB_NAME=agents

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=1d

# 邮箱验证码
EMAIL_PASS=your-email-smtp-auth-code

# OpenAI 兼容接口
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4o-mini

# 天气查询（QWeather）
WEATHER_API_TOKEN=your-qweather-token
WEATHER_API_HOST=https://your-qweather-host

# 支付宝授权
APP_PRIVATE_KEY=your-alipay-app-private-key
ALIPAY_PUBLIC_KEY=your-alipay-public-key

# 对象存储（可选，有默认值）
BITIFUL_BUCKET=your-bucket
BITIFUL_PREFIX=ai-agent
BITIFUL_ENDPOINT=https://s3.bitiful.net
BITIFUL_PUBLIC_BASE_URL=
BITIFUL_REGION=auto
BITIFUL_ACCESS_KEY_ID=your-access-key
BITIFUL_SECRET_ACCESS_KEY=your-secret-key
```

## 启动项目

```bash
# 开发模式
pnpm run start

# 监听模式
pnpm run start:dev

# 生产模式
pnpm run build
pnpm run start:prod
```

服务启动后默认监听 `http://localhost:3000`，全局接口前缀为 `/ai-service`。

## 鉴权说明

项目启用了全局 JWT 鉴权。除注册、登录、验证码、图片上传和健康检查等白名单接口外，请求需要在 Header 中携带登录返回的 token：

```bash
Authorization: Bearer <token>
```

成功响应会被统一包装为：

```json
{
  "success": true,
  "data": {},
  "code": 200,
  "feature": "user"
}
```

## 主要接口

### 基础接口

- `GET /ai-service`：默认欢迎接口。
- `GET /ai-service/general/health`：通用健康检查。
- `GET /ai-service/user/health`：用户模块健康检查。

### 用户

- `POST /ai-service/user/register`：账号注册。请求体包含 `username`、`password`、`captcha`，可选 `nickname`、`email`、`avatar`、`gender`。
- `POST /ai-service/user/login`：账号密码登录。请求体包含 `username`、`password`、`captcha`。
- `POST /ai-service/user/emailLogin`：邮箱验证码登录。请求体包含 `email`、`emailCode`。
- `GET /ai-service/user/profile`：获取当前登录用户资料。
- `POST /ai-service/user/update`：更新用户资料。
- `GET /ai-service/user/admin/userList?page=1&pageSize=10`：获取用户列表。

### 支付宝授权

- `POST /ai-service/alipay-auth/login`：通过支付宝 `authCode` 登录。请求体包含 `authCode`。
- `POST /ai-service/alipay-auth/getUserInfo`：调试接口，通过 `accessToken` 获取支付宝用户信息。

### 通用能力

- `GET /ai-service/general/captcha`：获取图形验证码，返回 base64 SVG 图片。
- `POST /ai-service/general/emailCode`：发送邮箱验证码。请求体包含 `email`。
- `POST /ai-service/general/upload`：上传图片，字段名为 `file`，最大 10 MB，支持 jpeg、png、gif、webp、svg。

### LangChain

- `GET /ai-service/langchain/status`：查看 LangChain 配置状态。
- `GET /ai-service/langchain/invoke?prompt=Hello`：使用指定 prompt 调用大模型。

### 天气 Agent

- `GET /ai-service/weather/status`：查看天气 Agent 配置状态。
- `GET /ai-service/weather/query?city=杭州`：查询城市天气并生成出行建议。
- `GET /ai-service/weather/query?message=明天上海适合跑步吗`：使用自然语言查询天气。
- `GET /ai-service/weather/query?city=北京&question=周末适合露营吗`：结合城市和问题查询天气。

天气 Agent 需要同时配置 `OPENAI_API_KEY` 和 `WEATHER_API_TOKEN`。当前大模型请求使用 OpenAI 兼容格式，并默认走阿里云 DashScope 兼容地址。

## 测试与代码检查

```bash
# 单元测试
pnpm run test

# e2e 测试
pnpm run test:e2e

# 覆盖率
pnpm run test:cov

# ESLint 自动修复
pnpm run lint

# 格式化
pnpm run format
```

## 目录结构

```text
src/
  agents/
    langchain/      # LangChain 基础调用
    weather/        # 天气 Agent、天气工具和提示词
    tools/          # 通用 Agent 工具
  alipay-auth/      # 支付宝授权登录
  common/           # 鉴权、异常过滤器、响应拦截器等公共能力
  general/          # 验证码、邮箱验证码、图片上传
  lib/              # 对象存储、验证码等基础服务
  user/             # 用户实体、DTO、服务和控制器
```

## 注意事项

- TypeORM 当前开启了 `synchronize: true`，生产环境请谨慎使用。
- MySQL 端口固定为 `3306`，数据库连接信息来自环境变量。
- 默认会话 Cookie 名称为 `ai-service.sid`，验证码依赖服务端 session。
- 部分三方能力依赖外部密钥，未配置时相关接口会返回配置缺失错误。
