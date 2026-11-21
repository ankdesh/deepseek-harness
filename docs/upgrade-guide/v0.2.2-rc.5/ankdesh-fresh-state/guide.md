---
kind: upgrade-guide
description: "The ankdesh-dsh upgrade uses a new state directory for Session format V4."
---

# Use a new state directory for ankdesh-dsh

English | [中文](guide.zh.md)

## Change

This ankdesh-dsh release writes Session format V4. The old fork wrote V3 and included required workflow events that the upstream converter cannot read. The old state directory can also contain Flow executions, event agents, and pending HTTP waits.

## Migration

1. Keep the old data directory and its application lockfile. Use the old version to view existing sessions or finish old runs.
2. Install one exact set of ankdesh-dsh package versions. Use a new, empty DSH_HOME for the upgraded web or headless profile.
3. Start the profile, create a Session, then reopen it with the upgraded runtime. Check that the application uses the new directory.
4. To roll back, restore the old lockfile and launch the old runtime with its original DSH_HOME.
