## What this covers

React Flow's complete error/warning code system (`error001`–`error015`), every classic pitfall that triggers them (inline `nodeTypes`/`edgeTypes`, missing `updateNodeInternals`, unmeasured containers, hooks outside `<ReactFlowProvider>`, controlled/uncontrolled mixing, `fitView` timing, duplicate/missing edge ids), and the performance patterns the library and its real consumers actually use — all traced to exact source in `@xyflow/react@12.10.2`, `@xyflow/system@0.0.76`, and `@xyflow/svelte@1.5.2`.

> Versions pinned from source: `xyflow/packages/react/package.json` → `12.10.2`, `xyflow/packages/system/package.json` → `0.0.76`, `xyflow/packages/svelte/package.json` → `1.5.2`. `strudel-flow` consumes `@xyflow/react` v12.

---

## 1. The error system: how it actually works

### 1.1 Central registry

Every message in the codebase lives in **one** object, keyed `error001`…`error015` (note: there is **no `error016`+`** and `error008` is declared out of numeric order in source, after `error009`). Each entry is a **function**, not a string — some take parameters that get interpolated into the message.

Source: `packages/system/src/constants.ts:errorMessages`

```ts
export const errorMessages = {
  error001: () =>
    '[React Flow]: Seems like you have not used zustand provider as an ancestor. Help: https://reactflow.dev/error#001',
  error002: () =>
    "It looks like you've created a new nodeTypes or edgeTypes object. If this wasn't on purpose please define the nodeTypes/edgeTypes outside of the component or memoize them.",
  error003: (nodeType: string) => `Node type "${nodeType}" not found. Using fallback type "default".`,
  error004: () => 'The React Flow parent container needs a width and a height to render the graph.',
  error005: () => 'Only child nodes can use a parent extent.',
  error006: () => "Can't create edge. An edge needs a source and a target.",
  error007: (id: string) => `The old edge with id=${id} does not exist.`,
  error009: (type: string) => `Marker type "${type}" doesn't exist.`,
  error008: (handleType, { id, sourceHandle, targetHandle }) =>
    `Couldn't create edge for ${handleType} handle id: "${handleType === 'source' ? sourceHandle : targetHandle}", edge id: ${id}.`,
  error010: () => 'Handle: No node id found. Make sure to only use a Handle inside a custom Node.',
  error011: (edgeType: string) => `Edge type "${edgeType}" not found. Using fallback type "default".`,
  error012: (id: string) =>
    `Node with id "${id}" does not exist, it may have been removed. This can happen when a node is deleted before the "onNodeClick" handler is called.`,
  error013: (lib: string = 'react') =>
    `It seems that you haven't loaded the styles. Please import '@xyflow/${lib}/dist/style.css' or base.css to make sure everything is working properly.`,
  error014: () =>
    'useNodeConnections: No node ID found. Call useNodeConnections inside a custom Node or provide a node ID.',
  error015: () =>
    'It seems that you are trying to drag a node that is not initialized. Please use onNodesChange as explained in the docs.',
};
```

### 1.2 Two dispatch mechanisms

A code can surface two different ways depending on where it lives.

**(a) The `onError` callback** — used everywhere inside the React render tree and the system package. Signature (`packages/system/src/types/general.ts:299`):

```ts
export type OnError = (id: string, message: string) => void;
```

It's invoked as `onError?.('003', errorMessages['error003'](nodeType))` — the first arg is the **bare 3-char id** (`'003'`), the second is the formatted message. You pass it via the `<ReactFlow onError={...}>` prop; if unset, the call is a no-op (`?.`). React Flow does **not** `console.warn` these itself when `onError` is provided — providing `onError` *replaces* the default logging, so wire up your own logging if you override it.

**(b) `devWarn`** — used by the framework-agnostic edge utilities (`addEdge`, `reconnectEdge`) that have no store/`onError` in scope. Source `packages/system/src/utils/general.ts:146`:

```ts
export const devWarn = (id: string, message: string) => {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[React Flow]: ${message} Help: https://reactflow.dev/error#${id}`);
  }
};
```

So every code maps to a help URL `https://reactflow.dev/error#<id>` (e.g. `#001`, `#006`). `error001` is the only message that bakes the URL into its text directly (it's thrown, not routed through `devWarn`).

**(c) Hard throws** — `error001` and `error014` are `throw new Error(...)`, not warnings. They crash the component.

### 1.3 Complete code → cause → fix table

| Code | Severity | Emitted from (source) | Cause | Fix |
|------|----------|------------------------|-------|-----|
| **001** | **throw** | `react/src/hooks/useStore.ts` (`useStore`, `useStoreApi`) | `StoreContext` is `null` — a hook that reads internal state ran outside any `<ReactFlow>`/`<ReactFlowProvider>`. Also fires when **two copies of `@xyflow/react`** are installed (two contexts). | Wrap in `<ReactFlowProvider>` and move state-reading into a **child** component; dedupe the package version. |
| **002** | warn | `react/src/container/GraphView/useNodeOrEdgeTypesWarning.ts:28` | `nodeTypes`/`edgeTypes` object identity changed between renders. | Define the object at **module scope** or `useMemo(() => ({...}), [])`. |
| **003** | warn → fallback | `react/src/components/NodeWrapper/index.tsx:59`; svelte `NodeWrapper.svelte:110` | `node.type` has no matching key in `nodeTypes`. Falls back to `'default'`. | Make `node.type` exactly match a `nodeTypes` key. |
| **004** | warn | `react/src/hooks/useResizeHandler.ts:22` | Measured container width or height is `0`. | Give the `<ReactFlow>` parent an explicit `width`/`height` (CSS). |
| **005** | warn | `system/src/utils/graph.ts:417` | A node uses `extent: 'parent'` but has no `parentId`. | Only set `extent: 'parent'` on nodes that have a `parentId`. |
| **006** | warn (`devWarn`) | `system/src/utils/edges/general.ts:140` (`addEdge`), `:209` (`reconnectEdge`) | An edge/connection is missing `source` or `target`. | Ensure both ids are set before `addEdge`/`reconnectEdge`. |
| **007** | warn (`devWarn`) | `system/src/utils/edges/general.ts:217` (`reconnectEdge`) | The `oldEdge` id passed to `reconnectEdge` isn't in the array. | Pass the actual existing edge object. |
| **008** | warn | `system/src/utils/edges/positions.ts:49` | Edge references a `sourceHandle`/`targetHandle` whose bounds can't be resolved. | Verify the handle `id` exists on the node and is registered. |
| **009** | warn | `react/src/container/EdgeRenderer/MarkerSymbols.tsx:55` | An edge `markerStart`/`markerEnd` uses a `MarkerType` that doesn't exist. | Use `MarkerType.Arrow` / `MarkerType.ArrowClosed`. |
| **010** | warn | `react/src/components/Handle/index.tsx:99` | `<Handle>` rendered with no node id in context — used outside a custom node. | Only render `<Handle>` inside a custom node component. |
| **011** | warn → fallback | `react/src/components/EdgeWrapper/index.tsx:47` | `edge.type` has no matching key in `edgeTypes`. Falls back to `'default'`. | Make `edge.type` match an `edgeTypes` key. |
| **012** | warn | `react/src/components/Nodes/utils.ts:31`; svelte store `index.ts:281,301` | A node was deleted before its `onNodeClick`/selection handler ran. | Guard handlers; treat as benign race. |
| **013** | warn | `react/src/container/GraphView/useStylesLoadedWarning.ts:16` | The base stylesheet isn't loaded (detected via `.react-flow__pane` `z-index !== 1`). | `import '@xyflow/react/dist/style.css'` (or `base.css`). |
| **014** | **throw** | `react/src/hooks/useNodeConnections.ts` | `useNodeConnections` called with no node id and outside a custom node. | Call it inside a custom node, or pass `{ id }`. |
| **015** | warn | `system/src/utils/graph.ts:441` | Dragging a node whose `measured.width`/`height` is still `undefined` (not yet measured). | Use `onNodesChange`/controlled flow so dimensions get applied. |

---

## 2. The classic pitfalls — root cause in source

### 2.1 Recreating `nodeTypes`/`edgeTypes` inline (error002)

This is the single most common React Flow performance bug. The detection is deliberately a **dev-only** identity check, not a deep comparison.

Source `packages/react/src/container/GraphView/useNodeOrEdgeTypesWarning.ts`:

```ts
const typesRef = useRef(nodeOrEdgeTypes);
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    const usedKeys = new Set([...Object.keys(typesRef.current), ...Object.keys(nodeOrEdgeTypes)]);
    for (const key of usedKeys) {
      if (typesRef.current[key] !== nodeOrEdgeTypes[key]) {     // referential !==
        store.getState().onError?.('002', errorMessages['error002']());
        break;
      }
    }
    typesRef.current = nodeOrEdgeTypes;
  }
}, [nodeOrEdgeTypes]);
```

Because the check is **referential** (`!==`), a fresh object literal each render trips it even if the contents are identical. The fix the docs prescribe (`web/.../troubleshooting/common-errors.mdx`):

```jsx
// ❌ new object every render → re-renders the whole flow
function Flow() {
  const nodeTypes = { myCustomNode: MyCustomNode };
  return <ReactFlow nodeTypes={nodeTypes} />;
}

// ✅ module scope — stable identity forever
const nodeTypes = { myCustomNode: MyCustomNode };
function Flow() { return <ReactFlow nodeTypes={nodeTypes} />; }

// ✅ or useMemo when types must be dynamic
const nodeTypes = useMemo(() => ({ myCustomNode: MyCustomNode }), []);
```

`strudel-flow` does this correctly for nodes — `nodeTypes` is exported once from `src/components/nodes/index.tsx` (`export const nodeTypes = {...}`) and imported. Note: `strudel-flow/src/components/workflow/index.tsx` defines `edgeTypes` *inside* the component (`const edgeTypes = { default: deleteEdge }`), which is exactly the pattern that trips error002 in dev — a real-world example of the easy mistake.

### 2.2 Forgetting `updateNodeInternals` after adding/moving handles

React Flow caches each node's handle bounds. Add a `<Handle>`, move one, or change `position` **programmatically**, and the cache is stale until you tell it. Source `packages/react/src/hooks/useUpdateNodeInternals.ts`:

```ts
export function useUpdateNodeInternals(): UpdateNodeInternals {
  const store = useStoreApi();
  return useCallback<UpdateNodeInternals>((id) => {
    const { domNode, updateNodeInternals } = store.getState();
    const updateIds = Array.isArray(id) ? id : [id];
    const updates = new Map<string, InternalNodeUpdate>();
    updateIds.forEach((updateId) => {
      const nodeElement = domNode?.querySelector(`.react-flow__node[data-id="${updateId}"]`) as HTMLDivElement;
      if (nodeElement) updates.set(updateId, { id: updateId, nodeElement, force: true });
    });
    requestAnimationFrame(() => updateNodeInternals(updates, { triggerFitView: false }));
  }, []);
}
```

Key internals: it re-queries the DOM node by `data-id`, sets `force: true`, and schedules the recompute inside a `requestAnimationFrame` (so the new handle DOM has painted). Without it, edges connect to the **old** handle positions or fail to render. Symptom of *not* calling it: edges that look detached, or new handles that won't accept connections.

```jsx
const updateNodeInternals = useUpdateNodeInternals();
const addHandle = useCallback(() => {
  setHandleCount(c => c + 1);
  updateNodeInternals(id);   // ← required after handle count/position changes
}, [id, updateNodeInternals]);
```

### 2.3 Missing parent dimensions (error004)

`useResizeHandler` measures the container and, on a `0×0` box, both warns **and** silently falls back to `500×500`. Source `packages/react/src/hooks/useResizeHandler.ts`:

```ts
const size = getDimensions(domNode.current);
if (size.height === 0 || size.width === 0) {
  store.getState().onError?.('004', errorMessages['error004']());
}
store.setState({ width: size.width || 500, height: size.height || 500 });
```

The fallback is why a flow may "render" but `fitView` and edge math behave wrongly. Fix: give the wrapping element a real height — `strudel-flow` uses a `.reactflow-wrapper` div with CSS dimensions around `<ReactFlow>`.

### 2.4 Hooks outside `<ReactFlowProvider>` (error001 / error014)

`useStore`/`useStoreApi` throw when `StoreContext === null`. Source `packages/react/src/hooks/useStore.ts`:

```ts
function useStore(selector, equalityFn?) {
  const store = useContext(StoreContext);
  if (store === null) throw new Error(zustandErrorMessage);   // error001
  return useZustandStore(store, selector, equalityFn);
}
```

The subtle gotcha (from `common-errors.mdx`): putting `<ReactFlowProvider>` in the **same** component that calls `useReactFlow()` still throws — only **children** of the provider can read state. Hoist the provider one level up:

```jsx
function Flow() {                 // ✅ child of provider — can read state
  const rf = useReactFlow();
  return <ReactFlow />;
}
export default function FlowWithProvider() {
  return <ReactFlowProvider><Flow /></ReactFlowProvider>;
}
```

`useNodeConnections` throws **error014** under the same rule when called with no node id outside a custom node (`packages/react/src/hooks/useNodeConnections.ts`).

### 2.5 Mixing controlled + uncontrolled

React Flow is **controlled** when you pass `nodes`/`edges` + `onNodesChange`/`onEdgesChange`, and **uncontrolled** when you pass `defaultNodes`/`defaultEdges`. Internally `EdgeWrapper` branches on `hasDefaultEdges` (`store.getState().hasDefaultEdges`) to decide whether *it* should `setEdges` on connect (`packages/react/src/components/Handle/index.tsx`, `onConnectExtended`). Mixing them — e.g. passing `nodes` but mutating that same array in place, or passing both `nodes` and `defaultNodes` — produces a flow that won't update or fights itself. Pick one model. Controlled is the norm; `strudel-flow` is fully controlled, driving everything through a Zustand store via `onNodesChange`/`onEdgesChange`/`onConnect`.

### 2.6 `fitView` timing before nodes are measured

`fitView` can only frame nodes that have non-`undefined` `measured.width/height`. Calling it (or rendering with the `fitView` prop) before the first measurement pass leaves nodes at `0×0` to the fitter. The library exposes `useNodesInitialized` (`packages/react/src/hooks/useNodesInitialized.ts`) precisely for this — gate manual fits on it:

```jsx
const nodesInitialized = useNodesInitialized();
const { fitView } = useReactFlow();
useEffect(() => {
  if (nodesInitialized) fitView();
}, [nodesInitialized, fitView]);
```

The `fitView` **prop** on `<ReactFlow>` is already correctly sequenced internally (`strudel-flow` uses `<ReactFlow ... fitView>`); the timing trap only bites when you call `fitView()` imperatively too early. This is the same family as **error015** — dragging an unmeasured node (`graph.ts:441`).

### 2.7 Edges need a unique, deterministic id (error006/007)

`addEdge` refuses to create an edge without `source` and `target`, and **dedupes** by connection identity rather than id. Source `packages/system/src/utils/edges/general.ts`:

```ts
export const addEdge = (edgeParams, edges, options = {}) => {
  if (!edgeParams.source || !edgeParams.target) {
    devWarn('006', errorMessages['error006']());      // error006
    return edges;
  }
  const edgeIdGenerator = options.getEdgeId || getEdgeId;
  let edge = isEdgeBase(edgeParams) ? { ...edgeParams } : { ...edgeParams, id: edgeIdGenerator(edgeParams) };
  if (connectionExists(edge, edges)) return edges;     // dedupe by source/target/handles
  // ...
  return edges.concat(edge);
};
```

The default id generator (`general.ts:101`):

```ts
export const getEdgeId = ({ source, sourceHandle, target, targetHandle }) =>
  `xy-edge__${source}${sourceHandle || ''}-${target}${targetHandle || ''}`;
```

`connectionExists` matches on `source`+`target`+both handles — so **`addEdge` will silently drop a "new" edge that has a different `id` but the same endpoints** (documented in the `addEdge` JSDoc: "won't add a new edge even if the `id` property is different"). If you render two edges with the **same** `id`, React's keying breaks and edges flicker/disappear. `reconnectEdge` additionally warns **error007** when the `oldEdge.id` isn't found, and reuses error006 for missing endpoints.

---

## 3. Performance: the patterns that matter

### 3.1 Memoize components and props

From `web/.../advanced-use/performance.mdx`: custom node/edge components passed to `<ReactFlow>` "should either be memoized using `React.memo` or declared outside the parent component," because a fresh reference each render triggers unnecessary re-renders.

```tsx
const NodeComponent = memo(({ data }) => <div>{data.label}</div>);
```

Same rule for **function** props (`onNodeClick` → `useCallback`) and **object/array** props (`defaultEdgeOptions`, `snapGrid` → `useMemo`). Inline `{...}`/`[...]` literals on `<ReactFlow>` are silent perf killers — only `nodeTypes`/`edgeTypes` get the explicit error002 warning; the rest just re-render quietly.

### 3.2 Selector subscriptions: read the *narrowest* slice

`useStore(selector, equalityFn?)` re-renders whenever the selected slice changes by the equality fn. Two failure modes:

1. **Selecting too much** — `useStore(s => s.nodes)` re-renders on every drag tick. The docs' canonical anti-pattern:

```tsx
// ❌ re-renders on every node change, even unrelated ones
const nodes = useStore((state) => state.nodes);
const selectedNodeIds = nodes.filter(n => n.selected).map(n => n.id);

// ✅ subscribe to a derived/separate field instead
const selectedNodeIds = useStore((state) => state.selectedNodeIds);
```

2. **Returning a fresh object without an equality fn** — a selector returning `{ a, b }` produces a new reference every store update, defeating bail-out. Provide an `equalityFn`. Two real approaches from `strudel-flow`:

```ts
// zoom-slider.tsx — explicit field comparison
const { minZoom, maxZoom } = useStore(
  (state) => ({ minZoom: state.minZoom, maxZoom: state.maxZoom }),
  (a, b) => a.minZoom !== b.minZoom || a.maxZoom !== b.maxZoom,
);

// workflow/index.tsx — useShallow wrapper (zustand/react/shallow)
const { nodes, edges, onNodesChange } = useAppStore(
  useShallow((state) => ({ nodes: state.nodes, edges: state.edges, onNodesChange: state.onNodesChange })),
);
```

`useStore`'s `equalityFn` is wired straight through to Zustand's `useStoreWithEqualityFn` (`useStore.ts`); `shallow`/`useShallow` is the idiomatic default. Note React Flow's own internal selectors (e.g. `Handle`, `NodeWrapper`) pass `shallow` as the second arg.

### 3.3 Render fewer DOM nodes

The performance guide's escalation ladder, all source-backed:

- **Collapse large trees** — toggle `node.hidden` dynamically so off-screen subtrees aren't rendered at all.
- **`onlyRenderVisibleElements`** prop — cull nodes/edges outside the viewport. This is a real `<ReactFlow>` prop wired through `react/src/container/{FlowRenderer,EdgeRenderer,GraphView}/index.tsx` (EdgeRenderer feeds it to `useVisibleEdgeIds(onlyRenderVisibleElements)`); it trades per-frame culling cost for fewer DOM nodes.
- **Simplify styles** — CSS animations, shadows, and gradients on nodes "can significantly impact performance" at scale; reduce them last.

### 3.4 Don't derive expensive values in node bodies

Because nodes re-render on selection/drag, keep per-node render work minimal: precompute in the store, not in `map()` calls inside the component body. The error012 race (`Node with id "..." does not exist`) is itself a symptom of reading stale node refs in handlers — always re-read from `nodeLookup`/`getNode()` inside callbacks rather than closing over a node object.

---

## 4. Quick triage cheat-sheet

| Symptom | Likely code / cause | First thing to check |
|---------|---------------------|----------------------|
| Whole flow re-renders constantly | 002 | Is `nodeTypes`/`edgeTypes` inline? |
| Custom node renders as a plain box | 003 | Does `node.type` match a `nodeTypes` key? |
| Flow invisible / wrong fit | 004 | Does the parent have CSS width+height? |
| App crashes on a hook | 001 / 014 | Is the hook a **child** of `<ReactFlowProvider>`? Duplicate `@xyflow/react`? |
| Edges detached after handle change | (no code) | Did you call `updateNodeInternals`? |
| Unstyled / broken layout | 013 | Imported `@xyflow/react/dist/style.css`? |
| New edge silently doesn't appear | 006 / dedupe | Missing source/target, or duplicate endpoints? |
| Node won't drag, `error015` in console | 015 | Node measured yet? Using `onNodesChange`? |

---

## Source index

- `xyflow/packages/system/src/constants.ts` — `errorMessages` (all 15 codes), `defaultAriaLabelConfig`
- `xyflow/packages/system/src/utils/general.ts:146` — `devWarn`
- `xyflow/packages/system/src/types/general.ts:299` — `OnError`
- `xyflow/packages/system/src/utils/edges/general.ts` — `addEdge`, `reconnectEdge`, `getEdgeId`, `connectionExists` (006/007)
- `xyflow/packages/system/src/utils/edges/positions.ts:49` — `getEdgePosition` (008)
- `xyflow/packages/system/src/utils/graph.ts:417,441` — extent/measure checks (005/015)
- `xyflow/packages/react/src/hooks/useStore.ts` — `useStore`/`useStoreApi` (001)
- `xyflow/packages/react/src/hooks/useResizeHandler.ts:22` — (004)
- `xyflow/packages/react/src/hooks/useNodeConnections.ts` — (014)
- `xyflow/packages/react/src/hooks/useUpdateNodeInternals.ts` — `useUpdateNodeInternals`
- `xyflow/packages/react/src/hooks/useNodesInitialized.ts` — `useNodesInitialized`
- `xyflow/packages/react/src/container/GraphView/useNodeOrEdgeTypesWarning.ts` — (002)
- `xyflow/packages/react/src/container/GraphView/useStylesLoadedWarning.ts:16` — (013)
- `xyflow/packages/react/src/container/EdgeRenderer/MarkerSymbols.tsx:55` — (009)
- `xyflow/packages/react/src/components/{NodeWrapper,EdgeWrapper,Handle,Nodes/utils}` — (003/011/010/012)
- `web/sites/reactflow.dev/src/content/learn/troubleshooting/common-errors.mdx` — error narratives & fixes
- `web/sites/reactflow.dev/src/content/learn/advanced-use/performance.mdx` — memoization, selectors, culling
- `web/sites/reactflow.dev/src/content/api-reference/types/on-error.mdx` — `OnError` prop docs
- `strudel-flow/src/components/{workflow/index.tsx,zoom-slider.tsx,nodes/index.tsx}` — real controlled-flow + selector usage
