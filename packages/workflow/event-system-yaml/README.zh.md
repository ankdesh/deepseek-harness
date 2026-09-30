---
description: "严格可信 YAML 事件定义与目录内 Markdown 提示词。"
kind: "package-reference"
---

# @deepseek-ai/dsh-event-system-yaml

[English](README.md) | 中文

<a id="summary"></a>
## 概述

把启动阶段拥有的事件 agent 模板加载到 `ctx.eventSystems`。YAML 指定成员、精确事件载荷 schema 和固定订阅；每个 agent 的 `prompt` 指向目录内 Markdown 文件。此 provider 不求值代码或启动 agent。

<a id="table-of-contents"></a>
## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用此包

先挂载[事件服务](../event-system/README.zh.md)，再显式配置 `roots`、`maxFileBytes`、`maxPromptBytes`。根路径为文件或目录，目录按排序加载直接 `.yaml`/`.yml` 子文件。`id` 和 `version` 标识模板。宿主在启动后封存注册，并在挂接对话时固定解析后的提示词。可从[通用示例](../event-system/examples/analysis-review/system.yml)开始。

<a id="understand-the-implementation"></a>
## 了解实现

解析器接受原生支持的 JSON Schema 子集，拒绝未知字段、缺失成员／事件引用、重复键、指令、标签、锚点、别名、合并键和非字符串映射键。提示词真实路径必须位于定义目录内且以 `.md` 结尾；空、缺失、越界或过大的提示词使启动失败。字节上限约束 YAML 和提示词。注册归销毁效果拥有，后续文件失败时也会回滚。

不发布运行时不变量配套插件，因为此 provider 通过归销毁效果拥有的目录注册贡献不可变启动定义，不维护可独立变化的运行时投影。

<a id="further-exploration"></a>
## 延伸阅读

- [Event service](../event-system/README.zh.md) — execution, spending, and recovery semantics.
- [Workflow subsystem](../../../docs/subsystems/workflow.zh.md) — group responsibilities.

<a id="model-experience"></a>
## 模型体验

### 已解析模板数据

#### 模型看到什么

provider 本身不增加模型消息或工具。事件服务消费解析后的 `prompt` 文本并添加稳定成员指令；YAML 保持为可信部署输入。

#### Token 影响

解析和注册不调用模型。消费服务执行成员时计入指令和事件输入。

#### KV 缓存影响

provider 只加载一次文本，不修改请求／缓存协议。模板文件变更时，已有对话保留固定指令。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 加载仅在启动时进行，不递归，无表达式、导入、自动热重载、编辑器或工作流编写。修改适用于新对话，既有对话保留固定解析定义。

<a id="dev-note"></a>
### 开发备注

解析回归检查严格 YAML 和真实文件系统路径包含关系。原生执行行为由服务 Loader 测试负责。
