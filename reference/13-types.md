# React Flow TypeScript Types Reference

## What this covers

This is a field-by-field reference of React Flow's core exported TypeScript types — `Node`, `Edge`, `NodeProps`, `EdgeProps`, `ReactFlowInstance`, `Connection`/`ConnectionState`, the change unions, and the supporting enums — with their **actual source definitions** copied verbatim from `@xyflow/system` and `@xyflow/react`, explaining how the two-level generic system (`@xyflow/system` framework-agnostic base types + thin React wrappers) lets you type custom node/edge data end-to-end.

**Pinned versions:** `@xyflow/react` 12.10.2 · `@xyflow/svelte` 1.5.2 · `@xyflow/system` 0.0.76.

## Architecture: why there are two layers of types

React Flow splits its types across two packages. The framework-agnostic primitives live in `@xyflow/system` and are suffixed `Base` (`NodeBase`, `EdgeBase`, `NodePropsBase`, `FitViewOptionsBase`, …). The React package (`@xyflow/react`) re-exports thin wrappers that add React-specific fields (`CSSProperties`, `ReactNode`, `AriaRole`, etc.) and drop the `Base` suffix. Svelte does the same in its own package.

| Layer | Package | Example | File |
|-------|---------|---------|------|
| Framework-agnostic core | `@xyflow/system` | `NodeBase`, `EdgeBase`, `NodeProps` (base) | `packages/system/src/types/*.ts` |
| React wrapper | `@xyflow/react` | `Node`, `Edge`, `NodeProps`, `EdgeProps` | `packages/react/src/types/*.ts` |

Everything in `packages/system/src/types/index.ts` is re-exported wholesale (`export * from './changes' | './general' | './nodes' | './edges' | './handles' | './utils' | './panzoom'`), so when you `import { Connection, MarkerType } from '@xyflow/react'` you are actually getting the system definitions. The React package overrides only `Node`, `Edge`, `NodeProps`, `EdgeProps`, `ReactFlowInstance`, and a handful of others.

---

## Node

The React `Node` type composes the system `NodeBase` with React presentation fields.

### `NodeBase<NodeData, NodeType>` — source `packages/system/src/types/nodes.ts:NodeBase`

```ts
export type NodeBase<
  NodeData extends Record<string, unknown> = Record<string, unknown>,
  NodeType extends string | undefined = string | undefined
> = {
  id: string;
  position: XYPosition;
  data: NodeData;
  sourcePosition?: Position;
  targetPosition?: Position;
  hidden?: boolean;
  selected?: boolean;
  dragging?: boolean;
  draggable?: boolean;
  selectable?: boolean;
  connectable?: boolean;
  deletable?: boolean;
  dragHandle?: string;
  width?: number;
  height?: number;
  initialWidth?: number;
  initialHeight?: number;
  parentId?: string;
  zIndex?: number;
  extent?: 'parent' | CoordinateExtent | null;
  expandParent?: boolean;
  ariaLabel?: string;
  origin?: NodeOrigin;
  handles?: NodeHandle[];
  measured?: { width?: number; height?: number };
} & (undefined extends NodeType
  ? { type?: string | undefined }    // NodeType is loose → type optional
  : { type: NodeType });             // NodeType is a literal → type REQUIRED
```

The trailing conditional intersection is the most important piece of machinery in the whole type system. If the `NodeType` generic is left as its default (`string | undefined`), then `undefined extends NodeType` is `true` and `type` is **optional**. But the moment you supply a string literal — `Node<MyData, 'counter'>` — `undefined` no longer extends `'counter'`, so `type` becomes **required and narrowed to that literal**. This is what makes discriminated unions of nodes work (see "Typing custom nodes").

### `Node<NodeData, NodeType>` — source `packages/react/src/types/nodes.ts:Node`

```ts
export type Node<
  NodeData extends Record<string, unknown> = Record<string, unknown>,
  NodeType extends string | undefined = string | undefined
> = NodeBase<NodeData, NodeType> & {
  style?: CSSProperties;
  className?: string;
  resizing?: boolean;
  focusable?: boolean;
  ariaRole?: AriaRole;          // @default "group"
  domAttributes?: Omit<HTMLAttributes<HTMLDivElement>,
    'id' | 'style' | 'className' | 'draggable' | 'role'
    | 'aria-label' | 'defaultValue' | 'dangerouslySetInnerHTML'
    | keyof DOMAttributes<HTMLDivElement>>;
};
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Required, unique. Used as the lookup key in the node Map. |
| `position` | `XYPosition` | `{ x, y }` relative to parent (or pane if no `parentId`). Required. |
| `data` | `NodeData` | Your arbitrary payload. This is generic param #1. Required. |
| `type` | `NodeType` or `string?` | Key into `nodeTypes`. Required only when you pass a literal generic. |
| `sourcePosition` / `targetPosition` | `Position` | Only relevant for built-in default/source/target nodes. |
| `hidden` | `boolean?` | Removes node from canvas without deleting it. |
| `selected` / `dragging` | `boolean?` | Runtime state React Flow writes back. |
| `draggable` / `selectable` / `connectable` / `deletable` | `boolean?` | Per-node interaction overrides of the global flow props. |
| `dragHandle` | `string?` | CSS selector; restricts drag-start to matching descendants. |
| `width` / `height` | `number?` | User-set dimensions. Distinct from `measured`. |
| `initialWidth` / `initialHeight` | `number?` | Used for the first render before measurement (SSR-friendly). |
| `parentId` | `string?` | Enables sub-flows; position becomes relative to the parent. |
| `zIndex` | `number?` | Manual stacking. |
| `extent` | `'parent' \| CoordinateExtent \| null` | Movement bounds. `'parent'` confines to parent node. |
| `expandParent` | `boolean?` | Parent auto-grows when child is dragged to its edge. |
| `origin` | `NodeOrigin` (`[number, number]`) | `[0.5,0.5]` centers node on its position. |
| `handles` | `NodeHandle[]?` | Pre-declared handles (advanced; usually inferred from DOM). |
| `measured` | `{ width?, height? }` | DOM-measured size, written by React Flow's ResizeObserver. |
| `style` / `className` | React | Applied to the node wrapper div. |
| `focusable` | `boolean?` | Keyboard a11y focus. |
| `ariaRole` | `AriaRole` | Defaults to `"group"`. |
| `domAttributes` | `Omit<HTMLAttributes…>` | Escape hatch for extra DOM attributes; reserved attrs are `Omit`ted. |

### `InternalNode` / `InternalNodeBase` — source `packages/system/src/types/nodes.ts:InternalNodeBase`

Functions that *return* nodes (e.g. `getInternalNode`, `useConnection`) hand you an `InternalNode`. It is the user node plus a computed `internals` block:

```ts
export type InternalNodeBase<NodeType extends NodeBase = NodeBase> = Omit<NodeType, 'measured'> & {
  measured: { width?: number; height?: number };  // now required, not optional
  internals: {
    positionAbsolute: XYPosition;   // resolved absolute position (parents applied)
    z: number;                      // computed z-index
    rootParentIndex?: number;
    userNode: NodeType;             // reference to the original node you passed
    handleBounds?: NodeHandleBounds;
    bounds?: NodeBounds;
  };
};

export type InternalNode<NodeType extends Node = Node> = InternalNodeBase<NodeType>;  // react wrapper
```

`internals.positionAbsolute` is the key reason `InternalNode` exists: `node.position` is parent-relative, but `internals.positionAbsolute` is the resolved canvas coordinate. `internals.userNode` is a back-reference optimization so React Flow can hand your original object back without re-deriving it.

---

## NodeProps — what a custom node component receives

### Source `packages/system/src/types/nodes.ts:NodeProps` (base) and `packages/react/src/types/nodes.ts:NodeProps`

```ts
// system base
export type NodeProps<NodeType extends NodeBase> = Pick<NodeType,
    'id' | 'data' | 'width' | 'height' | 'sourcePosition' | 'targetPosition' | 'dragHandle' | 'parentId'>
  & Required<Pick<NodeType,
      'type' | 'dragging' | 'zIndex' | 'selectable' | 'deletable' | 'selected' | 'draggable'>>
  & {
    isConnectable: boolean;
    positionAbsoluteX: number;
    positionAbsoluteY: number;
  };

// react wrapper
export type NodeProps<NodeType extends Node = Node> = NodePropsBase<NodeType>;
```

Note carefully: `NodeProps` is **not** the full `Node`. It is a curated `Pick`. Runtime-state fields (`dragging`, `selected`, `draggable`, `selectable`, `deletable`, `zIndex`, `type`) are wrapped in `Required<>` so inside your component they are guaranteed defined (no `?`). The absolute position arrives **flattened** as `positionAbsoluteX` / `positionAbsoluteY` (numbers), not as an `XYPosition`. `position`, `style`, `className`, `hidden`, and `selectable`-irrelevant fields are intentionally absent — your component renders inside the wrapper that already owns those.

```tsx
import { NodeProps, Node } from '@xyflow/react';
export type CounterNode = Node<{ initialCount?: number }, 'counter'>;

export default function CounterNode({ data, selected, positionAbsoluteX }: NodeProps<CounterNode>) {
  // data is typed { initialCount?: number }; selected is boolean (not boolean|undefined)
}
```

---

## Edge

### `EdgeBase<EdgeData, EdgeType>` — source `packages/system/src/types/edges.ts:EdgeBase`

```ts
export type EdgeBase<
  EdgeData extends Record<string, unknown> = Record<string, unknown>,
  EdgeType extends string | undefined = string | undefined
> = {
  id: string;
  type?: EdgeType;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  animated?: boolean;
  hidden?: boolean;
  deletable?: boolean;
  selectable?: boolean;
  data?: EdgeData;
  selected?: boolean;
  markerStart?: EdgeMarkerType;
  markerEnd?: EdgeMarkerType;
  zIndex?: number;
  ariaLabel?: string;
  interactionWidth?: number;
};
```

Unlike `NodeBase`, `EdgeBase.type` is **always optional** — there is no conditional-required trick — and `data` is optional (`data?`), reflecting that many edges carry no payload.

### `Edge<EdgeData, EdgeType>` — source `packages/react/src/types/edges.ts:Edge`

```ts
export type Edge<
  EdgeData extends Record<string, unknown> = Record<string, unknown>,
  EdgeType extends string | undefined = string | undefined
> = EdgeBase<EdgeData, EdgeType> & EdgeLabelOptions & {
    style?: CSSProperties;
    className?: string;
    reconnectable?: boolean | HandleType;   // override edgesReconnectable
    focusable?: boolean;
    ariaRole?: AriaRole;                     // @default "group"
    domAttributes?: Omit<SVGAttributes<SVGGElement>,
      'id' | 'style' | 'className' | 'role' | 'aria-label' | 'dangerouslySetInnerHTML'>;
  };
```

`EdgeLabelOptions` (source `packages/react/src/types/edges.ts:EdgeLabelOptions`) adds: `label?: ReactNode`, `labelStyle?`, `labelShowBg?`, `labelBgStyle?`, `labelBgPadding?: [number, number]`, `labelBgBorderRadius?`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Required, unique. |
| `source` / `target` | `string` | Node ids. Required. |
| `sourceHandle` / `targetHandle` | `string \| null` | Needed only when a node has multiple handles. |
| `type` | `EdgeType?` | Key into `edgeTypes`. Always optional. |
| `data` | `EdgeData?` | Generic param #1. Optional. |
| `animated` | `boolean?` | Dash animation on the path. |
| `markerStart` / `markerEnd` | `EdgeMarkerType` | `string \| EdgeMarker`; see MarkerType. |
| `reconnectable` | `boolean \| HandleType` | Per-edge override; can restrict to `'source'`/`'target'`. |
| `interactionWidth` | `number?` | Width of the invisible click/hover hit-path. |

The built-in edge variants are typed by intersecting `Edge` with `pathOptions` (source `packages/react/src/types/edges.ts`): `SmoothStepEdge` (+`SmoothStepPathOptions`), `BezierEdge` (type `'default'`, +`BezierPathOptions`), `StepEdge` (+`StepPathOptions`), `StraightEdge`. `BuiltInEdge` is their union.

---

## EdgeProps — what a custom edge component receives

### Source `packages/react/src/types/edges.ts:EdgeProps`

```ts
export type EdgeProps<EdgeType extends Edge = Edge> = Pick<EdgeType,
    'id' | 'type' | 'animated' | 'data' | 'style' | 'selected'
    | 'source' | 'target' | 'selectable' | 'deletable'>
  & EdgePosition
  & EdgeLabelOptions
  & {
    sourceHandleId?: string | null;
    targetHandleId?: string | null;
    markerStart?: string;     // note: resolved to a string url(#id), not EdgeMarkerType
    markerEnd?: string;
    pathOptions?: any;        // @TODO upstream: how to better type pathOptions
    interactionWidth?: number;
  };
```

The crucial addition is `EdgePosition` (source `packages/system/src/types/edges.ts:EdgePosition`), which gives your edge component the already-computed endpoint geometry so you only have to draw a path:

```ts
export type EdgePosition = {
  sourceX: number; sourceY: number;
  targetX: number; targetY: number;
  sourcePosition: Position; targetPosition: Position;
};
```

`markerStart`/`markerEnd` arrive as resolved SVG url strings (`"url(#marker-id)"`), not the authoring `EdgeMarkerType`. `sourceHandle`/`targetHandle` are renamed to `sourceHandleId`/`targetHandleId`.

`BaseEdgeProps` (source `packages/react/src/types/edges.ts:BaseEdgeProps`) is what you feed the `<BaseEdge>` helper: `Omit<SVGAttributes<SVGPathElement>, 'd'|'path'|'markerStart'|'markerEnd'> & EdgeLabelOptions & { interactionWidth?, labelX?, labelY?, path: string, markerStart?, markerEnd? }`.

---

## ReactFlowInstance

### Source `packages/react/src/types/instance.ts:ReactFlowInstance`

```ts
export type ReactFlowInstance<NodeType extends Node = Node, EdgeType extends Edge = Edge> =
  GeneralHelpers<NodeType, EdgeType>
  & ViewportHelperFunctions
  & { viewportInitialized: boolean };
```

It is the union of three feature groups. Obtain it via `useReactFlow()` or the `onInit` callback.

**`GeneralHelpers`** (source `packages/react/src/types/instance.ts:GeneralHelpers`) — state query/mutation:

| Method | Signature (abridged) | Purpose |
|--------|----------------------|---------|
| `getNodes` | `() => NodeType[]` | Current nodes. |
| `setNodes` | `(NodeType[] \| (nodes) => NodeType[]) => void` | Replace nodes; triggers `onNodesChange`. |
| `addNodes` | `(NodeType[] \| NodeType) => void` | Append. |
| `getNode` | `(id) => NodeType \| undefined` | Single node. |
| `getInternalNode` | `(id) => InternalNode<NodeType> \| undefined` | Node with `internals`. |
| `getEdges`/`setEdges`/`addEdges`/`getEdge` | analogous to node variants | Edge state. |
| `toObject` | `() => ReactFlowJsonObject<NodeType,EdgeType>` | Serialize `{ nodes, edges, viewport }`. |
| `deleteElements` | `(DeleteElementsOptions) => Promise<{deletedNodes,deletedEdges}>` | Programmatic delete. |
| `getIntersectingNodes` | `(node\|rect, partially?, nodes?) => NodeType[]` | Hit-testing. |
| `isNodeIntersecting` | `(node\|rect, area, partially?) => boolean` | Single intersection test. |
| `updateNode` | `(id, Partial<NodeType> \| (node)=>Partial, {replace}?) => void` | Merge/replace update. |
| `updateNodeData` | `(id, Partial<data> \| (node)=>Partial, {replace}?) => void` | Update just `.data`. |
| `updateEdge` / `updateEdgeData` | analogous | Edge updates. |
| `getNodesBounds` | `((NodeType\|InternalNode\|string)[]) => Rect` | Bounding rect. |
| `getNodeConnections` | `({type?,nodeId,handleId?}) => NodeConnection[]` | Connections to a node. |
| `getHandleConnections` | `({type,nodeId,id?}) => HandleConnection[]` | **@deprecated** — use `getNodeConnections`. |
| `fitView` | `FitView<NodeType>` | `(options?: FitViewOptions) => Promise<boolean>`. |

**`ViewportHelperFunctions`** (source `packages/react/src/types/general.ts:ViewportHelperFunctions`): `zoomIn`, `zoomOut`, `zoomTo`, `getZoom`, `setViewport`, `getViewport`, `setCenter`, `fitBounds`, `screenToFlowPosition(clientPos, {snapToGrid?,snapGrid?}) => XYPosition`, `flowToScreenPosition(flowPos) => XYPosition`.

`ReactFlowJsonObject` (source `instance.ts`) = `{ nodes: NodeType[]; edges: EdgeType[]; viewport: Viewport }`.

---

## Geometry primitives — source `packages/system/src/types/utils.ts`

```ts
export type XYPosition = { x: number; y: number };
export type XYZPosition = XYPosition & { z: number };
export type Dimensions = { width: number; height: number };
export type Rect = Dimensions & XYPosition;              // { x, y, width, height }
export type Box = XYPosition & { x2: number; y2: number };
export type Transform = [number, number, number];        // [x, y, zoom] internal transform
export type CoordinateExtent = [[number, number], [number, number]];  // [[minX,minY],[maxX,maxY]]
```

`CoordinateExtent` is a top-left/bottom-right pair. Props expecting it default to `[[-∞,-∞],[+∞,+∞]]` (unbounded). It is used for `nodeExtent`, `translateExtent`, and a node's `extent`.

### `Position` enum — source `packages/system/src/types/utils.ts:Position`

```ts
export enum Position {
  Left = 'left',
  Top = 'top',
  Right = 'right',
  Bottom = 'bottom',
}
```

The four sides a handle/edge can attach to. There is a sibling const `oppositePosition` mapping each to its opposite. Do not confuse `Position` (handle/edge side) with `PanelPosition` (`'top-left' | … | 'center-right'`, source `general.ts`), which positions overlay components.

### `Viewport` — source `packages/system/src/types/general.ts:Viewport`

```ts
export type Viewport = { x: number; y: number; zoom: number };
```

Where the flow is panned/zoomed. Note the docstring warning: `Viewport` and the internal `Transform` triple look similar but are *not* interchangeable.

---

## Connections

### `Connection` — source `packages/system/src/types/general.ts:Connection`

```ts
export type Connection = {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};
```

The minimal description of a link. `addEdge(connection, edges)` upgrades a `Connection` into a full `Edge`. `HandleConnection` and `NodeConnection` both extend it with `{ edgeId: string }`.

### `ConnectionState` / `ConnectionInProgress` — source `packages/system/src/types/general.ts`

`ConnectionState` is a discriminated union on the literal `inProgress` field, returned by the `useConnection` hook (`packages/react/src/hooks/useConnection.ts`).

```ts
export type ConnectionState<NodeType extends InternalNodeBase = InternalNodeBase> =
  | ConnectionInProgress<NodeType>
  | NoConnection;

export type NoConnection = {
  inProgress: false;
  isValid: null;
  from: null; fromHandle: null; fromPosition: null; fromNode: null;
  to: null;   toHandle: null;   toPosition: null;   toNode: null;
  pointer: null;
};

export type ConnectionInProgress<NodeType extends InternalNodeBase = InternalNodeBase> = {
  inProgress: true;
  isValid: boolean | null;     // null until over a handle / inside radius
  from: XYPosition;            // start xy
  fromHandle: Handle;
  fromPosition: Position;
  fromNode: NodeType;
  to: XYPosition;              // current end xy
  toHandle: Handle | null;
  toPosition: Position;
  toNode: NodeType | null;
  pointer: XYPosition;
};
```

Because the union is discriminated, `if (connection.inProgress) { connection.fromNode /* narrowed, non-null */ }` works without casts. `FinalConnectionState = Omit<ConnectionState, 'inProgress'>` is what `onConnectEnd`/`onReconnectEnd` receive. There is an exported `initialConnection: NoConnection` constant used as the default store value.

### `ConnectionMode` enum — source `packages/system/src/types/general.ts:ConnectionMode`

```ts
export enum ConnectionMode {
  Strict = 'strict',   // default: only source→target
  Loose  = 'loose',    // allows source→source and target→target
}
```

### `ConnectionLineType` enum — source `packages/system/src/types/edges.ts:ConnectionLineType`

```ts
export enum ConnectionLineType {
  Bezier = 'default',
  Straight = 'straight',
  Step = 'step',
  SmoothStep = 'smoothstep',
  SimpleBezier = 'simplebezier',
}
```

Set via the `connectionLineType` prop; dictates the in-progress connection line's shape and is forwarded to custom `ConnectionLineComponentProps.connectionLineType`.

### `HandleType` and `Handle` — source `packages/system/src/types/handles.ts`

```ts
export type HandleType = 'source' | 'target';

export type Handle = {
  id?: string | null;
  nodeId: string;
  x: number; y: number;        // position relative to node
  position: Position;          // which side
  type: HandleType;
  width: number; height: number;
};
```

`NodeHandle` (source `nodes.ts`) is `Omit<Optional<Handle, 'width'|'height'>, 'nodeId'>` — the authoring shape with optional size and no `nodeId`.

---

## Change unions

These drive controlled flows: `onNodesChange`/`onEdgesChange` deliver arrays of changes that you apply with `applyNodeChanges`/`applyEdgeChanges`.

### `NodeChange<NodeType>` — source `packages/system/src/types/changes.ts:NodeChange`

```ts
export type NodeChange<NodeType extends NodeBase = NodeBase> =
  | NodeDimensionChange   // { id; type:'dimensions'; dimensions?; resizing?; setAttributes? }
  | NodePositionChange    // { id; type:'position'; position?; positionAbsolute?; dragging? }
  | NodeSelectionChange   // { id; type:'select'; selected: boolean }
  | NodeRemoveChange      // { id; type:'remove' }
  | NodeAddChange<NodeType>      // { item: NodeType; type:'add'; index? }
  | NodeReplaceChange<NodeType>; // { id; item: NodeType; type:'replace' }
```

Each member is discriminated by its `type` literal. `NodeDimensionChange.setAttributes` can be `boolean | 'width' | 'height'` to control whether measured dimensions are also written to `width`/`height`.

### `EdgeChange<EdgeType>` — source `packages/system/src/types/changes.ts:EdgeChange`

```ts
export type EdgeChange<EdgeType extends EdgeBase = EdgeBase> =
  | EdgeSelectionChange   // = NodeSelectionChange  ({ id; type:'select'; selected })
  | EdgeRemoveChange      // = NodeRemoveChange      ({ id; type:'remove' })
  | EdgeAddChange<EdgeType>      // { item: EdgeType; type:'add'; index? }
  | EdgeReplaceChange<EdgeType>; // { id; item: EdgeType; type:'replace' }
```

Edges have only four change kinds (no dimension/position) — `EdgeSelectionChange`/`EdgeRemoveChange` are literal aliases of the node equivalents.

---

## FitView and edge defaults

### `FitViewOptions` — source `packages/system/src/types/general.ts:FitViewOptionsBase` (re-exported via `react/.../general.ts:FitViewOptions`)

```ts
export type FitViewOptionsBase<NodeType extends NodeBase = NodeBase> = {
  padding?: Padding;
  includeHiddenNodes?: boolean;
  minZoom?: number;
  maxZoom?: number;
  duration?: number;
  ease?: (t: number) => number;
  interpolate?: 'smooth' | 'linear';
  nodes?: (NodeType | { id: string })[];
};
```

`Padding` (source `general.ts`) is either a `PaddingWithUnit` (`` `${number}px` | `${number}%` | number ``) or a per-side object `{ top?, right?, bottom?, left?, x?, y? }`. `nodes` lets you fit to a subset — passing `{ id }` stubs is enough.

### `DefaultEdgeOptions` — source `packages/react/src/types/edges.ts:DefaultEdgeOptions`

```ts
// base, system: packages/system/src/types/edges.ts:DefaultEdgeOptionsBase
export type DefaultEdgeOptionsBase<EdgeType extends EdgeBase> = Omit<EdgeType,
  'id' | 'source' | 'target' | 'sourceHandle' | 'targetHandle' | 'selected'>;

// react
export type DefaultEdgeOptions = DefaultEdgeOptionsBase<Edge>;
```

It is `Edge` with the per-edge identity fields stripped, because defaults must apply to *every* new edge. Passed to the `defaultEdgeOptions` prop; values fill in any edge property you did not specify (e.g. `{ animated: true, type: 'smoothstep' }`).

---

## Markers

### `MarkerType` enum — source `packages/system/src/types/edges.ts:MarkerType`

```ts
export enum MarkerType {
  Arrow = 'arrow',
  ArrowClosed = 'arrowclosed',
}
```

### `EdgeMarker` / `EdgeMarkerType` — source `packages/system/src/types/edges.ts:EdgeMarker`

```ts
export type EdgeMarker = {
  type: MarkerType | `${MarkerType}`;   // enum value OR its string literal
  color?: string | null;
  width?: number;
  height?: number;
  markerUnits?: string;
  orient?: string;
  strokeWidth?: number;
};
export type EdgeMarkerType = string | EdgeMarker;
```

`Edge.markerStart`/`markerEnd` are `EdgeMarkerType`, so you may pass either a bare string id, a `MarkerType` value, or a full `EdgeMarker` config object. The `` `${MarkerType}` `` template form means raw strings `'arrow'`/`'arrowclosed'` are accepted without importing the enum.

---

## Panning

### `PanOnScrollMode` enum — source `packages/system/src/types/general.ts:PanOnScrollMode`

```ts
export enum PanOnScrollMode {
  Free = 'free',
  Vertical = 'vertical',
  Horizontal = 'horizontal',
}
```

Controls scroll-pan axis lock when `panOnScroll` is enabled. `Free` lets a trackpad pan in any direction; `Vertical`/`Horizontal` restrict to one axis.

---

## Typing custom nodes and edges (the generics in practice)

The two generics on `Node<NodeData, NodeType>` and `Edge<EdgeData, EdgeType>` let you build a **discriminated union** of your app's node/edge shapes. Because supplying a literal `NodeType` makes `type` required (the `undefined extends NodeType` conditional in `NodeBase`), TypeScript can discriminate on `node.type`:

```ts
import type { Node, Edge, NodeProps, BuiltInNode } from '@xyflow/react';

// 1. Define each node variant: data shape + literal type tag
type CounterNode  = Node<{ count: number }, 'counter'>;
type TextNode     = Node<{ text: string }, 'text'>;

// 2. Union them (optionally fold in the built-ins)
type AppNode = CounterNode | TextNode | BuiltInNode;

// 3. Use the union everywhere
const nodes: AppNode[] = [/* ... */];

// 4. In a custom component, pass the specific variant
function Counter({ data }: NodeProps<CounterNode>) {
  return <div>{data.count}</div>;   // data is { count: number }, fully typed
}

// 5. Discriminate by tag
function render(n: AppNode) {
  if (n.type === 'counter') n.data.count; // narrowed to CounterNode
}
```

`BuiltInNode` (source `packages/react/src/types/nodes.ts:BuiltInNode`) is `Node<{label:string}, 'input'|'output'|'default'|undefined> | Node<Record<string,never>, 'group'>`; `BuiltInEdge` is the union of the four built-in edge variants. Fold them into your union so the default node/edge types still type-check.

Pass your union types to the top-level component and store APIs — `ReactFlow<AppNode, AppEdge>`, `useReactFlow<AppNode, AppEdge>()`, `OnNodesChange<AppNode>`, `applyNodeChanges<AppNode>` — and the typing flows through the entire instance, including `getNode` returning `AppNode | undefined`.

> **Note on `NodeTypes`/`EdgeTypes` maps** (source `packages/react/src/types/general.ts`): the `nodeTypes`/`edgeTypes` *registry* objects are typed with `data: any; type: any` on their component value. This is deliberate — the map holds heterogeneous components, so per-component typing happens at each component's own `NodeProps<MySpecificNode>` annotation, not at the registry.

---

## Source index

| Type / enum | Defined in |
|-------------|-----------|
| `NodeBase`, `InternalNodeBase`, `NodeProps`(base), `NodeOrigin`, `NodeHandle`, `BuiltInNode`(react) | `packages/system/src/types/nodes.ts`, `packages/react/src/types/nodes.ts` |
| `Node`, `InternalNode`, `NodeProps`(react) | `packages/react/src/types/nodes.ts` |
| `EdgeBase`, `EdgePosition`, `ConnectionLineType`, `MarkerType`, `EdgeMarker`, `EdgeMarkerType`, `DefaultEdgeOptionsBase` | `packages/system/src/types/edges.ts` |
| `Edge`, `EdgeProps`, `BaseEdgeProps`, `EdgeLabelOptions`, `DefaultEdgeOptions`, `BuiltInEdge` | `packages/react/src/types/edges.ts` |
| `Connection`, `ConnectionState`, `ConnectionInProgress`, `NoConnection`, `FinalConnectionState`, `ConnectionMode`, `Viewport`, `PanOnScrollMode`, `PanelPosition`, `FitViewOptionsBase`, `Padding` | `packages/system/src/types/general.ts` |
| `XYPosition`, `Rect`, `Box`, `Transform`, `CoordinateExtent`, `Position`, `Dimensions` | `packages/system/src/types/utils.ts` |
| `HandleType`, `Handle`, `HandleProps` | `packages/system/src/types/handles.ts` |
| `NodeChange`, `EdgeChange` (and members) | `packages/system/src/types/changes.ts` |
| `ReactFlowInstance`, `GeneralHelpers`, `ReactFlowJsonObject`, `DeleteElementsOptions` | `packages/react/src/types/instance.ts` |
| `FitViewOptions`, `ViewportHelperFunctions`, `NodeTypes`, `EdgeTypes`, `OnNodesChange`, `OnEdgesChange` | `packages/react/src/types/general.ts` |
