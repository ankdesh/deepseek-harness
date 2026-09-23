---
description: "工作流 definition 与服务 adapter 的严格启动期 YAML loader。"
kind: "package-reference"
---

# @deepseek-ai/dsh-s-workflow-yaml

[English](README.md) | 中文

## 概述

在启动期一次性加载声明式工作流 definition 和服务 adapter。Loader 只接受数据，并拒绝 YAML 执行特性、未知字段及超大文件。对于必须在进程生命周期内保持稳定的部署目录，请选择本包。

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

在 `dsh-s-workflow` 后挂载本包，使其指向文件或非递归目录，并仅在所有 provider 加载后封存工作流目录。文档不含 script 或 expression 字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Parser 在注册类型化值之前拒绝 directive、自定义 tag、alias、anchor、merge key、非字符串 key、重复或未知字段，以及超过 256 KiB 的文件。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工作流服务](../s-workflow/README.zh.md)——目录与生命周期约定。
- [架构说明](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.zh.md)——通用工作流组合。

-----

<a id="model-experience"></a>
## 模型体验

通过投影已加载工作流 definition 和 adapter 的消费者间接产生影响。

#### KV Cache 影响

Loader 不增加请求内容；选中的目录身份只影响消费者拥有的上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限启动期**——根目录属于可信部署配置，不支持热重载。
- **非递归目录**——嵌套目录布局需要明确配置 row。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
