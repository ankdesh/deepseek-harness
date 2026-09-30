---
description: "Strict trusted YAML event definitions with contained Markdown prompts."
kind: "package-reference"
---

# @deepseek-ai/dsh-event-system-yaml

English | [中文](README.zh.md)

## Summary

Load startup-owned event-agent templates into `ctx.eventSystems`. YAML specifies the roster, exact event payload schemas, and fixed subscriptions; each agent's `prompt` names a contained Markdown file. This provider does not evaluate code or start agents.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the [event service](../event-system/README.md) first. Configure explicit `roots`, `maxFileBytes`, and `maxPromptBytes`. A root is a file or directory; directories load sorted immediate `.yaml`/`.yml` children. `id` and `version` identify a template. The host seals registrations after startup and pins resolved prompt text when attaching a conversation. Use the [generic example](../event-system/examples/analysis-review/system.yml) as a starting point.

## Understand the implementation

The parser accepts the native supported JSON Schema subset and rejects unknown fields, missing roster/event references, duplicate keys, directives, tags, anchors, aliases, merge keys, and non-string mapping keys. Prompt realpaths must remain inside the definition directory and end in `.md`; empty, missing, escaping, or oversized prompts fail startup. Configured byte limits bound YAML and prompt text. Registrations are disposal-owned, including rollback after a later file fails.

No runtime invariant companion is published because this provider contributes immutable startup definitions through disposal-owned catalog registrations and maintains no independently mutable runtime projection.

## Further Exploration

- [Event service](../event-system/README.md) — execution, spending, and recovery semantics.
- [Workflow subsystem](../../../docs/subsystems/workflow.md) — group responsibilities.

## Model Experience

### Resolved template data

#### What the model sees

The provider itself adds no model messages or tools. The event service consumes resolved `prompt` text and adds that member's stable instruction; YAML remains trusted deployment input.

#### Token effect

Parsing and registration use no model requests. The consuming service accounts for instruction and event input when executing members.

#### KV Cache effect

The provider loads text once and does not alter the request/cache protocol. Existing conversations retain pinned instructions when a template file changes.

## Known Limitations and Deferred Work

- Loading is startup-only, nonrecursive, and contains no expressions, imports, automatic hot reload, editor, or workflow authoring. Edits apply to new conversations; existing conversations keep their pinned resolved definitions.

### Dev Note

Parser regressions exercise strict YAML and real filesystem containment. The service's Loader tests own native execution behavior.
