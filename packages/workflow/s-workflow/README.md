---
description: "Durable, catalog-driven workflow state and authority boundaries for configurable assistants."
kind: "package-reference"
---

# @deepseek-ai/dsh-s-workflow

English | [中文](README.zh.md)

## Summary

Use `dsh-s-workflow` to run one durable, version-pinned workflow in a session. It records complete snapshots, budgets, drafts, checkpoints, and pending human decisions while keeping lifecycle and completion approval under host authority. Choose it when a deployment needs resumable work instead of a one-shot answer.

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

Mount the service before catalog providers, model tools, and deployment adapters. Register exact workflow and service-adapter versions during startup, seal both catalogs, then let the host start a run with an explicit preset and immutable binding.

### Authority boundary

Hosts start, pause, resume, cancel, answer input, approve completion, and raise budgets. Model-facing consumers may replace a draft, checkpoint work, or request human input or completion review. The service never applies or sends a product artifact.

### Durable state

Every `s-workflow/change` event contains a complete post-change snapshot and exact catalog digests. Revisions are consecutive, compare-and-set mutations reject stale references, and only one nonterminal run may exist per session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The catalog canonicalizes definitions and adapters before hashing them. The projection retains a failed state when snapshot continuity cannot be proven, and the service rejects access when the loaded catalog no longer matches a persisted digest. Preset policies provide bounded defaults and hard maximums for rounds, requests, tokens, elapsed time, and child work.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Catalogs, canonical digests, snapshot projection, and host/model mutation boundaries |
| [`src/types.ts`](src/types.ts) | Public workflow, budget, draft, and pending-decision contracts |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workflow YAML provider](../s-workflow-yaml/README.md) — strict declarative catalog loading.
- [Workflow tools](../tool-s-workflow/README.md) — the restricted model-facing mutation surface.
- [Persistence catalog](../../../docs/persistence-catalog.md) — the durable event contract.
- [Architecture note](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.md) — composition and authority decisions.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through prompt and tool consumers that project the current workflow snapshot.

#### KV Cache effect

The service adds no request content; consumers decide when changing workflow state appends model-visible context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One active run** — each session permits only one nonterminal workflow.
- **Exact catalogs required** — resume fails closed unless the process has the same definition and adapter digests.
- **No scheduler or executor** — goal rounds, child agents, review rendering, and artifact application are composed separately.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
