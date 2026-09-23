---
description: "The workflow group map: model-authored orchestration scripts that fan out subagents, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/workflow

English | [中文](README.zh.md)

## Summary

Use the workflow group for either deployment-owned durable workflows or model-authored orchestration. `s-workflow` keeps versioned definitions, budgets, drafts, and human decisions in full Session snapshots; its restricted tools report progress without lifecycle authority. The separate `workflow` and `ralph` tools retain scripted fan-out and fixed fresh-agent loops.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`workflow`](workflow/README.md) | Runs a model-written orchestration script that fans out subagents | `ctx.workflowEngine` |
| [`workflow-ptc`](workflow-ptc/README.md) | Runs workflow scripts through the shared sandboxed PTC Node process runtime | registers on `ctx.workflowEngine` |
| [`tool-workflow`](tool-workflow/README.md) | Gives the model the `workflow` tool for scripted multi-agent orchestration | registers on `ctx.tools` |
| [`tool-ralph`](tool-ralph/README.md) | Gives the model the `ralph` tool for fresh-agent iterative loops | registers on `ctx.tools` |
| [`s-workflow`](s-workflow/README.md) | Runs durable, catalog-defined, human-governed workflow state | `ctx.sWorkflow` |
| [`s-workflow-yaml`](s-workflow-yaml/README.md) | Loads strict no-code workflow and service-adapter YAML | `ctx.sWorkflowYaml` |
| [`tool-s-workflow`](tool-s-workflow/README.md) | Gives the model restricted workflow progress and review-request tools | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Workflow subsystem](../../docs/subsystems/workflow.md) — the seam's types, start request, and `workflow/*` events.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-workflow) — the `workflow` tool schema the model receives.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-ralph) — the `ralph` tool schema the model receives.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-s-workflow) — the restricted durable-workflow schemas the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-workflow-ptc) — every accepted engine config field.
- [Dynamic workflows Agent Note](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md) — the seam design and its decisions.
- [Harness-level goal-based execution Agent Note](../../.agents/notes/implemented/feature/2026-07-16-harness-level-loop.md) — the fixed fresh-agent loop design and deferred work.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
