---
description: "Strict startup YAML loader for workflow definitions and service adapters."
kind: "package-reference"
---

# @deepseek-ai/dsh-s-workflow-yaml

English | [中文](README.zh.md)

## Summary

Load declarative workflow definitions and service adapters once at startup. The loader accepts data only and rejects YAML execution features, unknown fields, and oversized files. Choose it for deployment-owned catalogs that must remain stable for a process lifetime.

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

Mount it after `dsh-s-workflow`, point it at files or non-recursive directories, and seal the workflow catalogs only after all providers load. Documents contain no script or expression field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The parser rejects directives, custom tags, aliases, anchors, merge keys, non-string keys, duplicate or unknown fields, and files over 256 KiB before registering typed values.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workflow service](../s-workflow/README.md) — catalog and lifecycle contracts.
- [Architecture note](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.md) — generic workflow composition.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through consumers that project loaded workflow definitions and adapters.

#### KV Cache effect

The loader adds no request content; selected catalog identities affect only consumer-owned context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Startup only** — roots are trusted deployment configuration and are not hot-reloaded.
- **Non-recursive directories** — nested catalog layouts require explicit rows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
