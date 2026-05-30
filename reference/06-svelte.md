## What this covers

Svelte Flow (`@xyflow/svelte` **1.5.2**, built on Svelte 5 + `@xyflow/system` 0.0.76) — the `<SvelteFlow>` component and its full prop surface, how the Svelte‑5‑runes reactive store is constructed and wired to your `$state.raw` node/edge arrays via `bind:nodes`/`bind:edges`, the `useStore`/`useSvelteFlow` access paths, every shipped component and hook, and the concrete behavioural differences from React Flow (and from Svelte Flow v0) that actually trip people up.

> Version pins: `@xyflow/svelte` 1.5.2, `@xyflow/react` 12.10.2, `@xyflow/system` 0.0.76. All file paths below are relative to `packages/svelte/` in the `xyflow` monorepo unless prefixed with `web/`. Docs paths are under `web/sites/svelteflow.dev/`.

---

## 1. The big picture: same `system`, different reactivity layer

Svelte Flow and React Flow are **thin framework adapters over the shared `@xyflow/system` package**. Drag (`XYDrag`), pan/zoom (`XYPanZoom`), handle/connection logic (`XYHandle`), resizing (`XYResizer`), node-internals bookkeeping (`adoptUserNodes`, `updateNodeInternals`, `updateConnectionLookup`), bounds math, and the edge-path helpers (`getBezierPath`, `getSmoothStepPath`, …) are **identical to React Flow**. What differs is the state container and the component shells.

- **React Flow** uses a Zustand store and re-renders components on selector changes.
- **Svelte Flow** uses a hand-rolled **class whose fields are Svelte 5 runes** (`$state`, `$state.raw`, `$derived`, `$derived.by`). Svelte's compiler turns class field accessors into fine-grained signals, so reading `store.nodes` in markup subscribes only that DOM to node changes.

Everything re-exported from `system` is surfaced through `src/lib/index.ts` (`src/lib/index.ts:66-147`): the path helpers, `addEdge`, `getNodesBounds`, `getIncomers`/`getOutgoers`/`getConnectedEdges`, and a large block of shared types (`Position`, `MarkerType`, `ConnectionMode`, `Viewport`, `Connection`, etc.). If you know React Flow, those names mean the same thing here.

---

## 2. `<SvelteFlow>` — the root component

`src/lib/container/SvelteFlow/SvelteFlow.svelte`. It is a generic component (`generics="NodeType extends Node = Node, EdgeType extends Edge = Edge"`) so node/edge typing flows through.

### 2.1 How props are received (the `$bindable` pattern)

`SvelteFlow.svelte:23-77` destructures props with `$props()`. The three model arrays are **bindable with defaults**:

```svelte
let {
  // ... ~50 other props with defaults ...
  nodes = $bindable([]),
  edges = $bindable([]),
  viewport = $bindable(undefined),
  ...props
}: SvelteFlowProps<NodeType, EdgeType> &
  Omit<HTMLAttributes<HTMLDivElement>, 'onselectionchange'> = $props();
```

`$bindable` is what makes `<SvelteFlow bind:nodes bind:edges />` write back to the parent's `$state.raw` array. Everything *not* explicitly destructured is collected into `...props` and forwarded into the store as `signals.props` (see §3). The component also spreads native `HTMLAttributes<HTMLDivElement>` so `class`, `style`, `data-*`, etc. pass through to the container.

### 2.2 How the store is created and shared

`SvelteFlow.svelte:79-116`. The store is created **once** with `createStore(...)`, and `nodes`/`edges`/`viewport` are passed **as getter/setter accessor objects** — not values — so the store's internal runes read and write the *live* bindable props:

```svelte
let store = createStore<NodeType, EdgeType>({
  props,
  width,
  height,
  get nodes() { return nodes; },
  set nodes(newNodes) { nodes = newNodes; },
  get edges() { return edges; },
  set edges(newEdges) { edges = newEdges; },
  get viewport() { return viewport; },
  set viewport(newViewport) { viewport = newViewport; }
});
```

It then registers the store on Svelte context under a module-private `Symbol` key (`src/lib/store/index.ts:27 export const key = Symbol()`):

```svelte
setContext(key, {
  provider: false,
  getStore() { return store; }
} satisfies StoreContext<NodeType, EdgeType>);
```

If a `<SvelteFlowProvider>` is an ancestor, the flow *also* pushes its store up into the provider's context via `providerContext.setStore(store)` (`SvelteFlow.svelte:105-108`), so `useStore`/hooks called in **sibling** components outside `<SvelteFlow>` resolve to the same store.

### 2.3 Internal render tree

`SvelteFlow.svelte:132-228` wraps children in `<Wrapper>` → `<KeyHandler>` → `<Zoom>` → `<Pane>` → `<Viewport>` containing `EdgeRenderer`, `ConnectionLine`, `NodeRenderer`, `NodeSelection`, plus `Selection`, `Attribution`, and `A11yDescriptions`. The store is threaded through each via `bind:store`. Selection-change is handled by an `$effect` that calls the `onselectionchange` prop and every registered `selectionChangeHandlers` callback whenever `store.selectedNodes`/`store.selectedEdges` change (`SvelteFlow.svelte:119-125`). On `onDestroy`, `store.reset()` runs (`SvelteFlow.svelte:127-129`).

### 2.4 Props reference

Full type: `SvelteFlowProps<NodeType, EdgeType>` in `src/lib/container/SvelteFlow/types.ts:53`. It is the intersection of `NodeEvents & NodeSelectionEvents & EdgeEvents & PaneEvents` (from `src/lib/types/events.ts`) and a large options object. Selected high-value props and their **source-confirmed defaults** (defaults come from `initial-store.svelte.ts` `$derived(... ?? X)` and from `SvelteFlow.svelte` destructuring):

| Prop | Type | Default | Notes / source |
|---|---|---|---|
| `nodes` | `NodeType[]` | `[]` | bindable; treat as immutable (`types.ts:80`) |
| `edges` | `EdgeType[]` | `[]` | bindable; immutable (`types.ts:92`) |
| `viewport` | `Viewport` | `undefined` | bindable; if omitted, internal `_viewport` is used (`initial-store.svelte.ts` `get viewport`) |
| `initialViewport` | `Viewport` | `{x:0,y:0,zoom:1}` | ignored if `fitView` set (`types.ts:198`) |
| `nodeTypes` | `NodeTypes` | merged with built-ins | `initial-store.svelte.ts` `nodeTypes` |
| `edgeTypes` | `EdgeTypes` | merged with built-ins | `initial-store.svelte.ts` `edgeTypes` |
| `fitView` | `boolean` | `false` | becomes `fitViewQueued` (`initial-store.svelte.ts`) |
| `fitViewOptions` | `FitViewOptions<NodeType>` | – | `types.ts:149` |
| `minZoom` / `maxZoom` | `number` | `0.5` / `2` | `initial-store.svelte.ts` |
| `nodeOrigin` | `NodeOrigin` | `[0,0]` | |
| `nodeExtent` / `translateExtent` | `CoordinateExtent` | `infiniteExtent` | |
| `connectionMode` | `ConnectionMode` | `Strict` | |
| `connectionRadius` | `number` | `20` | |
| `connectionDragThreshold` | `number` | `1` | |
| `connectionLineType` | `ConnectionLineType` | `Bezier` | destructured default in `SvelteFlow.svelte:69` |
| `connectionLineComponent` | `Component` | – | replaces v0's `slot="connectionLine"` (see §8) |
| `nodesDraggable`/`nodesConnectable`/`elementsSelectable` | `boolean` | `true` | |
| `nodesFocusable`/`edgesFocusable` | `boolean` | `true` | keyboard a11y |
| `selectNodesOnDrag` | `boolean` | `true` | `initial-store.svelte.ts` |
| `nodeDragThreshold` | `number` | `1` | |
| `snapGrid` | `SnapGrid` | `null` | |
| `panOnDrag` | `boolean \| number[]` | `true` | mouse-button array allowed (`types.ts:334`) |
| `panOnScroll` | `boolean` | `false` | |
| `panOnScrollMode` | `PanOnScrollMode` | `Free` | destructured in `SvelteFlow.svelte:56` |
| `zoomOnScroll`/`zoomOnDoubleClick`/`zoomOnPinch` | `boolean` | `true` | |
| `selectionOnDrag` | `boolean` | `false` | |
| `selectionMode` | `SelectionMode` | `Partial` | |
| `onlyRenderVisibleElements` | `boolean` | `false` | enables viewport culling (`store.visible`) |
| `elevateNodesOnSelect`/`elevateEdgesOnSelect` | `boolean` | `true` | z-index on select |
| `zIndexMode` | `ZIndexMode` | `'basic'` | `'auto' \| 'basic' \| 'manual'` (`types.ts:516`) |
| `colorMode` | `ColorMode` | `'light'`/`'system'` | `system` resolves via `MediaQuery` (§7) |
| `colorModeSSR` | `Omit<ColorMode,'system'>` | – | SSR fallback |
| `defaultMarkerColor` | `string \| null` | `'#b1b1b7'` | `null` → CSS var `--xy-edge-stroke` |
| `noDragClass`/`noWheelClass`/`noPanClass` | `string` | `'nodrag'`/`'nowheel'`/`'nopan'` | |
| `clickConnect` | `boolean` | `true` | enables click-to-connect (new in v1) |
| `disableKeyboardA11y` | `boolean` | `false` | |
| `ariaLabelConfig` | `Partial<AriaLabelConfig>` | merged defaults | localisation |
| `proOptions` | `ProOptions` | – | attribution removal |

**Key callbacks (lowercase, Svelte-style):** `onconnect`, `onconnectstart`, `onconnectend`, `onbeforeconnect`, `onreconnect`/`onreconnectstart`/`onreconnectend`/`onbeforereconnect`, `ondelete`/`onbeforedelete`, `onmovestart`/`onmove`/`onmoveend`, `oninit`, `onflowerror`, `onselectionchange`, `onselectiondrag(start|stop)`, `onclickconnectstart`/`onclickconnectend` (`types.ts:448-516`). Node/edge/pane pointer events live in `events.ts` and use the **destructured-object** signature (see §9).

---

## 3. The reactive store, in depth

Files: `src/lib/store/index.ts` (actions), `src/lib/store/initial-store.svelte.ts` (state + derived), `src/lib/store/types.ts` (types).

### 3.1 `StoreSignals` — the bridge object

`createStore(signals: StoreSignals)` receives (`store/types.ts`):

```ts
export type StoreSignals<NodeType extends Node = Node, EdgeType extends Edge = Edge> = {
  props: SvelteFlowRestProps<NodeType, EdgeType>; // everything except the explicitly handled props
  width?: number;
  height?: number;
  nodes: NodeType[];
  edges: EdgeType[];
  viewport?: Viewport;
};
```

`signals` is the accessor object from §2.2. Because `nodes`/`edges`/`viewport`/`props` are **getters that read the live bindable props**, every `$derived(signals.props.x ?? default)` inside the store stays reactive to prop changes.

### 3.2 `getInitialStore` builds a class of runes

`getInitialStore` (`initial-store.svelte.ts:109`) defines a local `class SvelteFlowStore` (`:114`) and returns `new SvelteFlowStore()` (`:478`). The comment explains the choice: *"We use a class here, because Svelte adds getters & setter for us."* Field flavours used:

- **`$state.raw(...)`** for values that are reassigned wholesale and should *not* be deeply proxied: `domNode`, `panZoom`, `width`, `height`, `_viewport`, `_connection`, all the `*KeyPressed` booleans, `selectionRect`, `dragging`, `clickConnectStartHandle`, `ariaLiveMessage`. `$state.raw` is critical for perf — it avoids Svelte deep-proxying large arrays/objects.
- **`$derived(expr)`** for prop-mirroring scalars: `nodesDraggable`, `minZoom`, `nodeExtent`, `connectionMode`, `colorMode`, `onerror`, every `on*` handler, etc. — each is `$derived(signals.props.X ?? default)`.
- **`$derived.by(() => {...})`** for computed collections: `nodesInitialized`, `_edges`, `selectedNodes`, `selectedEdges`, `visible`, `connection`, `markers`.

### 3.3 The `nodes`/`edges` getters drive the internal lookups

This is the heart of how Svelte Flow keeps `nodeLookup`, `parentLookup`, `connectionLookup`, `edgeLookup` in sync. `nodes` is a getter that **first touches `this.nodesInitialized`** (a `$derived.by`) to force `adoptUserNodes` to run (`initial-store.svelte.ts`):

```ts
nodesInitialized: boolean = $derived.by(() => {
  const { nodesInitialized } = adoptUserNodes(signals.nodes, this.nodeLookup, this.parentLookup, {
    nodeExtent: this.nodeExtent, nodeOrigin: this.nodeOrigin,
    elevateNodesOnSelect: signals.props.elevateNodesOnSelect ?? true,
    checkEquality: true, zIndexMode: this.zIndexMode
  });
  // ... schedules fitView when queued ...
  return nodesInitialized;
});

get nodes() { this.nodesInitialized; return signals.nodes; }
set nodes(nodes) { signals.nodes = nodes; }

_edges: EdgeType[] = $derived.by(() => {
  updateConnectionLookup(this.connectionLookup, this.edgeLookup, signals.edges);
  return signals.edges;
});
get edges() { return this._edges; }
set edges(edges) { signals.edges = edges; }
```

So: **reading `store.nodes` always returns a freshly-adopted array**, and the side-effecting lookups are rebuilt as a derivation. `nodeLookup`/`parentLookup`/`connectionLookup`/`edgeLookup` are plain `Map`s (intentionally *not* runes — see the `/* eslint-disable svelte/prefer-svelte-reactivity */` at the top of the file).

### 3.4 Viewport: internal vs. bound

`_viewport` is `$state.raw`. The public `viewport` getter prefers the bound prop and falls back to internal:

```ts
get viewport() { return signals.viewport ?? this._viewport; }
set viewport(newViewport) { if (signals.viewport) signals.viewport = newViewport; this._viewport = newViewport; }
```

This is why `bind:viewport` is optional — without it the flow owns its viewport internally.

### 3.5 Connection state is viewport-corrected

`_connection` (`$state.raw`, from `XYHandle`) is viewport-independent. The public `connection` is a `$derived.by` that, while a drag is in progress, maps `_connection.to` through `pointToRendererPoint(...)` using the current viewport (`initial-store.svelte.ts`). `useConnection()` reads this.

### 3.6 `visible` — the cull layer

`visible = $derived.by(...)` returns `{ nodes: Map, edges: Map<string, EdgeLayouted> }`. When `onlyRenderVisibleElements` is true it subscribes to viewport/width/height and calls `getVisibleNodes` + `getLayoutedEdges({ onlyRenderVisible: true, ... })`; otherwise it returns the full `nodeLookup` and a fully-layouted edge map (`src/lib/store/visibleElements.ts`).

### 3.7 Actions (`createStore` in `store/index.ts`)

`createStore` wraps the state object with methods via `Object.assign(store, { ... } satisfies SvelteFlowStoreActions)`. Notable internals:

- `addEdge(edge)` → `store.edges = addEdgeUtil(edge, store.edges)`.
- `updateNodeInternals(updates)` → calls system `updateNodeInternals` + `updateAbsolutePositions`, resolves a queued `fitView`, then rebuilds changed nodes (dimensions/position) and reassigns `store.nodes` (`store/index.ts:70-126`).
- `fitView(options)` uses `Promise.withResolvers`, sets `fitViewQueued = true`, and **triggers a `store.nodes = [...store.nodes]` reassign** so `adoptUserNodes` runs and `resolveFitView` can fire (`store/index.ts:128-142`). The actual viewport fit happens in `resolveFitView` via system `fitViewport` (`initial-store.svelte.ts`).
- Selection: `addSelectedNodes`/`addSelectedEdges`/`unselectNodesAndEdges`/`handleNodeSelection`/`handleEdgeSelection` honour `multiselectionKeyPressed` and immutably remap arrays.
- `moveSelectedNodes(direction, factor)` implements arrow-key movement (5px or snap-grid velocity).
- `updateConnection`/`cancelConnection` write `_connection`.
- `reset()` → `resetStoreValues()` + `unselectNodesAndEdges()`.

Full action list: `SvelteFlowStoreActions` in `store/types.ts` (`setNodeTypes`, `setEdgeTypes`, `addEdge`, `zoomIn`, `zoomOut`, `setMinZoom`, `setMaxZoom`, `setTranslateExtent`, `fitView`, `setCenter`, `updateNodePositions`, `updateNodeInternals`, `unselectNodesAndEdges`, `addSelectedNodes`, `addSelectedEdges`, `handleNodeSelection`, `handleEdgeSelection`, `moveSelectedNodes`, `panBy`, `updateConnection`, `cancelConnection`, `reset`).

### 3.8 Dev-time guard against deep reactivity

`initial-store.svelte.ts` constructor calls `warnIfDeeplyReactive(signals.nodes, 'nodes')` which attempts `structuredClone(array[0])`; if it throws (because the object is a Svelte deep-`$state` Proxy) it logs **"Use `$state.raw` for nodes to prevent performance issues."** This is the runtime nudge behind the v1 immutability rule.

---

## 4. Store access: `useStore` and contexts

### 4.1 `useStore`

`src/lib/hooks/useStore.ts`:

```ts
export function useStore<NodeType extends Node = Node, EdgeType extends Edge = Edge>(): SvelteFlowStore<NodeType, EdgeType> {
  const storeContext = getContext<StoreContext<NodeType, EdgeType>>(key);
  if (!storeContext) {
    throw new Error('To call useStore outside of <SvelteFlow /> you need to wrap your component in a <SvelteFlowProvider />');
  }
  return storeContext.getStore();
}
```

It returns the **whole store** (state + actions). The docs flag it as advanced-only; prefer the dedicated hooks (`use-store.mdx`). Because the returned store is a runes object, you can destructure reactive fields directly in markup: `const { connectionMode } = useStore();`.

### 4.2 Why most hooks wrap it in `$derived`

A `<SvelteFlowProvider>` can **swap** the store (`setStore` reassigns a `$state.raw` store — `SvelteFlowProvider.svelte:24-26`). So hooks do `const store = $derived(useStore())` to stay correct across a store swap. The `SvelteFlowStore` type = `SvelteFlowStoreState & SvelteFlowStoreActions` (`store/types.ts`).

### 4.3 Node/edge id contexts

`src/lib/store/context.ts` exposes typed context pairs built on Svelte's `setContext`/`getContext`:
- `getNodeIdContext` / `setNodeIdContext` — the current node id (set by `NodeWrapper`).
- `getNodeConnectableContext` / `setNodeConnectableContext` — `{ value: boolean }` connectable flag.
- `getEdgeIdContext` / `setEdgeIdContext` — current edge id.

`Handle`, `NodeResizer`, `NodeToolbar`, `EdgeLabel`, `useNodeConnections`, `useUpdateNodeInternals` read these so they can be used **without an explicit id** inside a custom node/edge. Calling the getter with a string makes it throw if the context is missing, e.g. `getNodeIdContext('Handle must be used within a Custom Node component')` (`Handle.svelte:37`).

---

## 5. `useSvelteFlow` — the imperative instance

`src/lib/hooks/useSvelteFlow.svelte.ts`. Internally `const store = $derived(useStore())`. Returns a flat object of helpers (verbatim signatures, abbreviated set):

```ts
zoomIn: ZoomInOut; zoomOut: ZoomInOut;
getInternalNode: (id: string) => InternalNode<NodeType> | undefined;
getNode: (id: string) => NodeType | undefined;
getNodes: (ids?: string[]) => NodeType[];
getEdge: (id: string) => EdgeType | undefined;
getEdges: (ids?: string[]) => EdgeType[];
setZoom: (zoomLevel: number, options?: ViewportHelperFunctionOptions) => Promise<boolean>;
getZoom: () => number;
setCenter: (x: number, y: number, options?: SetCenterOptions) => Promise<boolean>;
setViewport: (viewport: Viewport, options?: ViewportHelperFunctionOptions) => Promise<boolean>;
getViewport: () => Viewport;
fitView: (options?: FitViewOptions<NodeType>) => Promise<boolean>;
fitBounds: (bounds: Rect, options?: FitBoundsOptions) => Promise<boolean>;
getIntersectingNodes / isNodeIntersecting;
deleteElements: ({ nodes?, edges? }) => Promise<{ deletedNodes; deletedEdges }>;
screenToFlowPosition: (clientPosition: XYPosition, options?: { snapToGrid: boolean }) => XYPosition;
flowToScreenPosition: (flowPosition: XYPosition) => XYPosition;
updateNode: (id, nodeUpdate, options?: { replace }) => void;
updateNodeData: (id, dataUpdate, options?: { replace }) => void;
updateEdge: (id, edgeUpdate, options?: { replace }) => void;
toObject: () => { nodes; edges; viewport };
getNodesBounds: (nodes: (NodeType | InternalNode<NodeType> | string)[]) => Rect;
getHandleConnections: ({ type, id, nodeId }) => HandleConnection[];
```

Implementation notes that matter:

- `getNode(id)` is `getInternalNode(id)?.internals.userNode` — i.e. the user-facing node lives at `internalNode.internals.userNode`.
- `getViewport()` returns `$state.snapshot(store.viewport)` — a non-reactive plain copy (important when handing to non-Svelte code).
- `updateNode`/`updateEdge` use `untrack(() => store.nodes)` to read the current array without creating a dependency, then immutably `.map` and reassign. `replace: true` swaps the object; otherwise it merges (`{ ...node, ...nextNode }`).
- `screenToFlowPosition` defaults `snapToGrid: true` (note: **opposite of React Flow's `false`** default) and uses `store.domNode.getBoundingClientRect()` + `pointToRendererPoint`.
- `deleteElements` runs system `getElementsToRemove` (honouring `onbeforedelete`), reassigns filtered arrays, and fires `ondelete`.
- `getHandleConnections` reads `connectionLookup.get(`${nodeId}-${type}-${id ?? null}`)`.

`screenToFlowPosition` example (from `useSvelteFlow.svelte.ts:182`): `const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY })`.

---

## 6. The `.current` signal hooks

Because Svelte 5 `$state` **cannot be returned from a function and stay reactive**, Svelte Flow's data hooks return an object with a **`get current()`** accessor (and sometimes `set current` / `set` / `update`). This matches the official Svelte convention (e.g. `MediaQuery`).

| Hook | File | Returns | Reactive setter? |
|---|---|---|---|
| `useNodes()` | `useNodesEdgesViewport.svelte.ts` | `{ current: Node[] }` | yes — `set current`, `set`, `update(fn)` |
| `useEdges()` | same | `{ current: Edge[] }` | yes |
| `useViewport()` | same | `{ current: Viewport }` | yes |
| `useConnection()` | `useConnection.svelte.ts` | `{ current: ConnectionState }` | no |
| `useNodeConnections(params?)` | `useNodeConnections.svelte.ts` | `{ current: NodeConnection[] }` | no |
| `useNodesData(id \| ids)` | `useNodesData.svelte.ts` | `{ current: DistributivePick<NodeType,'id'\|'data'\|'type'> \| null }` (single) / `{ current: …[] }` (array) | no |
| `useInternalNode(id)` | `useInternalNode.svelte.ts` | `{ current: InternalNode \| undefined }` | no |
| `useNodesInitialized()` | `useInitialized.svelte.ts` | `{ current: boolean }` | no |
| `useViewportInitialized()` | same | `{ current: boolean }` | no |
| `useUpdateNodeInternals()` | `useUpdateNodeInternals.svelte.ts` | `(nodeId?) => void` (a function) | n/a |
| `useOnSelectionChange(cb)` | `useOnSelectionChange.svelte.ts` | `void` (registers in `$effect`) | n/a |
| `useSvelteFlow()` | `useSvelteFlow.svelte.ts` | flat helper object | n/a |
| `useStore()` | `useStore.ts` | the whole store | direct field writes |

Usage:

```svelte
<script>
  import { useNodes, useNodeConnections } from '@xyflow/svelte';
  const nodes = useNodes();
  $inspect(nodes.current);          // read reactively
  nodes.current = [...];            // reassign works for useNodes/useEdges/useViewport
  nodes.update((ns) => ns);         // or update()
  const conns = useNodeConnections({ handleType: 'target' }); // id inferred in a custom node
</script>
```

### 6.1 `useNodeConnections` internals

`useNodeConnections.svelte.ts`. Params type `UseNodeConnectionsParams` from system: `{ id?, handleType?, handleId?, onConnect?, onDisconnect? }`. `id` falls back to `getNodeIdContext()`. It builds a `connectionLookup` key — `` `${nodeId}${handleType ? (handleId ? `-${handleType}-${handleId}` : `-${handleType}`) : ''}` `` (so `handleId` is only appended when `handleType` is set) — diffs the previous/next `Map`s with `areConnectionMapsEqual`, and only recomputes the array when they differ. `onConnect`/`onDisconnect` fire via system `handleConnectionChange` inside an `$effect`.

### 6.2 `useNodesData` internals

Returns `{ id, type, data }` projections. Single-id overload returns the object or `null`; array overload returns an array. Uses system `shallowNodeData` to avoid churning the reference when data is unchanged (`useNodesData.svelte.ts`).

### 6.3 `useUpdateNodeInternals`

Returns `(id?: string | string[]) => void`. Without an id it falls back to `getNodeIdContext()` (called with no message, so it returns `undefined` outside a node rather than throwing); if both the passed id and the context id are missing the returned function throws `'When using outside of a node, you must provide an id.'` It queries `domNode.querySelector('.svelte-flow__node[data-id="…"]')`, builds an update map with `{ id, nodeElement, force: true }` entries, and calls `store.updateNodeInternals(updates)` inside `requestAnimationFrame`. Call it after you programmatically add/move handles.

---

## 7. Components shipped from `@xyflow/svelte`

All re-exported from `src/lib/index.ts`. Props types cited per component.

### Handle — `src/lib/components/Handle/Handle.svelte`, types `…/types.ts`
`HandleProps = HandlePropsSystem & { class?, onconnect?, ondisconnect?, children?, …HTMLAttributes }`. Props: `id`, `type='source'`, `position=Position.Top`, `isConnectable`, `isConnectableStart=true`, `isConnectableEnd=true`, `isValidConnection`, `style`. It reads `getNodeIdContext`/`getNodeConnectableContext` (so it must live inside a node), wires pointer-down to `XYHandle.onPointerDown`, and supports **click-connect** (`store.clickConnect`, `clickConnectStartHandle`, `XYHandle.isValid`). `onconnect`/`ondisconnect` fire via an `$effect.pre` that diffs `connectionLookup`. The rendered `<div>` gets `class:source/target/connectable/connectingfrom/connectingto/valid` toggles and `data-id="{store.flowId}-{nodeId}-{handleId ?? 'null'}-{type}"` (`Handle.svelte:202`).

### Background — `src/lib/plugins/Background`
`BackgroundProps` (`types.ts`): `id`, `bgColor`, `patternColor`, `patternClass`, `class`, `gap=20` (`number | [number, number]`), `size`, `lineWidth=1`, `variant` (`BackgroundVariant.Dots` default). Enum `BackgroundVariant { Lines='lines', Dots='dots', Cross='cross' }`. Multiple backgrounds need unique `id`.

### Controls — `src/lib/plugins/Controls`
`ControlsProps`: `position`, `showZoom`, `showFitView`, `showLock`, button color props, `orientation: 'horizontal' | 'vertical'`, `fitViewOptions`, snippet slots `children` / `before` / `after`. `ControlButton` (`ControlButtonProps`) is also exported for custom buttons.

### MiniMap — `src/lib/plugins/Minimap`
`MiniMapProps`: `bgColor`, `nodeColor`/`nodeStrokeColor`/`nodeClass` (each `string | (node) => string`), `nodeBorderRadius`, `nodeStrokeWidth`, `nodeComponent: Component<MiniMapNodeProps>` (must render SVG), mask props, `position`, `width`, `height`, `pannable`, `zoomable`, `inversePan`, `zoomStep`, `ariaLabel`. `MiniMapNodeProps` is exported for custom minimap nodes.

### Panel — `src/lib/container/Panel`
`PanelProps = HTMLAttributes<HTMLDivElement> & { position?: PanelPosition; style?; class? }`. Positions a snippet over the pane.

### NodeResizer / ResizeControl — `src/lib/plugins/NodeResizer`
`NodeResizerProps`: `nodeId?` (optional inside a custom node), `color`, `handleClass`/`handleStyle`/`lineClass`/`lineStyle`, `isVisible`, `minWidth`/`minHeight`/`maxWidth`/`maxHeight`, `keepAspectRatio`, `autoScale`, `shouldResize`/`onResizeStart`/`onResize`/`onResizeEnd`, `resizeDirection`. `ResizeControlProps` exposes a single control with `position`, `variant` (`ResizeControlVariant.Handle | .Line`), and a `children` snippet. Backed by system `XYResizer`.

### NodeToolbar — `src/lib/plugins/NodeToolbar`
`NodeToolbarProps`: `nodeId?: string | string[]`, `position?: Position`, `align?: Align`, `offset?`, `isVisible?` (show even when unselected), `children` snippet.

### EdgeToolbar — `src/lib/plugins/EdgeToolbar`
`EdgeToolbarProps = Omit<EdgeToolbarBaseProps, 'edgeId'> & { selectEdgeOnClick?: boolean; children?: Snippet } & HTMLAttributes<HTMLDivElement>` (`EdgeToolbar/types.ts`). Edge analogue of `NodeToolbar`; the edge id comes from `getEdgeIdContext` when used inside a custom edge.

### EdgeLabel — `src/lib/components/EdgeLabel/EdgeLabel.svelte` (was `EdgeLabelRenderer` in v0)
`EdgeLabelProps`: `x`, `y`, `width`, `height`, `selectEdgeOnClick`, `transparent`, `children`. It portals into the `edge-labels` layer via `use:portal={'edge-labels'}`, reads the current edge id from `getEdgeIdContext('EdgeLabel must be used within a Custom Edge component')`, positions via `translate(-50%,-50%) translate(Xpx,Ypx)`, derives `z-index` from `store.visible.edges.get(edgeId)?.zIndex`, and — when `selectEdgeOnClick` — calls `store.handleEdgeSelection(edgeId)` on click. **This is the big v1 difference**: it knows its edge and handles selection itself.

### EdgeReconnectAnchor — `src/lib/components/EdgeReconnectAnchor` (new in v1)
`EdgeReconnectAnchorProps`: `type: HandleType`, `reconnecting?`, `position?: XYPosition`, `size?`, `dragThreshold?`, `children`. Drop it inside a custom edge to create draggable reconnection points.

### BaseEdge & built-in edges
Exported: `BaseEdge`, `BezierEdge`, `StepEdge`, `SmoothStepEdge`, `StraightEdge`. Built-in node types (registered as defaults in `initial-store.svelte.ts`): `input`, `output`, `default`, `group`. Built-in edge defaults: `default`(bezier), `straight`, `smoothstep`, `step`.

### ViewportPortal — `src/lib/components/ViewportPortal`
`ViewportPortalProps`: `target: 'front' | 'back'`, `children`. v1 lets you render **below** (`back`) or **above** (`front`) nodes/edges in viewport space.

### SvelteFlowProvider — `src/lib/components/SvelteFlowProvider`
`SvelteFlowProviderProps = { children?: Snippet }`. Creates a placeholder store (`$state.raw(createStore({ props:{}, nodes:[], edges:[] }))`), publishes it on context as `{ provider: true, getStore, setStore }`, and lets the real `<SvelteFlow>` (a descendant) inject its store via `setStore`. Use it to call hooks **outside** `<SvelteFlow>` (sidebars, save/restore buttons).

### Color mode (§7 detail)
`colorMode` is a `$derived` on `signals.props.colorMode`; `'system'` resolves through `new MediaQuery('(prefers-color-scheme: dark)', colorModeSSR === 'dark')` from `svelte/reactivity` (`initial-store.svelte.ts`). The resolved class (`'light' | 'dark'`) is passed to `<Wrapper colorMode={store.colorMode}>`.

---

## 8. Svelte-5 runes usage — the canonical patterns

From `web/sites/svelteflow.dev/.../building-a-flow.mdx` and `…/custom-nodes.mdx`:

```svelte
<script>
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  let nodes = $state.raw([
    { id: '1', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Hello' } },
    { id: '2', type: 'output', position: { x: 100, y: 100 }, data: { label: 'World' } },
  ]);
  let edges = $state.raw([{ id: 'e1-2', source: '1', target: '2', type: 'smoothstep' }]);
  let viewport = $state({ x: 0, y: 0, zoom: 1 });
</script>

<div style:width="100vw" style:height="100vh">
  <SvelteFlow bind:nodes bind:edges bind:viewport fitView>
    <Background />
    <Controls />
    <MiniMap />
  </SvelteFlow>
</div>
```

Custom node (note `$props()` and `useSvelteFlow().updateNodeData`):

```svelte
<!-- TextUpdaterNode.svelte -->
<script lang="ts">
  import { Position, Handle, useSvelteFlow, type NodeProps } from '@xyflow/svelte';
  let { id, data }: NodeProps = $props();
  let { updateNodeData } = useSvelteFlow();
</script>
<Handle type="target" position={Position.Top} />
<input class="nodrag" value={data.text}
  oninput={(e) => updateNodeData(id, { text: e.currentTarget.value })} />
<Handle type="source" position={Position.Bottom} />
```

`NodeProps<NodeType>` (`src/lib/types/nodes.ts`) = system `NodeProps` plus `type: any` (generics for custom nodes are still loose in this version — see the `@todo` comment in the file). `Node<NodeData, NodeType>` extends system `NodeBase` and adds Svelte-specific `class?`, `style?`, `focusable?`, `ariaRole?`, and `domAttributes?`.

### Cross-module state with function bindings
When nodes/edges live in a `.svelte.js` module (you can't `export` a reassignable `$state` directly), use **function bindings** (`migrate-to-v1.mdx`):

```js
// store.svelte.js
let nodes = $state.raw([...]); let edges = $state.raw([...]);
export const getNodes = () => nodes;  export const setNodes = (n) => (nodes = n);
export const getEdges = () => edges;  export const setEdges = (e) => (edges = e);
```
```svelte
<SvelteFlow bind:nodes={getNodes, setNodes} bind:edges={getEdges, setEdges} />
```

---

## 9. Differences from React Flow that trip people up

These are the load-bearing gotchas, all verified against source.

1. **State is your own `$state.raw`, not a hook.** React Flow gives you `useNodesState`/`useEdgesState` (or `onNodesChange`). Svelte Flow has **no `onnodeschange`/`onedgeschange` props at all** — you own `let nodes = $state.raw([...])` and `bind:nodes`. There is **no change-array system**; you mutate by reassigning arrays.

2. **`bind:` is mandatory for two-way sync.** `<SvelteFlow {nodes} {edges} />` (one-way) means drag/select/delete won't write back. You need `bind:nodes bind:edges` because the props are `$bindable` (`SvelteFlow.svelte:72-74`). This is the #1 v0→v1 and React→Svelte mistake.

3. **Arrays are immutable; deep mutation is silently ignored.** `nodes[0].position.x = 100` does nothing. You must create new objects and **reassign the array** (`nodes = nodes.map(...)` or use `updateNode`). React Flow tolerates more because of `onNodesChange`; here the `$state.raw` choice (made for perf) forbids it. Dev mode warns via `warnIfDeeplyReactive` if you accidentally use deep `$state`.

4. **Hooks return `{ current }`, not the value.** `useNodes()` is not an array — read `useNodes().current`. Only `useNodes`/`useEdges`/`useViewport` allow writing back through `.current`/`.set`/`.update`. (React Flow returns the value directly.)

5. **Event props are lowercase and pass a single destructured object.** It's `onnodeclick={({ node, event }) => …}`, **not** `onNodeClick={(event, node) => …}`. Edge: `onedgeclick={({ edge, event }) => …}`. Pane: `onpaneclick={({ event }) => …}`. See `events.ts`. Connection/move/lifecycle callbacks are also lowercase: `onconnect`, `onmove`, `oninit`, `onflowerror` (not `onError`).

6. **`onbeforeconnect` replaces React's `onConnect`-mutate / v0 `onEdgeCreate`.** To customise/abort a new edge return a (possibly modified) edge or `false` from `onbeforeconnect` (`Handle.svelte:101-110`). `onconnect` fires *after* the edge is added.

7. **`EdgeLabel`, not `EdgeLabelRenderer`.** Pass `x`/`y` props (not a manual `transform`), and it auto-handles edge selection with `selectEdgeOnClick`. Must be inside a custom edge (reads `getEdgeIdContext`).

8. **Custom connection line is a prop, not a slot.** Use `connectionLineComponent={MyLine}` (v0 used `<ConnectionLine slot="connectionLine" />`).

9. **`screenToFlowPosition` defaults `snapToGrid: true`** in Svelte (`useSvelteFlow.svelte.ts:484`), whereas React Flow defaults it to `false`. Pass `{ snapToGrid: false }` if you want raw coordinates.

10. **`useStore` returns the whole store object** (state + actions), and you destructure runes off it — there is **no selector function** like React Flow's `useStore(selector, equalityFn)`.

11. **Provider semantics.** To use hooks outside `<SvelteFlow>` you need `<SvelteFlowProvider>` as an ancestor (the error message in `useStore.ts` says exactly this). React Flow has `ReactFlowProvider` with the same role, but here the provider literally *swaps in* the flow's store via `setStore`.

12. **Built-ins, theming, imports.** You must import `@xyflow/svelte/dist/style.css` (or `dist/base.css`). The package is `svelte`-conditioned in `exports` and ships uncompiled `.svelte` files — your bundler needs the Svelte plugin. Class names are `svelte-flow__*` (vs React's `react-flow__*`).

13. **Keyboard a11y is on by default** in v1 (tab through nodes/edges, arrow-key move). Disable with `disableKeyboardA11y`. This did not exist in v0.

---

## 10. Quick API index (import surface)

From `src/lib/index.ts`: **Components** — `SvelteFlow`, `SvelteFlowProvider`, `Panel`, `ViewportPortal`, `Handle`, `BaseEdge`, `BezierEdge`/`StepEdge`/`SmoothStepEdge`/`StraightEdge`, `EdgeLabel`, `EdgeReconnectAnchor`, `Controls`/`ControlButton`, `Background`, `MiniMap`, `NodeToolbar`, `EdgeToolbar`, `NodeResizer`/`ResizeControl`. **Hooks** — `useSvelteFlow`, `useStore`, `useNodes`, `useEdges`, `useViewport`, `useConnection`, `useNodeConnections`, `useNodesData`, `useInternalNode`, `useNodesInitialized`, `useViewportInitialized`, `useUpdateNodeInternals`, `useOnSelectionChange`. **Utils** — re-exported from system via `src/lib/index.ts:132-147`: `addEdge`, `getBezierPath`, `getSmoothStepPath`, `getStraightPath`, `getNodesBounds`, `getViewportForBounds`, `getIncomers`, `getOutgoers`, `getConnectedEdges`. `isNode`/`isEdge` are Svelte-local wrappers (`src/lib/utils/index.ts`) around system `isNodeBase`/`isEdgeBase`, exported via `export * from '$lib/utils'`. **Types** — `Node`, `Edge`, `NodeProps`, `EdgeProps`, `NodeTypes`, `EdgeTypes`, `InternalNode`, `SvelteFlowStore`, plus the large block of shared `@xyflow/system` types.

---

## Gaps / notes

- The provided `strudel-flow` app is a **React** app (`@xyflow/react ^12.10.2`), not Svelte, so it does not ground any Svelte usage; all real-usage examples here come from the `svelteflow.dev` docs and the package source.
- `EdgeProps`/`BaseEdgeProps` and the system `HandlePropsSystem`/`NodeBase`/`InternalNodeBase` shapes are re-exported from `@xyflow/system` (0.0.76) and not re-copied here; see the system reference doc for their full field lists.
