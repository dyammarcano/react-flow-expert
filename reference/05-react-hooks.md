# React Flow Hooks — Complete Internals Reference

## What this covers

Every hook exported by `@xyflow/react` (v12.10.2): exact signatures, params, return types, the Zustand store slice each one subscribes to, the equality function it uses to gate re-renders, and when to reach for it — because nearly every "data" hook is a thin `useStore(selector, equalityFn)` wrapper, understanding the selector + equality pair is the key to understanding (and not over-rendering with) the whole API.

Pinned versions: `@xyflow/react` **12.10.2**, `@xyflow/system` **0.0.76**, `@xyflow/svelte` **1.5.2**.

All hooks live in `xyflow/packages/react/src/hooks/*.ts` and are re-exported from `xyflow/packages/react/src/index.ts`. `useNodeId` is the one exception — it lives in `xyflow/packages/react/src/contexts/NodeIdContext.ts` and is re-exported from the index.

---

## The foundation: everything is `useStore`

React Flow keeps **all** internal state in a single Zustand store, scoped per `<ReactFlowProvider>` / `<ReactFlow>` instance via React context. Every other hook is built on top of two primitives in `hooks/useStore.ts`:

- `useStore(selector, equalityFn?)` — subscribe to a derived slice, re-render only when `equalityFn` says the slice changed.
- `useStoreApi()` — get the raw store handle (`getState` / `setState` / `subscribe`) for imperative reads/writes **without** subscribing (no re-renders).

### `useStore`

```ts
// hooks/useStore.ts:useStore
function useStore<StateSlice = unknown>(
  selector: (state: ReactFlowState) => StateSlice,
  equalityFn?: (a: StateSlice, b: StateSlice) => boolean
): StateSlice
```

Internals: it reads `StoreContext` (`contexts/StoreContext`), throws `errorMessages['error001']()` ("[React Flow]: Seems like you have not used zustand provider as an ancestor…") if the store is `null`, then delegates to Zustand's `useStoreWithEqualityFn` (imported from `zustand/traditional` as `useZustandStore`). The `equalityFn` is what lets every wrapper hook avoid re-rendering on unrelated state churn.

| Param | Type | Notes |
|-------|------|-------|
| `selector` | `(state: ReactFlowState) => StateSlice` | Extract/transform just the slice you need. |
| `equalityFn` | `(a, b) => boolean` | Optional. Default is `Object.is`. Pass `zustand/shallow` for object/array slices. |

**When to use:** only when no dedicated hook exposes the slice you need. The source itself says so (`@remarks` on `useStore`): "This hook should only be used if there is no other way to access the internal state."

```ts
import { useStore } from '@xyflow/react';
const nodeCount = useStore((s) => s.nodes.length);          // Object.is — re-renders only when count changes
const ids = useStore((s) => s.nodes.map((n) => n.id), shallow); // array — needs shallow
```

### `useStoreApi`

```ts
// hooks/useStore.ts:useStoreApi
function useStoreApi<NodeType extends Node = Node, EdgeType extends Edge = Edge>(): {
  getState: StoreApi<ReactFlowState<NodeType, EdgeType>>['getState'];
  setState: StoreApi<ReactFlowState<NodeType, EdgeType>>['setState'];
  subscribe: StoreApi<ReactFlowState<NodeType, EdgeType>>['subscribe'];
}
```

Internals: reads the same `StoreContext`, throws the same `error001` if null, and returns a `useMemo`-stabilized object exposing exactly three Zustand methods: `getState`, `setState`, `subscribe`. **It does not subscribe** — calling `store.getState()` inside an event handler reads fresh state without making the component re-render. This is the building block for `useReactFlow`, `useUpdateNodeInternals`, `useOnViewportChange`, `useOnSelectionChange`, and the middleware hooks.

**When to use:** inside callbacks/effects where you want current state on demand but must not subscribe (e.g. reading `nodeLookup` on a click). Returns a stable reference, safe as a `useEffect`/`useCallback` dependency.

---

## Store-subscribing data hooks

These are all `useStore(selector, equalityFn)` one-liners. The table tells you exactly which slice and which equality function each one uses — that is the whole behavioral contract.

| Hook | Store slice (`ReactFlowState`) | Equality fn | Re-renders when |
|------|--------------------------------|-------------|-----------------|
| `useNodes` | `state.nodes` | `shallow` | any node changes (incl. select/move) |
| `useEdges` | `state.edges` | `shallow` | any edge changes |
| `useViewport` | `{x,y,zoom}` from `state.transform` | `shallow` | viewport pans/zooms |
| `useNodesData` | derived from `state.nodeLookup` | `shallowNodeData` | the watched node(s) `id/type/data` change |
| `useInternalNode` | `state.nodeLookup.get(id)` | `shallow` | that node changes (select/move/measure) |
| `useNodesInitialized` | `state.nodesInitialized` (or scan of `nodeLookup`) | `Object.is` | all nodes get measured |
| `useConnection` | `state.connection` (+ `transform`) | `shallow` | active connection drag updates |
| `useNodeConnections` | `state.connectionLookup.get(key)` | `areConnectionMapsEqual` | connections on the node/handle change |
| `useHandleConnections` *(deprecated)* | `state.connectionLookup.get(key)` | `areConnectionMapsEqual` | same as above (old key format) |

### `useNodes`

```ts
// hooks/useNodes.ts
function useNodes<NodeType extends Node = Node>(): NodeType[]
// const nodesSelector = (state) => state.nodes;  uses shallow
```

Returns the full `state.nodes` array. Equality is `shallow` (from `zustand/shallow`), so it re-renders when the array's top-level membership changes — **including selection and position changes**, because those produce new node objects. Heavy on large graphs; prefer a narrow `useStore` selector if you only need a count or one field.

### `useEdges`

```ts
// hooks/useEdges.ts
function useEdges<EdgeType extends Edge = Edge>(): EdgeType[]
// const edgesSelector = (state) => state.edges;  uses shallow
```

Symmetric to `useNodes` for `state.edges`.

### `useViewport`

```ts
// hooks/useViewport.ts
function useViewport(): Viewport   // Viewport = { x: number; y: number; zoom: number }
```

Selector builds `{ x: transform[0], y: transform[1], zoom: transform[2] }` from the internal `state.transform` tuple, compared with `shallow`. Re-renders on every pan/zoom — use it for HUDs/minimap-style readouts, not for high-frequency layout math. Must be inside a `ReactFlowProvider`/`ReactFlow`.

### `useNodesData`

```ts
// hooks/useNodesData.ts — overloaded
function useNodesData<NodeType extends Node = Node>(
  nodeId: string
): DistributivePick<NodeType, 'id' | 'type' | 'data'> | null;
function useNodesData<NodeType extends Node = Node>(
  nodeIds: string[]
): DistributivePick<NodeType, 'id' | 'type' | 'data'>[];
```

Internals: the selector walks `state.nodeLookup`, pushing `{ id, type, data }` for each requested id; for a single-string arg it returns `data[0] ?? null`, for an array it returns the array. Equality is the specialized `shallowNodeData` (from `@xyflow/system`) which compares each entry's `id/type/data` — so the consumer re-renders **only when the watched node's data object actually changes**, not when unrelated nodes move. The inner selector is wrapped in `useCallback([nodeIds])` so passing a stable id/array keeps the selector identity stable. This is the canonical way for a node to react to *another* node's `data` (e.g. computation graphs).

### `useInternalNode`

```ts
// hooks/useInternalNode.ts
function useInternalNode<NodeType extends Node = Node>(
  id: string
): InternalNode<NodeType> | undefined
```

Selector: `(s) => s.nodeLookup.get(id)` (wrapped in `useCallback([id])`), equality `shallow`. Returns the **internal** node representation — the richer object React Flow maintains, including `measured: { width, height }` and `internals: { positionAbsolute, z, userNode, handleBounds, bounds, ... }` (`@xyflow/system` `types/nodes.ts:InternalNodeBase`). Use it when you need absolute position or handle bounds that the public `Node` does not carry. Re-renders whenever that node changes (select/move/measure).

### `useNodesInitialized`

```ts
// hooks/useNodesInitialized.ts
type UseNodesInitializedOptions = { includeHiddenNodes?: boolean /* @default false */ };
function useNodesInitialized(options?: UseNodesInitializedOptions): boolean
```

Internals: when `includeHiddenNodes` is false (default) it returns the precomputed `state.nodesInitialized` flag directly. When true, it scans `state.nodeLookup` and returns `false` if any node has `internals.handleBounds === undefined` or fails `nodeHasDimensions(internals.userNode)`. Returns `false` while nodes are being measured, then flips to `true`. The classic use is gating an auto-layout pass (dagre/elk) until real widths/heights exist — see the `useLayout` example in source.

### `useConnection`

```ts
// hooks/useConnection.ts
function useConnection<
  NodeType extends Node = Node,
  SelectorReturn = ConnectionState<InternalNode<NodeType>>
>(
  connectionSelector?: (connection: ConnectionState<InternalNode<NodeType>>) => SelectorReturn
): SelectorReturn
```

Internals: the base `storeSelector` reads `state.connection`. If a connection is in progress it returns `{ ...connection, to: pointToRendererPoint(connection.to, transform) }` (converting the pointer position into flow coordinates); otherwise `{ ...connection }`. An optional `connectionSelector` is composed on top so you can extract just a slice (e.g. `isValid`) and avoid re-renders. Equality is `shallow`. The returned `ConnectionState` is a discriminated union (`@xyflow/system` `types/general.ts`):

```ts
type ConnectionState<NodeType extends InternalNodeBase = InternalNodeBase> =
  | ConnectionInProgress<NodeType>   // { inProgress: true; isValid; from; fromHandle; fromNode; to; toHandle; toNode; ... }
  | NoConnection;                    // { inProgress: false; isValid: null; from: null; fromHandle: null; ...all null }
```

Use it to colorize handles or render a custom connection line based on validity (`connection.isValid`) during an active drag. When idle, every field is `null`.

### `useNodeConnections`

```ts
// hooks/useNodeConnections.ts
function useNodeConnections(params?: UseNodeConnectionsParams): NodeConnection[]
```

`UseNodeConnectionsParams` (`@xyflow/system` `types/general.ts:UseNodeConnectionsParams`):

```ts
type UseNodeConnectionsParams = {
  id?: string;                                    // node id; auto-filled from NodeIdContext inside a custom node
  onConnect?: (connections: HandleConnection[]) => void;
  onDisconnect?: (connections: HandleConnection[]) => void;
} & (
  | { handleType: HandleType; handleId?: string } // filter by 'source'|'target' (+ optional handle id)
  | { handleType?: HandleType; handleId?: never }
);
type NodeConnection = Connection & { edgeId: string };
```

Internals: `currentNodeId = id ?? useNodeId()`; throws `errorMessages['error014']()` if neither is present. It subscribes to `state.connectionLookup.get(key)` where the key is `\`${nodeId}${handleType ? (handleId ? \`-${handleType}-${handleId}\` : \`-${handleType}\`) : ''}\``, compared with `areConnectionMapsEqual`. A `useEffect` diffs the previous vs current connection map with `handleConnectionChange` to fire `onConnect`/`onDisconnect` callbacks. Returns `Array.from(connections?.values() ?? [])` (memoized). This is the modern replacement for `useHandleConnections`.

```jsx
const connections = useNodeConnections({ handleType: 'target', handleId: 'my-handle' });
// inside a custom node, id is inferred — no need to pass it
```

### `useHandleConnections` — DEPRECATED

```ts
// hooks/useHandleConnections.ts
function useHandleConnections(params: {
  type: HandleType;          // required (note: 'type', not 'handleType')
  id?: string | null;
  nodeId?: string;
  onConnect?: (connections: Connection[]) => void;
  onDisconnect?: (connections: Connection[]) => void;
}): HandleConnection[]
```

**Deprecated. Use `useNodeConnections` instead.** It `console.warn`s on every call. Same `connectionLookup` mechanism, but with the older key format `\`${nodeId}-${type}${id ? \`-${id}\` : ''}\`` and a different param shape (`type`/`id` instead of `handleType`/`handleId`). Kept for back-compat only.

---

## The instance hook: `useReactFlow`

```ts
// hooks/useReactFlow.ts
function useReactFlow<NodeType extends Node = Node, EdgeType extends Edge = Edge>():
  ReactFlowInstance<NodeType, EdgeType>
// ReactFlowInstance = GeneralHelpers & ViewportHelperFunctions & { viewportInitialized: boolean }
//   (react/src/types/instance.ts:ReactFlowInstance)
```

The single most important hook for imperative control. Internally it composes three things via `useStoreApi` + `useViewportHelper` + the `BatchProvider`:

1. **`generalHelper`** (`GeneralHelpers`, `types/instance.ts`) — node/edge CRUD + queries, built once in a `useMemo([])`. Reads go through `store.getState()`; **writes are queued** through `batchContext.nodeQueue` / `edgeQueue` (from `components/BatchProvider`) so multiple `setNodes`/`addNodes` in one tick are flushed together.
2. **`viewportHelper`** (`ViewportHelperFunctions`) — pan/zoom helpers, see next section.
3. **`viewportInitialized`** — from `useStore((s) => !!s.panZoom)`; the only reactive part (the outer `useMemo` re-runs on this), so the returned object is otherwise stable.

Key `GeneralHelpers` methods (exact behavior from source):

| Method | What it does |
|--------|--------------|
| `getNodes()` / `getEdges()` | Shallow-copied snapshot arrays from `state.nodes` / `state.edges`. |
| `getNode(id)` | `nodeLookup.get(id)?.internals.userNode`. |
| `getInternalNode(id)` | `nodeLookup.get(id)` (the `InternalNode`). |
| `getEdge(id)` | `edgeLookup.get(id)`. |
| `setNodes(payload)` / `setEdges(payload)` | Push onto the batch queue (array or updater fn). |
| `addNodes` / `addEdges` | Queue `(arr) => [...arr, ...new]`. |
| `updateNode(id, update, {replace})` | Queue a map that merges or replaces one node. |
| `updateNodeData(id, dataUpdate, {replace})` | Same but only the `data` object (merges by default). |
| `updateEdge` / `updateEdgeData` | Edge equivalents. |
| `toObject()` | `{ nodes, edges, viewport }` snapshot (for save/load). |
| `deleteElements({nodes, edges})` | Async; runs `getElementsToRemove` (+ `onBeforeDelete`), fires `onNodesDelete`/`onEdgesDelete`/`onDelete`, triggers changes. Returns `{ deletedNodes, deletedEdges }`. |
| `getIntersectingNodes(nodeOrRect, partially?, nodes?)` | Overlap test via `getOverlappingArea` against `nodeToRect`. |
| `isNodeIntersecting(nodeOrRect, area, partially?)` | Single boolean overlap test. |
| `getNodesBounds(nodes)` | `getNodesBounds(nodes, { nodeLookup, nodeOrigin })`. |
| `getNodeConnections({type, handleId, nodeId})` | Reads `connectionLookup` (new key format). |
| `getHandleConnections({type, id, nodeId})` | Reads `connectionLookup` (old key format). |
| `fitView(options?)` | Schedules a fit by setting `fitViewQueued`/`fitViewOptions` and pushing a no-op nodes update; returns a single reused `withResolvers<boolean>()` promise. |

**When to use:** event handlers and effects that mutate the graph or query it on demand. Because writes are queued, calling `setNodes` then immediately `getNodes()` returns the *old* nodes — read after the flush. Pass the instance itself as a dep (`[reactFlow]`) in `useCallback`/`useEffect`; it's stable except across viewport init.

---

## Viewport control: `useViewportHelper` (internal) → exposed via `useReactFlow`

`useViewportHelper` (`hooks/useViewportHelper.ts`, marked `@internal`) is **not exported** directly — its methods are spread into `useReactFlow`'s return. It builds the `ViewportHelperFunctions` via `useStoreApi` and the store's `panZoom` instance:

| Method | Internals |
|--------|-----------|
| `zoomIn(options)` | `panZoom.scaleBy(1.2, options)`; `false` if no `panZoom`. |
| `zoomOut(options)` | `panZoom.scaleBy(1/1.2, options)`. |
| `zoomTo(level, options)` | `panZoom.scaleTo(level, options)`. |
| `getZoom()` | `transform[2]`. |
| `setViewport(vp, options)` | `panZoom.setViewport`, falling back to current `transform` for missing fields. |
| `getViewport()` | `{ x, y, zoom }` from `transform`. |
| `setCenter(x, y, options)` | delegates to `state.setCenter`. |
| `fitBounds(bounds, options)` | computes `getViewportForBounds(...)` then `panZoom.setViewport`. |
| `screenToFlowPosition(clientPos, {snapToGrid, snapGrid})` | subtracts `domNode` rect, then `pointToRendererPoint(...)`. |
| `flowToScreenPosition(flowPos)` | `rendererPointToPoint(...)` + `domNode` rect offset. |

`screenToFlowPosition` is the one you reach for constantly: converting a mouse/drop client coordinate into flow space (e.g. drag-and-drop node creation).

---

## Imperative / side-effect hooks

### `useUpdateNodeInternals`

```ts
// hooks/useUpdateNodeInternals.ts
function useUpdateNodeInternals(): UpdateNodeInternals   // (id: string | string[]) => void
```

Internals: built on `useStoreApi`. The returned callback reads `domNode` + `updateNodeInternals` from state, finds each `.react-flow__node[data-id="…"]` element, builds a `Map<string, InternalNodeUpdate>` with `{ id, nodeElement, force: true }`, and calls `updateNodeInternals(updates, { triggerFitView: false })` inside a `requestAnimationFrame`. **Call this whenever you add/remove/move handles programmatically** so React Flow re-measures handle bounds and reroutes edges — otherwise edges connect to stale handle positions.

### `useKeyPress`

```ts
// hooks/useKeyPress.ts
function useKeyPress(
  keyCode?: KeyCode | null,               // default null
  options?: UseKeyPressOptions            // default { target: document, actInsideInputWithModifier: true }
): boolean

type UseKeyPressOptions = {
  target?: Window | Document | HTMLElement | ShadowRoot | null;  // @default document
  actInsideInputWithModifier?: boolean;                          // @default true
  preventDefault?: boolean;
};
```

Pure-React hook (no store). Returns whether the key/combo is currently held. Internals worth knowing:

- `keyCode` accepts a single key (`'a'`), a combination joined with `+` (`'Meta+s'`, and even `'key++'` via the `'\n\n' → '\n+'` trick), or an **array** of alternatives (`['Meta+s', 'Strg+s']` = any one matches).
- It decides per-key whether to match on `event.code` or `event.key`: if the parsed token appears in `keysToWatch` it uses `code`, otherwise `key` (so `'a'` matches the key, `'MetaLeft'` matches the code).
- `actInsideInputWithModifier`/`isInputDOMNode` suppress matches while typing in inputs unless a modifier is held.
- Listeners attach to `target` for keydown/keyup plus `window` `blur`/`contextmenu` reset handlers; a Mac-specific fix clears pressed keys when `Meta` is released. `preventDefault` (unless `false`) is called on match for non-interactive elements or when a modifier is down.

This is the same primitive React Flow uses internally for `deleteKeyCode`, `selectionKeyCode`, etc.

### `useOnViewportChange`

```ts
// hooks/useOnViewportChange.ts
function useOnViewportChange(options: UseOnViewportChangeOptions): void
type UseOnViewportChangeOptions = {
  onStart?: OnViewportChange;   // OnViewportChange = (viewport: Viewport) => void
  onChange?: OnViewportChange;
  onEnd?: OnViewportChange;
};
```

Internals: three `useEffect`s push the handlers into the store via `useStoreApi().setState({ onViewportChangeStart / onViewportChange / onViewportChangeEnd })`. It registers, it does not subscribe — your component does not re-render on pan/zoom; instead your callbacks fire. Equivalent to the `onViewportChange*` props on `<ReactFlow>` but usable from a deep child.

### `useOnSelectionChange`

```ts
// hooks/useOnSelectionChange.ts
function useOnSelectionChange<NodeType extends Node = Node, EdgeType extends Edge = Edge>(
  options: UseOnSelectionChangeOptions<NodeType, EdgeType>
): void
type UseOnSelectionChangeOptions<...> = { onChange: OnSelectionChangeFunc<NodeType, EdgeType> };
// onChange receives ({ nodes, edges })
```

Internals: a `useEffect` **appends** `onChange` to `state.onSelectionChangeHandlers` (an array — multiple subscribers coexist) and removes it on cleanup by filtering out that exact function reference. **You must memoize `onChange`** (`useCallback`) — the source `@remarks` explicitly warns that an unstable handler breaks the hook (it would re-register every render). Fires whenever node *or* edge selection changes.

### `useNodeId`

```ts
// contexts/NodeIdContext.ts
const useNodeId: () => string | null
```

`useContext(NodeIdContext)`. Inside a custom node's render tree, React Flow provides the node's id through `NodeIdContext`; this hook reads it so deeply-nested components don't have to prop-drill the id. Returns `null` outside a node. It's also what `useNodeConnections` / `useHandleConnections` use to auto-fill the node id.

---

## Prototyping state hooks (no store)

### `useNodesState` / `useEdgesState`

```ts
// hooks/useNodesEdgesState.ts
function useNodesState<NodeType extends Node>(initialNodes: NodeType[]): [
  nodes: NodeType[],
  setNodes: Dispatch<SetStateAction<NodeType[]>>,
  onNodesChange: OnNodesChange<NodeType>
];

function useEdgesState<EdgeType extends Edge = Edge>(initialEdges: EdgeType[]): [
  edges: EdgeType[],
  setEdges: Dispatch<SetStateAction<EdgeType[]>>,
  onEdgesChange: OnEdgesChange<EdgeType>
];
```

These are **not** connected to the store at all — they are plain `useState` + a memoized `onNodesChange`/`onEdgesChange` callback that applies incoming changes with `applyNodeChanges(changes, nds)` / `applyEdgeChanges(changes, eds)`. They give you a controlled flow with three lines:

```tsx
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
<ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} />
```

Source `@remarks`: built for prototyping/docs clarity; "OK to use in production," but a real app often wants a proper store (Zustand) instead. The strudel-flow app, for instance, drives nodes/edges from its own Zustand store rather than these hooks.

---

## Experimental middleware hooks

### `experimental_useOnNodesChangeMiddleware` / `experimental_useOnEdgesChangeMiddleware`

```ts
// hooks/useOnNodesChangeMiddleware.ts / useOnEdgesChangeMiddleware.ts
function experimental_useOnNodesChangeMiddleware<NodeType extends Node = Node>(
  fn: (changes: NodeChange<NodeType>[]) => NodeChange<NodeType>[]
): void

function experimental_useOnEdgesChangeMiddleware<EdgeType extends Edge = Edge>(
  fn: (changes: EdgeChange<EdgeType>[]) => EdgeChange<EdgeType>[]
): void
```

Internals: each generates a stable `Symbol()` (`useState(() => Symbol())`) as a key, registers `fn` into `state.onNodesChangeMiddlewareMap` / `onEdgesChangeMiddlewareMap` in a `useEffect([fn])`, and deletes that key on unmount. The middleware **transforms the change array** before it's applied — letting you veto, rewrite, or augment changes globally (e.g. snap, clamp, or block deletions). **Memoize `fn`** (the doc comment says so) or it re-registers every render. Experimental: the `experimental_` prefix signals the API may change.

---

## Cross-cutting notes

- **Provider requirement.** Every store-backed hook (all except `useNodesState`/`useEdgesState`/`useKeyPress`/`useNodeId`) throws `error001` if not under a `<ReactFlowProvider>` or `<ReactFlow>`. `useNodeId` returns `null` outside a node rather than throwing.
- **Equality fn is the perf lever.** `shallow` for arrays/objects; specialized `shallowNodeData` / `areConnectionMapsEqual` for the data/connection hooks; `Object.is` (default) for scalars like `useNodesInitialized`. If a hook re-renders too often, drop to a narrower `useStore` selector.
- **Subscribe vs. read.** Hooks built on `useStore` subscribe (re-render). Hooks built on `useStoreApi` (`useReactFlow`, `useUpdateNodeInternals`, `useOnViewportChange`, `useOnSelectionChange`, middleware) read/register without subscribing.
- **Writes are batched.** `useReactFlow`'s `setNodes`/`addNodes`/`updateNode*`/`fitView` enqueue work through `BatchProvider`; don't expect a synchronous read-after-write.
- **Svelte parity.** SvelteFlow ships analogues (`useSvelteFlow`, `useStore`, `useNodes`, `useEdges`, `useConnection`, `useNodeConnections`, `useNodesData`, `useInternalNode`, `useNodesInitialized`, `useUpdateNodeInternals`, `useOnSelectionChange`) under `web/sites/svelteflow.dev/.../api-reference/hooks/`, but Svelte has no `useNodesState`/`useEdgesState`/`useKeyPress`/`useReactFlow` (it uses `useSvelteFlow`).

## Sources

- `xyflow/packages/react/src/index.ts` — public hook export list.
- `xyflow/packages/react/src/hooks/{useStore, useReactFlow, useNodes, useEdges, useNodesEdgesState, useViewport, useUpdateNodeInternals, useNodesData, useNodeConnections, useHandleConnections, useNodesInitialized, useConnection, useInternalNode, useKeyPress, useOnViewportChange, useOnSelectionChange, useViewportHelper, useOnNodesChangeMiddleware, useOnEdgesChangeMiddleware}.ts`.
- `xyflow/packages/react/src/contexts/NodeIdContext.ts` — `useNodeId`.
- `xyflow/packages/react/src/types/instance.ts` — `GeneralHelpers`, `ReactFlowInstance`; `react/src/types/general.ts` — `ViewportHelperFunctions`.
- `xyflow/packages/system/src/types/general.ts` — `UseNodeConnectionsParams`, `NodeConnection`, `HandleConnection`, `ConnectionState`, `ConnectionInProgress`, `NoConnection`; `system/src/types/nodes.ts` — `InternalNodeBase`.
- `web/sites/reactflow.dev/src/content/api-reference/hooks/*.mdx` — official docs.
