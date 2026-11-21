---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-21-ankdesh-s-workflow-v4

English | [中文](2026-11-21-ankdesh-s-workflow-v4.zh.md)

## Summary

Record S-Workflow state and the event-system and native Flow model message sources in fresh V4 Sessions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The S-Workflow event is required to reconstruct workflow state. The message sources distinguish event relays from private Flow model notices. Use a fresh data directory for this release. Read old fork V3 records with the old runtime.

<a id="verification"></a>
## Verification

The persistence checker compares the generated event inventory with the recorded schema. The S-Workflow, event-system replay, and native Flow model tests cover the affected writers and readers.

<a id="dev-note"></a>
## Dev Note

None.
