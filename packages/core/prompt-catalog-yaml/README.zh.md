---
description: "用于受信任 prompt bundle 的严格启动期 YAML loader。"
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-catalog-yaml

[English](README.md) | 中文

## 概述

此 provider 在启动期间读取受信任的 prompt bundle 文件，并将其注册到 `ctx.promptCatalog`。它拒绝 YAML 执行特性、重复或未知字段、超大文档及格式错误的 bundle。它不会监视或重新加载文件。

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

让 provider row 指向一个文件或含有受信任 `.yaml` 文件的非递归目录。在 `dsh-prompt-catalog` 之后加载，并仅在所有 provider 激活后封存目录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Loader 使用唯一键 schema 解析 YAML，拒绝 directive、tag、anchor、alias、merge key、非字符串 map key、未知字段及超过 256 KiB 的文档，然后把语义验证交给目录。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Prompt 目录](../prompt-catalog/README.zh.md)——绑定、摘要与封存语义。
- [架构说明](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.zh.md)——部署组合。

-----

<a id="model-experience"></a>

## 模型体验

通过选择已加载 bundle 的 prompt-catalog 消费者间接产生影响。

#### KV Cache 影响

没有直接影响；启动时选择的 bundle 决定消费者所拥有的 prompt 前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限启动期**——修改文件后必须重启进程，禁止静默改变运行中的 session。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
