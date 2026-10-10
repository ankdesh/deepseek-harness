---
description: "Bounded result-only phases in native conversations."
kind: "package-reference"
---

# @deepseek-ai/dsh-flow-model-native

English | [中文](README.zh.md)

## Summary

Bounded result-only phases in native conversations.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount after agents, sessions, persistence, tools, system prompt and flows. Each attempt pins instructions, JSON inputs, result schema and provider selection. The native request exposes only `structured_output`; a guard rejects domain tools. Invalid output, unexpected calls, missing results and provider failure end the attempt without correction. Designer input pauses the phase and remains in the ordinary inbox. Completion requires the exact inbox receipt, successful tool result and turn ending. Closed conversations reconcile through persisted native logs.

The invariant companion compares committed model outputs with independently recorded native structured-result receipts.

Restored conversations discard queued phase notices before ordinary input can run. The executor retains completed native receipts and requires explicit Resume for unfinished work. Receipt inspection uses explicit native storage reads. Request accounting shares reservation and usage settlement with the Event System; missing provider usage retains the reserved charge.

<a id="dev-note"></a>

## Dev Note

None.

<a id="model-experience"></a>

## Model Experience

### Phase input and result reporting

#### What the model sees

Pinned phase instructions, explicit JSON inputs, and the result schema. Only `structured_output` reports a result. Native conversation history remains visible.

#### Token effect

Schemas and pinned instructions add input tokens. Each phase has one bounded request attempt; failed attempts and missing usage remain charged.

#### KV Cache effect

Stable schemas and instructions can reuse their prefix. Appended phase inputs, calls and results add to conversation history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One process owns each state root. One active flow can involve a conversation at a time. Parallel branches, loops, automatic model repair, model-created definitions, cross-run caching and portable executable traces are deferred.
