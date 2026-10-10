---
description: "开发者定义 flow 的持久执行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-flow-runtime

[English](README.md) | 中文

## 概述

开发者定义 flow 的持久执行。

## 目录

- [使用此包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

在原生 storage domain 上挂载 `ctx.flows`。明确配置全部六项部署限制。启动验证输入和调用上下文，记录固定的编译定义，并返回已受理状态。命名工具仅在发起 turn 及其原生日志结束后推进。Pause、Resume、Cancel 和等待响应使用执行 ID 及已观察的修订号。重启后必须显式 Resume。操作版本必须兼容。Receipt 恢复解决不确定写入；取消保留已确认的效果。

不发布 invariant companion，因为节点进度和图帧提交到同一权威记录；原生结果 receipt 由模型提供者的 companion 检查。

<a id="dev-note"></a>

## 开发备注

无。

<a id="model-experience"></a>

## 模型体验

间接通过读取已提交执行状态的命名 flow 工具和原生模型阶段。

#### KV Cache 影响

消费者负责模型输入。固定定义保证一次执行中的指令稳定。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 state root 由一个进程管理。一个 conversation 同时只能参与一个活动 flow。并行分支、循环、自动模型修正、模型创建定义、跨执行缓存和可移植可执行 trace 均推迟。
