---
description: "Public flow types and pure compilation."
kind: "package-reference"
---

# @deepseek-ai/dsh-flow

English | [中文](README.zh.md)

## Summary

Public flow types and pure compilation.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Use `defineFlow()` and `defineOperation()` to author definitions and operations. Compile exact operation and subflow versions before execution. Typed references preserve JSON values. Equality branches and subflows must be acyclic. The compiler uses the enforced Harness JSON Schema subset; domain operations validate semantic bounds.

No invariant companion is published because this package contains definitions and pure compilation, with no independently maintained runtime observations.

<a id="dev-note"></a>

## Dev Note

None.

<a id="model-experience"></a>

## Model Experience

None, as this package validates definition data without adding model input.

#### KV Cache effect

The consumer owns model input. Pinned definitions keep instructions stable within an execution.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One process owns each state root. One active flow can involve a conversation at a time. Parallel branches, loops, automatic model repair, model-created definitions, cross-run caching and portable executable traces are deferred.
