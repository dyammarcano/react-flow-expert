## What this covers

Migrating an app from React Flow v11 (`reactflow`) to v12 (`@xyflow/react` 12.10.2, built on `@xyflow/system` 0.0.76) — every breaking change, the real type signatures behind each one, and a concrete copy-paste-able step-by-step checklist, all grounded in the actual v12 source and the official migration guide.

> Pinned versions for this doc: `@xyflow/react` **12.10.2**, `@xyflow/system` **0.0.76**, `@xyflow/svelte` **1.5.2**.
> Source of truth: `reactflow.dev/src/content/learn/troubleshooting/migrate-to-v12.mdx` plus the v12 TypeScript source in `xyflow/packages/react` and `xyflow/packages/system`.

---

## The one-paragraph summary

v12 is the "xyflow" rewrite: the package is renamed (`reactflow` → `@xyflow/react`), the default export is gone (named `import { ReactFlow }`), the CSS import path changes, and a framework-agnostic core (`@xyflow/system`) is now shared between React Flow and Svelte Flow. The single biggest data-model change is that **measured node dimensions moved off `node.width`/`node.height` onto `node.measured.{width,height}`**, freeing `width`/`height` to become *inputs* (inline-style dimensions, enabling SSR). The internal `nodeInternals` store map was renamed to `nodeLookup`, `parentNode` → `parentId`, the whole edge-update API was renamed to "reconnect", several deprecated helpers were deleted, and a "replace" change event replaced the old "reset" event. v11 is **not** dead — it lives on the `v11` branch, is still published as the `reactflow` package, and its docs remain at `v11.reactflow.dev`.

---

## 1. Package rename + import style + CSS path

The npm package `reactflow` was renamed to `@xyflow/react`, and `ReactFlow` is **no longer a default export** — it is a named export. The bundled stylesheet also moved.

Cited: `migrate-to-v12.mdx` §1; `xyflow/packages/react/package.json` (`"name": "@xyflow/react"`, `"version": "12.10.2"`, `exports` entries `"./dist/base.css"` and `"./dist/style.css"`).

```bash
npm uninstall reactflow
npm install @xyflow/react
```

```js
// v11 — default import
import ReactFlow from 'reactflow';
import 'reactflow/dist/style.css';

// v12 — named import + new CSS path
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css'; // full theme
// or, for just the structural/layout rules:
import '@xyflow/react/dist/base.css';
```

In v11 React Flow was split across multiple packages (`reactflow` re-exported `@reactflow/core`, `@reactflow/background`, `@reactflow/controls`, `@reactflow/minimap`, `@reactflow/node-resizer`, `@reactflow/node-toolbar`). In v12 the core is a **single** package: `Background`, `Controls`, `MiniMap`, `NodeResizer`, `NodeToolbar`, `Handle`, `Panel`, etc. all come from `@xyflow/react`.

Real-world confirmation — `strudel-flow/package.json` pins `"@xyflow/react": "^12.10.2"`, and `strudel-flow/src/index.css` imports `@import '@xyflow/react/dist/style.css' layer(base);`.

---

## 2. The headline change: `node.measured` for measured dimensions

This is the change that breaks the most app code. After React Flow measures a node in the DOM, it now writes the result to `node.measured.width` / `node.measured.height` — **not** to `node.width` / `node.height`.

### Why it changed

In v11 the library *overwrote* `node.width`/`node.height` with measured values once the node mounted, which made those fields confusing: you couldn't reliably use them to *request* a size, and it wasn't obvious the library was mutating them. v12 splits the two concerns: `width`/`height` are now optional **inputs** you provide; everything the library computes lives under `measured`. This split is what makes server-side rendering possible (`migrate-to-v12.mdx` "New features §1").

### The real type (copied from source)

`NodeBase` in `xyflow/packages/system/src/types/nodes.ts:NodeBase` carries both the input dimensions and the measured object:

```ts
// xyflow/packages/system/src/types/nodes.ts (NodeBase, abridged)
export type NodeBase<
  NodeData extends Record<string, unknown> = Record<string, unknown>,
  NodeType extends string | undefined = string | undefined
> = {
  id: string;
  position: XYPosition;
  data: NodeData;
  // ...
  width?: number;          // input: fixed inline-style width
  height?: number;         // input: fixed inline-style height
  initialWidth?: number;   // input: SSR hint, used until measured
  initialHeight?: number;  // input: SSR hint, used until measured
  parentId?: string;       // parent node id, used for sub-flows
  origin?: NodeOrigin;
  handles?: NodeHandle[];
  measured?: {             // OUTPUT: written by the library after measuring
    width?: number;
    height?: number;
  };
} & (undefined extends NodeType
  ? { type?: string | undefined }
  : { type: NodeType });   // `type` is required only when NodeType is a literal
```

Note `measured` is optional on `NodeBase` but **required** on the internal node (`InternalNodeBase` in the same file forces `measured: { width?; height? }`), so any node you read out of the store via `nodeLookup` always has a `measured` object.

### Migration

```js
// v11
const w = node.width;
const h = node.height;

// v12
const w = node.measured?.width;
const h = node.measured?.height;
```

This is the line layout libraries care about. If you feed nodes into **dagre** or **elk** to compute a layout, read sizes from `node.measured` (after a first render/measure pass), not from `node`:

```js
dagreGraph.setNode(node.id, {
  width: node.measured?.width ?? 0,
  height: node.measured?.height ?? 0,
});
```

---

## 3. New meaning of `node.width` / `node.height` (and `node.style`)

Because measured values moved to `measured`, the bare `width`/`height` fields were repurposed. In v12 they are **inline styles that fix the node's dimensions** — using them opts that node out of content-based auto-sizing.

Cited: `migrate-to-v12.mdx` §3.

```js
// v11 — you set size via node.style
const nodes = [{
  id: '1', type: 'input', data: { label: 'input node' },
  position: { x: 250, y: 5 },
  style: { width: 180, height: 40 },
}];

// v12 — set size with node.width / node.height directly
const nodes = [{
  id: '1', type: 'input', data: { label: 'input node' },
  position: { x: 250, y: 5 },
  width: 180,
  height: 40,
}];
```

**Gotcha for DB-loaded flows:** if you persist nodes to a database and you were saving the v11 measured `width`/`height` back onto the node, you must **strip those fields before loading into v12** — otherwise every node becomes a fixed, non-dynamic size. Persist `measured` (or nothing) instead. For SSR, provide `initialWidth`/`initialHeight` as a first-paint hint that the library replaces once it measures on the client (see `ssr-ssg-configuration` guide referenced by the migration doc).

---

## 4. No more object mutation — always return a new node/edge

v12 stops supporting in-place mutation of nodes and edges. The `Node` JSDoc in `xyflow/packages/react/src/types/nodes.ts:Node` states it directly: *"Whenever you want to update a certain attribute of a node, you need to create a new node object."*

Cited: `migrate-to-v12.mdx` §4; `xyflow/packages/react/src/types/nodes.ts:Node`.

```js
// v11 — mutate in place (no longer works reliably)
setNodes((nds) => nds.map((node) => { node.hidden = true; return node; }));

// v12 — return a fresh object
setNodes((nds) => nds.map((node) => ({ ...node, hidden: true })));
```

Internally this matters because v12 keeps a stable `nodeLookup` map keyed by id and stores a reference to your original node object in `node.internals.userNode` (`xyflow/packages/system/src/types/nodes.ts:InternalNodeBase`). Reference identity is used as a fast-path "did this change?" check, so mutating in place can silently skip updates.

---

## 5. `onEdgeUpdate*` → `onReconnect*` (the reconnect rename)

The entire "edge update" family was renamed to "reconnect" because the old name was easily confused with data updates. `reconnectEdge` is exported from `xyflow/packages/react/src/index.ts` (the old `updateEdge` helper for reconnection was removed — see §12).

Cited: `migrate-to-v12.mdx` §5; `xyflow/packages/react/src/index.ts` (`reconnectEdge`).

| v11 | v12 |
|-----|-----|
| `updateEdge` (the reconnect helper) | `reconnectEdge` |
| `onEdgeUpdateStart` | `onReconnectStart` |
| `onEdgeUpdate` | `onReconnect` |
| `onEdgeUpdateEnd` | `onReconnectEnd` |
| `edgeUpdaterRadius` | `reconnectRadius` |
| `edge.updatable` | `edge.reconnectable` |
| `edgesUpdatable` (prop) | `edgesReconnectable` |

```jsx
// v11
<ReactFlow onEdgeUpdate={fn} onEdgeUpdateStart={fn} onEdgeUpdateEnd={fn} />
// v12
<ReactFlow onReconnect={fn} onReconnectStart={fn} onReconnectEnd={fn} />
```

> Naming collision to be aware of: v12 *also* introduces a brand-new `updateEdge` function on `useReactFlow` (see §9) for **data** updates. It is unrelated to the old reconnect `updateEdge`. Don't confuse them.

---

## 6. `node.parentNode` → `node.parentId` (subflows)

For subflows, the field that holds the parent's id was renamed from the misleading `parentNode` (it was never a node reference, just an id string) to `parentId`. It is a first-class field on `NodeBase` (`xyflow/packages/system/src/types/nodes.ts:NodeBase` → `parentId?: string`).

Cited: `migrate-to-v12.mdx` §6.

```js
// v11
{ id: 'xyz', position: { x: 0, y: 0 }, type: 'default', data: {}, parentNode: 'abc' }
// v12
{ id: 'xyz', position: { x: 0, y: 0 }, type: 'default', data: {}, parentId: 'abc' }
```

`parentId` is also now exposed on `NodeProps` (see §7) so custom nodes can read it.

---

## 7. Custom node props: `xPos`/`yPos` → `positionAbsoluteX`/`positionAbsoluteY`

The position props passed to your custom node components were renamed and the props object was tightened. The real shape is `NodeProps` in `xyflow/packages/system/src/types/nodes.ts:NodeProps`:

```ts
// xyflow/packages/system/src/types/nodes.ts:NodeProps
export type NodeProps<NodeType extends NodeBase> = Pick<
  NodeType,
  'id' | 'data' | 'width' | 'height' | 'sourcePosition' | 'targetPosition' | 'dragHandle' | 'parentId'
> &
  Required<Pick<NodeType,
    'type' | 'dragging' | 'zIndex' | 'selectable' | 'deletable' | 'selected' | 'draggable'>> & {
    isConnectable: boolean;
    positionAbsoluteX: number; // was xPos
    positionAbsoluteY: number; // was yPos
  };
```

Cited: `migrate-to-v12.mdx` §7 and "More features" (adds `selectable`, `deletable`, `draggable`, `parentId` to `NodeProps`).

```jsx
// v11
function CustomNode({ xPos, yPos }) { /* ... */ }
// v12
function CustomNode({ positionAbsoluteX, positionAbsoluteY }) { /* ... */ }
```

New in v12, you also now get `selectable`, `deletable`, `draggable`, and `parentId` inside `NodeProps`.

---

## 8. Handle CSS class renames

If you style handles based on connection state, three class names changed (`migrate-to-v12.mdx` §8):

| v11 class | v12 class |
|-----------|-----------|
| `react-flow__handle-connecting` | `connectingfrom` / `connectingto` |
| `react-flow__handle-valid` | `valid` |

So a selector like `.react-flow__handle-connecting` becomes a selector targeting `.react-flow__handle.connectingfrom` / `.connectingto`, and `.react-flow__handle-valid` becomes `.react-flow__handle.valid`.

---

## 9. `useReactFlow` / store helpers: renames, removals, and new functions

### Removed instance helpers (renamed)

These were already deprecated in late v11 and are **deleted** in v12 (`migrate-to-v12.mdx` §12):

| Removed v11 helper | v12 replacement |
|--------------------|-----------------|
| `project(point)` | `screenToFlowPosition(point)` |
| `getTransformForBounds(...)` | `getViewportForBounds(...)` |
| `getRectOfNodes(nodes)` | `getNodesBounds(nodes, options)` |
| `getMarkerEndId` | (removed, no replacement) |
| `updateEdge` (reconnect helper) | `reconnectEdge` |

`screenToFlowPosition` lives in `xyflow/packages/react/src/hooks/useViewportHelper.ts` (alongside the new `flowToScreenPosition`). strudel-flow uses the v12 API directly: `const { screenToFlowPosition } = useReactFlow();` (`strudel-flow/src/hooks/use-drag-and-drop.ts`, `strudel-flow/src/components/layouts/sidebar-layout/app-sidebar.tsx`).

### New v12 instance helpers (computing flows)

v12 adds data-update helpers to `useReactFlow` (`xyflow/packages/react/src/hooks/useReactFlow.ts` returns `updateNode`, `updateNodeData`, `updateEdge`, `updateEdgeData`):

```ts
// xyflow/packages/react/src/hooks/useReactFlow.ts (return shape, abridged)
updateNode,                                   // (id, nodeUpdate, options?)
updateNodeData: (id, dataUpdate, options = { replace: false }) => { /* ... */ },
updateEdge,
updateEdgeData: (id, dataUpdate, options = { replace: false }) => { /* ... */ },
```

`updateNodeData(id, partial)` shallow-merges into `node.data` by default; pass `{ replace: true }` to overwrite. These pair with the new `useNodesData` hook for the "computing flows" pattern.

---

## 10. `getNodesBounds` signature change

The second parameter changed from a bare `nodeOrigin` value to a `params` object (`migrate-to-v12.mdx` §9). The migration guide calls it an "options object"; in the actual source the parameter is named `params` and its `nodeOrigin` field is what the old positional `nodeOrigin` argument became — i.e. `params.nodeOrigin`, not `options.nodeOrigin`.

```js
// v11
const bounds = getNodesBounds(nodes, nodeOrigin);
// v12
const bounds = getNodesBounds(nodes, { nodeOrigin });
```

### The real v12 signature (copied from source)

`getNodesBounds` lives in `xyflow/packages/system/src/utils/graph.ts:getNodesBounds` (line 195) and is re-exported from `@xyflow/react` via `xyflow/packages/react/src/index.ts:139`. Its JSDoc even notes: *"This function was previously called `getRectOfNodes`"* (`graph.ts:169`).

```ts
// xyflow/packages/system/src/utils/graph.ts:getNodesBounds
export const getNodesBounds = <NodeType extends NodeBase = NodeBase>(
  nodes: (NodeType | InternalNodeBase<NodeType> | string)[],
  params: GetNodesBoundsParams<NodeType> = { nodeOrigin: [0, 0] }
): Rect => { /* ... */ };

// xyflow/packages/system/src/utils/graph.ts:GetNodesBoundsParams (line 151)
export type GetNodesBoundsParams<NodeType extends NodeBase = NodeBase> = {
  /**
   * Origin of the nodes: `[0, 0]` for top-left, `[0.5, 0.5]` for center.
   * @default [0, 0]
   */
  nodeOrigin?: NodeOrigin;
  nodeLookup?: NodeLookup<InternalNodeBase<NodeType>>;
};
```

So the v11→v12 change is precisely **positional `nodeOrigin` → `params.nodeOrigin`** (`GetNodesBoundsParams.nodeOrigin`, defaulting to `[0, 0]`). Note three further v12 details from the source:

- The array can now contain **node ids (`string`) or `InternalNodeBase` nodes**, not just plain nodes (`nodes: (NodeType | InternalNodeBase<NodeType> | string)[]`).
- `params` also accepts an optional **`nodeLookup`**; without it, sub-flow (parent-relative) positions can be wrong, and in development the function `console.warn`s: *"Please use `getNodesBounds` from `useReactFlow`/`useSvelteFlow` hook to ensure correct values for sub flows…"* (`graph.ts:199-203`).
- That is why `useReactFlow().getNodesBounds(nodes)` takes **only** the nodes array and injects `nodeLookup`/`nodeOrigin` from the store for you (`xyflow/packages/react/src/hooks/useReactFlow.ts:276-279` → `getNodesBounds(nodes, { nodeLookup, nodeOrigin })`; instance type at `xyflow/packages/react/src/types/instance.ts:196`). Prefer the hook form when you have sub-flows.

---

## 11. TypeScript: define your own node union, not a data generic

v12 changed how you type nodes. Instead of passing a `NodeData` generic into functions, you define **named node types** and a union, then narrow by `node.type`. The base `Node` type is generic over data **and** a literal type string (`xyflow/packages/react/src/types/nodes.ts:Node` → `NodeBase<NodeData, NodeType>`).

Cited: `migrate-to-v12.mdx` §10.

```ts
import type { Node, OnNodesChange } from '@xyflow/react';

type NumberNode = Node<{ value: number }, 'number'>;
type TextNode   = Node<{ text: string }, 'text'>;
type AppNode    = NumberNode | TextNode;

const nodes: AppNode[] = [
  { id: '1', type: 'number', data: { value: 1 }, position: { x: 100, y: 100 } },
  { id: '2', type: 'text',   data: { text: 'Hello' }, position: { x: 200, y: 200 } },
];

const onNodesChange: OnNodesChange<AppNode> =
  useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
```

Now `if (node.type === 'number')` narrows `node.data` to `{ value: number }`. The same pattern applies to edges via `Edge<DataType, TypeString>`. Hooks like `useNodesData` were upgraded in 12.10.1 so the return type narrows by node type too (`xyflow/packages/react/CHANGELOG.md` 12.10.1, PR #5703).

---

## 12. `nodeInternals` → `nodeLookup` (the store map)

If you read directly from the internal store, the node map was renamed. In v12 the store holds `nodeLookup` (`xyflow/packages/react/src/store/initialState.ts:48` → `const nodeLookup = new Map<string, InternalNode>();`).

Cited: `migrate-to-v12.mdx` §11 and "Internal changes".

```js
// v11
const node = useStore((s) => s.nodeInternals.get(id));
// v12
const node = useStore((s) => s.nodeLookup.get(id));
```

The semantic difference (per the migration doc's "Internal changes"): in v11 `nodeInternals` was a **fresh map object on every change**; in v12 `nodeLookup` is a stable map that is mutated in place — it is *only* useful as a lookup, and you must subscribe to something else (or select the specific node) to detect changes. Values in `nodeLookup` are `InternalNode`s, which add `node.internals` (`positionAbsolute`, `z`, `userNode`, `handleBounds`, `bounds`) on top of your node (`xyflow/packages/system/src/types/nodes.ts:InternalNodeBase`). The store also dropped `connectionNodeId` / `connectionHandleId` / `connectionHandleType` in favor of `connection.fromHandle.{nodeId,id,...}`.

---

## 13. Custom `applyNodeChanges` / `applyEdgeChanges`: handle the new `"replace"` event

v12 removed the internal `"reset"` change event and added a `"replace"` event that swaps a specific node/edge. If you wrote your own change-applier, you must handle `"replace"`.

Cited: `migrate-to-v12.mdx` §13; types in `xyflow/packages/system/src/types/changes.ts`.

```ts
// xyflow/packages/system/src/types/changes.ts
export type NodeReplaceChange<NodeType extends NodeBase = NodeBase> = {
  id: string;
  item: NodeType;
  type: 'replace';
};

export type NodeChange<NodeType extends NodeBase = NodeBase> =
  | NodeDimensionChange
  | NodePositionChange
  | NodeSelectionChange
  | NodeRemoveChange
  | NodeAddChange<NodeType>
  | NodeReplaceChange<NodeType>; // <-- new in v12 (replaces the old "reset")
```

**Confirmed: there is no `"reset"` change type in v12.** Verified against `xyflow/packages/system/src/types/changes.ts:NodeChange` (line 51) — the union has exactly **six** members (the five listed above plus `NodeReplaceChange`), with no `NodeResetChange` and no `type: 'reset'` variant. A full-source search confirms the literal `'reset'` does not appear anywhere in `packages/system/src`, `packages/react/src`, or `packages/svelte/src` as a change type. The `EdgeChange` union (`changes.ts:81`) mirrors this with four members ending in `EdgeReplaceChange` (`changes.ts:67`) — also no `'reset'`. So any v11 code that constructed or matched `{ type: 'reset', ... }` must migrate to the `'replace'` change (`NodeReplaceChange`/`EdgeReplaceChange`, both carrying `id` + `item`).

The built-in `applyNodeChanges` / `applyEdgeChanges` (`xyflow/packages/react/src/utils/changes.ts:182` and `:220`) already handle `'replace'`: the internal `applyChanges` groups `'remove'` and `'replace'` together (`changes.ts:32`), and a leading `'replace'` is special-cased to push a shallow copy of the replacement `item` (`changes.ts:70-73`: `updatedElements.push({ ...changes[0].item })`). If you use the built-ins you get this for free; only hand-rolled appliers need updating. The `'replace'` change itself is produced by the store's diff helper `getElementsDiffChanges` (`changes.ts:300`: `changes.push({ id: item.id, item, type: 'replace' })`), which fires when `setNodes`/`updateNode`/`updateNodeData` push a new-but-same-id object.

---

## 14. Other behavioral changes worth knowing (not always flagged as "breaking")

From `migrate-to-v12.mdx` "More features and updates" / "Internal changes":

- **`nodeDragThreshold` default is now `1`** (was `0`). A pure click no longer starts a drag.
- **`paneClickDistance` default is `1`** (`react/CHANGELOG.md` 12.9.3, PR #5621) — max mousedown→mouseup distance that still counts as a click.
- **New edges created by the library** only carry `sourceHandle` / `targetHandle` when actually set — v11 always emitted `sourceHandle: null` / `targetHandle: null`.
- **`onMove`** now also fires for library-invoked viewport changes (e.g. `fitView`, zoom buttons).
- **`deleteElements`** now returns the deleted nodes and edges.
- `onNodeDragStart` / `onNodeDrag` / `onNodeDragStop` now also fire when dragging a **selection** (in addition to the `onSelectionDrag*` callbacks).
- New `origin` field on nodes; edges gained a `selectable` field; edges get a `data-id` attribute; edges no longer remount when their z-index changes.

### Deprecated-but-still-works in current v12

- **`useHandleConnections` is deprecated** — use `useNodeConnections`. The hook logs `'[DEPRECATED] useHandleConnections is deprecated. Instead use useNodeConnections'` at runtime (`xyflow/packages/react/src/hooks/useHandleConnections.ts:30` `@deprecated`, `:41` warning). The migration guide still mentions `useHandleConnections` as a "new feature", but in 12.10.x you should reach for `useNodeConnections`.

---

## 15. New v12 features you can adopt after migrating

You don't have to use these to migrate, but they're the payoff (`migrate-to-v12.mdx` "New features"):

- **SSR / SSG**: provide `width`/`height`/`handles` (or `initialWidth`/`initialHeight`) so a flow renders on the server and hydrates on the client.
- **Computing flows**: `useNodesData`, `useNodeConnections` (and `updateNode` / `updateNodeData` / `updateEdge` / `updateEdgeData` on `useReactFlow`).
- **Dark mode**: `colorMode="light" | "dark" | "system"` adds a `dark` class and the lib now uses CSS variables you can override in user land.
- **`useConnection` hook** for the in-progress connection; **controlled `viewport`** via `viewport` + `onViewportChange`; **`ViewportPortal`**; combined **`onDelete`** + guarding **`onBeforeDelete`**; **`isValidConnection`** prop; **`autoPanSpeed`**, **`paneClickDistance`**; **`patternClassName`** on `Background`.
- **Framework-agnostic core** `@xyflow/system` now houses `XYDrag`, `XYPanZoom`, and `XYHandle`, shared by React Flow and Svelte Flow.

---

## 16. v11 docs stay online

The migration guide's intro Callout points to the docs for older releases, which remain hosted: **v11.reactflow.dev**, **v10.reactflow.dev**, and **v9.reactflow.dev** (`migrate-to-v12.mdx` intro `<Callout>`, lines 12-15 — the only thing the guide actually states about old versions; it does *not* claim a `v11` branch or continued `reactflow` publishing, so don't assert those from this source). v12 is the actively developed line shipped as `@xyflow/react` (current 12.10.2); the old `reactflow` package name is what the rename in §1 replaces.

---

## 17. Step-by-step migration checklist

1. **Swap the dependency.** `npm uninstall reactflow && npm install @xyflow/react`. (Svelte: `@xyflow/svelte` 1.5.2.)
2. **Fix imports.** Replace `import ReactFlow from 'reactflow'` with `import { ReactFlow } from '@xyflow/react'`. Pull `Background`, `Controls`, `MiniMap`, `Handle`, `NodeResizer`, `NodeToolbar`, `Panel`, hooks, helpers, and types all from `@xyflow/react`. Remove any `@reactflow/*` sub-package imports.
3. **Fix the CSS import.** `reactflow/dist/style.css` → `@xyflow/react/dist/style.css` (or `.../dist/base.css`).
4. **Read measured sizes from `measured`.** Search the codebase for `.width` / `.height` on node objects (layout code, fitting code) and change `node.width`/`node.height` reads to `node.measured?.width`/`node.measured?.height`.
5. **Audit `node.width`/`node.height` writes.** Anywhere you *set* a node's size, decide: dynamic content size → set it via CSS/`style`; fixed size → `node.width`/`node.height`. **Strip persisted v11 measured `width`/`height` from DB-loaded nodes** so they don't become fixed-size.
6. **Stop mutating nodes/edges.** Replace in-place `node.x = …; return node;` patterns with `({ ...node, x })`.
7. **Rename the reconnect API.** `onEdgeUpdate*` → `onReconnect*`, `updateEdge` (reconnect) → `reconnectEdge`, `edgeUpdaterRadius` → `reconnectRadius`, `edgesUpdatable` → `edgesReconnectable`, `edge.updatable` → `edge.reconnectable`.
8. **Rename `parentNode` → `parentId`** on every subflow node.
9. **Rename custom-node props** `xPos`/`yPos` → `positionAbsoluteX`/`positionAbsoluteY`.
10. **Update handle CSS** classes: `react-flow__handle-connecting` → `connectingfrom`/`connectingto`, `react-flow__handle-valid` → `valid`.
11. **Replace removed helpers:** `project` → `screenToFlowPosition`, `getTransformForBounds` → `getViewportForBounds`, `getRectOfNodes` → `getNodesBounds`, and update `getNodesBounds(nodes, nodeOrigin)` → `getNodesBounds(nodes, { nodeOrigin })`. Remove `getMarkerEndId`.
12. **Rename store access** `nodeInternals` → `nodeLookup`; update any `useStore` selectors and remember the map is mutated in place now.
13. **Update custom `applyNodeChanges`/`applyEdgeChanges`** to handle the new `"replace"` change type (and drop any handling of the old `"reset"`). Prefer the built-in appliers if you can.
14. **Re-type nodes/edges** as a union of named `Node<Data, 'type'>` (and `Edge<Data, 'type'>`) and use `useReactFlow<AppNode, AppEdge>()` / `OnNodesChange<AppNode>` for full inference.
15. **Check new defaults:** confirm `nodeDragThreshold` (now `1`) and `paneClickDistance` (now `1`) don't change your click/drag UX; if you relied on `sourceHandle: null`, handle the now-absent field.
16. **(Optional) Replace deprecated hooks:** `useHandleConnections` → `useNodeConnections`.
17. **Type-check and run.** `tsc --noEmit` will surface most renames; then exercise drag, reconnect, subflows, and any layout pass.

---

## Quick reference: v11 → v12 rename map

| Area | v11 | v12 |
|------|-----|-----|
| Package | `reactflow` | `@xyflow/react` |
| Import | `import ReactFlow from 'reactflow'` | `import { ReactFlow } from '@xyflow/react'` |
| CSS | `reactflow/dist/style.css` | `@xyflow/react/dist/style.css` |
| Measured size | `node.width` / `node.height` | `node.measured.width` / `node.measured.height` |
| Fixed size input | `node.style.width/height` | `node.width` / `node.height` |
| Subflow parent | `node.parentNode` | `node.parentId` |
| Custom node pos | `xPos` / `yPos` | `positionAbsoluteX` / `positionAbsoluteY` |
| Reconnect | `onEdgeUpdate*`, `updateEdge`, `edgeUpdaterRadius`, `edge.updatable`, `edgesUpdatable` | `onReconnect*`, `reconnectEdge`, `reconnectRadius`, `edge.reconnectable`, `edgesReconnectable` |
| Store map | `nodeInternals` | `nodeLookup` |
| Coord helper | `project` | `screenToFlowPosition` |
| Bounds helper | `getRectOfNodes` | `getNodesBounds` |
| Viewport helper | `getTransformForBounds` | `getViewportForBounds` |
| Change event | `"reset"` | `"replace"` |
| Handle class | `…-connecting`, `…-valid` | `connectingfrom`/`connectingto`, `valid` |
| Node connections | `useHandleConnections` (deprecated) | `useNodeConnections` |

---

### Sources

- `web/sites/reactflow.dev/src/content/learn/troubleshooting/migrate-to-v12.mdx` (the official migration guide — every numbered section above maps to a section there)
- `xyflow/packages/react/package.json` (name `@xyflow/react`, version `12.10.2`, CSS export paths)
- `xyflow/packages/system/package.json` (`@xyflow/system` `0.0.76`); `xyflow/packages/svelte/package.json` (`@xyflow/svelte` `1.5.2`)
- `xyflow/packages/system/src/types/nodes.ts` (`NodeBase`, `InternalNodeBase`, `NodeProps`)
- `xyflow/packages/react/src/types/nodes.ts` (`Node`, `InternalNode`)
- `xyflow/packages/system/src/types/changes.ts` (`NodeReplaceChange`, `NodeChange`, `EdgeChange`)
- `xyflow/packages/react/src/store/initialState.ts` (`nodeLookup`)
- `xyflow/packages/react/src/hooks/useReactFlow.ts` (`updateNode`, `updateNodeData`, `updateEdge`, `updateEdgeData`)
- `xyflow/packages/react/src/hooks/useViewportHelper.ts` (`screenToFlowPosition`, `flowToScreenPosition`)
- `xyflow/packages/react/src/hooks/useHandleConnections.ts` (`@deprecated` → `useNodeConnections`)
- `xyflow/packages/react/src/utils/changes.ts` (`applyNodeChanges`, `applyEdgeChanges`, `'replace'` handling)
- `xyflow/packages/react/src/index.ts` (`reconnectEdge`)
- `xyflow/packages/react/CHANGELOG.md` (12.10.2 / 12.10.1 / 12.9.3 patch notes)
- `strudel-flow/package.json`, `strudel-flow/src/index.css`, `strudel-flow/src/hooks/use-drag-and-drop.ts` (real v12 app usage)
