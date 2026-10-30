---
description: "启动产品 Web 界面并托管已安装的前端文件，无需选择完整的 UI bundle。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-runtime

[English](README.md) | 中文

## 概述

启动并托管产品 Web 界面，同时独立选择其 UI 模块。在显式产品配置中使用本包。它保留完整 Web bundle 的启动行为，并要求提供已构建的前端以及声明的主机服务。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在命名的 `dsh` 配置中挂载主插件及其 `./startup` 入口。[Web bundle 组合](../web-app/cordis.patch.yml)提供完整示例。本包不选择对话 UI 插件；产品需单独声明这些包和配置项。

启动服务接受主机、端口、可信主机和打开浏览器的选项。必需的启动服务失败时，不会输出就绪 URL 或打开浏览器。产品必须提供主机服务器、客户端连接、静态前端提供方以及其他已声明服务。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[托管](src/index.ts)从已安装的前端包元数据解析浏览器资源。[启动](src/startup.ts)提供命令行设置。完整的 Web bundle 重新导出这两个入口。不发布独立的不变量插件，因为托管和注册服务自行管理其资源。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [Web bundle](../web-app/README.zh.md) — 完整的标准 UI 组合。
- [应用启动](../../boot/app-boot/README.zh.md) — 命名配置和有序层。
- [前端托管](../../host/frontend-static/README.zh.md) — 构建后的浏览器文件。

<a id="model-experience"></a>
## 模型体验

### Harness 源码与 Web 表层上下文

#### 模型看到什么

当 `surfaceContext` 为 true 时，`harness:source` 段落标明磁盘上的 Harness 实现，但不会声称它就是工作目录；全局段落 `app:web-surface`（first-party 顺序 10100，位于可复用指令之后）则向模型说明 GUI：规范的本地 URL、「this page」指代什么、更新约定（重载接收端始终开启；无刷新重载还需要 `pnpm run dev:web` watcher），以及不要启动替代服务器的指令。`DSH_WEB_URL` 还会连同描述出现在受管 bash 环境中，每次调用时从运行中的服务器解析。当它为 false 时，这两个段落和该变量都不会注册。

#### Token 影响

每个会话一行源码说明和一段提示词，外加两行受管环境变量；每个进程内保持恒定。

#### KV Cache 影响

源码与 Web 段落位于第一方可复用指令之后。工具与配置一致时，不同 checkout 路径或本地端口不会改变前置前缀；不保证提供方复用缓存。


## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 前端发行文件仍是共享依赖；本包不会为每个产品编译前端。
- 不同的前端需要单独测试其提供方。
- 浏览器交接报告的是已请求启动，而非浏览器窗口已经打开。

### 开发备注

无。
