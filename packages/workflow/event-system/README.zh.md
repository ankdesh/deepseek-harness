---
description: "持久对话事件智能体、可靠投递和宿主拥有的聚合预算。"
kind: "package-reference"
---

# @deepseek-ai/dsh-event-system

[English](README.md) | 中文

<a id="summary"></a>
## 概述

使用此服务让持久原生 agent（智能体）在同一对话中按固定订阅响应事件。已提交的类型化事件生成投递，原生收件箱消息激活配置成员。宿主拥有配置、资源上限和人类控制权限；空闲成员不请求模型。原生目标续行可使用相同计量，无需通过订阅路由目标轮次。

<a id="table-of-contents"></a>
## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用此包

先组合原生 agent、会话持久化、工具、系统提示词、token 计量和 storage-domain 后端，再挂载此服务。通过 [YAML provider](../event-system-yaml/README.zh.md) 加载精确的可信模板，等待 `ready` 并封存目录。宿主用定义、模式和显式 `ExecutionLimits` 挂接主 agent；再次挂接保留固定定义和已有消耗。成员的原生组合必须提供配置工具，执行器拒绝允许列表之外的工具。

[分析／审核模板](examples/analysis-review/system.yml) 和相邻 Markdown 提示词不导入产品代码。未指定的成员 provider/model 在附加时继承主代理选定的路由；解析后的选择保持固定，直到创建新会话。Loader 组合回归使用脚本化提供方执行此示例，而会话、工具、目标、持久化、存储和调度器均为原生实现。在仓库根目录运行 `pnpm exec vitest run packages/workflow/event-system/tests packages/workflow/event-system-yaml/tests`。

`publishHost` 接纳经过验证的应用事件；`publishAgent` 派生当前调用者和因果来源，并检查其发布权限。生产者使用稳定去重键；相同键携带不同内容会失败。匹配仅按精确事件类型指向固定成员，目标不来自模型参数。

`control` 按修订号执行暂停、恢复、停止。暂停和停止取消活动原生 agent 并等待静止，停止为终态。恢复保留资源消耗且不能覆盖耗尽状态。恢复存储时，活动系统变为 `needs-resume`，不确定投递变为 `interrupted`，不会自动调用模型。`retry` 要求当前修订号、活动状态和明确承认执行结果不确定；新尝试追加为独立投递，保留原收据和错误。每个订阅尝试链受 `maxRequests` 限制，待处理数量受 `maxPending` 限制。

`wait_for_event` 持久化人类、已声明事件或审核等待。未来响应匹配精确字符串载荷字段；人类回答要求当前宿主生成等待 ID 和执行修订号。等待阻止该成员后续请求。原生目标恢复还检查保存的目标修订及剩余轮次。审核等待接受同一提案的应用或丢弃。

订阅可声明 `retry: { replaySafe: true, maxAttempts: 3, initialBackoffMillis: 1000, maxBackoffMillis: 10000 }`。仅失败尝试自动有界退避重试，中断尝试仍手动处理。两种路径均追加尝试并消耗相同上限。

<a id="understand-the-implementation"></a>
## 了解实现

存储域 `event_systems` 版本 1 按主 Session ID 保存固定快照。事件、投递、原生消息、激活、请求预留分别拥有身份。事件及全部订阅扇出在一次串行表更新中提交。接纳依赖精确的原生 `user/message` 收据，完成依赖该 agent 对应的 `turn/end`；收据不表示执行成功。重启先验证定义摘要、成员、投递引用和对话内无环因果，再允许人工恢复。

上限约束成员、并发投递激活、轮次、请求、token、活动模型时间、待处理投递、事件历史、完整事件字节数、因果深度和输出 token。所有有发起者的 `llm/stream` 调用，包括原生重试和压缩，均在访问提供方前预留资源。直接调用必须明确设置不超过 `maxOutputTokens` 的输出上限。token 预留采用序列化请求字节数与原生计量估计的较大值，加上输出容量；互不重叠的提供方用量结算预留。缺失用量和中断请求保留保守预留。共享计时器计入重叠请求时间，到期取消全部成员。新事件和重启均不刷新资源。

调用方拥有主 Agent 句柄，服务拥有专家句柄、调度任务、计时器和域句柄。销毁时取消工作、等待任务和 agent、释放专家并关闭域。可选 `./invariant` 配套插件根据独立观察的原生消息和轮次收据检查已提交投递转换。没有新增 Session 事件类型或修改执行循环。

<a id="further-exploration"></a>
## 延伸阅读

- [YAML provider](../event-system-yaml/README.zh.md) — trusted text loading and prompt containment.
- [Workflow subsystem](../../../docs/subsystems/workflow.zh.md) — the group's separately composed execution capabilities.
- [Decision](../../../.agents/notes/implemented/architecture/2026-09-30-conversation-event-agents.zh.md) — ownership and deferred features.

<a id="model-experience"></a>
## 模型体验

### 固定成员指令

#### 模型看到什么

每个成员在稳定系统提示词段落中收到可信解析后的 Markdown。下文逐字列出通用示例主成员指令；部署定义可提供不同文本。

##### 通用主成员指令

```markdown
Acknowledge direct requests. Wait for the analyst and reviewer events, then summarize the reviewer result. Read get_event_system to inspect the configured reactions.
```

#### Token 影响

固定指令为每个成员增加一段。投递事件和工具结果扩展原生历史；成员空闲本身不产生模型请求。

#### KV 缓存影响

固定指令在各次激活之间保持稳定。原生历史扩展既有前缀；此服务不增加自定义缓存协议。

### 事件发布与投递

#### 模型看到什么

`publish_event` 验证 `payload_json` 并返回持久事件身份；`get_event_system` 返回成员、配置事件 schema、上限和投递。收件箱输入是包含 `event`、`activation_id` 和 `subscription` 的已记录插件消息。宿主工具展示使用普通文本结果。

#### Token 影响

事件封套和查询的投递历史消耗输入 token。每个发起请求在访问提供方前保守预留输入／输出容量。

#### KV 缓存影响

事件输入改变后缀，固定指令不变。请求构建和原生压缩保留已有缓存行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 不提供工作流执行器、图汇合、跨对话路由、配置编辑器或预算追加。获准 HTTP 监控通过 [event-system-http](../event-system-http/README.zh.md) 独立组合。历史达到上限后拒绝新事件。人工重试承认可能已有副作用，不宣称独立存储和所有者系统之间具有 exactly-once 副作用。保守字节预留可能比提供方实际消耗更早耗尽 token 预算。每个持久状态根目录只运行一个进程。

<a id="dev-note"></a>
### 开发备注

通用服务拥有调度和计量，产品 adapter 保留所有者绑定、提案工具、审批检查和审核 UI。专家执行期间，主 agent 仍可接收普通人类输入；订阅调度把正在执行的成员计入并发，所有模型消耗共享一个额度。
