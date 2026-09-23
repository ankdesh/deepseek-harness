---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-22-s-workflow-state

[English](2026-09-22-s-workflow-state.md) | 中文

## 概述

新增必需的 `s-workflow/change` 会话事件。每个事件保存变更后的完整工作流快照，包括精确的目录内容标识、生命周期状态、资源预算与用量、当前草稿与检查点，以及待处理的人类决策。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-22-s-workflow-state
baseline: false
changes:
  - root: "event:s-workflow/change"
    previous: null
    after: "5832041181a54bc40c4df139806297cf3b2da4e6b6d3590f9da8b67a038134d9"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这是新增的必需事件根，不改变 Session v3 信封。当前读取器通过工作流投影重建状态。旧版本不会静默跳过该事件：其构建期已知事件集合会拒绝包含此不可忽略事件的日志，因此不理解该事件的程序会安全失败，而不会生成错误的工作流状态。

<a id="verification"></a>
## 验证

已重新生成持久化目录、模式清单和已知事件集合。Node.js 24 下的 TypeScript 构建与定向 Vitest 覆盖验证了完整快照折叠、连续修订、严格 YAML 加载、目录身份和重放失败保留。

<a id="dev-note"></a>
## 开发备注

无。
