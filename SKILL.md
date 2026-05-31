---
name: react-flow-expert
description: Use when building, extending, or debugging node-based UIs with React Flow / Svelte Flow / @xyflow — custom nodes & edges, handles & connections, layouting, viewport/coordinate math, store & state management, edge paths, or any xyflow internals.
---

# React Flow Expert

Authoritative, source-verified knowledge for `@xyflow/react` **12.10.2**, `@xyflow/svelte` **1.5.2**, and the shared `@xyflow/system` **0.0.76** core. This file is the always-loaded orientation; depth lives in `reference/` — open the specific doc rather than guessing.

## Core mental model

**Three packages, one engine.** `@xyflow/system` is a headless, framework-free core: pure geometry/coordinate functions plus D3-based imperative controllers (`XYPanZoom`, `XYDrag`, `XYHandle`, `XYResizer`, `XYMinimap`) and all shared TypeScript types. `@xyflow/react` (Zustand store) and `@xyflow/svelte` (Svelte 5 runes store) are thin bindings that hold reactive state, render a fixed DOM tree, and attach the system controllers to DOM nodes. Behavior is identical across frameworks because the algorithms live in `system`, not the wrapper. (`reactflow` v11 is the legacy React-11 package, out of scope.)

**The store + two representations.** Each `<ReactFlowProvider>` (auto-mounted by `<ReactFlow>` if absent) owns one store. It holds two parallel views of your graph: your plain **user array** (`{ id, position, data }`) and a normalized **internal lookup** (`nodeLookup`/`edgeLookup`/`parentLookup`/`connectionLookup` — Maps of `InternalNode`s with measured dimensions, `internals.positionAbsolute`, z-index, handle bounds). `adoptUserNodes` rebuilds the lookups from the user array on every `setNodes`; you never write the lookups directly. Components subscribe via narrow `useStore(selector, shallow)` selectors, and renderers subscribe to *visible ID lists* so dragging one node re-renders one wrapper, not the graph.

**Coordinate systems + viewport transform.** There are exactly two spaces — **flow coords** (`node.position`, pan/zoom-independent) and **screen/rendered px** — bridged by one `Transform` tuple `[x, y, zoom]` (same three numbers as the public `Viewport {x,y,zoom}`). Pan/zoom is a *single* CSS `translate(x,y) scale(zoom)` on the `Viewport` div — that's the core performance trick. Pure helpers (mind the naming): `pointToRendererPoint` maps **screen→flow** `(p-translate)/zoom`; `rendererPointToPoint` maps **flow→screen** `p*zoom+translate`. They ignore the container's page offset; the instance methods `screenToFlowPosition` / `flowToScreenPosition` (from `useReactFlow()` / `useSvelteFlow()`) add it via `getBoundingClientRect` — use those for mouse events and overlays.

**Controlled vs uncontrolled.** React Flow never mutates your arrays; it emits declarative `NodeChange`/`EdgeChange` objects. **Controlled** (recommended): pass `nodes`+`onNodesChange` (and edges), fold changes with `applyNodeChanges`/`applyEdgeChanges`, pass the new array back. **Uncontrolled**: pass `defaultNodes`/`defaultEdges` and the store applies changes internally; mutate via `useReactFlow()`. Forgetting to wire `onNodesChange` in controlled mode makes nodes appear frozen (no drag/select).

## Reference map

Open the one doc that matches the question; cite it in answers.

| Doc | Open it when… |
|-----|---------------|
| `reference/01-architecture.md` | You need the big picture: package layering, render tree (`GraphView→…→Viewport`), data flow, coordinate/viewport math, store concept. |
| `reference/02-system-internals.md` | Working in/with `@xyflow/system` controllers — `XYDrag`, `XYPanZoom`, `XYHandle`, `XYResizer`, `XYMinimap`, pan/zoom & drag wiring, hit-testing, bounds helpers. |
| `reference/03-edge-paths.md` | Computing or customizing edge paths/markers — `getBezierPath`/`getSmoothStepPath`/`getStraightPath`/`getSimpleBezierPath`, `BaseEdge`, marker defs, `ConnectionLineType`. |
| `reference/04-react-components.md` | `<ReactFlow>` props/defaults and built-in components — `Background`, `Controls`, `MiniMap`, `Panel`, `Handle`, `NodeResizer`, `NodeToolbar`, `EdgeLabelRenderer`, callbacks. |
| `reference/05-react-hooks.md` | Choosing/using a React hook — `useReactFlow`, `useStore`/`useStoreApi`, `useNodesState`, `useNodesData`, `useNodeConnections`, `useConnection`, `useUpdateNodeInternals`, `useKeyPress`, etc. |
| `reference/06-svelte.md` | Anything Svelte Flow — `SvelteFlow`, runes store, Svelte hooks/components, `$state.raw`/`$derived`/`$bindable`, Svelte-specific events and gotchas. |
| `reference/07-state-management.md` | Controlled/uncontrolled, the change system, `applyNodeChanges`/`applyEdgeChanges`, store shape & actions, batching, why `nodeTypes`/`edgeTypes` must be stable. |
| `reference/08-custom-nodes-edges.md` | Building custom nodes/edges and the handle/connection system — `NodeProps`/`EdgeProps`, `Handle`, `XYHandle`, connection validation, `ConnectionMode`, wrappers. |
| `reference/09-patterns-recipes.md` | Recipes: dagre/elkjs auto-layout, drag-and-drop, sub-flows/parent nodes (`parentId`/`extent`/`expandParent`), external zustand store, node data updates. |
| `reference/10-gotchas-errors.md` | A warning/error code (`error001`–`error015`), `OnError`, perf tuning (`onlyRenderVisibleElements`), or a "why isn't this working" symptom. |
| `reference/11-migration.md` | Migrating v11 → v12 — package rename, `measured` dimensions, reconnect API, `parentId`, `screenToFlowPosition`, change-type updates. |
| `reference/12-ecosystem.md` | Choosing a library or layout/graph util — React/Svelte/Vue Flow vs rete/litegraph/GoJS/jointjs, and dagre/elkjs/d3 layouting options. |
| `reference/13-types.md` | Exact TypeScript type definitions — `Node`/`Edge`/`InternalNode`, `NodeProps`/`EdgeProps`, `Connection`/`ConnectionState`, change unions, generics. |

## Top gotchas

- **Stable `nodeTypes` / `edgeTypes`.** Define them *outside* the component (or `useMemo`). A new object identity each render forces full remounts and fires a console warning (see `reference/07` / `reference/10`).
- **`updateNodeInternals` after handles change.** If you add/move/remove handles or change a node's dimensions imperatively, call `useUpdateNodeInternals()` for that node id — otherwise handle bounds and edges go stale.
- **Provider scope.** `useReactFlow`/`useStore` throw `error001` ("no zustand provider as an ancestor") unless rendered under the same `<ReactFlowProvider>`. Wrap a shared provider when you need hooks in siblings of `<ReactFlow>` or in toolbar/panel components.
- **Measured dimensions are async.** In v12 sizes live in `node.measured.{width,height}` and are filled by a `ResizeObserver` after first paint — they're `undefined` on the first render. Gate layout/fitView on `useNodesInitialized()`; don't read width/height synchronously on mount.
- **Apply your changes.** Controlled mode requires wiring `onNodesChange`/`onEdgesChange` to `applyNodeChanges`/`applyEdgeChanges`; without it the graph looks frozen.
- **Prefer source over memory.** When a detail matters, open the matching `reference/NN-*.md` (verified against the pinned versions) rather than recalling API shapes.

## Agents (dispatchable)

| Subagent | Use it to… |
|----------|-----------|
| `agents/react-flow-expert.md` | Answer deep React Flow / Svelte Flow questions and **build** features (custom nodes/edges, handles, layout, viewport math) — source-cited. |
| `agents/react-flow-doctor.md` | **Audit, fix, and drift-check** an existing `@xyflow` project: maps usage, flags the gotchas above (RFD001–013), applies fixes with a reviewable plan, runs the project's typecheck/tests to verify, and writes `REACT-FLOW-AUDIT.md`. Report-only mode for read-only review; drift mode for version/API/best-practice regressions over time. |
