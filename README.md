# react-flow-expert

A **global Claude Code skill** that turns any session into a deep [React Flow](https://reactflow.dev) / [Svelte Flow](https://svelteflow.dev) / `@xyflow` expert — not just the public API, but the internals.

The knowledge base was **mined from real source** across four upstream repos and **adversarially fact-checked against the live code** (every API, hook, prop, type, and error code verified or corrected). Pinned to:

- `@xyflow/react` **12.10.2**
- `@xyflow/svelte` **1.5.2**
- `@xyflow/system` **0.0.76**

## What's inside

| Path | What |
|------|------|
| `SKILL.md` | Always-loaded entry: core mental model + routing table + top gotchas |
| `agents/react-flow-expert.md` | Dispatchable subagent for deep Q&A / building features |
| `reference/01..13-*.md` | ~48k words of source-verified depth |
| `DESIGN.md` | The design spec (how/why it was built) |
| `build/` | The Claude Code Workflow that generated the KB — re-runnable |

### Reference docs

1. Architecture & mental model — the 3-package engine, data flow, coordinate systems
2. `@xyflow/system` internals — XYPanZoom / XYDrag / XYHandle / XYResizer / XYMinimap
3. Edge-path algorithms & markers — bezier / smoothstep / step / straight math
4. React components & every `<ReactFlow>` prop
5. Every React hook — signatures, returns, internals, when-to-use
6. Svelte Flow — Svelte 5 runes, stores, component/hook equivalents
7. State management & the store — controlled vs uncontrolled, change system, perf
8. Custom nodes, edges & the handle/connection system
9. Patterns & recipes — layouting, drag-and-drop, sub-flows, computing flows
10. Gotchas, error codes & performance
11. Migration `reactflow` v11 → `@xyflow/react` v12
12. Node-UI ecosystem & when to choose what
13. TypeScript types reference

## Install

Clone into your Claude Code skills directory:

```bash
git clone https://github.com/dyammarcano/react-flow-expert.git \
  ~/.claude/skills/react-flow-expert
```

## Use

In any Claude Code session:

- Invoke the **`react-flow-expert`** skill for instant orientation + routing to the right reference doc.
- Or dispatch the **`react-flow-expert`** subagent for a source-citing deep answer or to build a React Flow / Svelte Flow feature.

## Regenerate / extend

The `build/` Workflow re-mines the KB from local clones of the upstream repos (see `DESIGN.md` for the repo layout and the 4-phase extract → verify → synthesize → polish pipeline).

## License & attribution

Original prose and tooling: **BSD 3-Clause** (see `LICENSE`).
The reference docs quote and cite **MIT-licensed** source from the xyflow project — see `NOTICE` for attribution.
