---
description: "严格 YAML 定义和固定的指令文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-flow-yaml

[English](README.md) | 中文

## 概述

严格 YAML 定义和固定的指令文件。

## 目录

- [使用此包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

配置可信根目录、完整文件字节数和指令字节数。标签、锚点、别名、重复键、未知字段和可执行表达式均拒绝加载。指令路径限定在定义目录内。YAML 和 TypeScript 使用同一编译器。导入 `dsh-flow-yaml/example` 可使用独立的文本计数器、分支、可复用子 flow 和可选的类型化模型摘要。

不发布 invariant companion，因为加载只验证一次数据，不保留独立的执行状态。

<a id="dev-note"></a>

## 开发备注

无。

<a id="model-experience"></a>

## 模型体验

间接通过编译定义和固定指令的消费者。

#### KV Cache 影响

消费者负责模型输入。固定定义保证一次执行中的指令稳定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 state root 由一个进程管理。一个 conversation 同时只能参与一个活动 flow。并行分支、循环、自动模型修正、模型创建定义、跨执行缓存和可移植可执行 trace 均推迟。
