---
description: "Progress and human controls for reusable flow executions."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-flow

English | [中文](README.zh.md)

## Summary

Show the latest flow execution in the conversation dock. Status and permitted controls come from committed host reads. Pause, Resume and Cancel carry the displayed execution revision.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Mount the flow runtime controller on the host and this plugin in a web profile. The dock subscribes to cropped execution notifications and refreshes after connection reset. Product-specific approval cards remain in the product plugin.

No invariant companion is published because the dock renders committed remote reads and owns no host execution state.

<a id="dev-note"></a>

## Dev Note

None.

<a id="model-experience"></a>

## Model Experience

Indirectly, through human lifecycle commands that resume bounded native model phases.

#### KV Cache effect

The browser contribution adds no model request content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The dock shows the latest execution. A complete trace inspector and product-specific approval forms are separate consumers.
