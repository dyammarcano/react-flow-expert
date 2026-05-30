# react-flow-expert — Design Spec

**Date:** 2026-05-30
**Goal:** A global Claude skill that makes any future session a deep React Flow expert, mined from real source in four local repos.

## Deliverable

A self-contained global skill at `~/.claude/skills/react-flow-expert/`:

```
react-flow-expert/
  SKILL.md                  trigger + core mental model + routing table
  reference/
    01-architecture.md      3-package model, data flow, coordinate systems, store
    02-system-internals.md  @xyflow/system: XYDrag/XYPanZoom/XYHandle/XYResizer/XYMinimap, transforms, measurement
    03-edge-paths.md        bezier/smoothstep/step/straight path math, markers
    04-react-components.md   <ReactFlow> props + Background/Controls/MiniMap/Panel/Handle/NodeResizer/NodeToolbar/...
    05-react-hooks.md        every hook: signature, returns, internals, when-to-use
    06-svelte.md             <SvelteFlow>, Svelte 5 runes, stores, equivalents
    07-state-management.md   controlled vs uncontrolled, applyChanges, Zustand store, perf
    08-custom-nodes-edges.md NodeProps/EdgeProps, handle + connection system, dynamic handles
    09-patterns-recipes.md   layouting (dagre/elk), DnD, sub-flows, computing flows, strudel-flow patterns
    10-gotchas-errors.md     error codes, nodeTypes recreation, updateNodeInternals, pitfalls, perf
    11-migration.md          v11 reactflow -> v12 @xyflow/react
    12-ecosystem.md          when React Flow vs alternatives (awesome list)
    13-types.md              key TS types reference
  agents/
    react-flow-expert.md     subagent: deep Q&A + builds React Flow features
```

## Source repos (ground truth)

- `xyflow/` — core monorepo: `@xyflow/react` 12.10.2, `@xyflow/svelte` 1.5.2, `@xyflow/system` 0.0.76
- `web/` — docs + site monorepo (reactflow.dev, svelteflow.dev, example-apps, ui-components)
- `strudel-flow/` — real production app on `@xyflow/react` v12 (reference patterns)
- `awesome-node-based-uis/` — ecosystem list

## Build engine (Workflow)

- **Phase A — Extract (pipeline, ~13 agents):** one agent per reference doc; reads real source/docs/examples, cites `repo/path:symbol`, writes its own file.
- **Phase B — Verify (adversarial, per-doc):** skeptic checks every API/hook/prop/error against live source; fixes fabrications.
- **Phase C — Synthesize:** writes SKILL.md + subagent def, cross-linked.

## Quality bar

- Source-cited; no invented APIs.
- Pinned to versions in the repos.
- Internals-deep: how it works, not just how to use it.

## Status

Approved 2026-05-30. Build executes as a single multi-phase Workflow in-session.
