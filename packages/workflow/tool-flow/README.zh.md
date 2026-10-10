---
description: "根据已发布 flow 定义生成命名模型工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-flow

[English](README.md) | 中文

## 概述

根据已发布 flow 定义生成命名模型工具。

## 目录

- [使用此包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

提供由 host 明确选择的发布上下文。每个定义添加对应命名工具及声明的输入 schema。`get_flow` 读取限定范围的进度。模型调用者不能回答决策或改变生命周期状态。启动结果返回执行 ID、修订号和受理状态，结束 turn，再由 host executor 继续。使用现有操作注册另一个 flow 只需要数据，不需要新的 HTTP endpoint 或工具 handler。

不发布 invariant companion，因为所有执行读写由 flow runtime 负责；此包仅保存可撤销的工具注册。

<a id="dev-note"></a>

## 开发备注

无。

<a id="model-experience"></a>

## 模型体验

### 阶段输入与结果报告

#### 模型看到什么

每个选定的已发布工具包含 flow 描述及参数 schema。结果确认执行已受理。`get_flow` 返回限定范围的状态、等待、诊断和已保存结果。

#### Token 影响

Schema 和固定指令增加输入 token。每个阶段只有一次受限请求尝试；失败尝试及缺少 usage 的尝试仍计费。

#### KV Cache 影响

稳定的 schema 和指令可以复用前缀。追加的阶段输入、调用和结果进入 conversation 历史。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 state root 由一个进程管理。一个 conversation 同时只能参与一个活动 flow。并行分支、循环、自动模型修正、模型创建定义、跨执行缓存和可移植可执行 trace 均推迟。
