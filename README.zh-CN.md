# ssticker-mcp (中文)

[English](README.md)

[![CI](https://img.shields.io/github/actions/workflow/status/T1anjiu/ssticker-mcp/ci.yml?branch=main&style=flat-square&logo=github&label=CI)](https://github.com/T1anjiu/ssticker-mcp/actions/workflows/ci.yml)
[![Container](https://img.shields.io/github/actions/workflow/status/T1anjiu/ssticker-mcp/container.yml?branch=main&style=flat-square&logo=docker&label=镜像)](https://github.com/T1anjiu/ssticker-mcp/actions/workflows/container.yml)
[![Release](https://img.shields.io/github/v/release/T1anjiu/ssticker-mcp?style=flat-square&include_prereleases&sort=semver)](https://github.com/T1anjiu/ssticker-mcp/releases)
[![License](https://img.shields.io/github/license/T1anjiu/ssticker-mcp?style=flat-square)](https://github.com/T1anjiu/ssticker-mcp/blob/main/LICENSE)
[![MCP protocol](https://img.shields.io/badge/MCP-2025--11--25-blue?style=flat-square)](https://modelcontextprotocol.io)
[![Node >= 24](https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)

> 自托管的 MCP 表情包推荐服务：当用户在聊天 channel（微信、QQ、Telegram）把最近对话交给 AI 时，AI 调用 ssticker-mcp，由它判断场景、语气、安全性，并返回一张渠道兼容的表情包。

## 它做什么

- 实现 Model Context Protocol 2025-11-25，同时支持 Streamable HTTP 和 stdio。
- 4 个工具：recommend_sticker、search_stickers、get_sticker_asset、report_sticker_outcome。
- 3 个 Resource：ssticker://scenes、ssticker://stickers/{id}、ssticker://policies/{profile}。
- 中英双语场景识别 + 严肃/敏感正则阻断 + 显式请求识别 + 私聊/群聊频控 + 重复抑制。
- SQLite FTS5 + sqlite-vec 混合检索，本地嵌入默认 multilingual-e5-small（384 维），hash 兜底。
- 可选 OpenAI-compatible LLM 分类器：只在置信度模糊时调用，超时/失败自动降级。
- 媒体管线：Sharp 处理静态图，ffmpeg 转码 GIF，输出 image/sticker/animation 三种渠道变体。
- 4 个参考渠道适配器：Telegram Bot、QQ 官方机器人、企业微信群机器人、微信公众号客服。
- React + Vite 管理端：Argon2id 令牌登录、CSRF、素材库、上传、场景策略、决策记录。
- 安全：Origin 校验、OIDC/JWKS、签名素材 URL、IP+subject 限流、审计日志。
- 隐私：对话原文不落库，session_id HMAC 后再写决策事件，pino 自动屏蔽敏感字段。

## 环境要求

- Node.js 24 或更高版本
- pnpm 10
- 可选：ffmpeg（用于 GIF 转码）

## 5 分钟上手

`ash
pnpm install
pnpm run build

pnpm exec ssticker init
pnpm exec ssticker demo:generate
pnpm exec ssticker catalog import examples/manifest.yaml
pnpm exec ssticker catalog validate
pnpm exec ssticker index rebuild

pnpm exec ssticker serve
`

然后：

1. 浏览器访问 http://127.0.0.1:3377/admin
2. 用 pnpm exec ssticker admin token create local-admin 创建管理员令牌并粘贴登录
3. 在 MCP 客户端配置 streamable-http：http://127.0.0.1:3377/mcp

## 工具与 reason_code

请阅读 [README.md](README.md) 中的工具表与 reason_codes 语义。中文场景包括：问候、告别、晚安、感谢、肯定/否认、惊讶、安慰、抱歉、鼓励、庆祝、开心/笑、撒娇、催促、玩笑/打趣、害羞/尴尬、疲惫、无奈/崩溃、拒绝/抗拒、想念、爱意等。

## 评测与基准

`ash
pnpm run eval       # 460 条双语对话
pnpm run benchmark  # 5 万素材、p95/p99、错误率
`

当前 pnpm run eval（hash 嵌入、无 LLM）：

- 严肃集错误自动发送数：0
- 自动发送 Precision@1：100%
- 显式请求 Recall@5：100%
- 渠道兼容变体覆盖率：100%

当前 pnpm run benchmark（5 万素材、384 维、300 次推荐）：

- p50 ~ 118ms / p95 ~ 130ms / p99 ~ 138ms
- 错误率：0%
- 吞吐：~ 8 QPS（串行持续运行）

## 渠道适配器

src/adapters/ 提供抽象 ChannelAdapter，仓库附 4 个参考实现。platform credentials 只从 adapter 的环境变量读取，不进入 MCP 服务。详见 src/adapters/common.ts 与各适配器。

## 测试与质量

`ash
pnpm run typecheck    # TypeScript strict
pnpm run lint         # ESLint
pnpm run test         # 24 单元 + 集成
pnpm run test:e2e     # Playwright + axe
pnpm run check        # lint + typecheck + test + build
`

## 部署

单服务 Docker Compose：

`ash
docker compose up -d
`

生产环境请设置 SSTICKER_AUTH_MODE=oidc 并配置 SSTICKER_OIDC_*。

## 配置变量

详见 .env.example，常用项：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| SSTICKER_HOST / SSTICKER_PORT | 监听地址 | 127.0.0.1:3377 |
| SSTICKER_DATA_DIR | SQLite、素材、模型缓存根 | ./data |
| SSTICKER_PUBLIC_BASE_URL | 签名 URL 中使用的公网地址。**非 loopback 部署必须显式设置。** | `http://127.0.0.1:3377` |
| SSTICKER_ALLOWED_ORIGINS | 允许跨域来源 | 同 base URL |
| SSTICKER_AUTH_MODE | none / oidc | none |
| SSTICKER_EMBEDDING_PROVIDER | local / hash | local |
| SSTICKER_MODEL_ID | 本地嵌入模型 | intfloat/multilingual-e5-small |
| SSTICKER_LLM_BASE_URL / _API_KEY / _MODEL | 可选 LLM | - |
| SSTICKER_LOG_LEVEL | silent / info / debug | info |

## 许可证

代码遵循 Apache-2.0；导入的素材保留各自授权。
