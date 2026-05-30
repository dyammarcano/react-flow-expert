# State Management & the Store

## What this covers

How React Flow keeps node/edge state: the **controlled vs uncontrolled** models, the **change system** (`NodeChange`/`EdgeChange` unions + the exact `applyNodeChanges`/`applyEdgeChanges` reducer), the **Zustand store** shape and its action layer, the convenience hooks (`useNodesState`/`useEdgesState`), how `useStore(selector, equalityFn)` enables selective subscriptions, why `nodeTypes`/`edgeTypes` must be stable references, and how updates are batched — all traced to real source in `@xyflow/react@12.10.2` and `@xyflow/system@0.0.76`.

> **One load-bearing sentence:** React Flow never mutates your node/edge arrays directly — every internal interaction (drag, select, resize, add, remove) is emitted as a *declarative `NodeChange`/`EdgeChange` object*, and it is your job (or the `useNodesState`/`hasDefaultNodes` machinery) to fold those changes back into state with `applyNodeChanges`/`applyEdgeChanges`, while an internal Zustand store separately maintains a normalized, measured "internal" mirror (`nodeLookup`/`edgeLookup`) that components subscribe to via selectors.

---

## 1. The mental model: two parallel representations

React Flow keeps **two** representations of your graph at all times:

| Representation | What it is | Where it lives | Source |
|---|---|---|---|
| **User array** | The plain `Node[]` / `Edge[]` you pass in (or hold in your own state) | `store.nodes`, `store.edges` | `store/initialState.ts` |
| **Internal lookup** | A normalized `Map<id, InternalNode>` with measured dimensions, absolute positions, z-index, parent relationships | `store.nodeLookup`, `store.edgeLookup`, `store.parentLookup`, `store.connectionLookup` | `store/initialState.ts:48-51` |

The bridge between them is `adoptUserNodes(...)` (from `@xyflow/system`), called whenever `setNodes` runs — it walks the user array and *extends* each node with internal fields, writing the result into `nodeLookup` (`store/index.ts:setNodes`). This is why your node objects stay clean (`{ id, position, data }`) while React Flow still has measured geometry to render edges and run hit-testing.

The critical consequence: **you never write to `nodeLookup` yourself.** You write the user array; React Flow re-derives internals. Conversely, hooks like `useNodesData` read straight from `nodeLookup` because that's where measured/internal data is authoritative.

---

## 2. Controlled vs uncontrolled

There are exactly two supported modes, decided by **which props you pass** to `<ReactFlow>`. The store records this with two booleans set at init time:

```ts
// store/initialState.ts:97-98
hasDefaultNodes: defaultNodes !== undefined,
hasDefaultEdges: defaultEdges !== undefined,
```

### 2a. Controlled (recommended for production)

You pass `nodes` + `onNodesChange` (and `edges` + `onEdgesChange`). **You own the array.** React Flow emits changes; you apply them; you pass the new array back down.

```tsx
const [nodes, setNodes] = useState(initialNodes);
const [edges, setEdges] = useState(initialEdges);

const onNodesChange = useCallback(
  (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
  [],
);
const onEdgesChange = useCallback(
  (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
  [],
);

<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
/>;
```

Here `hasDefaultNodes === false`. When React Flow produces changes it calls `onNodesChange?.(changes)` **only** — it does *not* update its own `nodes` (see `triggerNodeChanges`, `store/index.ts:264-279`). The new array reaches the store on the next render via the `StoreUpdater` effect (Section 7). If you forget to wire `onNodesChange`, nodes appear frozen (no drag/select) because the changes go nowhere.

### 2b. Uncontrolled

You pass `defaultNodes` / `defaultEdges`. React Flow takes ownership of the array internally; you manipulate it imperatively via the instance (`useReactFlow().setNodes`, `addNodes`, etc.).

```tsx
<ReactFlow defaultNodes={initialNodes} defaultEdges={initialEdges} />
```

Now `hasDefaultNodes === true`. In `triggerNodeChanges` the store *applies the changes for you* before firing your optional callback:

```ts
// store/index.ts:264-279
triggerNodeChanges: (changes) => {
  const { onNodesChange, setNodes, nodes, hasDefaultNodes, debug } = get();
  if (changes?.length) {
    if (hasDefaultNodes) {
      const updatedNodes = applyNodeChanges(changes, nodes); // <-- store applies
      setNodes(updatedNodes);
    }
    onNodesChange?.(changes);
  }
},
```

`defaultNodes`/`defaultEdges` are read **once** at construction (`initialState.ts:53-54`: `const storeNodes = defaultNodes ?? nodes ?? []`). Re-rendering with a different `defaultNodes` value does **not** re-seed the store — that's what "they are not dynamic" means in the `ReactFlowProvider` prop docs (`components/ReactFlowProvider/index.tsx:14-17`).

> **Do not mix.** Passing both `nodes` and `defaultNodes` is unsupported; the controlled path silently shadows the default because `setDefaultNodesAndEdges` only runs once on mount (`StoreUpdater/index.tsx:128-136`) while controlled `nodes` are re-synced on every render.

---

## 3. The change system — the heart of state management

### 3a. `NodeChange` union (six variants)

From `packages/system/src/types/changes.ts`:

```ts
export type NodeChange<NodeType extends NodeBase = NodeBase> =
  | NodeDimensionChange
  | NodePositionChange
  | NodeSelectionChange
  | NodeRemoveChange
  | NodeAddChange<NodeType>
  | NodeReplaceChange<NodeType>;
```

| Variant | `type` | Key fields | Emitted when | Source |
|---|---|---|---|---|
| `NodeDimensionChange` | `'dimensions'` | `dimensions?`, `resizing?`, `setAttributes?: boolean \| 'width' \| 'height'` | ResizeObserver measures a node, or `NodeResizer` drags | `changes.ts:3-11` |
| `NodePositionChange` | `'position'` | `position?`, `positionAbsolute?`, `dragging?` | Node is dragged | `changes.ts:13-19` |
| `NodeSelectionChange` | `'select'` | `selected: boolean` | Node selected/deselected | `changes.ts:21-25` |
| `NodeRemoveChange` | `'remove'` | (only `id`) | Node deleted (e.g. Backspace) | `changes.ts:27-30` |
| `NodeAddChange` | `'add'` | `item: NodeType`, `index?` | Node added imperatively | `changes.ts:32-36` |
| `NodeReplaceChange` | `'replace'` | `id`, `item: NodeType` | Whole node object swapped | `changes.ts:38-42` |

### 3b. `EdgeChange` union (four variants)

Edges have **no** position/dimension variants — they're derived from their endpoints. Note edges *reuse* the node select/remove change shapes:

```ts
// changes.ts:59-85
export type EdgeSelectionChange = NodeSelectionChange;
export type EdgeRemoveChange = NodeRemoveChange;
export type EdgeChange<EdgeType extends EdgeBase = EdgeBase> =
  | EdgeSelectionChange     // type: 'select'
  | EdgeRemoveChange        // type: 'remove'
  | EdgeAddChange<EdgeType> // type: 'add'
  | EdgeReplaceChange<EdgeType>; // type: 'replace'
```

### 3c. The exact `applyChanges` implementation

`applyNodeChanges`/`applyEdgeChanges` are thin generic wrappers (`react/src/utils/changes.ts:182-225`) around one shared `applyChanges(changes, elements)`. This function is the single most important piece of the state model. Its design goals: **minimal object copying** (so React's referential-equality bailouts work) and **correct ordering** (removes win, adds happen last). Verbatim from `react/src/utils/changes.ts:19-104`:

```ts
function applyChanges(changes: any[], elements: any[]): any[] {
  const updatedElements: any[] = [];
  const changesMap = new Map<any, any[]>();
  const addItemChanges: any[] = [];

  for (const change of changes) {
    if (change.type === 'add') {
      addItemChanges.push(change);
      continue;
    } else if (change.type === 'remove' || change.type === 'replace') {
      // remove/replace overwrite any queued change for that id
      changesMap.set(change.id, [change]);
    } else {
      const elementChanges = changesMap.get(change.id);
      if (elementChanges) {
        elementChanges.push(change); // mutable append — avoids copying
      } else {
        changesMap.set(change.id, [change]);
      }
    }
  }

  for (const element of elements) {
    const changes = changesMap.get(element.id);

    if (!changes) {
      updatedElements.push(element); // unchanged -> SAME reference, no copy
      continue;
    }
    if (changes[0].type === 'remove') {
      continue; // drop it
    }
    if (changes[0].type === 'replace') {
      updatedElements.push({ ...changes[0].item }); // full swap
      continue;
    }

    const updatedElement = { ...element }; // ONE shallow copy
    for (const change of changes) {
      applyChange(change, updatedElement); // mutates the copy
    }
    updatedElements.push(updatedElement);
  }

  // adds happen last so `index` lands correctly in the final array
  if (addItemChanges.length) {
    addItemChanges.forEach((change) => {
      if (change.index !== undefined) {
        updatedElements.splice(change.index, 0, { ...change.item });
      } else {
        updatedElements.push({ ...change.item });
      }
    });
  }

  return updatedElements;
}
```

**Why this matters for performance / correctness:**

1. **Unchanged elements keep their identity.** If an element has no queued change, the *exact same object reference* is pushed (`updatedElements.push(element)`), so `React.memo` on `NodeWrapper` bails out and that node does not re-render.
2. **At most one shallow copy per changed element.** Multiple changes for the same id (e.g. a simultaneous `position` + `dragging`) are folded onto a single `{ ...element }` copy via repeated *mutable* `applyChange` calls.
3. **`remove` is terminal and short-circuiting.** As soon as a `remove` is seen for an id, `changesMap.set(change.id, [change])` discards every other queued change for that id ("it's going to be removed anyway").
4. **`add` is deferred to the end** so a provided `index` slots into the *final* array, not a mid-flight one.

### 3d. `applyChange` — the per-change mutator

The single-change applier (`react/src/utils/changes.ts:107-149`) only handles the *mutating* variants (`select`, `position`, `dimensions`); `add`/`remove`/`replace` are handled structurally in `applyChanges`:

```ts
function applyChange(change: any, element: any): any {
  switch (change.type) {
    case 'select':
      element.selected = change.selected;
      break;
    case 'position':
      if (typeof change.position !== 'undefined') element.position = change.position;
      if (typeof change.dragging !== 'undefined') element.dragging = change.dragging;
      break;
    case 'dimensions':
      if (typeof change.dimensions !== 'undefined') {
        element.measured = { ...change.dimensions };
        if (change.setAttributes) {
          if (change.setAttributes === true || change.setAttributes === 'width')
            element.width = change.dimensions.width;
          if (change.setAttributes === true || change.setAttributes === 'height')
            element.height = change.dimensions.height;
        }
      }
      if (typeof change.resizing === 'boolean') element.resizing = change.resizing;
      break;
  }
}
```

Note the subtlety: a `dimensions` change writes to `element.measured` (the rendered size), and only writes `element.width`/`element.height` when `setAttributes` is set — i.e. measurement does not clobber user-set width/height unless explicitly requested (used by `NodeResizer`).

### 3e. How changes are *produced*: diffing & selection helpers

`changes.ts` also holds the producers React Flow uses internally:

- **`getElementsDiffChanges({ items, lookup })`** (`changes.ts:271-317`): given the *next* user array and the *current* `nodeLookup`/`edgeLookup`, it emits `replace` (object identity differs), `add` (new id, with `index`), and `remove` (id gone from next array) changes. This is how passing a brand-new `nodes` prop in controlled mode gets translated into changes for `onNodesChange` consumers via the batch queue (Section 6).
- **`getSelectionChanges(items, selectedIds, mutateItem)`** (`changes.ts:235-260`): diffs current `selected` flags against a target set, optionally *mutating* the internal item immediately (the `mutateItem` hack used during drag so only one node is selected at a time — see the inline comment at `changes.ts:248-252`).
- **`createSelectionChange(id, selected)`** / **`elementToRemoveChange(item)`**: tiny constructors (`changes.ts:227-233`, `319-324`).

---

## 4. The Zustand store

### 4a. How it's created

The store is a Zustand store created with `createWithEqualityFn` from `zustand/traditional`, with a default equality of `Object.is`:

```ts
// store/index.ts:55, 452
createWithEqualityFn<ReactFlowState>((set, get) => { ... }, Object.is);
```

One store instance is created **per flow**, memoized in `ReactFlowProvider` so it survives re-renders:

```ts
// components/ReactFlowProvider/index.tsx:104-120
const [store] = useState(() => createStore({ nodes, edges, defaultNodes, defaultEdges, ... }));
```

It is published through React context (`contexts/StoreContext.ts`) and wrapped in `<BatchProvider>` (Section 6). `<ReactFlow>`'s `Wrapper` only mounts a new provider if one isn't already present (`container/ReactFlow/Wrapper.tsx:39-47`) — this is why nesting `<ReactFlowProvider>` yourself lets sibling components (sidebars, toolbars) share the same store.

### 4b. The store shape — `ReactFlowState = ReactFlowStore & ReactFlowActions`

`ReactFlowState` (the type returned by `useStore`'s selector) is the **state** (`ReactFlowStore`) merged with the **action** methods (`ReactFlowActions`), both from `react/src/types/store.ts`. Key state fields:

| Field | Type | Role | Default |
|---|---|---|---|
| `nodes` | `NodeType[]` | The user node array (the controlled value) | `[]` |
| `edges` | `EdgeType[]` | The user edge array | `[]` |
| `nodeLookup` | `NodeLookup<InternalNode>` | Normalized, **measured** internal node map | `new Map()` |
| `edgeLookup` | `EdgeLookup` | Internal edge map | `new Map()` |
| `parentLookup` | `ParentLookup` | child→parent relationships for sub-flows | `new Map()` |
| `connectionLookup` | `ConnectionLookup` | handle→edges index for fast connection lookups | `new Map()` |
| `nodesInitialized` | `boolean` | true once every node has been measured | `false` |
| `transform` | `Transform` `[x,y,zoom]` | viewport pan/zoom | `[0,0,1]` |
| `hasDefaultNodes` / `hasDefaultEdges` | `boolean` | uncontrolled mode flags | from props |
| `onNodesChange` / `onEdgesChange` | `OnNodesChange \| null` | user callbacks | `null` |
| `width` / `height` | `number` | measured pane size | `0` |
| `minZoom` / `maxZoom` | `number` | zoom bounds | `0.5` / `2` |
| `nodeOrigin` | `NodeOrigin` | `[0,0]`..`[1,1]` anchor | `[0,0]` |
| `nodeExtent` | `CoordinateExtent` | placement bounds | `infiniteExtent` |
| `elevateNodesOnSelect` | `boolean` | bump z-index of selected nodes | `true` |
| `multiSelectionActive` | `boolean` | shift/meta held | `false` |
| `connection` | `ConnectionState` | in-progress connection | `initialConnection` |
| `fitViewQueued` | `boolean` | a fitView is pending next measure | `fitView ?? false` |
| `panZoom` | `PanZoomInstance \| null` | the d3-zoom wrapper | `null` |
| `onNodesChangeMiddlewareMap` | `Map<symbol, fn>` | change-transforming middlewares | `new Map()` |

Full field list: `initialState.ts:83-156` (values) and `types/store.ts:ReactFlowStore` (types). The action layer (`ReactFlowActions`, `types/store.ts`) includes `setNodes`, `setEdges`, `triggerNodeChanges`, `triggerEdgeChanges`, `updateNodePositions`, `updateNodeInternals`, `addSelectedNodes`, `unselectNodesAndEdges`, `setNodeExtent`, `panBy`, `setCenter`, `reset`, etc.

### 4c. Important action internals

**`setNodes`** (`store/index.ts:99-141`) is the funnel for *every* node array replacement. It calls `adoptUserNodes(nodes, nodeLookup, parentLookup, { checkEquality: true, ... })` to rebuild the internal lookup, derives `nodesInitialized` and `hasSelectedNodes`, and — crucially — passes `checkEquality: true` so unchanged internal nodes keep their identity. It also resolves a queued fitView once nodes are initialized.

**`setEdges`** (`store/index.ts:142-148`) rebuilds `connectionLookup`/`edgeLookup` via `updateConnectionLookup` then `set({ edges })`.

**`updateNodePositions`** (`store/index.ts:210-263`) is the drag path: it converts drag items into `position` changes, handles `expandParent`, runs them through `onNodesChangeMiddlewareMap`, then calls `triggerNodeChanges`.

**`updateNodeInternals`** (`store/index.ts:166-209`) is the ResizeObserver path: it re-measures via `updateNodeInternals` (system), recomputes absolute positions with `updateAbsolutePositions`, and emits `dimensions` changes through `triggerNodeChanges`. It always calls `set(...)` (a bare `set({})` in the normal path, line 200; or `set({ fitViewQueued: false, ... })` when a fitView was queued, line 197) to force a re-render so subscribers see new measured data even if no change object was produced — note the inline comment "we always want to trigger useStore calls whenever updateNodeInternals is called".

---

## 5. Selective subscription — `useStore(selector, equalityFn)`

`useStore` (`hooks/useStore.ts:34-45`) is the public escape hatch for reading internal state. It's a thin wrapper over Zustand's `useStoreWithEqualityFn`:

```ts
function useStore<StateSlice = unknown>(
  selector: (state: ReactFlowState) => StateSlice,
  equalityFn?: (a: StateSlice, b: StateSlice) => boolean,
) {
  const store = useContext(StoreContext);
  if (store === null) throw new Error(zustandErrorMessage); // error001
  return useZustandStore(store, selector, equalityFn);
}
```

**How it avoids re-renders:** the component re-renders only when `selector(state)` produces a value that fails `equalityFn` against the previous one. With the default `Object.is`, returning a *new object/array* every call (e.g. `(s) => ({ a: s.a, b: s.b })`) re-renders on every store change — a classic footgun. The fix is to pass `zustand/shallow` as `equalityFn`, which is exactly what the built-in hooks do.

`useStoreApi` (`hooks/useStore.ts:60-77`) returns `{ getState, setState, subscribe }` for imperative, *non-reactive* reads — used heavily internally (e.g. `BatchProvider` reads `store.getState()` instead of subscribing).

### Real selective-subscription patterns from source

```ts
// useNodes: subscribe to the whole nodes array with shallow equality
// hooks/useNodes.ts:6, 27-31
const nodesSelector = (state: ReactFlowState) => state.nodes;
export function useNodes() {
  return useStore(nodesSelector, shallow); // re-renders when any node changes
}
```

```ts
// useNodesData: subscribe to ONLY {id,type,data} of specific nodes.
// Reads from nodeLookup, uses shallowNodeData equality so it ignores
// position/selection churn entirely. hooks/useNodesData.ts:34-58
const nodesData = useStore(
  useCallback((s) => {
    const data = [];
    for (const nodeId of _nodeIds) {
      const node = s.nodeLookup.get(nodeId);
      if (node) data.push({ id: node.id, type: node.type, data: node.data });
    }
    return isArrayOfIds ? data : data[0] ?? null;
  }, [nodeIds]),
  shallowNodeData, // custom equality: only re-render when data actually changes
);
```

This is the canonical performance pattern: **select the narrowest slice + supply the right `equalityFn`.** `useNodesData` won't re-render when a node is dragged because `position` isn't in its selected slice and `shallowNodeData` compares only `id/type/data`.

---

## 6. Batching

React Flow batches imperative array updates (`setNodes`, `addNodes`, `setEdges`, `addEdges` from the instance) through `<BatchProvider>` (`components/BatchProvider/index.tsx`) and a queue (`useQueue.ts`).

**The queue** (`useQueue.ts`) holds pending payloads in a ref and bumps a `BigInt` serial counter on each push to schedule a flush in a **layout effect**:

```ts
// useQueue.ts:22-44
const [serial, setSerial] = useState(BigInt(0));
const [queue] = useState(() => createQueue<T>(() => setSerial((n) => n + BigInt(1))));
useIsomorphicLayoutEffect(() => {
  const queueItems = queue.get();
  if (queueItems.length) {
    runQueue(queueItems);
    queue.reset();
  }
}, [serial]);
```

A `BigInt` serial (rather than a boolean dirty flag) is used deliberately to dodge React 18 automatic-batching collapse (`useQueue.ts` comment referencing xyflow issue #4779) — every push produces a distinct state value so the layout effect always fires.

**The flush** (`nodeQueueHandler`, `BatchProvider/index.tsx:30-77`) reduces all queued payloads (each is either a new array or an updater fn) into a single `next` array, diffs it against `nodeLookup` via `getElementsDiffChanges`, then runs the result through `onNodesChangeMiddlewareMap`. It then runs two *independent* branches (not mutually exclusive): `if (hasDefaultNodes) setNodes(next)` writes the array into the store (uncontrolled), and separately `if (changes.length > 0) onNodesChange?.(changes)` fires the callback (controlled). When there are no changes but a fitView is queued it re-`setNodes` on the next animation frame instead. So N synchronous `setNodes` calls collapse into **one** store update and **one** `onNodesChange`. (The edge path, `edgeQueueHandler` at `index.tsx:81-99`, is simpler: `setEdges(next)` when `hasDefaultEdges`, else `onEdgesChange(getElementsDiffChanges(...))`.)

This is *separate* from how React itself batches `applyNodeChanges` results inside `setNodes` updater functions — that batching is just React's normal state batching.

---

## 7. Syncing controlled props → store: `StoreUpdater`

In controlled mode the store still needs your latest `nodes`/`edges` and dozens of config props. `<StoreUpdater>` (`components/StoreUpdater/index.tsx`) is a render-null component that diffs a fixed list of tracked props (`reactFlowFieldsToTrack`, `index.tsx:15-74`) against a `useRef` of previous values and pushes only the changed ones into the store:

```ts
// StoreUpdater/index.tsx:140-168 (abridged)
useEffect(() => {
  for (const fieldName of fieldsToTrack) {
    const fieldValue = props[fieldName];
    if (fieldValue === previousFields.current[fieldName]) continue;
    if (typeof props[fieldName] === 'undefined') continue;
    if (fieldName === 'nodes') setNodes(fieldValue as Node[]);
    else if (fieldName === 'edges') setEdges(fieldValue as Edge[]);
    else if (fieldName === 'minZoom') setMinZoom(fieldValue as number);
    // ...renamed: fitView -> fitViewQueued, fitViewOptions, ariaLabelConfig...
    else store.setState({ [fieldName]: fieldValue });
  }
  previousFields.current = props;
}, fieldsToTrack.map((fieldName) => props[fieldName]));
```

Implications:

- **`nodes`/`edges` go through `setNodes`/`setEdges`** (so `adoptUserNodes` re-runs), not a raw `setState`. That's why a controlled `nodes` array reaching the store still rebuilds `nodeLookup`.
- **Referential equality is the trigger.** A field is only re-applied when `fieldValue !== previousFields.current[fieldName]`. Passing a *new* `nodes` array each render is expected (cheap diff inside `adoptUserNodes` with `checkEquality: true`), but passing a new **`nodeTypes`** object each render is *not* — see Section 8.
- **Defaults are applied once.** `setDefaultNodesAndEdges(props.defaultNodes, props.defaultEdges)` runs in a mount-only effect; on unmount it calls `reset()` (`index.tsx:128-136`).

---

## 8. Why `nodeTypes` / `edgeTypes` must be stable references

`nodeTypes`/`edgeTypes` are **not** in `StoreUpdater`'s tracked list — they flow straight into `GraphView` and are used to build the actual rendering component map. React Flow ships a dev-only guard that warns when their identity changes between renders. From `container/GraphView/useNodeOrEdgeTypesWarning.ts:18-36`:

```ts
export function useNodeOrEdgeTypesWarning(nodeOrEdgeTypes: any = emptyTypes): any {
  const typesRef = useRef(nodeOrEdgeTypes);
  const store = useStoreApi();
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const usedKeys = new Set([...Object.keys(typesRef.current), ...Object.keys(nodeOrEdgeTypes)]);
      for (const key of usedKeys) {
        if (typesRef.current[key] !== nodeOrEdgeTypes[key]) {
          store.getState().onError?.('002', errorMessages['error002']());
          break;
        }
      }
      typesRef.current = nodeOrEdgeTypes;
    }
  }, [nodeOrEdgeTypes]);
}
```

The emitted message (`packages/system/src/constants.ts:error002`):

> "It looks like you've created a new nodeTypes or edgeTypes object. If this wasn't on purpose please define the nodeTypes/edgeTypes outside of the component or memoize them."

**Why it actually hurts (beyond the warning):** `GraphView` (and the node/edge renderers) derive a wrapped component map keyed by these objects. A new `nodeTypes` identity invalidates that derivation, which can remount every custom node component — destroying their local state and forcing full re-render of the canvas. The fix is mechanical:

```tsx
// GOOD: module-scope constant (stable for app lifetime)
const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

function Flow() {
  return <ReactFlow nodeTypes={nodeTypes} edgeTypes={edgeTypes} ... />;
}

// or, if it must be inside the component:
const nodeTypes = useMemo(() => ({ custom: CustomNode }), []);
```

```tsx
// BAD: new object literal every render -> error002, possible remounts
<ReactFlow nodeTypes={{ custom: CustomNode }} />
```

The guard is registered for both maps in `GraphView` (`container/GraphView/index.tsx:109-110`).

---

## 9. Convenience hooks: `useNodesState` / `useEdgesState`

For prototyping, `useNodesState`/`useEdgesState` (`hooks/useNodesEdgesState.ts`) wrap `useState` + `applyNodeChanges` into a `useState`-like tuple with a third `onChange` element:

```ts
// hooks/useNodesEdgesState.ts:51-66
export function useNodesState<NodeType extends Node>(initialNodes: NodeType[]) {
  const [nodes, setNodes] = useState(initialNodes);
  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  return [nodes, setNodes, onNodesChange];
}
// useEdgesState is identical with applyEdgeChanges (lines 115-130)
```

Usage:

```tsx
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
<ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} />;
```

The source itself flags these as prototyping helpers — the JSDoc explicitly recommends a "more sophisticated state management solution like Zustand" for production (`useNodesEdgesState.ts:45-48`).

---

## 10. Production pattern: your own Zustand store (real app)

The official guide (`web/.../learn/advanced-use/state-management.mdx`) and the real **strudel-flow** app both move `nodes`/`edges` and the three handlers into a user-owned Zustand store, then pass them into `<ReactFlow>`. From `strudel-flow/src/store/app-store.ts:40-71`:

```ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';

export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => ({
    nodes: initialNodes,
    edges: initialEdges,

    onNodesChange: async (changes) => {
      set({ nodes: applyNodeChanges(changes, get().nodes) });
    },
    setNodes: (nodes) => set({ nodes }),
    addNode: (node) => set({ nodes: [...get().nodes, node] }),
    removeNode: (nodeId) =>
      set({ nodes: get().nodes.filter((node) => node.id !== nodeId) }),

    setEdges: (edges) => set({ edges }),
    onEdgesChange: (changes) =>
      set({ edges: applyEdgeChanges(changes, get().edges) }),

    onConnect: (connection) => {
      if (connection.source === connection.target) return;
      const { source, target, sourceHandle, targetHandle } = connection;
      set({
        edges: addEdge(
          { id: `${source}-${target}`, source, target, type: 'default',
            ...(sourceHandle ? { sourceHandle } : {}),
            ...(targetHandle ? { targetHandle } : {}) },
          get().edges,
        ),
      });
    },
  })),
);
```

Then in the canvas component you select narrow slices (so node-data edits don't re-render the whole tree):

```tsx
const nodes = useAppStore((s) => s.nodes);
const edges = useAppStore((s) => s.edges);
const onNodesChange = useAppStore((s) => s.onNodesChange);
const onEdgesChange = useAppStore((s) => s.onEdgesChange);
const onConnect = useAppStore((s) => s.onConnect);
```

Note `onConnect` uses `addEdge(edgeParams, edges)` from `@xyflow/react` (re-exported from `@xyflow/system/src/utils/edges/general.ts:addEdge`), which de-dupes and inserts a new edge — the edge analogue of an `'add'` change.

> This is the same controlled flow as Section 2a; the only difference is your array lives in Zustand instead of `useState`. React Flow's own internal store (Section 4) is *separate* and still mirrors these into `nodeLookup`/`edgeLookup`.

---

## 11. Practical guidance & gotchas

- **Always memoize/hoist `nodeTypes`, `edgeTypes`, and `defaultEdgeOptions`.** New identities trigger `error002` and can remount custom nodes.
- **Controlled mode requires `onNodesChange`/`onEdgesChange`.** Without them, drag/select/remove are silently dropped (changes reach `triggerNodeChanges`, which only calls the missing callback).
- **`defaultNodes`/`defaultEdges` are read once.** Don't expect re-renders with new defaults to reset the graph; use the controlled `nodes` prop or imperative `setNodes` for that.
- **Read internal/measured data from `nodeLookup`, not `nodes`.** `nodes[i].measured` is only present after measurement; `useNodesData`/`useInternalNode` read the authoritative lookup.
- **Subscribe narrowly.** Prefer `useNodesData`/`useStore(selector, shallow)` over `useNodes()` (which re-renders on *any* node change). Always pair object/array selectors with `zustand/shallow` or a custom equality.
- **Don't mutate node/edge objects in place.** `applyChanges` relies on referential equality to skip re-renders; mutating the array you passed in breaks React's bailouts and React Flow's diffing.
- **Order in a single change batch:** removes are terminal and win over other changes for the same id; adds are applied last (honoring `index`).

---

## Source index (all relative to repo roots)

**xyflow (`@xyflow/react@12.10.2`, `@xyflow/system@0.0.76`)**
- `packages/system/src/types/changes.ts` — `NodeChange`/`EdgeChange` unions + all variant types
- `packages/react/src/utils/changes.ts` — `applyChanges`, `applyChange`, `applyNodeChanges`, `applyEdgeChanges`, `getElementsDiffChanges`, `getSelectionChanges`, `createSelectionChange`
- `packages/react/src/store/index.ts` — `createStore`, `setNodes`, `setEdges`, `triggerNodeChanges`, `triggerEdgeChanges`, `updateNodePositions`, `updateNodeInternals`, `reset`
- `packages/react/src/store/initialState.ts` — `getInitialState`, full default store shape, `hasDefaultNodes`/`hasDefaultEdges`
- `packages/react/src/types/store.ts` — `ReactFlowStore`, `ReactFlowActions`, `ReactFlowState`
- `packages/react/src/hooks/useStore.ts` — `useStore`, `useStoreApi`
- `packages/react/src/hooks/useNodesEdgesState.ts` — `useNodesState`, `useEdgesState`
- `packages/react/src/hooks/useNodes.ts`, `useNodesData.ts` — selective subscription examples
- `packages/react/src/components/StoreUpdater/index.tsx` — controlled-prop → store sync, `reactFlowFieldsToTrack`
- `packages/react/src/components/BatchProvider/index.tsx`, `BatchProvider/useQueue.ts` — batching queue
- `packages/react/src/components/ReactFlowProvider/index.tsx`, `container/ReactFlow/Wrapper.tsx`, `contexts/StoreContext.ts` — store provision
- `packages/react/src/container/GraphView/useNodeOrEdgeTypesWarning.ts`, `container/GraphView/index.tsx` — `nodeTypes`/`edgeTypes` stability guard
- `packages/system/src/constants.ts` — `errorMessages.error001`/`error002`
- `packages/system/src/utils/edges/general.ts` — `addEdge`

**web docs**
- `sites/reactflow.dev/src/content/learn/advanced-use/state-management.mdx` — Zustand guide
- `sites/reactflow.dev/src/content/learn/advanced-use/uncontrolled-flow.mdx` — uncontrolled mode

**strudel-flow (real app, `@xyflow/react@^12.10.2`)**
- `src/store/app-store.ts` — production Zustand store wiring `onNodesChange`/`onEdgesChange`/`onConnect` with `applyNodeChanges`/`applyEdgeChanges`/`addEdge`
