---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-22-s-workflow-state

English | [中文](2026-09-22-s-workflow-state.zh.md)

## Summary

Adds the required `s-workflow/change` session event. Each event stores the complete post-mutation workflow snapshot, including exact catalog content identities, lifecycle state, resource budgets and usage, the current draft and checkpoint, and any pending human decision.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

This is an additive required event root and does not change the Session v3 envelope. Current readers reconstruct it through the workflow projection. Older builds do not silently skip it: their build-static known-event set rejects a log containing this non-ignorable event, so opening with an unaware binary fails closed instead of producing incorrect workflow state.

<a id="verification"></a>
## Verification

Regenerated the persistence catalog, schema inventory, and known-event set. TypeScript builds and focused Vitest coverage validate full-snapshot folding, consecutive revisions, strict YAML loading, catalog identity, and replay failure retention under Node.js 24.

<a id="dev-note"></a>
## Dev Note

None.
