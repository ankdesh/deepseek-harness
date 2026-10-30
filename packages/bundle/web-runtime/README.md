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

The startup service accepts host, port, trusted-host, and browser-opening options. Required startup failures prevent the ready URL and browser handoff. A product must supply the host server, client connection, static frontend provider, and other declared services.

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

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section (first-party order 10100, after reusable instructions) orients the model to the GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

Source and Web sections follow first-party reusable instructions. Different checkout paths or local ports leave that preceding prefix unchanged when tools and configuration match; provider cache reuse is not guaranteed.


## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The frontend distribution remains a shared dependency; this package does not compile a frontend per product.
- A different frontend needs its own tested provider.
- Browser handoff reports that the launch was requested, not that a browser window opened.

### Dev Note

None.
