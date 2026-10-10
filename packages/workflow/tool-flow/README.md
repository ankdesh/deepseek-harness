---
description: "Named model tools from published flow definitions."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-flow

English | [中文](README.zh.md)

## Summary

Named model tools from published flow definitions.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Supply an explicit host-selected publication context. Every definition adds its named tool with the declared input schema. `get_flow` reads scoped progress. Model callers cannot answer decisions or change lifecycle state. A start result reports execution ID, revision and accepted state, concludes the turn, and lets the host executor continue. Registering another flow with existing operations requires data, not a new HTTP endpoint or tool handler.

No invariant companion is published because all execution reads and writes belong to the flow runtime; this package keeps only reversible tool registrations.

<a id="dev-note"></a>

## Dev Note

None.

<a id="model-experience"></a>

## Model Experience

### Phase input and result reporting

#### What the model sees

Each selected published tool has its flow description and argument schema. The result acknowledges execution acceptance. `get_flow` returns scoped status, waits, diagnostics and saved results.

#### Token effect

Schemas and pinned instructions add input tokens. Each phase has one bounded request attempt; failed attempts and missing usage remain charged.

#### KV Cache effect

Stable schemas and instructions can reuse their prefix. Appended phase inputs, calls and results add to conversation history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One process owns each state root. One active flow can involve a conversation at a time. Parallel branches, loops, automatic model repair, model-created definitions, cross-run caching and portable executable traces are deferred.
