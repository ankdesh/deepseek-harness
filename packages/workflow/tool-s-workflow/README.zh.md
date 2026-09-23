---
description: "用于读取工作流状态、替换草稿、记录检查点及请求人类决策的模型安全工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-s-workflow

[English](README.md) | 中文

## 概述

为模型提供已由部署启动的工作流中的有界进度控制。五个工具用于读取状态、替换审核草稿、记录用量，或请求人类输入及完成审核。精确 revision 会拒绝过期写入，生命周期、批准、工件应用与发送始终不向模型开放。

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

在 `dsh-s-workflow` 之后把本包挂载到 goal 型 preset 中。部署必须启动 run；每次模型变更都必须先读取再复制准确的 `run_id` 与 `revision`。

| 工具 | 结果 |
|---|---|
| `get_workflow` | 读取当前 run 和准确 revision |
| `update_workflow_draft` | 替换完整审核草稿但不应用 |
| `checkpoint_workflow` | 记录进度与资源用量 |
| `request_workflow_input` | 暂停进度并等待一个人类回答 |
| `request_workflow_completion` | 提交草稿供人类明确审核 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每次调用都证明准确的活跃 agent 拥有当前 driver，通过服务解析当前工作流，并对变更使用比较并交换引用。草稿以 JSON 字符串跨越工具边界，上限为 128 KiB。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工作流服务](../s-workflow/README.zh.md)——状态、预算与权限规则。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-s-workflow)——准确 schema 与结果。
- [架构说明](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.zh.md)——preset 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到的内容

一条固定策略规定先读后写行为，以及进度报告与宿主权限之间的边界。

##### 工作流策略

```markdown
Workflow tools report progress inside an already-started deployment workflow. Call get_workflow before every change and copy its exact run_id and revision. You may update the review draft, record a checkpoint, request missing human input, or request completion review. You cannot start, pause, resume, cancel, raise budgets, approve completion, apply an artifact, or send it elsewhere.
```

#### Token 影响

当本包位于作用域内时，每次请求有少量固定输入成本。

#### KV Cache 影响

包作用域和策略文本不变时，前缀保持稳定。

### 工具 schema 与结果

#### 模型看到的内容

生成的 [`get_workflow`、`update_workflow_draft`、`checkpoint_workflow`、`request_workflow_input` 和 `request_workflow_completion` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-s-workflow)。结果包含紧凑的当前状态摘要；变更会追加持久的完整快照事件。

#### Token 影响

固定 schema 成本，加上每次调用的一条紧凑 JSON 结果。

#### KV Cache 影响

Schema 的定义与可见性不变时，前缀保持稳定；调用和结果追加在可复用前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **JSON 草稿传输**——草稿是完整 JSON 替换，而不是服务专用的类型化参数。
- **无生命周期权限**——启动、暂停、恢复、取消、预算、批准、应用和发送需要宿主表面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
