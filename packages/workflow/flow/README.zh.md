---
description: "公共 flow 类型和纯编译。"
kind: "package-reference"
---

# @deepseek-ai/dsh-flow

[English](README.md) | 中文

## 概述

公共 flow 类型和纯编译。

## 目录

- [使用此包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

使用 `defineFlow()` 和 `defineOperation()` 编写定义和操作。执行前编译精确的操作及子 flow 版本。类型引用保留 JSON 值。等值分支和子 flow 必须无环。编译器使用 Harness 强制验证的 JSON Schema 子集；领域操作验证语义边界。

不发布 invariant companion，因为此包只包含定义和纯编译，没有独立维护的运行时观测。

<a id="dev-note"></a>

## 开发备注

无。

<a id="model-experience"></a>

## 模型体验

无，因为此包验证定义数据，不添加模型输入。

#### KV Cache 影响

消费者负责模型输入。固定定义保证一次执行中的指令稳定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 state root 由一个进程管理。一个 conversation 同时只能参与一个活动 flow。并行分支、循环、自动模型修正、模型创建定义、跨执行缓存和可移植可执行 trace 均推迟。
