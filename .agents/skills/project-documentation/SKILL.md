---
name: project-documentation
description: Use when creating, updating, or reviewing README, docs, AGENTS.md, CLI docs, config docs, architecture docs, troubleshooting docs, or behavior-linked documentation in this repository.
---

# Project Documentation

Use this skill for documentation work in this repository.

## Workflow

1. Run `python3 scripts/docs-list.py` when available.
2. Read the docs whose `read_when` hints match the task.
3. Inspect source, tests, package scripts, CLI help, config schemas, and current
   docs before making behavior-sensitive claims.
4. Update docs when architecture, APIs, CLI commands, config, setup, or user
   workflows change.
5. Use `python3 scripts/docs-new.py <slug> --title "..." --summary "..."`
   for new pages.
6. Update `docs/docs.json` when a page should be discoverable in navigation.
7. Run `python3 scripts/docs-check.py` before handoff.

## Page Rules

Every page under `docs/` needs frontmatter:

```yaml
---
doc-schema-version: 1
title: "Page Title"
summary: "One sentence describing this page."
read_when:
  - When an agent should read this page
doc_type: "guide"
---
```

Allowed `doc_type` values: `overview`, `architecture`, `guide`, `reference`,
`troubleshooting`, `decision`, `runbook`.

## Source-Backed Claims

- CLI docs come from implementation, help output, package scripts, and tests.
- Config docs come from schemas, defaults, parser code, and generated metadata.
- API docs come from exported types, handlers, and tests.
- Architecture docs come from current module boundaries.
- Dependency behavior comes from upstream docs/source/types.

Separate current behavior, planned behavior, and TODOs. Do not invent behavior
to make a page feel complete.
