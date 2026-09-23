# Agent Note: Separate workflow presets from service adapters

Status: implemented

English | [中文](2026-09-22-configurable-prompt-and-workflow-catalogs.zh.md)

## Problem

Product assistants need two independent kinds of variation. A user chooses how
work should run: a focused exchange, bounded same-session goal work, or bounded
orchestration. The selected product service independently decides what the
assistant knows and may do: prompts, semantic tools, binding rules, and review
contracts. Encoding both choices in one profile duplicates policy for every
service/preset pair and makes adding a service an unsafe composition edit.

Prompt text and tool guidance also need exact, inspectable identity. Runtime
code constants provide no startup validation, content digest, or declarative
path for products. Existing model-authored JavaScript workflows solve a
different problem and grant execution authority that service workflows do not
need.

## Decision

DSH now has a startup-owned prompt catalog and a host-owned service-workflow
domain.

`dsh-prompt-catalog` registers versioned prompt bundles, computes a canonical
SHA-256 identity, binds explicit variables, orders sections deterministically,
and seals after startup. Its YAML provider accepts trusted deployment data only
and rejects directives, custom tags, aliases, anchors, merge keys, non-string
keys, duplicate keys, unknown fields, and oversized files. It does not evaluate
expressions or hot-reload prompt text.

`dsh-s-workflow` maintains separate catalogs for generic workflow definitions
and service adapters. A run snapshots the exact definition and adapter digests,
the user-selected `focused`, `goal`, or `orchestrated` preset, the immutable
service contract, resource budgets and usage, review draft, checkpoint, and any
pending human decision. One nonterminal run may exist in a Session. Every
mutation uses an exact run revision and appends a complete
`s-workflow/change` snapshot.

Lifecycle authority is split deliberately. Deployment or human-owned calls
start, pause, resume, cancel, answer, approve completion, and raise budgets.
The generic model tools can only read state, replace a review draft, checkpoint
progress and usage, request required input, or request completion review. They
cannot apply or send a product artifact. A service adapter remains responsible
for the semantic proposal tools and the explicit review-card mutation boundary.

The YAML workflow vocabulary is declarative and closed: model, review,
delegation, and checkpoint steps with prose descriptions. It contains no code,
expressions, imports, or arbitrary plugin configuration. Existing stock DSH
goals and one-shot subagent providers remain the execution mechanisms selected
by a preset; the catalog records and governs the product workflow rather than
reimplementing those mechanisms.

The required workflow event remains on Session format v3. Adding an ordinary
required event does not change the envelope. Current builds know the event;
older builds reject a log containing it through their build-static known-event
set because the event is not ignorable. They therefore fail closed rather than
silently reconstructing an incomplete workflow.

## Alternatives considered

**Create one preset for every service and execution mode.** Rejected because
the Cartesian product duplicates prompt, tool, and budget policy and makes
service onboarding modify execution policy.

**Use the existing model-authored workflow engine.** Rejected for this use case
because a trusted declarative product workflow needs no JavaScript execution,
and the model must not own lifecycle or mutation authority.

**Let adapters select the execution preset.** Rejected because the user owns
whether a conversation is focused, long-running, or orchestrated. A service
adapter contributes domain capabilities but does not broaden autonomy.

**Persist only transition deltas.** Rejected because full snapshots make replay,
projection caching, review, and compatibility inspection self-contained and
consistent with other DSH state domains.

**Treat the event as ignorable.** Rejected because omitting it changes durable
workflow reconstruction. An unaware reader must refuse the log.

## Consequences

Products can add a service by supplying an exact adapter, prompt bundles, tools,
and review contract while reusing the same three execution presets and generic
workflow definitions. Prompt and workflow startup failures are deterministic,
and persisted runs can name the exact content they used.

The catalogs are process-local and startup-only. A deployment must restore the
referenced versions and digests before resuming a stored run. Scheduling,
same-session goal continuation, child-agent process caps, and service-specific
review rendering remain separately composed responsibilities; the workflow
domain does not pretend to enforce limits owned by those runtimes.
