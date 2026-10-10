---
description: "可复用 flow 执行的进度和人工控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-flow

[English](README.md) | 中文

## 概述

在 conversation dock 显示最近的 flow 执行。状态和可用控制来自已提交的 host 读取。Pause、Resume 和 Cancel 携带显示的执行修订号。

## 目录

- [使用此包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

在 host 挂载 flow runtime controller，在 web profile 挂载此 plugin。Dock 订阅经过裁剪的执行通知，并在连接重置后刷新。产品专用 approval card 保留在产品 plugin 中。

不发布 invariant companion，因为 dock 显示已提交的 remote 读取，不持有 host 执行状态。

<a id="dev-note"></a>

## 开发备注

无。

<a id="model-experience"></a>

## 模型体验

间接通过恢复受限原生模型阶段的人工生命周期命令。

#### KV Cache 影响

Browser contribution 不添加模型请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Dock 显示最近的执行。完整 trace inspector 和产品专用 approval form 是独立消费者。
