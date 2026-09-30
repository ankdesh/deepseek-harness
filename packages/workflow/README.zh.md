---
description: "workflow 组地图：由模型编写的、可扇出 subagent 的编排脚本，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/workflow

[English](README.md) | 中文

## 概述

使用 workflow 组可选择部署拥有的持久工作流或模型编写的编排。`s-workflow` 在完整 Session 快照中保存版本化 definition、预算、草稿与人类决策；其受限工具只报告进度，不拥有生命周期权限。独立的 `workflow` 和 `ralph` 工具继续提供脚本化扇出和固定的全新 agent 循环。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`event-system`](event-system/README.zh.md) | 持久对话内事件 agent 与宿主聚合预算 | `ctx.eventSystems` |
| [`event-system-yaml`](event-system-yaml/README.zh.md) | 可信 YAML 成员／订阅与 Markdown 提示词 | `ctx.eventSystemsYaml` |
| [`workflow`](workflow/README.zh.md) | 运行由模型编写的、扇出 subagent 的编排脚本 | `ctx.workflowEngine` |
| [`workflow-ptc`](workflow-ptc/README.zh.md) | 通过共享的沙箱化 PTC Node 进程运行时执行工作流脚本 | 注册到 `ctx.workflowEngine` |
| [`tool-workflow`](tool-workflow/README.zh.md) | 把 `workflow` 工具交给模型，用于脚本化多 agent 编排 | 注册到 `ctx.tools` |
| [`tool-ralph`](tool-ralph/README.zh.md) | 把 `ralph` 工具交给模型，用于全新 agent 迭代循环 | 注册到 `ctx.tools` |
| [`s-workflow`](s-workflow/README.zh.md) | 运行持久、目录定义、由人类治理的工作流状态 | `ctx.sWorkflow` |
| [`s-workflow-yaml`](s-workflow-yaml/README.zh.md) | 加载严格无代码的工作流与服务 adapter YAML | `ctx.sWorkflowYaml` |
| [`tool-s-workflow`](tool-s-workflow/README.zh.md) | 向模型提供受限的工作流进度与审核请求工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

- [工作流子系统](../../docs/subsystems/workflow.zh.md)——seam 的类型、启动请求与 `workflow/*` 事件。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-workflow)——模型接收的 `workflow` 工具 schema。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-ralph)——模型接收的 `ralph` 工具 schema。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-s-workflow)——模型接收的受限持久工作流 schema。
- [生成的配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-workflow-ptc)——每个受支持的引擎配置字段。
- [动态工作流 Agent Note](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.zh.md)——seam 设计及其决策。
- [Harness 层目标式执行 Agent Note](../../.agents/notes/implemented/feature/2026-07-16-harness-level-loop.zh.md)——固定全新 agent 循环的设计与暂缓事项。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
