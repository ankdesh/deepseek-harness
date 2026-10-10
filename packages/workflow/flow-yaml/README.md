---
description: "Strict YAML definitions and pinned instruction files."
kind: "package-reference"
---

# @deepseek-ai/dsh-flow-yaml

English | [中文](README.zh.md)

## Summary

Strict YAML definitions and pinned instruction files.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Configure trusted roots, whole-file bytes and instruction bytes. Tags, anchors, aliases, duplicate keys, unknown fields and executable expressions reject loading. Instruction paths stay inside their definition directory. YAML and TypeScript use the same compiler. Import `dsh-flow-yaml/example` for the independent text counter, branch, reusable subflow and optional typed model summary.

No invariant companion is published because loading validates data once and retains no independent execution state.

<a id="dev-note"></a>

## Dev Note

None.

<a id="model-experience"></a>

## Model Experience

Indirectly, through consumers of the compiled definitions and pinned instructions.

#### KV Cache effect

The consumer owns model input. Pinned definitions keep instructions stable within an execution.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One process owns each state root. One active flow can involve a conversation at a time. Parallel branches, loops, automatic model repair, model-created definitions, cross-run caching and portable executable traces are deferred.
