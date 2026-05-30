## What this covers

The three-package xyflow architecture (`@xyflow/system` → `@xyflow/react` / `@xyflow/svelte`) and the end-to-end data flow from your `nodes`/`edges` state, through a single framework-specific store, down a fixed render tree (`GraphView → FlowRenderer → ZoomPane → Pane → Viewport → Node/EdgeRenderer → DOM`), with a CSS `transform` viewport `[x, y, zoom]` that is the **only** thing standing between flow coordinates and screen coordinates — and the pure helper functions that convert between them.

Pinned versions: `@xyflow/react` **12.10.2**, `@xyflow/svelte` **1.5.2**, `@xyflow/system` **0.0.76** (confirmed: `packages/react/package.json:version`, `packages/svelte/package.json:version`, `packages/system/package.json:version`). Both wrappers depend on `@xyflow/system` via `workspace:*`.

---

## 1. The three-package architecture

The xyflow monorepo ships four published things, but architecturally there are three layers (`README.md:"The xyflow mono repo"`):

| Package | Role | Depends on |
|---------|------|-----------|
| `@xyflow/system` | Framework-agnostic core: pure functions, D3-based pan/zoom, drag, handle, resizer, minimap logic, and all shared TypeScript types. No React, no Svelte. | (d3-zoom, d3-drag, d3-selection only) |
| `@xyflow/react` | React 12 binding: Zustand store + React components that render the DOM and call into system. | `@xyflow/system` |
| `@xyflow/svelte` | Svelte 5 binding: runes (`$state`/`$derived`) store + Svelte components. | `@xyflow/system` |
| `reactflow` (v11) | Legacy React 11 package on the `v11` branch. Out of scope here. | — |

**Mental model:** `@xyflow/system` is a headless engine. It knows *how* to pan, zoom, drag, measure, and convert coordinates, but it never owns React/Svelte state and never renders. The framework packages are thin: they hold reactive state, render a DOM tree, attach the system's imperative controllers to DOM nodes, and feed state changes back into the store. The same `XYPanZoom`, `XYDrag`, `XYHandle`, `pointToRendererPoint`, `getViewportForBounds`, etc. are used **identically** by both React and Svelte — this is why behavior is consistent across frameworks.

### 1.1 What `@xyflow/system` exports

`packages/system/src/index.ts` re-exports eight barrels:

```ts
export * from './constants';   // errorMessages, infiniteExtent, defaultAriaLabelConfig, elementSelectionKeys
export * from './types';       // Transform, Viewport, XYPosition, CoordinateExtent, NodeBase, InternalNodeBase, ...
export * from './utils';       // pointToRendererPoint, getViewportForBounds, adoptUserNodes, ... (see below)
export * from './xydrag';      // XYDrag controller (node/selection dragging)
export * from './xyhandle';    // XYHandle controller (connection drag from handles)
export * from './xyminimap';   // XYMinimap controller
export * from './xypanzoom';   // XYPanZoom controller (D3 pan/zoom wrapper)
export * from './xyresizer';   // XYResizer controller (NodeResizer logic)
```

`./utils` (`packages/system/src/utils/index.ts`) itself fans out into:

```ts
export * from './connections';        // connection lookup, isConnectable, etc.
export * from './dom';                // getEventPosition, getDimensions, getHostForElement, ...
export * from './edges';              // getBezierPath, getSmoothStepPath, getEdgePosition, ...
export * from './graph';              // getNodesBounds, getNodePositionWithOrigin, isInternalNodeBase, ...
export * from './general';            // clamp, pointToRendererPoint, rendererPointToPoint, getViewportForBounds, ...
export * from './marker';
export * from './node-toolbar';
export * from './edge-toolbar';
export * from './store';              // adoptUserNodes, updateAbsolutePositions, updateNodeInternals, panBy, fitViewport, ...
export * from './types';
export * from './shallow-node-data';
```

The naming convention is consistent: the imperative, stateful controllers are PascalCase factory functions prefixed `XY` (`XYPanZoom`, `XYDrag`, `XYHandle`, `XYResizer`, `XYMinimap`); everything else is a pure function or a type.

> **Constants worth knowing** (`packages/system/src/constants.ts`):
> `infiniteExtent = [[-∞, -∞], [+∞, +∞]]` — the default unbounded `CoordinateExtent`. `errorMessages` — every `[React Flow]: error00X` string, e.g. `error001` is the "no zustand provider as an ancestor" error thrown by `useStore`.

---

## 2. End-to-end data flow

### 2.1 The render tree

In React, `<ReactFlow>` renders a fixed nesting of container components. The chain is (verified in `packages/react/src/container/*`):

```
<ReactFlow>                              container/ReactFlow/index.tsx
  └─ <Wrapper>                           container/ReactFlow/Wrapper.tsx  → mounts <ReactFlowProvider> if not already wrapped
       └─ <StoreUpdater/>                pushes props into the Zustand store every render
       └─ <GraphView>                    container/GraphView/index.tsx
            └─ <FlowRenderer>            container/FlowRenderer/index.tsx
                 └─ <ZoomPane>           container/ZoomPane/index.tsx     → owns the XYPanZoom instance
                      └─ <Pane>          container/Pane/index.tsx         → pointer events, box selection
                           └─ <Viewport> container/Viewport/index.tsx     → the CSS transform div
                                ├─ <EdgeRenderer/>   container/EdgeRenderer/index.tsx
                                ├─ <ConnectionLineWrapper/>
                                ├─ div.react-flow__edgelabel-renderer
                                ├─ <NodeRenderer/>   container/NodeRenderer/index.tsx
                                └─ div.react-flow__viewport-portal
```

This is exactly the JSX emitted by `GraphView` (`container/GraphView/index.tsx:GraphViewComponent`): `FlowRenderer` wraps `ZoomPane` + `Pane`, and inside `Pane` it renders `<Viewport>` containing `EdgeRenderer`, the connection line, the edge-label portal target, `NodeRenderer`, and the viewport portal target.

The Svelte tree mirrors this (`packages/svelte/src/lib/container/`): `SvelteFlow → Zoom (ZoomPane) → Pane → Viewport → {EdgeRenderer, NodeRenderer}`.

### 2.2 Step-by-step: from `nodes` prop to pixels

1. **You provide state.** Either controlled (`nodes`/`edges` props + `onNodesChange`/`onEdgesChange`) or uncontrolled (`defaultNodes`/`defaultEdges`). `useNodesState`/`useEdgesState` are convenience hooks for the controlled case (`README.md` basic usage).

2. **Props enter the store.** `<StoreUpdater>` (rendered by `ReactFlow/index.tsx`) writes every relevant prop into the Zustand store on each render. When `nodes` changes, `store.setNodes(nodes)` runs (`store/index.ts:setNodes`).

3. **`adoptUserNodes` enriches nodes.** `setNodes` calls `adoptUserNodes(nodes, nodeLookup, parentLookup, {...})` (from system). This is the heart of the data flow: it takes your *plain* user node objects and builds the internal `nodeLookup` Map of `InternalNode`s, computing `internals.positionAbsolute`, `internals.z` (z-index), `handleBounds`, `userNode` back-reference, etc. (`store/index.ts:setNodes`; `system .../utils/store`). It returns `{ nodesInitialized, hasSelectedNodes }`.

   ```ts
   // store/index.ts:setNodes (abridged)
   const { nodesInitialized, hasSelectedNodes } = adoptUserNodes(nodes, nodeLookup, parentLookup, {
     nodeOrigin, nodeExtent, elevateNodesOnSelect, checkEquality: true, zIndexMode,
   });
   set({ nodes, nodesInitialized, ... });
   ```

4. **Edges build a connection lookup.** `setEdges` calls `updateConnectionLookup(connectionLookup, edgeLookup, edges)` (`store/index.ts:setEdges`) so handle-by-handle connectivity is O(1).

5. **Renderers subscribe to *IDs only*.** `NodeRenderer` does **not** subscribe to the node array; it subscribes to `useVisibleNodeIds(onlyRenderVisibleElements)` — a list of IDs (`NodeRenderer/index.tsx:NodeRendererComponent`). `EdgeRenderer` uses `useVisibleEdgeIds` the same way (`EdgeRenderer/index.tsx`). Each ID maps to a memoized `NodeWrapper`/`EdgeWrapper` that subscribes to *its own* node/edge slice. The in-source comment explains the rationale (`NodeRenderer/index.tsx:47-71`): when you drag one node it updates many times per second; if `NodeRenderer` re-ran `nodes.map()` each time it would be expensive with hundreds of nodes, so the map loop only re-runs when the *set of visible IDs* changes (add/remove), while per-node updates stay isolated in the wrapper.

6. **Measurement loop.** `NodeRenderer` creates one shared `ResizeObserver` (`useResizeObserver`) and passes it to every `NodeWrapper`. When a node's DOM box changes, `store.updateNodeInternals(updates)` runs, which calls `updateNodeInternals` (system) to remeasure, then `updateAbsolutePositions(...)` to recompute `positionAbsolute` for children/parents, then `set({})` to force subscribers to re-read (`store/index.ts:updateNodeInternals`). Comment: *"Every node gets registered at a ResizeObserver."*

7. **The viewport transform renders.** `Viewport` subscribes to `s.transform` and emits a single CSS transform on one div (`Viewport/index.tsx`):

   ```ts
   const selector = (s: ReactFlowState) =>
     `translate(${s.transform[0]}px,${s.transform[1]}px) scale(${s.transform[2]})`;
   // <div className="react-flow__viewport ..." style={{ transform }}>{children}</div>
   ```

   Every node and edge lives inside this one transformed div. **Panning and zooming are a single CSS transform on a single element** — nodes are positioned with their flow coordinates and the whole layer is translated/scaled. This is the central performance trick.

### 2.3 The reverse flow (user input → state)

Interaction controllers live in system and write back through store actions:

- **Pan/zoom:** `ZoomPane` instantiates `XYPanZoom({ domNode, minZoom, maxZoom, translateExtent, viewport, onDraggingChange, onPanZoomStart, onPanZoom, onPanZoomEnd, ... })` in a `useEffect` (`ZoomPane/index.tsx`). D3-zoom emits transform events; `onTransformChange(transform)` fires `onViewportChange?.(...)` and, when uncontrolled, `store.setState({ transform })`. After creating the instance it seeds the store: `store.setState({ panZoom, transform: [x, y, zoom], domNode: ...closest('.react-flow') })`. So `store.panZoom` is the live D3 controller and `store.domNode` is the outer container element.
- **Box selection / pane pointer events:** `Pane` handles `pointerdown/move/up`, builds a `userSelectionRect`, converts the start point with `pointToRendererPoint` and reads back with `rendererPointToPoint`, computes hit nodes via `getNodesInside`, and triggers `triggerNodeChanges`/`triggerEdgeChanges` (`Pane/index.tsx:onPointerDownCapture`, `commitUserSelectionRect`).
- **Node drag:** `XYDrag` (system) drives `store.updateNodePositions(...)` which emits `type: 'position'` `NodeChange`s through `triggerNodeChanges` (`store/index.ts:updateNodePositions`).

In all cases the store action either calls your `onNodesChange`/`onEdgesChange` (controlled) or, for `defaultNodes`/`defaultEdges`, applies the change internally via `applyNodeChanges`/`applyEdgeChanges` then re-sets state (`store/index.ts:triggerNodeChanges` checks `hasDefaultNodes`).

---

## 3. The store concept

### 3.1 React: a Zustand store behind context

The store is a Zustand store created per `<ReactFlowProvider>` (or per `<ReactFlow>` when not externally wrapped). It is built with `createWithEqualityFn` from `zustand/traditional` (`store/index.ts:createStore`) and provided through React context.

- **Provider mounting:** `Wrapper` reads `StoreContext`; if a parent already mounted a provider (`isWrapped`) it just renders children, otherwise it mounts `<ReactFlowProvider>` (`ReactFlow/Wrapper.tsx`). This is why `useReactFlow()` works in sibling components only when they share a `ReactFlowProvider`.
- **Reading state:** `useStore(selector, equalityFn?)` is `useStoreWithEqualityFn(store, selector, equalityFn)` (`hooks/useStore.ts:useStore`). The convention everywhere in the codebase is a narrow `selector` plus `shallow` from `zustand/shallow` to avoid re-renders (e.g. `FlowRenderer/index.tsx` selects `{ nodesSelectionActive, userSelectionActive }`). If no provider exists, `useStore` throws `errorMessages.error001` (the "zustand provider as an ancestor" message).
- **Imperative access:** `useStoreApi()` returns `{ getState, setState, subscribe }` (`hooks/useStore.ts:useStoreApi`) — used inside event handlers (e.g. `Pane`) to read/write without subscribing.

**Initial state and defaults** come from `store/initialState.ts:getInitialState`. Notable defaults verified there:

| Field | Default | Notes |
|-------|---------|-------|
| `transform` | `[0, 0, 1]` | unless `fitView` + width/height → computed via `getViewportForBounds` |
| `minZoom` / `maxZoom` | `0.5` / `2` | |
| `nodeExtent` / `translateExtent` | `infiniteExtent` | |
| `nodeOrigin` | `[0, 0]` | top-left origin |
| `connectionMode` | `ConnectionMode.Strict` | |
| `snapGrid` / `snapToGrid` | `[15, 15]` / `false` | |
| `nodesDraggable/Connectable/Focusable`, `elementsSelectable` | `true` | |
| `elevateNodesOnSelect` / `elevateEdgesOnSelect` | `true` | raise z-index on selection |
| `nodeDragThreshold` / `connectionDragThreshold` | `1` / `1` | px before drag begins |
| `connectionRadius` | `20` | snap radius for handles |
| `autoPanSpeed` | `15` | |
| `lib` | `'react'` | used in error/CSS messages |

The store also holds the four lookup Maps — `nodeLookup`, `parentLookup`, `edgeLookup`, `connectionLookup` — plus `panZoom` (the live `XYPanZoom`), `domNode`, and the change-triggering actions.

> **Why `lib` matters:** the same conceptual store exists in both frameworks; `lib: 'react' | 'svelte'` lets shared system/error code phrase messages correctly (e.g. `error013` tells you to import `@xyflow/${lib}/dist/style.css`).

### 3.2 Svelte: the same store as runes

The Svelte store (`packages/svelte/src/lib/store/index.ts:createStore`, `initial-store.svelte.ts:getInitialStore`) is **not** Zustand — it is a class whose fields are Svelte 5 runes:

```ts
// initial-store.svelte.ts (abridged, real)
domNode  = $state.raw<HTMLDivElement | null>(null);
panZoom: PanZoomInstance | null = $state.raw(null);
width    = $state.raw<number>(signals.width ?? 0);
height   = $state.raw<number>(signals.height ?? 0);
nodesInitialized: boolean = $derived.by(() => { ... });
viewportInitialized: boolean = $derived(this.panZoom !== null);
selectedNodes = $derived.by(() => { ... });
nodesDraggable: boolean = $derived(signals.props.nodesDraggable ?? true);
```

So reactivity is provided by `$state`/`$derived` instead of Zustand selectors, but the store calls the **identical** system functions: `adoptUserNodes`, `updateNodeInternals`, `updateAbsolutePositions`, `panBy`, `addEdge`, `getHandlePosition`, `fitViewport`, etc. (`svelte .../store/index.ts` imports). The Svelte `Viewport.svelte` applies the same transform:

```svelte
<div class="svelte-flow__viewport ..."
     style:transform="translate({store.viewport.x}px, {store.viewport.y}px) scale({store.viewport.zoom})">
```

The store is shared through Svelte context under a `Symbol()` key (`store/index.ts:export const key = Symbol()`); `useStore` retrieves it. The takeaway: **only the reactivity mechanism differs** (Zustand vs runes); the algorithms, types, and coordinate math are one shared implementation in `@xyflow/system`.

---

## 4. Coordinate systems

There are exactly two coordinate spaces, and one transform between them.

### 4.1 The two spaces

- **Flow / position coordinates** — what you write in `node.position = { x, y }`. Independent of pan and zoom. A node at `{ x: 0, y: 0 }` is at flow-origin no matter how the user has scrolled or zoomed. Internally, the resolved absolute position (accounting for parent nodes / `nodeOrigin`) is stored as `internalNode.internals.positionAbsolute` (`system .../types/nodes.ts:internals.positionAbsolute`).
- **Rendered / screen coordinates** — pixels relative to the flow container's top-left (and, for *client* coordinates, the browser viewport). This is where the pointer is.

The docs put it plainly (`learn/concepts/terms-and-definitions.mdx:Viewport`): *"All of React Flow is contained within the viewport. Each node has an x- and y-coordinate… The viewport has x, y, and zoom values."*

### 4.2 The transform `[x, y, zoom]`

The bridge is a single `Transform` tuple (`system .../types/utils.ts:Transform`):

```ts
export type Transform = [number, number, number];   // [translateX, translateY, zoom]
export type Viewport = { x: number; y: number; zoom: number };   // .../types/general.ts:Viewport
export type XYPosition = { x: number; y: number };               // .../types/utils.ts:XYPosition
export type CoordinateExtent = [[number, number], [number, number]]; // top-left, bottom-right
```

`Transform` (array `[x, y, zoom]`) and `Viewport` (object `{ x, y, zoom }`) are the **same three numbers** in two shapes — `transform` is the store/internal form, `Viewport` is the public API form. The CSS that realizes it is literally `translate(${x}px, ${y}px) scale(${zoom})` (`Viewport/index.tsx`).

### 4.3 The conversion helpers (pure, in system)

`packages/system/src/utils/general.ts`:

```ts
// flow/renderer point  →  screen/rendered point
export const rendererPointToPoint = ({ x, y }: XYPosition, [tx, ty, tScale]: Transform): XYPosition => ({
  x: x * tScale + tx,
  y: y * tScale + ty,
});

// screen/rendered point  →  flow point  (inverse of the above; optional snap-to-grid)
export const pointToRendererPoint = (
  { x, y }: XYPosition,
  [tx, ty, tScale]: Transform,
  snapToGrid = false,
  snapGrid: SnapGrid = [1, 1]
): XYPosition => {
  const position = { x: (x - tx) / tScale, y: (y - ty) / tScale };
  return snapToGrid ? snapPosition(position, snapGrid) : position;
};
```

The names are slightly counter-intuitive, so commit them to memory:

| Helper | Input | Output | Math |
|--------|-------|--------|------|
| `pointToRendererPoint(p, t)` | a *container-relative screen* point | a **flow** point | `(p - translate) / zoom` |
| `rendererPointToPoint(p, t)` | a **flow** point | a *container-relative screen* point | `p * zoom + translate` |

> Note the apparent inversion: `pointToRendererPoint` actually maps **screen → flow** (it divides out the transform), and `rendererPointToPoint` maps **flow → screen**. The "renderer point" in these names means the flow-space point the renderer positions nodes with. They are used together throughout `Pane` (box selection start vs. live screen position).

`snapPosition(position, snapGrid)` rounds to the nearest grid multiple (`general.ts:snapPosition`).

### 4.4 The instance methods you actually call

These two pure helpers don't account for the container's offset in the page (client coordinates from `event.clientX/Y`). The store-bound instance methods do. They live in `useViewportHelper` (React) and `useSvelteFlow` (Svelte), and are exposed on the object returned by `useReactFlow()` / `useSvelteFlow()`.

**`screenToFlowPosition(clientPosition, options?)`** — turn a browser-client pixel (e.g. a mouse event) into a flow coordinate. Use it whenever you drop/create a node at the pointer (`hooks/useViewportHelper.ts:screenToFlowPosition`):

```ts
screenToFlowPosition: (clientPosition, options = {}) => {
  const { transform, snapGrid, snapToGrid, domNode } = store.getState();
  if (!domNode) return clientPosition;
  const { x: domX, y: domY } = domNode.getBoundingClientRect();          // subtract container offset
  const correctedPosition = { x: clientPosition.x - domX, y: clientPosition.y - domY };
  const _snapGrid = options.snapGrid ?? snapGrid;
  const _snapToGrid = options.snapToGrid ?? snapToGrid;
  return pointToRendererPoint(correctedPosition, transform, _snapToGrid, _snapGrid);
}
```

**`flowToScreenPosition(flowPosition)`** — the inverse: place an HTML overlay/tooltip at a node's flow position (`useViewportHelper.ts:flowToScreenPosition`):

```ts
flowToScreenPosition: (flowPosition) => {
  const { transform, domNode } = store.getState();
  if (!domNode) return flowPosition;
  const { x: domX, y: domY } = domNode.getBoundingClientRect();
  const rendererPosition = rendererPointToPoint(flowPosition, transform);  // flow → container-relative
  return { x: rendererPosition.x + domX, y: rendererPosition.y + domY };     // + container offset → client
}
```

So the full pipeline is: **client px → (− container offset) → container-relative px → (÷ transform) → flow coords**, and reverse. The Svelte implementations are byte-for-byte equivalent (`svelte .../hooks/useSvelteFlow.svelte.ts:screenToFlowPosition` / `flowToScreenPosition`, both using `store.domNode.getBoundingClientRect()`).

### 4.5 Related viewport helpers (same module)

`useViewportHelper` also returns: `zoomIn/zoomOut` (`panZoom.scaleBy(1.2)` / `1/1.2`), `zoomTo`, `getZoom` (`transform[2]`), `setViewport`/`getViewport`, `setCenter`, and `fitBounds` (`getViewportForBounds(bounds, width, height, minZoom, maxZoom, padding ?? 0.1)`). All of these mutate the viewport through `store.panZoom` — i.e. they drive the D3 controller, which emits a transform event, which flows back through `onTransformChange` into the store and finally into the `Viewport` CSS. `getViewportForBounds` (`general.ts:getViewportForBounds`) is the pure function that computes the `[x, y, zoom]` needed to enclose a `Rect` with padding — it is what `fitView` uses.

---

## 5. Why it's built this way (design rationale, from source)

1. **One transform, not N.** Pan/zoom moves a *single* element (`Viewport`), so the browser composites one layer instead of repositioning every node. Nodes carry only their static flow position.
2. **ID-level subscriptions.** `NodeRenderer`/`EdgeRenderer` subscribe to ID lists; per-element wrappers subscribe to their own slice. Dragging one node re-renders one wrapper, not the whole graph (`NodeRenderer/index.tsx` comment block, lines 47-71).
3. **Lookups over arrays.** `nodeLookup`/`edgeLookup`/`connectionLookup`/`parentLookup` give O(1) access for hit-testing, connection validation, and parent/child math, rebuilt by `adoptUserNodes`/`updateConnectionLookup` on every state change.
4. **Headless core.** All geometry, pan/zoom, drag, and coordinate math live in `@xyflow/system` as framework-free functions and `XY*` controllers, so React and Svelte share one battle-tested engine and differ only in their reactivity layer (Zustand selectors vs. Svelte runes).

---

## 6. Quick reference — key symbols and where they live

| Symbol | File (repo-relative) |
|--------|----------------------|
| system barrel | `packages/system/src/index.ts` |
| `pointToRendererPoint`, `rendererPointToPoint`, `snapPosition`, `getViewportForBounds`, `clamp` | `packages/system/src/utils/general.ts` |
| `Transform`, `XYPosition`, `CoordinateExtent`, `Rect`, `Box` | `packages/system/src/types/utils.ts` |
| `Viewport`, `SnapGrid` | `packages/system/src/types/general.ts` |
| `InternalNodeBase.internals.positionAbsolute`, `.userNode` | `packages/system/src/types/nodes.ts` |
| `infiniteExtent`, `errorMessages`, `defaultAriaLabelConfig` | `packages/system/src/constants.ts` |
| React store factory + actions (`setNodes`, `updateNodeInternals`, `panBy`, `setCenter`) | `packages/react/src/store/index.ts` |
| React initial state / defaults | `packages/react/src/store/initialState.ts` |
| `useStore`, `useStoreApi` | `packages/react/src/hooks/useStore.ts` |
| `screenToFlowPosition`, `flowToScreenPosition`, `fitBounds`, `zoomIn/Out` | `packages/react/src/hooks/useViewportHelper.ts` |
| `GraphView`, `FlowRenderer`, `ZoomPane`, `Pane`, `Viewport`, `NodeRenderer`, `EdgeRenderer` | `packages/react/src/container/*/index.tsx` |
| Provider mount logic | `packages/react/src/container/ReactFlow/Wrapper.tsx` |
| `XYPanZoom` binding + `onTransformChange` | `packages/react/src/container/ZoomPane/index.tsx` |
| Svelte runes store | `packages/svelte/src/lib/store/initial-store.svelte.ts`, `.../store/index.ts` |
| Svelte `screenToFlowPosition`/`flowToScreenPosition` | `packages/svelte/src/lib/hooks/useSvelteFlow.svelte.ts` |
| Svelte viewport transform div | `packages/svelte/src/lib/container/Viewport/Viewport.svelte` |
