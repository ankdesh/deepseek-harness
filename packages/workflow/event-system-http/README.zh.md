---
description: "监控获准的 HTTP JSON 条件，在值不变时不消耗模型请求，并唤醒对话智能体。"
kind: "package-reference"
---

# @deepseek-ai/dsh-event-system-http

[English](README.md) | 中文

<a id="summary"></a>
## 概述

监控获准的 HTTP JSON 端点，在选定值变化或进入相等条件时唤醒所属对话。未变化的检查不产生模型请求。防抖、流量上限和持久游标约束监控；发布重试保持事件身份。人类配置来源，后续智能体工作使用对话已有预算。

<a id="table-of-contents"></a>
## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在原生 storage-domain 和 event-system 服务之后挂载此服务。人类添加来源前等待 `ready`。[phase2.spec.ts](../event-system/tests/phase2.spec.ts) 的真实 Loader 组合演示可运行的配置、游标恢复和原生激活。

### 配置

全部配置字段均为必填；服务不提供隐含网络默认值。宿主通过 `allowedOrigins` 传入精确 HTTP(S) 源；URL 内凭据、重定向及外部源均被拒绝。

| Field | Default | Meaning |
|---|---|---|
| `allowedOrigins` | required | 精确获准源。 |
| `tickMillis` | required | 调度检查周期。 |
| `minIntervalMillis`, `maxIntervalMillis` | required | 来源间隔范围及最大失败退避。 |
| `timeoutMillis`, `maxResponseBytes` | required | 整个请求期限及完整响应字节上限。 |
| `maxSourcesPerConversation`, `maxTotalSources` | required | 保留来源数量上限。 |
| `maxConcurrentChecks`, `maxFailures` | required | 网络并发及暂停前失败次数。 |

人类来源定义选择 `url`、已声明的 `eventType`、JSON `pointer`、`condition`（`changed` 或 `equals`）、`intervalMillis`、`debounceMillis` 及 `emitInitial`。相等条件还要求 `expectedJson`。宿主可通过 `authorizationEnv` 指定 bearer 凭据环境变量；持久化只保存变量名，不保存密钥。缺失凭据会拒绝接纳或启动。对象键顺序不影响摘要。相等条件仅在值进入条件时触发，不会在每次匹配检查时触发。

注册和发布要求执行处于活动状态。暂停、耗尽、停止及重启恢复状态阻止后续检查。重启要求人类 Resume，并保留游标和待发布事件。连续错误暂停来源；修复端点后查看错误并按修订号重新启用。来源控制还要求所属对话匹配。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>Implementation internals — click to expand</summary>

版本 1 的 `event_http_sources` 域拥有不可变定义、已观察摘要、防抖候选及待发布 outbox。服务先提交 outbox，再发布事件；event-system 提交后才推进游标。两次提交间崩溃时，重用来源身份和序号作为稳定去重键。原生智能体执行仍由 event-system 服务拥有。销毁中止请求、清除调度器、等待所属任务并关闭域。

可选 `./invariant` 配套插件独立检查已确认来源序号是否对应已提交事件。观察器属于配套插件 fiber，销毁时移除；重新注册再次安装单个观察器。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [事件智能体](../event-system/README.zh.md) — 原生执行、等待、重试和预算。
- [YAML 定义](../event-system-yaml/README.zh.md) — 固定可信响应。
- [HTTP 和等待决策](../../../.agents/notes/implemented/architecture/2026-10-01-event-http-waiting-recovery.zh.md) — 提交顺序及恢复权衡。

-----

<a id="model-experience"></a>
## 模型体验

### 条件观察

#### 模型看到什么

匹配的检查提供普通已记录 event-system 收件箱消息。类型化载荷包含 `trigger_id`、`url`、`value_json`、`previous_digest` 及 `current_digest`。端点内容仅是观察，不授予工具或变更权限。此服务不添加提示词段落或模型工具。

#### Token 影响

HTTP 请求及未变化的值不消耗模型 token。已发布观察和被激活的智能体消耗对话已有预算，包括配置的投递重试。

#### KV 缓存影响

固定成员指令保持稳定。观察扩展原生会话历史，因此事件内容按照原生缓存行为改变请求后缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

监控有明确部署约束。

- 仅支持有界 JSON GET 轮询；webhook、文件观察器、自定义头和任意谓词仍未实现。相等条件按进入状态触发，不提供调度时钟。每个状态根仅使用单个进程。暂停后进行中的检查可能结束，但活动状态发布检查会在缺少权限时拒绝唤醒。来源槽位保留；不提供删除和编辑来源定义。
- 启动重新验证严格允许列表及凭据。部署策略变化时，打开持久来源前可能需要恢复获准配置。恰好一次的 owner 变更仍在游标／事件提交边界之外。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

来源适配器共享事件发布和计量。工作流执行及可视订阅编辑仍属于独立决策。

</details>
