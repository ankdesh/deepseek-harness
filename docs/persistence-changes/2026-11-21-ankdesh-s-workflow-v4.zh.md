---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-21-ankdesh-s-workflow-v4

[English](2026-11-21-ankdesh-s-workflow-v4.md) | 中文

## 概述

在新的 V4 会话中记录 S-Workflow 状态，以及事件系统与原生流程模型的消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-21-ankdesh-s-workflow-v4
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "46090cf0fbb8a94f6e24c36e1b7d3cf40a17996a574d0b0f97560a883880b508"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "8644975e000a8668251093ea67807298c3fcc98383fc86e1a49289252fb90289"
    decision: same-version
  - root: "event:s-workflow/change"
    previous: null
    after: "5832041181a54bc40c4df139806297cf3b2da4e6b6d3590f9da8b67a038134d9"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "1b824394130167708f30b41973e842a9226641aa78771f0380103027ee6bac6f"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "7ddf7564ccb8e68b52e18e90981ccbce55596bb2fcb8cf81b6e91dd51a5f75a3"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

重建工作流状态需要 S-Workflow 事件。消息来源可区分事件转发和仅供流程模型使用的通知。此版本使用新的数据目录。请用旧运行时读取旧分支的 V3 记录。

<a id="verification"></a>
## 验证

持久化检查器比较生成的事件清单和记录的架构。S-Workflow、事件系统回放和原生流程模型测试覆盖受影响的写入与读取。

<a id="dev-note"></a>
## 开发备注

无。
