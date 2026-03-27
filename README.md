<p align="center">
  <img src="./logo.png" alt="Q-gate logo" width="128" />
</p>

<div align="center">

# Q-gate

_A lightweight access quiz framework for Minecraft servers and community screening._

简单 · 轻量 · 好看

<p>
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white" alt="Fastify" />
  <img src="https://img.shields.io/badge/SQLite-Node%2022-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/YAML-Config-CB171E?logo=yaml&logoColor=white" alt="YAML" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

</div>

---

## Welcome

Q-gate 是一个偏向 Minecraft 白名单、进群审核和社区准入场景的轻量答题框架。

- 题库和站点文案都尽量用 YAML 维护
- 前端使用 React + Vite，后端使用 Fastify
- 运行态落到 SQLite，结构简单但比旧的 JSON 更稳
- 默认界面走清爽科幻风，适合直接拿来改成自己的品牌

## Feature

- **Easy to Maintain**
  - 题库、文案、图片入口都集中，改字不需要全局翻源码。
- **Lightweight Runtime**
  - 前后端结构直接，适合个人项目、小型社区或自建审核入口。
- **Modern Admin Flow**
  - 管理端使用密码登录，并要求每次进入重新验证。
- **Quiz + Identity Binding**
  - 支持把验证码和 `QQ + Minecraft 用户名` 绑定，用于后续审核校验。
- **Media Ready**
  - 支持图片、音频、视频题目，也支持远程图片 API。

## Project Structure

- `apps/web`
  - 用户答题前端 + 管理工作台
- `apps/api`
  - 题库读取、开题、判分、验证码校验、管理端接口
- `apps/api/data/starter-quiz.yaml`
  - 默认题库
- `apps/api/data/site-settings.yaml`
  - 品牌名、文案、按钮、图片地址
- `apps/api/data/runtime/runtime.sqlite`
  - 运行态数据库

## Quick Start

先准备配置文件:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
```

安装依赖并启动:

```bash
npm install
npm run dev:api
npm run dev:web
```

构建:

```bash
npm run build
```

默认本地地址:

- Web: `http://localhost:5173`
- API: `http://localhost:4100`

## Config

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

- 管理端优先读取 `ADMIN_PASSWORD`
- 旧字段 `ADMIN_KEY` 仍兼容，但新部署建议统一改成 `ADMIN_PASSWORD`
- 修改 API 密码配置后，需要重启 API

## Content Entry

日常维护基本只需要看三处:

1. `apps/api/data/starter-quiz.yaml`
   - 改题目、答案、分值和组卷方式
2. `apps/api/data/site-settings.yaml`
   - 改站点名字、页面标题、按钮文案、说明文字
3. `apps/api/data/site-settings.yaml` 里的 `media`
   - 改首页图和绑定页图

这意味着大多数维护者都不需要去改 React 代码。

## Media

直接改 `apps/api/data/site-settings.yaml` 里的 `media`:

```yaml
media:
  homeHeroImage: https://photo.yrrlyb.top/api.php?sort=pc
  homeInsetImage: https://photo.yrrlyb.top/api.php?sort=pc
  entryHeroImage: https://photo.yrrlyb.top/api.php?sort=mp
```

如果以后换图床或者改成本地路径，也还是只需要改这一处。

## Quiz Format

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

## Verify API

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

## For Who

- 想快速搭一个入群答题系统的人
- 想让别人容易接手维护的人
- 想保留“轻量 + 可改字 + 不难看”这三个优先级的人
