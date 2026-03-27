# Q-gate

一个偏向 Minecraft 白名单、进群审核和社区准入场景的轻量答题框架。

这套项目的目标一直很明确:

- 简单: 题库和站点文案都尽量用 YAML 维护
- 轻量: React + Vite 前端，Fastify API，运行态落到单文件 SQLite
- 好看: 默认就是偏科幻、偏清爽、可直接拿来用的视觉风格

## 现在这套项目包含什么

- `apps/web`: 用户答题前端 + 管理工作台
- `apps/api`: 题库读取、开题、判分、验证码校验、管理端接口
- `apps/api/data/starter-quiz.yaml`: 默认题库
- `apps/api/data/site-settings.yaml`: 品牌名、文案、按钮、图片地址
- `apps/api/data/runtime/runtime.sqlite`: 运行态数据库

## 当前特性

- 题库使用 YAML，适合直接改字、备份、版本管理
- 站点文案单独拆到 `site-settings.yaml`，改品牌名、按钮文案、标题不需要翻源码
- 管理端改成“密码登录 + 每次进入重新验证”，浏览器可以保存密码，但不会直接沿用旧登录状态
- 运行态已经从 JSON 文件切到 SQLite，结构更稳，也更适合后续扩展
- 默认首页图和绑定页图可以直接用你自己的远程图片 API
- 默认前端支持晴空 / 夜航主题切换
- 题目支持单选、多选、文本题，以及题目媒体资源
- 支持通过一次性短验证码把答题结果绑定到 `QQ + Minecraft 用户名`

## 适合怎么维护

### 1. 改题库

优先改这个文件:

- `apps/api/data/starter-quiz.yaml`

服务端会热加载它。工作台里也可以直接读取、编辑、发布。

### 2. 改名字和页面文本

优先改这个文件:

- `apps/api/data/site-settings.yaml`

这里集中放了:

- 站点名字
- 管理台名字
- 首页标题、副标题、按钮文案
- 绑定页说明
- 结果页文案
- 默认图片地址

如果你只是想把整套框架改成自己的品牌，这个文件基本就是最重要的入口。

### 3. 改图片

直接改 `apps/api/data/site-settings.yaml` 里的 `media`:

```yaml
media:
  homeHeroImage: https://photo.yrrlyb.top/api.php?sort=pc
  homeInsetImage: https://photo.yrrlyb.top/api.php?sort=pc
  entryHeroImage: https://photo.yrrlyb.top/api.php?sort=mp
```

如果你后面换图床或者改成本地路径，也还是只需要改这一处。

## 题库格式示例

```yaml
meta:
  slug: mc-whitelist
  title: Q-gate Access Exam
  subtitle: 新人准入测验
  description: 面向服务器白名单与社区审核的基础问答
  passScore: 70
  durationSec: 900
  shuffleQuestions: true
  examMode: closed_book
  requireFullscreen: false
  selectionMode: fixed

questions:
  - id: rule_01
    type: single
    group: objective
    points: 20
    prompt: 在主城展示建筑区域，哪种行为最不合规？
    options:
      - key: A
        text: 使用领地插件圈地后再施工
      - key: B
        text: 先阅读建筑区告示牌
      - key: C
        text: 未经说明直接爆破旧建筑
      - key: D
        text: 在公共仓库登记材料借用
    answer:
      - C
```

文本题的 `answer` 支持多个关键词，当前逻辑按“答案里需要包含这些关键词”来判断。

## 环境变量

先准备配置文件:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

`apps/api/.env` 示例:

```bash
PORT=4100
APP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
ADMIN_PASSWORD=replace-with-your-password
TOKEN_SECRET=replace-with-a-very-long-random-secret
DATA_DIR=./data/runtime
QUIZ_SEED_FILE=./data/starter-quiz.yaml
SITE_SETTINGS_FILE=./data/site-settings.yaml
TOKEN_TTL_MINUTES=20
ADMIN_SESSION_TTL_HOURS=12
```

`apps/web/.env` 示例:

```bash
VITE_API_BASE=http://localhost:4100/api
```

补充说明:

- 管理端现在优先读取 `ADMIN_PASSWORD`
- 旧字段 `ADMIN_KEY` 仍兼容，但新部署建议统一改成 `ADMIN_PASSWORD`
- 如果你修改了 API 的密码配置，需要重启 API

## 本地开发

```bash
npm install
npm run dev:api
npm run dev:web
```

构建:

```bash
npm run build
```

## 局域网手机测试

1. API 保持启动: `npm run dev:api`
2. 前端用公开模式启动: `npm run dev:web:public`
3. 把 `apps/api/.env` 里的 `APP_ORIGIN` 改成你的前端局域网地址
4. 把 `apps/web/.env` 里的 `VITE_API_BASE` 改成你的 API 局域网地址
5. 手机访问 `http://你的电脑局域网IP:5173`

例如:

- 前端: `http://192.168.1.23:5173`
- API: `http://192.168.1.23:4100/api`

## Bot 校验接口

请求:

```http
POST /api/integrations/verify
Content-Type: application/json

{
  "code": "483291",
  "qq": "123456789",
  "playerName": "MyPlayer"
}
```

成功响应:

```json
{
  "valid": true,
  "status": "accepted",
  "attemptId": "att_xxx",
  "quizSlug": "mc-whitelist",
  "score": 80
}
```

失败响应:

```json
{
  "valid": false,
  "status": "mismatch"
}
```

## 推荐维护思路

如果你希望别人也能很方便地接手这套框架，推荐把维护入口固定成三层:

1. 只改名字和按钮文案: 改 `apps/api/data/site-settings.yaml`
2. 改题目和评分规则: 改 `apps/api/data/starter-quiz.yaml`
3. 改视觉图资源: 改 `apps/api/data/site-settings.yaml` 里的 `media`

这样大多数维护者都不需要进 React 代码，也不需要理解 API 细节。
