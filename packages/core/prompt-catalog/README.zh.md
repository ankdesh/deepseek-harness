---
description: "用于组合部署及领域指令的密封版本化 prompt bundle 注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-catalog

[English](README.md) | 中文

## 概述

`dsh-prompt-catalog` 在启动期间存储经过验证且带版本的 prompt bundle。消费者使用标量变量绑定准确版本，并取得有序 section、具名文本片段以及稳定的 SHA-256 摘要。调用 `seal()` 后会拒绝新增注册，同时 effect 所属的 disposer 仍可执行正常的 Cordis 拆卸。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用此包

请先加载此服务，再加载 bundle provider。Provider 调用 `ctx.promptCatalog.register(...)`；所有受信任 provider 激活后，部署调用 `seal()`。运行时消费者使用准确的 `{id, version}` 引用，禁止隐式选择最新版本。

Catalog 不接受 `complete` prompt override。它限制每段文本、每个 bundle 和渲染后内容的大小，并拒绝重复标识、无效语义版本、未解析变量和空 section。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

注册过程验证并深度冻结每个 bundle。绑定只替换已声明的标量变量，确定性排序 section，并散列规范 JSON，使部署能够持久化精确身份。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Prompt YAML provider](../prompt-catalog-yaml/README.zh.md)——严格的启动期加载。
- [架构说明](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.zh.md)——目录组合决策。

-----

<a id="model-experience"></a>

## 模型体验

通过在 Agent system-prompt 服务中注册已绑定 section 的消费者间接产生影响。

#### KV Cache 影响

Catalog 本身不会增加请求内容。消费者改变选中的 bundle 摘要时，会改变其拥有的 system-prompt 前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅支持标量替换**——模板不提供条件、循环、继承或 include；调用方必须自行准备结构化 block。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
