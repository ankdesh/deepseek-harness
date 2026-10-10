---
description: "Durable execution of developer-authored flows."
kind: "package-reference"
---

# @deepseek-ai/dsh-flow-runtime

English | [中文](README.zh.md)

## Summary

Durable execution of developer-authored flows.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount `ctx.flows` over native storage domains. Set all six deployment limits explicitly. Start admission validates inputs and caller context, records a pinned compiled definition, and returns acceptance. Named tools advance only after the initiating turn and its native log settle. Pause, Resume, Cancel and wait responses use the execution ID and observed revision. Restart requires explicit Resume. Operation versions must remain compatible. Receipt recovery resolves uncertain writes; cancellation retains confirmed effects.

No invariant companion is published because node progress and graph frames commit in one authoritative record; native result receipts are checked by the model provider companion.

<a id="dev-note"></a>

## Dev Note

None.

<a id="model-experience"></a>

## Model Experience

Indirectly, through named flow tools and native model phases that consume committed execution state.

#### KV Cache effect

The consumer owns model input. Pinned definitions keep instructions stable within an execution.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One process owns each state root. One active flow can involve a conversation at a time. Parallel branches, loops, automatic model repair, model-created definitions, cross-run caching and portable executable traces are deferred.
