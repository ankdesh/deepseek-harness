---
description: "原生 conversation 中受限且只返回结果的阶段。"
kind: "package-reference"
---

# @deepseek-ai/dsh-flow-model-native

[English](README.md) | 中文

## 概述

原生 conversation 中受限且只返回结果的阶段。

## 目录

- [使用此包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

在 agents、sessions、persistence、tools、system prompt 和 flows 之后挂载。每次尝试固定指令、JSON 输入、结果 schema 和提供者选择。原生请求仅展示 `structured_output`；guard 拒绝领域工具。无效输出、意外调用、缺少结果和提供者失败会结束尝试，不进行修正。设计者输入暂停阶段，并保留在普通 inbox。完成需要精确的 inbox receipt、成功的工具结果和 turn 结束。已关闭 conversation 通过持久原生日志进行核对。

Invariant companion 比较已提交的模型输出与独立记录的原生结构化结果 receipt。

恢复的对话会在处理普通输入前丢弃排队的阶段通知。执行器保留已完成的原生回执，并要求对未完成工作显式执行 Resume。回执检查使用显式原生存储读取。请求计费与 Event System 共用预留和用量结算规则；提供方未报告用量时保留预留费用。

<a id="dev-note"></a>

## 开发备注

无。

<a id="model-experience"></a>

## 模型体验

### 阶段输入与结果报告

#### 模型看到什么

固定的阶段指令、明确的 JSON 输入及结果 schema。只有 `structured_output` 能报告结果。原生 conversation 历史仍然可见。

#### Token 影响

Schema 和固定指令增加输入 token。每个阶段只有一次受限请求尝试；失败尝试及缺少 usage 的尝试仍计费。

#### KV Cache 影响

稳定的 schema 和指令可以复用前缀。追加的阶段输入、调用和结果进入 conversation 历史。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 state root 由一个进程管理。一个 conversation 同时只能参与一个活动 flow。并行分支、循环、自动模型修正、模型创建定义、跨执行缓存和可移植可执行 trace 均推迟。
