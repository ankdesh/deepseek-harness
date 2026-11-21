# ankdesh-dsh constitution

## Rules for both agents

- Start Codex and Antigravity at the fork root. Read this file and the applicable nested instructions before editing. Use short sentences and consistent terms. Follow ASD-STE100 where practical.
- Record the owner's decisions here through normal review. Give a fork exception its scope, rationale, and verification. Follow upstream rules in other cases.
- Put new behavior in Cordis plugins, bundles, and named dsh profiles. Record each necessary upstream edit in its own focused commit and link the owning Agent Note. Keep product configuration and deployment in the product repository.

## One checkout

Only one agent edits at a time. Start a task branch from ankdesh-dsh. Before handing over, make a local commit, then record the branch, commit, checks run and their results, open issues, and next action in handoff.local.md beside this file. The incoming agent compares the record with git status and HEAD before editing. Resolve differences with the outgoing agent or the owner. Keep credentials out of the handoff. Record durable decisions here or in the owning Agent Note.

## Upstream updates

Use master as the upstream-only reference. Fetch upstream and select an exact release tag or commit. Start a sync branch from ankdesh-dsh and merge the selected commit. Review the existing fork edits, preserve the root instruction link, update the upstream commit in the framework package recipe, and run private release verification before merging. After acceptance, fast-forward master to the selected upstream commit. Keep task changes in separate pull requests.
