---
description: "Sealed versioned prompt-bundle registry for composable deployment and domain instructions."
kind: "package-reference"
---

# @deepseek-ai/dsh-prompt-catalog

English | [中文](README.zh.md)

## Summary

`dsh-prompt-catalog` stores validated, versioned prompt bundles during startup. Consumers bind exact versions with scalar variables and receive ordered sections plus named text fragments and a stable SHA-256 digest. `seal()` rejects later registrations, while effect-owned disposers still permit normal Cordis teardown.

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

Load the service before bundle providers. Providers call `ctx.promptCatalog.register(...)`; the deployment calls `seal()` after every trusted provider has activated. Runtime consumers use exact `{id, version}` references and never select an implicit latest bundle.

The catalog accepts no `complete` prompt override. It bounds each text, bundle, and rendered contribution and rejects duplicate identities, invalid semantic versions, unresolved variables, and empty sections.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Registration validates and deep-freezes each bundle. Binding substitutes only declared scalar variables, sorts sections deterministically, and hashes canonical JSON so deployments can persist an exact identity.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Prompt YAML provider](../prompt-catalog-yaml/README.md) — strict startup loading.
- [Architecture note](../../../.agents/notes/implemented/architecture/2026-09-22-configurable-prompt-and-workflow-catalogs.md) — catalog composition decisions.

-----

<a id="model-experience"></a>

## Model Experience

Indirectly, through consumers that register bound sections on an Agent's system-prompt service.

#### KV Cache effect

The catalog itself adds no request content. A consumer changing a selected bundle digest changes the system-prompt prefix it owns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Scalar substitution only** — templates have no conditions, loops, inheritance, or includes; callers must prepare any structured block themselves.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
