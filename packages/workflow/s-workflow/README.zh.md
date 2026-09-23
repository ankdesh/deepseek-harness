---
description: "为可配置 assistant 提供持久、目录驱动的工作流状态及权限边界。"
kind: "package-reference"
---

# @deepseek-ai/dsh-s-workflow

[English](README.md) | 中文

## 概述

使用 `dsh-s-workflow` 可在一个 session 中运行一个持久且固定版本的工作流。它记录完整快照、预算、草稿、检查点和待处理的人类决策，同时将生命周期与完成批准保留给宿主。当部署需要可恢复的工作而不是一次性回答时，请选择本包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

先挂载服务，再挂载目录 provider、模型工具与部署适配器。在启动期注册精确版本的工作流和服务适配器并封存两个目录，随后由宿主使用明确 preset 与不可变 binding 启动 run。

### 权限边界

宿主负责启动、暂停、恢复、取消、回答输入、批准完成和提高预算。面向模型的消费者只能替换草稿、记录检查点，或请求人类输入与完成审核。该服务绝不会应用或发送产品工件。

### 持久状态

每个 `s-workflow/change` 事件都包含完整的变更后快照和精确目录摘要。Revision 连续递增，比较并交换变更会拒绝过期引用，每个 session 只能存在一个未终止 run。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

目录在散列前将 definition 和 adapter 规范化。Projection 在无法证明快照连续性时保留 failed 状态；若已加载目录不再匹配持久摘要，服务会拒绝访问。Preset 策略为 round、request、token、运行时间及子任务提供有界默认值和硬上限。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 目录、规范摘要、快照投影与宿主/模型变更边界 |
| [`src/types.ts`](src/types.ts) | 公开的工作流、预算、草稿与待决决策约定 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工作流 YAML provider](../s-workflow-yaml/README.zh.md)——严格的声明式目录加载。
- [工作流工具](../tool-s-workflow/README.zh.md)——受限的模型侧变更表面。
- [持久化目录](../../../docs/persistence-catalog.zh.md)——持久事件约定。
- [架构说明](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.zh.md)——组合与权限决策。

-----

<a id="model-experience"></a>
## 模型体验

通过将当前工作流快照投影到模型的 prompt 和工具消费者间接产生影响。

#### KV Cache 影响

服务本身不增加请求内容；消费者决定工作流状态变化何时追加模型可见上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅一个活跃 run**——每个 session 只允许一个未终止工作流。
- **需要精确目录**——除非进程拥有相同 definition 和 adapter 摘要，否则恢复会失败关闭。
- **不含调度器或执行器**——goal round、子 agent、审核呈现及工件应用由其他包组合。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
