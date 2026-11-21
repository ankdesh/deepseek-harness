---
description: "Start a product Web interface and serve installed frontend files without selecting a broad UI bundle."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-runtime

English | [中文](README.zh.md)

## Summary

Start and host a product Web interface while selecting its UI modules separately. Use this package in an explicit product profile. It retains the startup behavior of the broad web bundle and requires a built frontend and the declared host services.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount the main plugin and its `./startup` entry in a named `dsh` profile. The [web bundle composition](../web-app/cordis.patch.yml) supplies a complete example. This package does not select conversation UI plugins; the product declares those packages and rows separately.

The startup service accepts host, port, trusted-host, and browser-opening options. Required startup failures prevent the ready URL and browser handoff. Existing product connection rows can read explicitly configured authorities from `ctx.webRuntime.trustedHosts`. A product must supply the host server, client connection, static frontend provider, and other declared services.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

[Hosting](src/index.ts) resolves browser assets from installed frontend package metadata. [Startup](src/startup.ts) supplies command-line settings. The broad web bundle re-exports both entries. No independent invariant companion is published because the hosting and registration services manage their own resources.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Web bundle](../web-app/README.md) — the complete standard UI composition.
- [App boot](../../boot/app-boot/README.md) — named profiles and ordered layers.
- [Frontend hosting](../../host/frontend-static/README.md) — built browser files.

<a id="model-experience"></a>
## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the runtime registers `DSH_WEB_URL` for shell commands. A profile that mounts [Harness development context](../../context/harness-dev-context/README.md) can also include Web orientation in model requests.

#### Token effect

The shell variable has no prompt cost. The development context package owns any model text.

#### KV Cache effect

The Web runtime does not modify model input. The enabled context plugins determine whether the advertised URL appears in requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The frontend distribution remains a shared dependency; this package does not compile a frontend per product.
- A different frontend needs its own tested provider.
- Browser handoff reports that the launch was requested, not that a browser window opened.

### Dev Note

None.
