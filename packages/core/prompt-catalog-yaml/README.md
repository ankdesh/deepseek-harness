---
description: "Strict startup YAML loader for trusted prompt bundles."
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-catalog-yaml

English | [中文](README.zh.md)

## Summary

This provider reads trusted prompt bundle files during startup and registers them on `ctx.promptCatalog`. It rejects YAML execution features, duplicate or unknown fields, oversized documents, and malformed bundle shapes. It never watches or reloads files.

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

Point a provider row at one file or a non-recursive directory of trusted `.yaml` files. Load it after `dsh-prompt-catalog` and seal the catalog only after every provider has activated.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The loader parses YAML with a unique-key schema, rejects directives, tags, anchors, aliases, merge keys, non-string map keys, unknown fields, and documents over 256 KiB, then delegates semantic validation to the catalog.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Prompt catalog](../prompt-catalog/README.md) — binding, digest, and sealing semantics.
- [Architecture note](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.md) — deployment composition.

-----

<a id="model-experience"></a>

## Model Experience

Indirectly, through the prompt-catalog consumers that select loaded bundles.

#### KV Cache effect

No direct effect; startup bundle selection determines consumer-owned prompt prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Startup only** — changing a file requires a process restart and cannot alter a running session silently.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
