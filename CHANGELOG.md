# Changelog

All notable changes to **react-flow-expert** are documented here.
Knowledge pinned to `@xyflow/react` 12.10.2, `@xyflow/svelte` 1.5.2, `@xyflow/system` 0.0.76.

## [1.0.0] - 2026-05-31

### Added
- **Knowledge base** — 13 source-verified reference docs (~47k words): architecture, `@xyflow/system` internals (XYPanZoom/XYDrag/XYHandle/XYResizer/XYMinimap), edge-path math, React components & props, all hooks, Svelte Flow, state management, custom nodes/edges & the handle system, patterns & recipes, gotchas & error codes, v11→v12 migration, ecosystem, and TypeScript types.
- `SKILL.md` — core mental model, reference routing table, and top gotchas.
- `agents/react-flow-expert.md` — dispatchable deep Q&A / feature-building subagent.
- `agents/react-flow-doctor.md` — dispatchable **audit / fix / drift-detection** subagent: maps `@xyflow` usage, applies the RFD001–013 rule set, runs a diagnose → plan → apply → verify → report pipeline (reverting any fix that breaks typecheck/tests), and detects version / API / best-practice drift with a re-runnable baseline.
- `DESIGN.md` and `build/` — the design spec and the build Workflow used to regenerate the KB.

### Changed
- Closed the logged extraction gaps in 6 reference docs with source-verified detail — connection-state types, built-in edge-component prop types, store-side prop defaults, `getSmoothStepPath`/`getStraightPath`/`getSimpleBezierPath` signatures, real sub-flow node arrays, and `getNodesBounds` — each adversarially re-verified against the live source.
