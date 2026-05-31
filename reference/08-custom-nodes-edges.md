## What this covers

Building custom nodes and custom edges in React Flow v12, plus the full handle/connection system internals — every field of `NodeProps`/`EdgeProps`, every `<Handle>` prop, how `XYHandle` resolves a valid connection target during a drag, the `ConnectionState` machine, `ConnectionMode` (loose vs. strict), why dynamic handles require `updateNodeInternals`, and how `nodeTypes`/`edgeTypes` registration wires a string `type` to your component.

> Versions pinned: `@xyflow/react@12.10.2`, `@xyflow/svelte@1.5.2`, `@xyflow/system@0.0.76`. Source paths below are relative to `xyflow/packages/` unless noted. The `@xyflow/system` package is framework-agnostic and holds the connection engine; `@xyflow/react` wraps it.

---

## 1. Mental model: how a node/edge becomes a component

React Flow does **not** render your `nodeTypes` components directly. Each user node object is rendered by an internal `NodeWrapper` (`react/src/components/NodeWrapper/index.tsx`) and each edge by an internal `EdgeWrapper` (`react/src/components/EdgeWrapper/index.tsx`). The wrapper:

1. Looks up the component by the node/edge `type` string.
2. Computes derived props (absolute position, resolved `isConnectable`, edge endpoint coordinates, marker URLs).
3. Renders **your** component with a flat, computed prop set — `NodeProps` / `EdgeProps`.

So your custom component receives a *projection* of the underlying `Node`/`Edge` object, not the object itself. This is why, e.g., `NodeProps` exposes `positionAbsoluteX`/`positionAbsoluteY` (computed) rather than the raw `position` you set, and why `EdgeProps` exposes `sourceX/sourceY/targetX/targetY` (computed handle coordinates) that never exist on the `Edge` object.

The wrapper's lookup-and-fallback for nodes (`NodeWrapper/index.tsx`):

```ts
let nodeType = node.type || 'default';
let NodeComponent = nodeTypes?.[nodeType] || builtinNodeTypes[nodeType];

if (NodeComponent === undefined) {
  onError?.('003', errorMessages['error003'](nodeType));
  nodeType = 'default';
  NodeComponent = nodeTypes?.['default'] || builtinNodeTypes.default;
}
```

An unknown `type` falls back to the `default` node and fires error `003` (not a crash). `onError` here is the destructured `NodeWrapperProps.onError` (wired from `<ReactFlow onError>`), and `errorMessages.error003` is ``Node type "${nodeType}" not found. Using fallback type "default".`` (`system/src/constants.ts:error003`). The same pattern holds for edges in `EdgeWrapper/index.tsx`, except the edge fallback fires error `011` (`error011`: ``Edge type "${edgeType}" not found. Using fallback type "default".``) — **not** `003`.

---

## 2. Custom nodes

### 2.1 The `Node` object vs. `NodeProps`

The object you put in state is a `Node` (`react/src/types/nodes.ts:Node`), extending the framework-independent `NodeBase` (`system/src/types/nodes.ts:NodeBase`). Key `NodeBase` fields you *set*:

| Field | Type | Meaning (source: `system/src/types/nodes.ts:NodeBase`) |
|---|---|---|
| `id` | `string` | Unique node id (required). |
| `position` | `XYPosition` | Position relative to parent (or pane). |
| `data` | `NodeData` | Arbitrary per-node payload. |
| `type` | `NodeType` (string) | Key into `nodeTypes`. Optional → `'default'`. |
| `sourcePosition` / `targetPosition` | `Position` | Only used by built-in default/input/output nodes; passed through to custom nodes for you to honor. |
| `hidden` | `boolean` | If true, node isn't rendered. |
| `selected`, `dragging`, `draggable`, `selectable`, `connectable`, `deletable` | `boolean` | State / capability flags. |
| `dragHandle` | `string` | CSS selector; only elements matching it start a drag. |
| `width` / `height` | `number` | Controlled dimensions. |
| `initialWidth` / `initialHeight` | `number` | Used before measurement to avoid layout jumps. |
| `parentId` | `string` | Sub-flow parent — child position is relative to it. |
| `zIndex` | `number` | Manual stacking. |
| `extent` | `'parent' \| CoordinateExtent \| null` | Movement boundary. |
| `expandParent` | `boolean` | Auto-grow parent when dragged to its edge. |
| `origin` | `NodeOrigin` (`[number,number]`) | `[0.5,0.5]` centers the node on `position`. |
| `handles` | `NodeHandle[]` | Pre-declared handle bounds (advanced/SSR). |
| `measured` | `{width?; height?}` | React Flow-measured size (read-only in practice). |

`Node` (React) adds `style`, `className`, `resizing`, `focusable`, `ariaRole`, and `domAttributes` (escape hatch for arbitrary DOM attrs, with reserved keys omitted).

`InternalNode` (`react/src/types/nodes.ts:InternalNode` → `InternalNodeBase`) is what internal APIs return. It adds an `internals` block — `positionAbsolute`, `z`, `userNode` (a reference to your original node), `handleBounds` (measured handle rects), and `bounds`. You get an `InternalNode` from `useInternalNode(id)` or `store.nodeLookup.get(id)`.

### 2.2 `NodeProps` — the exact projection your component receives

Definition (`system/src/types/nodes.ts:NodeProps`):

```ts
export type NodeProps<NodeType extends NodeBase> = Pick<
  NodeType,
  'id' | 'data' | 'width' | 'height' | 'sourcePosition' | 'targetPosition' | 'dragHandle' | 'parentId'
> &
  Required<Pick<NodeType,
    'type' | 'dragging' | 'zIndex' | 'selectable' | 'deletable' | 'selected' | 'draggable'>> & {
    /** Whether a node is connectable or not. */
    isConnectable: boolean;
    /** Position absolute x value. */
    positionAbsoluteX: number;
    /** Position absolute y value. */
    positionAbsoluteY: number;
  };
```

The React-facing alias is `react/src/types/nodes.ts:NodeProps` (`= NodePropsBase`). Full field list, with how the wrapper computes each (`NodeWrapper/index.tsx`, JSX `<NodeComponent>`):

| Prop | Type | How it is computed |
|---|---|---|
| `id` | `string` | `node.id`. |
| `data` | `NodeData` | `node.data`. |
| `type` | `string` (required) | The resolved type key (`nodeType`). |
| `selected` | `boolean` (required) | `node.selected ?? false`. |
| `dragging` | `boolean` (required) | Internal drag flag for this node. |
| `draggable` | `boolean` (required) | `isDraggable` — node flag OR global `nodesDraggable`. |
| `selectable` | `boolean` (required) | `isSelectable` — node flag OR global `elementsSelectable`. |
| `deletable` | `boolean` (required) | `node.deletable ?? true`. |
| `isConnectable` | `boolean` | `!!(node.connectable || (nodesConnectable && node.connectable === undefined))` — node opt-in, else global default. |
| `sourcePosition` | `Position?` | `node.sourcePosition` (pass-through). |
| `targetPosition` | `Position?` | `node.targetPosition` (pass-through). |
| `dragHandle` | `string?` | `node.dragHandle`. |
| `zIndex` | `number` (required) | `internals.z` (computed stacking, not raw `node.zIndex`). |
| `parentId` | `string?` | `node.parentId`. |
| `positionAbsoluteX` | `number` | `internals.positionAbsolute.x` — absolute X after applying parent offset/origin. |
| `positionAbsoluteY` | `number` | `internals.positionAbsolute.y`. |
| `width` / `height` | `number?` | Spread from `nodeDimensions` (measured or controlled). |

Note what is **absent**: there is no `position`, no `xPos`/`yPos` (that was v11), and no `style`/`className` prop — the wrapper applies `style`/`className` to the outer node DOM element itself, so your component styles its inner content only.

### 2.3 Minimal custom node

```tsx
import { useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

export type CounterNode = Node<{ initialCount?: number }, 'counter'>;

export default function CounterNode(props: NodeProps<CounterNode>) {
  const [count, setCount] = useState(props.data?.initialCount ?? 0);
  return (
    <div>
      <p>Count: {count}</p>
      {/* `nodrag` lets the button receive clicks without starting a node drag */}
      <button className="nodrag" onClick={() => setCount(count + 1)}>Increment</button>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

(Adapted from the JSDoc example in `react/src/types/nodes.ts:NodeProps`.) The `nodrag` class is the standard escape hatch — interactive elements inside a node must carry it, or the pointer-down is swallowed by the drag handler. Similarly, the `<Handle>` itself carries `nodrag` and the no-pan class internally (see §4).

### 2.4 Real-world shape (strudel-flow)

In the strudel-flow app, custom node components are thin and receive the typed projection; handles are split into the leaf node (`workflow-node.tsx`):

```tsx
import { Position } from '@xyflow/react';
import { BaseHandle } from '@/components/base-handle';
// ...
<BaseHandle position={Position.Top} type="target" />
<BaseHandle position={Position.Bottom} type="source" />
```

(`strudel-flow/src/components/nodes/workflow-node.tsx`). `BaseHandle` is a thin styled wrapper over the library `<Handle>`. Leaf effect nodes (e.g. `gain-node.tsx`) destructure only `{ id, data }` from their props type and read everything else from a Zustand store — a common pattern when node state lives outside React Flow.

### 2.5 Registering `nodeTypes`

`nodeTypes` maps a `type` string to a component (`react/src/types/general.ts:NodeTypes`):

```ts
export type NodeTypes = Record<string, ComponentType<NodeProps & { data: any; type: any }>>;
```

```tsx
const nodeTypes = { counter: CounterNode };           // object key === Node.type
<ReactFlow nodeTypes={nodeTypes} nodes={nodes} ... />
```

**Critical performance rule:** define `nodeTypes` (and `edgeTypes`) **outside** the component or memoize with `useMemo`. A fresh object identity on every render forces React Flow to re-create every node/edge, which both kills perf and fires a console warning. strudel-flow registers a static module-level object (`strudel-flow/src/components/nodes/index.tsx:296 export const nodeTypes = {...}`) and passes it straight through (`workflow/index.tsx:54`).

---

## 3. Custom edges

### 3.1 `Edge` object vs. `EdgeProps`

The state object is an `Edge` (`react/src/types/edges.ts:Edge`) extending `EdgeBase` (`system/src/types/edges.ts:EdgeBase`). Fields you set:

| Field | Type | Source: `system/src/types/edges.ts:EdgeBase` |
|---|---|---|
| `id` | `string` | Unique (required). |
| `type` | `EdgeType` (string) | Key into `edgeTypes`. Optional → `'default'` (bezier). |
| `source` / `target` | `string` | Node ids (required). |
| `sourceHandle` / `targetHandle` | `string \| null` | Needed only for multi-handle nodes. |
| `animated` | `boolean` | Animated dash. |
| `hidden`, `deletable`, `selectable`, `selected` | `boolean` | State/capability. |
| `data` | `EdgeData` | Per-edge payload. |
| `markerStart` / `markerEnd` | `EdgeMarkerType` (`string \| EdgeMarker`) | Arrow markers. |
| `zIndex` | `number` | Stacking. |
| `ariaLabel` | `string` | A11y. |
| `interactionWidth` | `number` | Width of the invisible hit-path. No default on `EdgeBase`; `<BaseEdge>` falls back to `20` when unset. |

`Edge` (React) adds `style`, `className`, `label`/`labelStyle`/`labelBgStyle`/… (`EdgeLabelOptions`), `reconnectable` (`boolean \| HandleType`), `focusable`, `ariaRole`, `domAttributes`, and per-type `pathOptions` (e.g. `BezierPathOptions { curvature }`, `SmoothStepPathOptions { offset; borderRadius; stepPosition }`).

### 3.2 `EdgeProps` — exact projection your edge component receives

Definition (`react/src/types/edges.ts:EdgeProps`):

```ts
export type EdgeProps<EdgeType extends Edge = Edge> = Pick<
  EdgeType,
  'id' | 'type' | 'animated' | 'data' | 'style' | 'selected' | 'source' | 'target' | 'selectable' | 'deletable'
> &
  EdgePosition &            // sourceX/Y, targetX/Y, sourcePosition, targetPosition
  EdgeLabelOptions & {      // label, labelStyle, labelBgStyle, ...
    sourceHandleId?: string | null;
    targetHandleId?: string | null;
    markerStart?: string;   // already resolved to url('#id')
    markerEnd?: string;
    pathOptions?: any;
    interactionWidth?: number;
  };
```

`EdgePosition` (`system/src/types/edges.ts:EdgePosition`) is the computed geometry — these never exist on the `Edge` object:

```ts
export type EdgePosition = {
  sourceX: number; sourceY: number;
  targetX: number; targetY: number;
  sourcePosition: Position; targetPosition: Position;
};
```

How the wrapper produces these (`EdgeWrapper/index.tsx`):

- `sourceX/sourceY/targetX/targetY/sourcePosition/targetPosition` come from `getEdgePosition({...})` using the source/target nodes' measured `handleBounds`. They are recomputed when nodes move or resize.
- `markerStart`/`markerEnd` are **resolved to CSS url references** before reaching you: `edge.markerStart ? url('#${getMarkerId(edge.markerStart, rfId)}') : undefined`. So the `markerEnd` you receive is a `string` like `"url('#1__color=…')"` — pass it straight to `<BaseEdge markerEnd={markerEnd} />`.
- `data`, `selected`, `animated`, `style`, `source`, `target`, `sourceHandleId` (= `edge.sourceHandle`), `targetHandleId`, `interactionWidth`, and `pathOptions` (`'pathOptions' in edge ? edge.pathOptions : undefined`) are passed through.
- If the edge is hidden or any endpoint coord is `null`, the wrapper returns `null` and your component never renders.

Note `EdgeProps` does **not** include `markerStart`/`markerEnd` as `EdgeMarker` objects, nor `className` — and label-related props are available so a custom edge can render its own label.

### 3.3 Building the path: `getBezierPath` & friends

A custom edge is responsible for producing an SVG path `d` string. The path utilities take `EdgePosition`-shaped input and return a tuple. `getBezierPath` (`system/src/utils/edges/bezier-edge.ts:getBezierPath`):

```ts
export function getBezierPath({
  sourceX, sourceY, sourcePosition = Position.Bottom,
  targetX, targetY, targetPosition = Position.Top,
  curvature = 0.25,
}: GetBezierPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

Return tuple: `[path, labelX, labelY, offsetX, offsetY]`. Siblings with the same tuple shape: `getStraightPath`, `getSmoothStepPath`, `getSimpleBezierPath`. `labelX/labelY` is the geometric center — feed it to `<BaseEdge label=.../>` or to your own `<EdgeLabelRenderer>` content.

**Exact signatures of the sibling path utilities** (all return the same `[path, labelX, labelY, offsetX, offsetY]` tuple):

`getStraightPath` (`system/src/utils/edges/straight-edge.ts:getStraightPath`) — takes **only the four coordinates**, no position/curvature options:

```ts
export type GetStraightPathParams = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
};

export function getStraightPath({
  sourceX, sourceY, targetX, targetY,
}: GetStraightPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

Its body is just `M ${sourceX},${sourceY}L ${targetX},${targetY}` plus the center from `getEdgeCenter`. Because it ignores `sourcePosition`/`targetPosition`, passing them (as a custom edge naturally would) is harmless but has no effect.

`getSmoothStepPath` (`system/src/utils/edges/smoothstep-edge.ts:getSmoothStepPath`) — orthogonal/stepped routing with rounded corners:

```ts
export interface GetSmoothStepPathParams {
  sourceX: number;
  sourceY: number;
  sourcePosition?: Position;   // @default Position.Bottom
  targetX: number;
  targetY: number;
  targetPosition?: Position;   // @default Position.Top
  borderRadius?: number;       // @default 5
  centerX?: number;
  centerY?: number;
  offset?: number;             // @default 20
  stepPosition?: number;       // bend location: 0 = at source, 1 = at target, 0.5 = midpoint. @default 0.5
}

export function getSmoothStepPath({
  sourceX, sourceY, sourcePosition = Position.Bottom,
  targetX, targetY, targetPosition = Position.Top,
  borderRadius = 5, centerX, centerY, offset = 20, stepPosition = 0.5,
}: GetSmoothStepPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

`borderRadius = 0` makes it a hard-cornered `step` edge (this is exactly how `StepEdge` is built — see §3.6). `offset` is the gap before the first bend; `stepPosition` slides the bend along the dominant axis; `centerX`/`centerY` let you pin the midpoint explicitly. Internally `getPoints` builds the corner list and `getBend` emits each `L…Q…` rounded corner.

`getSimpleBezierPath` (`react/src/components/Edges/SimpleBezierEdge.tsx:getSimpleBezierPath`) — note this one lives in the **React** package, not `@xyflow/system`, and is re-exported from `@xyflow/react`:

```ts
export interface GetSimpleBezierPathParams {
  sourceX: number;
  sourceY: number;
  sourcePosition?: Position;   // @default Position.Bottom
  targetX: number;
  targetY: number;
  targetPosition?: Position;   // @default Position.Top
}

export function getSimpleBezierPath({
  sourceX, sourceY, sourcePosition = Position.Bottom,
  targetX, targetY, targetPosition = Position.Top,
}: GetSimpleBezierPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

Unlike `getBezierPath`, it has **no `curvature` option**. Control points are derived by `getControl` (a fixed 0.5 midpoint on the axis implied by each handle's `Position`), producing a single cubic `M…,… C…,… …,… …,…` whose center comes from `getBezierEdgeCenter`. Built-in type key: `'simplebezier'`.

### 3.4 `<BaseEdge>` — render the path + interaction zone + label

`<BaseEdge>` (`react/src/components/Edges/BaseEdge.tsx:BaseEdge`) renders the visible path, the invisible interaction path, and an optional label:

```tsx
export function BaseEdge({
  path, labelX, labelY, label, labelStyle, labelShowBg, labelBgStyle,
  labelBgPadding, labelBgBorderRadius, interactionWidth = 20, ...props
}: BaseEdgeProps) {
  return (
    <>
      <path {...props} d={path} fill="none" className={cc(['react-flow__edge-path', props.className])} />
      {interactionWidth ? (
        <path d={path} fill="none" strokeOpacity={0}
              strokeWidth={interactionWidth} className="react-flow__edge-interaction" />
      ) : null}
      {label && isNumeric(labelX) && isNumeric(labelY) ? (
        <EdgeText x={labelX} y={labelY} label={label} .../>
      ) : null}
    </>
  );
}
```

The second `<path>` with `strokeOpacity={0}` and `strokeWidth={interactionWidth}` is the fat invisible hit-area that makes thin edges clickable — this is what `interactionWidth` (default `20`) controls.

### 3.5 Complete custom edge

```tsx
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export default function ButtonEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, markerEnd, style,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {/* EdgeLabelRenderer portals HTML out of the SVG layer so you can render buttons/divs */}
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan"   // required: edges live above the pane
          style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
        >×</button>
      </EdgeLabelRenderer>
    </>
  );
}
```

`<EdgeLabelRenderer>` (`react/src/components/EdgeLabelRenderer/index.tsx`) portals its children into a non-SVG div layer that tracks the viewport transform, so you can render real DOM (buttons, inputs) on top of an edge. Interactive label content needs `nodrag nopan` plus `pointer-events: all`.

### 3.6 Registering `edgeTypes`

`edgeTypes` (`react/src/types/general.ts:EdgeTypes`) mirrors `NodeTypes`. Same identity-stability rule applies.

```tsx
const edgeTypes = { button: ButtonEdge };
<ReactFlow edgeTypes={edgeTypes} edges={[{ id: 'e1', source: 'a', target: 'b', type: 'button' }]} />
```

Built-in edge types (`'default'`=bezier, `'straight'`, `'step'`, `'smoothstep'`, `'simplebezier'`) are always available and merged behind your custom ones. Note built-in components like `StepEdge` are internally a `SmoothStepEdge` with `borderRadius: 0` (`react/src/components/Edges/StepEdge.tsx`).

---

## 4. The `<Handle>` component

`<Handle>` (`react/src/components/Handle/index.tsx:Handle`) is the connection anchor placed inside a custom node. It is exported as `memo(fixedForwardRef(HandleComponent))` (`fixedForwardRef` is a typed `forwardRef` wrapper, `react/src/utils`) — a `<div>` carrying data attributes the connection engine queries by selector.

### 4.1 Every prop

The React `HandleProps` = system `HandleProps` (`system/src/types/handles.ts:HandleProps`) + `Omit<HTMLAttributes<HTMLDivElement>,'id'>` + `onConnect` (`react/src/components/Handle/index.tsx:HandleProps`). Full list:

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `type` | `'source' \| 'target'` (`HandleType`) | `'source'` | Whether the handle starts (source) or ends (target) connections. In loose mode this distinction relaxes (see §5). |
| `position` | `Position` (`'left'\|'top'\|'right'\|'bottom'`) | `Position.Top` | Which side of the node; controls handle placement and default edge direction. |
| `id` | `string \| null` | `null` | Handle id. **Required when a node has >1 handle of the same type** so edges can target a specific handle (`sourceHandle`/`targetHandle`). |
| `isConnectable` | `boolean` | `true` | Master switch — can you connect to/from this handle at all. |
| `isConnectableStart` | `boolean` | `true` | Can a connection *start* by dragging out of this handle. |
| `isConnectableEnd` | `boolean` | `true` | Can a dragged connection *end* on this handle. |
| `onConnect` | `OnConnect` (`(c: Connection) => void`) | — | Called when a connection that includes this handle completes. |
| `isValidConnection` | `IsValidConnection` (`(edge: Edge \| Connection) => boolean`) | — | Per-handle validator. Run when this handle is the candidate target. **Prefer the global `isValidConnection` on `<ReactFlow>` for performance** (handle-level runs more often). |
| `...rest` | `HTMLAttributes<HTMLDivElement>` | — | `style`, `className`, event handlers, etc. spread onto the div. |

`isConnectable=false` removes the `connectionindicator` class but the handle is still rendered; `isConnectableStart=false` makes a handle *receive-only* (e.g. an input port), `isConnectableEnd=false` makes it *emit-only*.

### 4.2 What the rendered DOM looks like (and why)

The handle div carries data attributes and classes the engine relies on:

```tsx
<div
  data-handleid={handleId}
  data-nodeid={nodeId}
  data-handlepos={position}
  data-id={`${rfId}-${nodeId}-${handleId}-${type}`}
  className={cc(['react-flow__handle', `react-flow__handle-${position}`, 'nodrag', noPanClassName, className,
    { source: !isTarget, target: isTarget, connectable: isConnectable,
      connectablestart: isConnectableStart, connectableend: isConnectableEnd,
      clickconnecting, connectingfrom, connectingto, valid, connectionindicator }])}
  onMouseDown={onPointerDown} onTouchStart={onPointerDown}
  onClick={connectOnClick ? onClick : undefined}
/>
```

The `data-id` selector `${rfId}-${nodeId}-${handleId}-${type}` is exactly what `XYHandle.isValid` queries to find a handle DOM node (§5.3). The `source`/`target`/`connectable`/`connectableend` classes are read by the engine via `classList.contains(...)` to decide validity. The built-in `nodrag` + no-pan classes stop a handle pointer-down from triggering node drag or pane pan.

`nodeId` comes from `useNodeId()` (a context provided by `NodeWrapper`). Using `<Handle>` outside a custom node yields no node id and fires error `010`: *"Handle: No node id found. Make sure to only use a Handle inside a custom Node."* (`system/src/constants.ts:error010`).

### 4.3 The `onConnect` extension chain

When a connection completes, `<Handle>` calls `onConnectExtended` (`Handle/index.tsx`), which:

```ts
const edgeParams = { ...defaultEdgeOptions, ...params };
if (hasDefaultEdges) { setEdges(addEdge(edgeParams, edges)); } // uncontrolled flows auto-add
onConnectAction?.(edgeParams);  // the <ReactFlow onConnect> prop
onConnect?.(edgeParams);        // this handle's onConnect prop
```

So in an **uncontrolled** flow (using `defaultEdges`) the edge is auto-created via `addEdge`; in a **controlled** flow you must add it yourself in the `<ReactFlow onConnect>` handler.

---

## 5. Connection system internals (`XYHandle`)

The drag-to-connect engine is `XYHandle` (`system/src/xyhandle/XYHandle.ts`), exposing two methods (`system/src/xyhandle/types.ts:XYHandleInstance`):

```ts
export type XYHandleInstance = {
  onPointerDown: (event, params: OnPointerDownParams) => void;
  isValid:       (event, params: IsValidParams) => Result;
};
```

### 5.1 Lifecycle of a drag connection

`<Handle>`'s `onPointerDown` calls `XYHandle.onPointerDown(nativeEvent, {...store state...})` only when `isConnectableStart` and (for mouse) the left button is pressed. Inside (`XYHandle.ts:onPointerDown`):

1. **Resolve the originating handle.** `getHandle(nodeId, handleType, handleId, nodeLookup, connectionMode)` reads `node.internals.handleBounds` to find the start handle and its absolute position. If none, it bails.
2. **Seed the connection state.** Builds a `ConnectionInProgress` object: `inProgress: true`, `from`/`fromHandle`/`fromPosition`/`fromNode` set, `to = pointer`, `toHandle: null`, `toPosition = oppositePosition[fromHandle.position]`.
3. **Drag threshold.** Movement only "starts" the connection once `dx² + dy² > dragThreshold²` (`dragThreshold` from `connectionDragThreshold`, default 1). If `dragThreshold === 0`, it starts immediately. On start it calls `updateConnection(...)` and `onConnectStart`.
4. **On each `pointermove`** (`onPointerMove`): recompute pointer position, find the closest candidate handle, validate, and push a new `ConnectionInProgress` via `updateConnection`. Also kicks off `autoPan` if the pointer nears the canvas edge.
5. **On `pointerup`** (`onPointerUp`): if there is a valid `connection`, calls `onConnect(connection)`. Then builds `FinalConnectionState` (the in-progress state minus `inProgress`) and calls `onConnectEnd` (and `onReconnectEnd` if this was an edge reconnect). Finally `cancelConnection()` resets state and detaches listeners.

### 5.2 Finding the closest candidate handle

`getClosestHandle` (`system/src/xyhandle/utils.ts:getClosestHandle`):

- Gathers nodes within `connectionRadius + ADDITIONAL_DISTANCE` (`ADDITIONAL_DISTANCE = 250`) of the pointer via the local `getNodesWithinDistance` helper (rough broad-phase — internally `getOverlappingArea(rect, nodeToRect(node)) > 0`, `utils.ts:getNodesWithinDistance`).
- Iterates every handle in each node's `handleBounds.source`/`.target`, **skipping the originating handle** (same `nodeId+type+id`).
- Computes Euclidean distance from pointer to handle center; discards handles farther than `connectionRadius`.
- Keeps the minimum-distance handle; on ties, collects all and **prefers the opposite handle type** (`source`→`target`).

This is why `connectionRadius` (a `<ReactFlow>` prop) creates "magnetic" snapping — you don't have to land exactly on a handle.

### 5.3 Validating a candidate — `XYHandle.isValid` (`isValidHandle`)

`isValidHandle` (`XYHandle.ts:isValidHandle`) decides whether the candidate is connectable. The core logic:

```ts
const handleBelow = doc.elementFromPoint(x, y);
// prefer the handle directly under the cursor over the closest-by-distance one
const handleToCheck = handleBelow?.classList.contains(`${lib}-flow__handle`) ? handleBelow : handleDomNode;

const connection: Connection = {
  source:       isTarget ? handleNodeId : fromNodeId,
  sourceHandle: isTarget ? handleId     : fromHandleId,
  target:       isTarget ? fromNodeId   : handleNodeId,
  targetHandle: isTarget ? fromHandleId : handleId,
};

const isConnectable = connectable && connectableEnd; // reads .connectable + .connectableend classes
const isValid =
  isConnectable &&
  (connectionMode === ConnectionMode.Strict
    ? (isTarget && handleType === 'source') || (!isTarget && handleType === 'target')
    : handleNodeId !== fromNodeId || handleId !== fromHandleId);

result.isValid = isValid && isValidConnection(connection); // user callback last
```

Key takeaways:

- **DOM-driven.** Validity is read from the candidate's CSS classes (`connectable`, `connectableend`) and `data-*` attributes — not from your React props directly. This is why programmatically toggling handle props works only after the DOM re-renders.
- **Direction is normalized** so `Connection` is always `{source→target}` regardless of which end you dragged from (`isTarget` flips the mapping).
- **`connectableend`** (i.e. `isConnectableEnd`) is what gates a handle as a drop target.
- **User `isValidConnection` runs last** and can veto an otherwise-valid connection.

`isConnectionValid` (`utils.ts`) maps the boolean to the tri-state used for visual feedback: `true` if valid, `false` if inside the radius but invalid, `null` if no candidate at all.

### 5.4 `ConnectionMode`: strict vs. loose

```ts
export enum ConnectionMode { Strict = 'strict', Loose = 'loose' }   // system/src/types/general.ts
```

- **Strict (default):** only `source → target`. The validity check requires the candidate's `handleType` to be the opposite of the dragged end.
- **Loose:** allows `source → source` and `target → target`. The check degrades to "any handle that isn't the exact originating handle (different `nodeId` or different `handleId`)."

Loose mode also changes lookup: `getHandle` in loose mode searches *both* `handleBounds.source` and `.target` arrays (`utils.ts:getHandle`), so a handle declared as `type="target"` can still originate a drag. Set via `<ReactFlow connectionMode={ConnectionMode.Loose}>`. The handle-level `connectingSelector` in `Handle/index.tsx` mirrors this: in strict mode a handle is a possible end only if `fromHandle.type !== type`.

### 5.5 `ConnectionState` — the observable connection machine

The whole in-progress connection is a discriminated union (`system/src/types/general.ts`):

```ts
export type ConnectionState<NodeType extends InternalNodeBase = InternalNodeBase> =
  | ConnectionInProgress<NodeType>
  | NoConnection;
```

`ConnectionInProgress` fields (all `null` in `NoConnection`):

| Field | Type | Meaning |
|---|---|---|
| `inProgress` | `true` | Discriminant. |
| `isValid` | `boolean \| null` | `true`/`false` over a handle/in radius, else `null`. |
| `from` | `XYPosition` | Start xy (flow coords). |
| `fromHandle` | `Handle` | Start handle. |
| `fromPosition` | `Position` | Start side. |
| `fromNode` | `InternalNode` | Start node. |
| `to` | `XYPosition` | Current end xy (snaps to handle when valid). |
| `toHandle` | `Handle \| null` | Hovered/candidate handle. |
| `toPosition` | `Position` | End side (opposite of `from` until snapped). |
| `toNode` | `InternalNode \| null` | Candidate node. |
| `pointer` | `XYPosition` | Raw pointer xy. |

Read it in React via `useConnection()`. `FinalConnectionState` (passed to `onConnectEnd`) is `Omit<ConnectionState,'inProgress'>` — use it to detect "dropped on empty pane" (`toHandle === null`) and, e.g., create a new node there. The initial value is the exported `initialConnection` constant — a `NoConnection` with every field `null` and `inProgress: false` (`system/src/types/general.ts:initialConnection`).

A custom connection line component receives a parallel `ConnectionLineComponentProps` (`react/src/types/edges.ts`) with `fromNode`, `fromHandle`, `fromX/fromY`, `toX/toY`, `connectionStatus: 'valid'|'invalid'|null`, `toHandle`, `toNode`, and `pointer` — fully detailed in §5.6.

### 5.6 Custom connection line — `connectionLineComponent` & `ConnectionLineWrapper`

The dashed line drawn *while you are dragging* a new connection (before it becomes an edge) is rendered separately from edges, by `ConnectionLineWrapper` (`react/src/components/ConnectionLine/index.tsx:ConnectionLineWrapper`). You override its look via the `<ReactFlow connectionLineComponent>` prop (`react/src/types/component-props.ts:312` → `connectionLineComponent?: ConnectionLineComponent<NodeType>`), which flows `GraphView → ConnectionLineWrapper` as the `component` prop (`GraphView/index.tsx:178` passes `component={connectionLineComponent}`).

**Exact props your component receives** (`react/src/types/edges.ts:ConnectionLineComponentProps`):

```ts
export type ConnectionLineComponentProps<NodeType extends Node = Node> = {
  connectionLineStyle?: CSSProperties;
  connectionLineType: ConnectionLineType;
  /** The node the connection line originates from. */
  fromNode: InternalNode<NodeType>;
  /** The handle on the `fromNode` that the connection line originates from. */
  fromHandle: Handle;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromPosition: Position;
  toPosition: Position;
  /**
   * If there is an `isValidConnection` callback, this prop will be set to `"valid"` or `"invalid"`
   * based on the return value of that callback. Otherwise, it will be `null`.
   */
  connectionStatus: 'valid' | 'invalid' | null;
  toNode: InternalNode<NodeType> | null;
  toHandle: Handle | null;
  pointer: XYPosition;
};

export type ConnectionLineComponent<NodeType extends Node = Node> = ComponentType<
  ConnectionLineComponentProps<NodeType>
>;
```

**How `ConnectionLineWrapper` renders** (`ConnectionLine/index.tsx`):

1. It subscribes to the store and only renders when `!!(width && nodesConnectable && inProgress)` — i.e. a drag is in progress, the canvas has a width, and connecting is enabled (`renderConnection`). Otherwise it returns `null`.
2. It draws an outer `<svg className="react-flow__connectionline react-flow__container">` sized to `width`/`height`, wrapping a `<g className={cc(['react-flow__connection', getConnectionStatus(isValid)])}>`. So the `valid`/`invalid` status class is applied to the group, derived from `store.connection.isValid` via `getConnectionStatus`.
3. Inside, the internal `ConnectionLine` reads the live machine with `useConnection<NodeType>()` and, **if a `CustomComponent` was supplied**, renders it with the mapping below:

```tsx
<CustomComponent
  connectionLineType={type}        // from <ReactFlow connectionLineType>
  connectionLineStyle={style}      // from <ReactFlow connectionLineStyle>
  fromNode={fromNode}
  fromHandle={fromHandle}
  fromX={from.x}  fromY={from.y}
  toX={to.x}      toY={to.y}
  fromPosition={fromPosition}
  toPosition={toPosition}
  connectionStatus={getConnectionStatus(isValid)}   // 'valid' | 'invalid' | null
  toNode={toNode}
  toHandle={toHandle}
  pointer={pointer}
/>
```

   `from.x/from.y` (drag origin in flow coords) become `fromX/fromY`; `to.x/to.y` (current end, which snaps to a handle when valid) become `toX/toY`. `pointer` is the raw, un-snapped pointer position. `connectionStatus` is the string form of `ConnectionState.isValid`.

4. If **no** `CustomComponent` is set, the wrapper instead builds a path itself from `type` (a `ConnectionLineType` — `Bezier`/`SimpleBezier`/`Step`/`SmoothStep`/`Straight`, default `Bezier`) by switching to `getBezierPath` / `getSimpleBezierPath` / `getSmoothStepPath({...,borderRadius:0})` for `Step` / `getSmoothStepPath` for `SmoothStep` / `getStraightPath` (default), then renders a single `<path className="react-flow__connection-path" style={style} />`. Note `Step` is just smoothstep with `borderRadius: 0` here too.

**Minimal custom connection line:** your component returns SVG (it is rendered inside the wrapper's `<g>`), so you typically draw a `<path>` and any end decoration:

```tsx
import { getStraightPath, type ConnectionLineComponentProps } from '@xyflow/react';

function CustomConnectionLine({ fromX, fromY, toX, toY, connectionStatus }: ConnectionLineComponentProps) {
  const [path] = getStraightPath({ sourceX: fromX, sourceY: fromY, targetX: toX, targetY: toY });
  return (
    <g>
      <path fill="none" stroke={connectionStatus === 'invalid' ? '#f00' : '#222'} strokeWidth={1.5} d={path} />
      <circle cx={toX} cy={toY} r={3} fill="#fff" stroke="#222" strokeWidth={1.5} />
    </g>
  );
}

<ReactFlow connectionLineComponent={CustomConnectionLine} />
```

`fromHandle`/`fromNode` are always set (you can only drag from a real handle); `toHandle`/`toNode` are `null` until the pointer is over a candidate, so guard them. The component lives only for the duration of a drag.

---

## 6. Dynamic handles & `updateNodeInternals`

React Flow caches each node's handle geometry in `node.internals.handleBounds` (measured once after render, via a `ResizeObserver` + the node mount). The connection engine reads **only** `handleBounds` — never the live DOM positions during distance checks (`getClosestHandle` uses `node.internals.handleBounds`). Therefore:

> If you add, remove, reposition, or re-id handles **after** the node's first measurement (e.g. handle count driven by state/props), the cached `handleBounds` is stale and the new handles won't connect correctly until you recompute them.

Call `useUpdateNodeInternals()` (`react/src/hooks/useUpdateNodeInternals.ts`). It returns a function `(id | id[]) => void` that re-measures the node's DOM and forces a `handleBounds` update:

```ts
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
```

Note it forces (`force: true`) and defers to the next animation frame, so call it **after** the render that mounts the new handles (inside the same `useEffect`/callback that changes the count):

```tsx
import { Handle, useUpdateNodeInternals } from '@xyflow/react';

function DynamicNode({ id }: NodeProps) {
  const updateNodeInternals = useUpdateNodeInternals();
  const [count, setCount] = useState(1);
  const onChange = (n: number) => { setCount(n); updateNodeInternals(id); };
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Handle key={i} type="target" position={Position.Left} id={`h-${i}`}
                style={{ top: 10 + i * 12 }} />
      ))}
      <button className="nodrag" onClick={() => onChange(count + 1)}>Add handle</button>
    </>
  );
}
```

(Pattern from `react/src/hooks/useUpdateNodeInternals.ts` JSDoc + the `handles.mdx` "Dynamic handles" section.) When a node has multiple handles of the same type, **each needs a unique `id`** so `getHandle`/`getClosestHandle` can disambiguate and so edges can pin `sourceHandle`/`targetHandle`. Position multiple same-side handles with inline `style` (`top`/`left`), per `handles.mdx` "Using multiple handles".

---

## 7. Observing connections on a node

`useNodeConnections` (`react/src/hooks/useNodeConnections.ts`) returns the live `NodeConnection[]` for a node/handle, sourced from the store's `connectionLookup` map. The lookup key is built as:

```ts
`${currentNodeId}${handleType ? (handleId ? `-${handleType}-${handleId}` : `-${handleType}`) : ''}`
```

```tsx
const targets = useNodeConnections({ handleType: 'target', handleId: 'in' });
// targets: { source, target, sourceHandle, targetHandle, edgeId }[]
```

It also accepts `onConnect`/`onDisconnect` callbacks fired via `handleConnectionChange` when the set changes (with the documented caveat that mount/unmount firing is undecided). Used outside a custom node without an explicit `id`, it throws error `014`.

---

## 8. Reconnecting existing edges

Edge endpoints are themselves draggable when reconnect is enabled. The `EdgeWrapper` renders `EdgeUpdateAnchors` and routes drags back through `XYHandle.onPointerDown` with an `edgeUpdaterType` (`'source'`/`'target'`). `getHandleType(edgeUpdaterType, dom)` (`xyhandle/utils.ts`) returns that type directly, so a reconnect drag is treated as originating from the chosen edge end. On drop, `onReconnectEnd` fires in addition to `onConnectEnd`. Enable globally with `<ReactFlow edgesReconnectable>` and the `onReconnect` handler, or per-edge with `edge.reconnectable` (`boolean | HandleType`). `reconnectRadius` controls the grab tolerance of the anchors.

---

## 9. Gotchas & cross-references

- **`nodeTypes`/`edgeTypes` identity must be stable** — define module-level or `useMemo`. Unstable identity re-creates components and warns.
- **Interactive content needs `nodrag`** (nodes) and edge label content needs `nodrag nopan` + `pointer-events:all`.
- **`<Handle>` must live inside a custom node** (needs `NodeIdContext`), else error `010`.
- **`markerStart`/`markerEnd` arrive on `EdgeProps` pre-resolved** to `url('#…')` strings — don't re-wrap them.
- **Dynamic handles ⇒ `updateNodeInternals(id)`** in the same callback that mutates handles; multiple same-type handles need unique `id`s.
- **Per-handle `isValidConnection` is slower** than the global `<ReactFlow isValidConnection>` because it runs on every candidate evaluation — prefer the global prop (noted in `system/src/types/handles.ts:HandleProps.isValidConnection`).
- **`zIndex` you receive in `NodeProps` is `internals.z`** (computed), not your raw `node.zIndex`.
- Svelte parity: `@xyflow/svelte@1.5.2` shares `@xyflow/system`'s `XYHandle`; the `<Handle>` props and `ConnectionMode` semantics are identical (`web/sites/svelteflow.dev/.../custom-nodes.mdx`, `custom-edges.mdx`).
