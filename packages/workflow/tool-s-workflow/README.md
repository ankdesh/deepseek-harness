---
description: "Model-safe tools for reading workflow state, replacing drafts, checkpointing progress, and requesting human decisions."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-s-workflow

English | [中文](README.zh.md)

## Summary

Give a model bounded progress controls inside an already-started deployment workflow. Five tools read state, replace a review draft, checkpoint usage, or request human input or completion review. Exact revisions reject stale writes, and lifecycle, approval, artifact application, and sending remain unavailable to the model.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package in goal-oriented presets after `dsh-s-workflow`. The deployment must start the run; every model mutation must first read and then copy the exact `run_id` and `revision`.

| Tool | Outcome |
|---|---|
| `get_workflow` | Read the current run and exact revision |
| `update_workflow_draft` | Replace the complete review draft without applying it |
| `checkpoint_workflow` | Record progress and resource usage |
| `request_workflow_input` | Pause progress for one human answer |
| `request_workflow_completion` | Submit the draft for explicit human review |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each call proves that the exact live agent owns the active driver, resolves the current workflow through the service, and uses compare-and-set references for changes. Drafts cross the tool boundary as JSON strings and are capped at 128 KiB.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workflow service](../s-workflow/README.md) — state, budget, and authority rules.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-s-workflow) — exact schemas and results.
- [Architecture note](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.md) — preset composition.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One fixed policy defines read-before-write behavior and the boundary between progress reporting and host authority.

##### Workflow policy

```markdown
Workflow tools report progress inside an already-started deployment workflow. Call get_workflow before every change and copy its exact run_id and revision. You may update the review draft, record a checkpoint, request missing human input, or request completion review. You cannot start, pause, resume, cancel, raise budgets, approve completion, apply an artifact, or send it elsewhere.
```

#### Token effect

Small fixed input cost whenever the package is in scope.

#### KV Cache effect

Prefix-stable while the package scope and policy text remain unchanged.

### Tool schemas and results

#### What the model sees

The generated [`get_workflow`, `update_workflow_draft`, `checkpoint_workflow`, `request_workflow_input`, and `request_workflow_completion` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-s-workflow). Results contain a compact current-state summary; mutations append a durable full-snapshot event.

#### Token effect

Fixed schema cost plus one compact JSON result per call.

#### KV Cache effect

Schemas are prefix-stable while their definitions and visibility are unchanged; calls and results append after the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **JSON draft transport** — drafts are complete JSON replacements rather than service-specific typed arguments.
- **No lifecycle authority** — start, pause, resume, cancel, budgets, approval, application, and sending require host surfaces.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
