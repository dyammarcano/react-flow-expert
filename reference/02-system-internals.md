## What this covers

The framework-agnostic core in `@xyflow/system@0.0.76` is a set of **stateless factory functions** (`XYDrag`, `XYPanZoom`, `XYHandle`, `XYResizer`, `XYMinimap`) that own all imperative DOM/pointer/d3 logic and read live state through a `getStoreItems()` callback, so React (`@xyflow/react@12.10.2`) and Svelte (`@xyflow/svelte@1.5.2`) only supply a store binding, a `domNode`, and effect-driven `update()`/`destroy()` calls — they never reimplement drag, zoom, connection, resize, or measurement math.

---

## Mental model

`@xyflow/system` is the **engine**; the React and Svelte packages are **thin adapters**. The contract is always the same:

1. A framework component creates a ref/action pointing at a DOM element.
2. In an effect (React `useEffect` / Svelte action), it calls a factory like `XYDrag({ getStoreItems, ... })` **once**, capturing a closure over the framework store.
3. On every prop change it calls `instance.update({ domNode, ...params })`.
4. On unmount it calls `instance.destroy()`, which tears down the d3 event listeners.

The factories are framework-agnostic because:
- They never read the store directly — they call **`getStoreItems()`** (a function the adapter passes in) on every event, so they always see *fresh* state without re-binding listeners.
- They emit results by **calling callbacks** (`onTransformChange`, `updateNodePositions`, `updateConnection`, `onChange`) rather than mutating any framework state.
- They take a raw `Element`/`HTMLDivElement` and use **d3-selection** to attach behaviors.

Source: `packages/system/src/index.ts` re-exports `constants`, `types`, `utils`, `xydrag`, `xyhandle`, `xyminimap`, `xypanzoom`, `xyresizer`.

### d3 dependency surface

From `packages/system/package.json` `dependencies`: `d3-drag@^3.0.0`, `d3-zoom@^3.0.0`, `d3-selection@^3.0.0`, `d3-interpolate@^3.0.1` (the package declares no `peerDependencies`). Note: `d3-transition` is **not** a declared dependency, yet it is imported as a side-effect (`import { transition } from 'd3-transition'` in `xypanzoom/XYPanZoom.ts:24` and `xypanzoom/utils.ts:4`, both with an eslint-disable for the "unused" binding) so that `selection.transition()` is registered for viewport animation — it is pulled in transitively via `d3-zoom`. Each module uses a focused subset:

| Module | d3 packages used |
|---|---|
| `XYDrag` | `d3-drag` (`drag()`), `d3-selection` (`select`) |
| `XYPanZoom` | `d3-zoom` (`zoom`, `zoomTransform`, `zoomIdentity`, `ZoomTransform`), `d3-selection` (`select`, `pointer`), `d3-interpolate` (`interpolateZoom`, `interpolate`), `d3-transition` |
| `XYHandle` | none directly — uses raw `addEventListener`/`elementFromPoint` |
| `XYResizer` | `d3-drag`, `d3-selection` |
| `XYMinimap` | `d3-zoom` (`zoom`, `D3ZoomEvent`), `d3-selection` (`select`, `pointer`) |

---

## 1. XYDrag — node & selection dragging

**File:** `packages/system/src/xydrag/XYDrag.ts`, helpers in `packages/system/src/xydrag/utils.ts`.

### Responsibility
Drags a single node *or* the whole selection, applies extent/parent/snap-grid constraints, auto-pans the viewport when the cursor approaches an edge, enforces a drag threshold, and fires `onNodeDrag*` / `onSelectionDrag*` / generic `onDrag*` callbacks. It is the same factory used for the node body and (with `nodeId` undefined) for the selection box.

### Public API

```ts
export function XYDrag<NodeType, EdgeType>(params: XYDragParams): XYDragInstance;

export type XYDragInstance = {
  update: (params: DragUpdateParams) => void;
  destroy: () => void;
};

export type XYDragParams<NodeType, EdgeType> = {
  getStoreItems: () => StoreItems<NodeType, EdgeType>;
  onDragStart?: OnDrag<NodeType>;
  onDrag?: OnDrag<NodeType>;
  onDragStop?: OnDrag<NodeType>;
  onNodeMouseDown?: (id: string) => void;
  autoPanSpeed?: number;
};

export type DragUpdateParams = {
  noDragClassName?: string;   // e.g. "nodrag"
  handleSelector?: string;    // a CSS selector the pointer must hit (drag handle)
  isSelectable?: boolean;
  nodeId?: string;            // undefined ⇒ this instance drags the *selection*
  domNode: Element;
  nodeClickDistance?: number; // d3-drag clickDistance
};
```

`OnDrag` is `(event, dragItems: Map<string, NodeDragItem>, node, nodes) => void` (`XYDrag.ts:OnDrag`).

The `getStoreItems()` return (`StoreItems`) is the live store slice: `nodeLookup`, `nodes`, `edges`, `nodeExtent`, `snapGrid`, `snapToGrid`, `nodeOrigin`, `multiSelectionActive`, `transform`, `autoPanOnNodeDrag`, `nodesDraggable`, `selectNodesOnDrag`, `nodeDragThreshold`, `panBy`, `unselectNodesAndEdges`, `updateNodePositions`, plus optional `onNodeDrag*`/`onSelectionDrag*` and `onError` (`XYDrag.ts:StoreItems`).

### How `update()` works (the d3-drag wiring)
`update()` does `d3Selection = select(domNode)` then builds a `d3.drag()` behavior with four hooks and a filter, and `.call(...)`s it onto the selection (`XYDrag.ts:121-408`):

- **`.clickDistance(nodeClickDistance)`** — pixels the pointer may move before it is no longer a click.
- **`.filter((event) => ...)`** — returns draggable only when `!event.button` (left button), the target is **not** inside `.${noDragClassName}`, and — if a `handleSelector` is set — the target **is** inside it. Selector matching uses `hasSelector(target, selector, domNode)` which walks `parentElement` up to `domNode` calling `current.matches(selector)` (`utils.ts:hasSelector`).
- **`.on('start')`** — caches `containerBounds = domNode.getBoundingClientRect()`, resets `abortDrag`/`nodePositionsChanged`, stores `dragEvent`. If `nodeDragThreshold === 0` it starts immediately; otherwise it defers. It records `mousePosition` via `getEventPosition` and `lastPos` via `getPointerPosition`.
- **`.on('drag')`** — recomputes pointer position; aborts on multi-touch (`touches.length > 1`) or if the dragged node was deleted (`nodeId && !nodeLookup.has(nodeId)`). Lazily starts auto-pan. If the threshold hasn't been crossed it measures client-space distance `sqrt(x²+y²)` and only calls `startDrag` once `distance > nodeDragThreshold` (threshold is measured in **client pixels** so it's zoom-independent). Skips no-movement events by comparing `lastPos` to `pointerPos.xSnapped/ySnapped`.
- **`.on('end')`** — cancels auto-pan, flushes a final `updateNodePositions(dragItems, false)` (dragging=false) if anything changed, fires `onNodeDragStop`/`onSelectionDragStop`.

### `startDrag` and selection semantics
`startDrag` (`XYDrag.ts:259`) handles select-on-drag: if `selectNodesOnDrag` is off (or not selectable) and not multi-select, and the node isn't already selected, it calls `unselectNodesAndEdges()`; if select-on-drag is on it calls `onNodeMouseDown(nodeId)`. It then builds the drag set via `getDragItems(nodeLookup, nodesDraggable, pointerPos, nodeId)`.

`getDragItems` (`utils.ts:35`) collects every node that is **selected or equals `nodeId`**, is draggable, and is **not** a child of a selected parent (`isParentSelected`, a recursive walk up `parentId`). For each it records `position`, `distance` (cursor-to-`positionAbsolute` offset captured at start), `extent`, `parentId`, `origin`, `expandParent`, and `measured` w/h. The `distance` is the key to smooth dragging: every move computes `nextPosition = pointer - distance`.

### `updateNodes` — the per-frame position math
On each move `updateNodes({x, y})` (`XYDrag.ts:130`):
1. For multi-drag it computes a shared bounding box (`getInternalNodesBounds(dragItems)`) and, when snapping, a single shared snap offset (`calculateSnapOffset`) so the whole selection snaps coherently rather than each node independently.
2. Per item: `nextPosition = { x - distance.x, y - distance.y }`, optionally snapped.
3. For multi-drag with a `nodeExtent` it **shrinks** the extent per node so the *group* stays inside the extent (computed from `positionAbsolute`, `measured`, and the group box).
4. Calls **`calculateNodePosition`** (see Core utils) to resolve `position`/`positionAbsolute` honoring parent extent, `extent:'parent'`, and `origin`.
5. Tracks `hasChange`; if nothing moved it returns early (no store churn). Otherwise `updateNodePositions(dragItems, true)` and fires drag callbacks built by `getEventHandlerParams` (which materializes the dragged `userNode` + the full selection with the new `position` and `dragging: true`).

### Auto-pan
`autoPan()` (`XYDrag.ts:232`) runs on `requestAnimationFrame`. It calls `calcAutoPan(mousePosition, containerBounds, autoPanSpeed)`; if movement is non-zero it adjusts `lastPos` by `-movement / transform[2]` (scaling screen movement into flow coordinates), awaits `panBy(...)`, and re-runs `updateNodes` so nodes keep tracking the cursor while the canvas scrolls. It self-cancels if `autoPanOnNodeDrag` becomes false.

### `destroy()`
`d3Selection?.on('.drag', null)` — removes all `.drag`-namespaced listeners.

### Framework wiring
- **React** `packages/react/src/hooks/useDrag.ts`: creates `XYDrag({ getStoreItems: () => store.getState(), onNodeMouseDown: handleNodeClick, onDragStart/Stop: setDragging })` in a mount-only effect, then a second effect calls `xyDrag.current.update({ domNode: nodeRef.current, ... })` on prop change and returns `destroy` as cleanup. Returns the `dragging` boolean.
- **Svelte** `packages/svelte/src/lib/actions/drag/index.ts`: a Svelte **action**; `getStoreItems` maps the runes-based `store` (`store.nodeLookup`, `store.viewport`, etc.) into the `StoreItems` shape (note `transform: [viewport.x, viewport.y, viewport.zoom]` and `snapToGrid: !!snapGrid`). The action's `update`/`destroy` proxy to the instance.

---

## 2. XYPanZoom — viewport pan & zoom

**File:** `packages/system/src/xypanzoom/XYPanZoom.ts`; handlers in `eventhandler.ts`, gate in `filter.ts`, math in `utils.ts`.

### Responsibility
Wraps **d3-zoom** to implement the canvas pan/zoom, including pan-on-scroll, pinch-zoom, zoom-on-double-click, programmatic viewport animation, translate/scale extents, right-click-pan + context menu coordination, and `nopan`/`nowheel` class gating.

### Public API

```ts
export function XYPanZoom(params: PanZoomParams): PanZoomInstance;

export type PanZoomInstance = {
  update: (params: PanZoomUpdateOptions) => void;
  destroy: () => void;
  getViewport: () => Viewport;
  setViewport: (v: Viewport, o?: PanZoomTransformOptions) => Promise<ZoomTransform | undefined>;
  setViewportConstrained: (v: Viewport, extent, translateExtent) => Promise<ZoomTransform | undefined>;
  setScaleExtent: (scaleExtent: [number, number]) => void;
  setTranslateExtent: (translateExtent: CoordinateExtent) => void;
  scaleTo: (scale: number, o?: PanZoomTransformOptions) => Promise<boolean>;
  scaleBy: (factor: number, o?: PanZoomTransformOptions) => Promise<boolean>;
  syncViewport: (viewport: Viewport) => void;
  setClickDistance: (distance: number) => void;
};
```

`PanZoomParams` (`types/panzoom.ts`): `{ domNode, minZoom, maxZoom, viewport, translateExtent, onDraggingChange, onPanZoomStart?, onPanZoom?, onPanZoomEnd? }`.

### Construction
In the factory body (runs once per `domNode`):

```ts
const d3ZoomInstance = zoom().scaleExtent([minZoom, maxZoom]).translateExtent(translateExtent);
const d3Selection = select(domNode).call(d3ZoomInstance);
// initial constrained viewport
setViewportConstrained({ x, y, zoom: clamp(zoom, minZoom, maxZoom) }, [[0,0],[bbox.width,bbox.height]], translateExtent);
const d3ZoomHandler = d3Selection.on('wheel.zoom')!;          // d3's native wheel handler, stashed
const d3DblClickZoomHandler = d3Selection.on('dblclick.zoom')!;
d3ZoomInstance.wheelDelta(wheelDelta);                        // custom wheel→zoom delta
```

Stashing d3's own `wheel.zoom` / `dblclick.zoom` handlers lets `update()` swap them in and out depending on `panOnScroll`/`zoomOnDoubleClick` without recreating the zoom behavior. `wheelDelta` (`utils.ts:36`) is `-deltaY * (deltaMode===1 ? 0.05 : deltaMode ? 1 : 0.002) * factor` where `factor` is `10` for ctrl+Mac (trackpad pinch).

### `update()` — rebinding handlers per prop change
`update(opts: PanZoomUpdateOptions)` (`XYPanZoom.ts:91`) rebuilds the four d3-zoom event handlers and the filter on every call:

- If `userSelectionActive && !isZoomingOrPanning` → `destroy()` (suspends zoom while a selection box is drawn).
- `d3ZoomInstance.clickDistance(...)` — `Infinity` when `selectionOnDrag` (so a drag never counts as a pane click), else the validated `paneClickDistance`.
- **wheel handler**: `createPanOnScrollHandler(...)` when `panOnScroll && !zoomActivationKeyPressed && !userSelectionActive`, otherwise `createZoomOnScrollHandler(...)`. Bound via `d3Selection.on('wheel.zoom', wheelHandler, { passive: false })`.
- `d3ZoomInstance.on('start' | 'zoom' | 'end', ...)` ← `createPanZoomStartHandler` / `createPanZoomHandler` / `createPanZoomEndHandler`.
- `d3ZoomInstance.filter(createFilter(...))`.
- `dblclick.zoom` is toggled directly on the selection (not via filter) because **double-tap on touch bypasses the d3 filter**.

`PanZoomUpdateOptions` includes `noWheelClassName`, `noPanClassName`, `onPaneContextMenu`, `userSelectionActive`, `panOnScroll`, `panOnDrag` (`boolean | number[]` of mouse buttons), `panOnScrollMode`, `panOnScrollSpeed`, `preventScrolling`, `zoomOnPinch`, `zoomOnScroll`, `zoomOnDoubleClick`, `zoomActivationKeyPressed`, `lib`, `onTransformChange`, `connectionInProgress`, `paneClickDistance`, `selectionOnDrag`.

### The event handlers (`eventhandler.ts`)
Internal mutable state lives in `ZoomPanValues` (`isZoomingOrPanning`, `usedRightMouseButton`, `prevViewport`, `mouseButton`, `timerId`, `panScrollTimeout`, `isPanScrolling`).

- **`createPanZoomStartHandler`**: ignores synthetic events (`event.sourceEvent?.internal`), records `mouseButton` (it's `0` during the zoom event so it must be captured here), sets `isZoomingOrPanning`, and calls `onDraggingChange(true)` on `mousedown`.
- **`createPanZoomHandler`**: the live zoom handler. It computes `usedRightMouseButton` for context-menu coordination, and — unless the event is a `sync` (programmatic) event — calls **`onTransformChange([transform.x, transform.y, transform.k])`**, which is how the new viewport flows back into the framework store. Also fires `onPanZoom`.
- **`createPanZoomEndHandler`**: clears dragging, optionally fires `onPaneContextMenu` for a completed right-click that *didn't* pan, and debounces `onPanZoomEnd` with a `setTimeout` (`150ms` for pan-on-scroll, else `0`) to coalesce trailing events.
- **`createPanOnScrollHandler`**: bypasses d3's wheel→zoom entirely. On ctrl+wheel with `zoomOnPinch` it does `d3Zoom.scaleTo`; otherwise it normalizes `deltaX/deltaY` (Firefox `deltaMode===1` ⇒ ×20, shift⇒horizontal on non-Mac) and calls `d3Zoom.translateBy(..., { internal: true })`. Because d3's own start/zoom/end fire on *every* scroll tick, it **hand-rolls** start/move/end via the `isPanScrolling` flag and a `150ms` `panScrollTimeout`.
- **`createZoomOnScrollHandler`**: gates `nowheel` and `preventScrolling`, then delegates to the stashed native `d3ZoomHandler.call(this, event, d)`.

### The filter (`filter.ts`)
`createFilter(...)` returns the d3-zoom `filter` predicate deciding which raw events d3 acts on. Key rules in order: middle-click on a node/edge passes (for panning over them); if **all** interactions are disabled → false; during `userSelectionActive` → false; during `connectionInProgress` non-wheel events → false; `nowheel`/`nopan` class gating; pinch handling when `!zoomOnPinch`; wheel allowed only if some scroll mode is on; `panOnDrag` button gating (`Array.isArray(panOnDrag) && !panOnDrag.includes(event.button)` blocks). Final return: `(!event.ctrlKey || isWheelEvent) && buttonAllowed`.

### Programmatic viewport
- `setTransform(transform, options)` resolves a Promise when the transition ends; `getD3Transition(selection, duration, ease, onEnd)` (`utils.ts:26`) returns either the bare selection (duration 0, calls `onEnd` synchronously) or `selection.transition().duration(d).ease(e).on('end', onEnd)`. `interpolate` chooses `interpolateZoom` (smooth) vs `interpolate` (linear).
- `setViewportConstrained` runs the transform through `d3ZoomInstance.constrain()(...)` before applying — this is how `fitView`, minimap pan, and `panBy` stay inside `translateExtent`.
- `syncViewport(viewport)` writes the transform with a `{ sync: true }` flag so the zoom handler **skips** `onTransformChange` (prevents an echo loop when the store drives the viewport).
- `getViewport()` reads `zoomTransform(node)` → `{ x, y, zoom: k }`.

### `destroy()`
`d3ZoomInstance.on('zoom', null)` — detaches the zoom handler only (the selection keeps the behavior so `update()` can re-arm it).

### Framework wiring
**React** `packages/react/src/container/ZoomPane/index.tsx`: a mount effect creates `XYPanZoom({ domNode, minZoom, maxZoom, translateExtent, viewport, onDraggingChange, onPanZoom* })`, then `store.getState().panZoom = panZoom.current`. `onTransformChange` is a `useCallback` that writes `[x,y,zoom]` into the store. A second effect calls `panZoom.current.update({...})` on every relevant prop. **Svelte** mirrors this in `packages/svelte/src/lib/actions/zoom/index.ts`.

---

## 3. XYHandle — connection lifecycle

**File:** `packages/system/src/xyhandle/XYHandle.ts`; helpers in `utils.ts`, types in `types.ts`.

### Responsibility
Drives creating a new edge (and reconnecting an existing one): from `pointerdown` on a handle, it tracks the pointer, finds the closest valid target handle within `connectionRadius`, validates per `connectionMode` + `isValidConnection`, streams an in-progress connection to the store via `updateConnection`, auto-pans, and on `pointerup` fires `onConnect`/`onConnectEnd`/`onReconnectEnd`.

### Public API
Unlike the others, `XYHandle` is a **singleton object**, not a per-instance factory:

```ts
export const XYHandle: XYHandleInstance = { onPointerDown, isValid: isValidHandle };

export type XYHandleInstance = {
  onPointerDown: (event: MouseEvent | TouchEvent, params: OnPointerDownParams) => void;
  isValid:       (event: MouseEvent | TouchEvent, params: IsValidParams) => Result;
};
```

There is no `update`/`destroy`; each `pointerdown` spins up its own `mousemove/mouseup/touchmove/touchend` listeners on the correct document (or **shadow root** via `getHostForElement`) and removes them on pointer-up. Key `OnPointerDownParams` fields (`types.ts`): `connectionMode`, `connectionRadius`, `handleId`, `nodeId`, `isTarget`, `domNode`, `nodeLookup`, `lib`, `flowId`, `edgeUpdaterType?`, `updateConnection`, `panBy`, `cancelConnection`, `onConnectStart/onConnect/onConnectEnd`, `isValidConnection`, `onReconnectEnd`, `getTransform`, `getFromHandle`, `autoPanSpeed?`, `dragThreshold = 1`, `handleDomNode`.

### `onPointerDown` flow (`XYHandle.ts:26`)
1. Resolve `doc = getHostForElement(event.target)`, the start handle type (`getHandleType` from `edgeUpdaterType` or the handle DOM node's `source`/`target` class), and `containerBounds`. Bail if missing.
2. `fromHandleInternal = getHandle(nodeId, handleType, handleId, nodeLookup, connectionMode)` — the originating handle's stored bounds.
3. Build the initial `ConnectionInProgress` object: `inProgress: true`, `from` (absolute handle position from `getHandlePosition(fromNode, fromHandle, Left, true)`), `fromHandle/fromNode/fromPosition`, `to: pointer`, `toHandle/toNode: null`, `toPosition: oppositePosition[fromHandle.position]`.
4. `dragThreshold === 0` ⇒ start immediately; else `startConnection()` only fires once pointer moves past `dx²+dy² > dragThreshold²`. `startConnection` calls `updateConnection(previousConnection)` and `onConnectStart`.

### `onPointerMove`
On each move it: converts the pointer to flow coords (`pointToRendererPoint(position, transform, false, [1,1])`), finds `closestHandle = getClosestHandle(...)`, lazily starts auto-pan, then runs `isValidHandle(...)` and assembles a new connection with `to` snapped to the target handle (via `rendererPointToPoint`) when valid, `toHandle`, `toPosition`, `toNode`, and `pointer`. It calls `updateConnection(newConnection)` and stores it as `previousConnection`.

### `getClosestHandle` (`utils.ts:28`)
Gathers candidate nodes overlapping a square of side `2*(connectionRadius+250)` around the pointer (`getNodesWithinDistance` using `getOverlappingArea`). For each handle it computes the absolute center (`getHandlePosition(node, handle, handle.position, true)`), Euclidean distance, skips the origin handle and anything beyond `connectionRadius`, and keeps the minimum. **Ties prefer the opposite handle type** (source↔target).

### `isValidHandle` (`XYHandle.ts:252`)
Picks the handle to check: it prefers the handle **directly under the pointer** (`doc.elementFromPoint(x,y)` with the `${lib}-flow__handle` class) over the geometric closest, since center-distance can mislead. It reads `data-nodeid`/`data-handleid`, `connectable`/`connectableend` classes, builds a `Connection`, and validates: in `ConnectionMode.Strict` only source↔target are allowed; otherwise any non-self handle. Then `result.isValid = isValid && isValidConnection(connection)`.

### `onPointerUp`
Ignores multi-touch residue. If a connection was started and `(closestHandle || resultHandleDomNode) && connection && isValid`, fires `onConnect(connection)`. It strips `inProgress` from `previousConnection`, fires `onConnectEnd(event, finalConnectionState)` (and `onReconnectEnd` if `edgeUpdaterType`), then `cancelConnection()`, cancels auto-pan, and removes all four listeners.

### Framework wiring
**React** `packages/react/src/components/Handle/index.tsx`: the `Handle` component's `onPointerDown`/`onTouchStart` call `XYHandle.onPointerDown(event.nativeEvent, { ...store-derived params })`. **Svelte** uses the same singleton from `Handle.svelte`/`EdgeReconnectAnchor.svelte`.

### Connection state types

The shape that `updateConnection` streams into the store and that `useConnection`/`onConnectEnd`/`onReconnectEnd` expose. Defined in `packages/system/src/types/general.ts` (not `handles.ts`). `ConnectionState = ConnectionInProgress | NoConnection`; the two variants are discriminated by the `inProgress` literal.

**`NoConnection`** (`types/general.ts:NoConnection`) — every field is the literal `false`/`null`; `initialConnection: NoConnection` is the store's default:
```ts
export type NoConnection = {
  inProgress: false;
  isValid: null;
  from: null;
  fromHandle: null;
  fromPosition: null;
  fromNode: null;
  to: null;
  toHandle: null;
  toPosition: null;
  toNode: null;
  pointer: null;
};
```

**`ConnectionInProgress<NodeType extends InternalNodeBase = InternalNodeBase>`** (`types/general.ts:ConnectionInProgress`) — exact fields (note: `fromHandle`/`from`/`fromPosition`/`fromNode`/`to`/`toPosition`/`pointer` are always set once in progress; only the `to*` *target* fields are nullable when not yet over a valid handle):
```ts
export type ConnectionInProgress<NodeType extends InternalNodeBase = InternalNodeBase> = {
  inProgress: true;
  isValid: boolean | null;   // true/false when over a handle or within radius, else null
  from: XYPosition;          // xy start position
  fromHandle: Handle;        // start handle
  fromPosition: Position;    // side of the start handle
  fromNode: NodeType;        // start node
  to: XYPosition;            // xy end position
  toHandle: Handle | null;   // end handle (null if not over one)
  toPosition: Position;      // side of the end handle
  toNode: NodeType | null;   // end node (null if none)
  pointer: XYPosition;       // pointer position
};
```

**`FinalConnectionState<NodeType extends InternalNodeBase = InternalNodeBase>`** (`types/general.ts:FinalConnectionState`) is simply `Omit<ConnectionState<NodeType>, 'inProgress'>` — the connection state with the discriminant dropped. This is the type handed to `onConnectEnd`/`onReconnectEnd` (see `OnConnectEnd`/`OnReconnectEnd` in the same file), so handlers can read `fromNode`/`toNode`/`isValid` after the gesture ends without a discriminated union.

---

## 4. XYResizer — NodeResizer drag math

**File:** `packages/system/src/xyresizer/XYResizer.ts`; math in `utils.ts`, types in `types.ts`.

### Responsibility
Backs the `NodeResizer`/`NodeResizeControl` components. A `d3-drag` on a resize control computes the node's new `width/height/x/y` honoring min/max bounds, `keepAspectRatio`, parent extent (`extent:'parent'`), child constraints (`expandParent`/child `extent:'parent'`), `nodeOrigin`, snap grid, and single-axis `resizeDirection`. It also re-positions child nodes when the top/left edge moves so they don't drift.

### Public API

```ts
export function XYResizer(params: XYResizerParams): XYResizerInstance;

export type XYResizerInstance = { update: (p: XYResizerUpdateParams) => void; destroy: () => void; };
```

`XYResizerParams`: `{ domNode: HTMLDivElement, nodeId, getStoreItems, onChange, onEnd? }`. `getStoreItems()` returns `{ nodeLookup, transform, snapGrid?, snapToGrid, nodeOrigin, paneDomNode }`. `XYResizerUpdateParams`: `{ controlPosition, boundaries: {minWidth,minHeight,maxWidth,maxHeight}, keepAspectRatio, resizeDirection?, onResizeStart?, onResize?, onResizeEnd?, shouldResize? }`.

Callbacks: `onChange(changes: XYResizerChange, childChanges: XYResizerChildChange[])` where `XYResizerChange = { x?, y?, width?, height? }`; `onEnd(change: Required<XYResizerChange>)`. `ResizeDragEvent = D3DragEvent<HTMLDivElement, null, SubjectPosition>`.

### `update()` drag lifecycle (`XYResizer.ts:112`)
`select(domNode).call(drag<HTMLDivElement, unknown>()...)` with:

- **`start`**: snapshots `prevValues` (node w/h/x/y) and `startValues` (+ `pointerX/pointerY` from `getPointerPosition`, `aspectRatio = width/height`). Resolves `nodeExtent` (own `extent`, or the parent's box for `extent:'parent'`). Collects `childNodes` (to correct positions) and a `childExtent` — the union box of children with `expandParent`/`extent:'parent'` — which is the minimum the parent may shrink to. Fires `onResizeStart`.
- **`drag`**: gets snapped pointer, calls **`getDimensionsAfterResize(startValues, controlDirection, pointerPosition, boundaries, keepAspectRatio, nodeOrigin, nodeExtent, childExtent)`**. Diffs against `prevValues`; bails if nothing changed. When x/y change (or origin is 1) it sets `change.x/y` and shifts every child by `-xChange + origin[0]*(width-prevWidth)` so children stay put. Applies `resizeDirection` to lock an axis. Fixes `expandParent` overshoot from top/left. Computes a `direction` (`getResizeDirection`) for callbacks. `shouldResize` can veto (`=== false` ⇒ return). Else `onResize(event, nextValues)` and `onChange(change, childChanges)`.
- **`end`**: only if a resize actually happened (`resizeDetected`), fires `onResizeEnd` and `onEnd`.

### `getDimensionsAfterResize` (`utils.ts:114`) — the constraint solver
This is the "chunky" function the source comments warn about. The strategy: instead of clamping each value independently, it computes the **strongest restriction** as a single `clampX`/`clampY` (in pointer-movement units `distX/distY`) and applies it uniformly. It folds in, via `Math.max`, the clamps from: min/max size (`getSizeClamp`), parent `extent` lower/upper bounds, `childExtent`, and — when `keepAspectRatio` — the aspect-driven clamp of the opposing axis (separately for horizontal/vertical/diagonal). `nodeOrigin` is handled by offsetting as if origin were `[0,0]`, computing clamps, then re-applying the origin offset in the returned `x/y`. `getControlDirection(controlPosition)` yields `{ isHorizontal, isVertical, affectsX (left), affectsY (top) }`.

### `destroy()`
`selection.on('.drag', null)`.

### Framework wiring
**React** `packages/react/src/additional-components/NodeResizer/NodeResizeControl.tsx`: creates `XYResizer({ domNode, nodeId, getStoreItems, onChange, onEnd })`; `onChange` converts `XYResizerChange`/`XYResizerChildChange[]` into `NodeDimensionChange`/`NodePositionChange` and pushes them through `store.triggerNodeChanges`. **Svelte**: `ResizeControl.svelte`.

---

## 5. XYMinimap — minimap pan/zoom interaction

**File:** `packages/system/src/xyminimap/index.ts`.

### Responsibility
Makes the minimap SVG interactive: dragging inside it pans the main viewport (optionally inverted), wheeling zooms it. It does **not** own a transform — it drives the main `PanZoomInstance`.

### Public API

```ts
export function XYMinimap(params: XYMinimapParams): XYMinimapInstance;

export type XYMinimapInstance = {
  update: (params: XYMinimapUpdate) => void;
  destroy: () => void;
  pointer: typeof pointer;   // re-exported d3-selection pointer
};
```

`XYMinimapParams`: `{ panZoom: PanZoomInstance, domNode: Element, getTransform: () => Transform, getViewScale: () => number }`. `XYMinimapUpdate`: `{ translateExtent, width, height, inversePan?, zoomStep? = 1, pannable? = true, zoomable? = true }`.

### How it works
`update()` builds a `d3.zoom()` purely to harvest pointer/wheel events (it ignores the zoom transform):

- **wheel** (`zoom.wheel` handler, active when `zoomable`): converts `deltaY` into `pinchDelta` (Mac/ctrl ×10), `nextZoom = transform[2] * 2^(pinchDelta*factor)`, and calls `panZoom.scaleTo(nextZoom)`.
- **pan** (`start` + `zoom` handlers, active when `pannable`): tracks raw `clientX/clientY`, computes `panDelta`, scales it by `getViewScale() * max(zoom, log(zoom)) * (inversePan ? -1 : 1)`, and applies it through **`panZoom.setViewportConstrained({ x, y, zoom }, [[0,0],[width,height]], translateExtent)`** so the pan respects the same translate extent as the main canvas.

`destroy()`: `selection.on('zoom', null)`. **React** wiring is in `packages/react/src/additional-components/MiniMap/MiniMap.tsx`; **Svelte** in `plugins/Minimap/interactive.ts`.

---

## Node measurement & ResizeObserver

This is the bridge between rendered DOM and the store's geometry. The system package provides the measurement primitives; the framework packages own the `ResizeObserver`.

### Primitives (`packages/system/src/utils/dom.ts`)
- `getDimensions(node) => { width: node.offsetWidth, height: node.offsetHeight }`.
- `getHandleBounds(type, nodeElement, nodeBounds, zoom, nodeId)` — `querySelectorAll('.source'|'.target')`, and for each handle records `id`(`data-handleid`), `position`(`data-handlepos`), and **zoom-corrected** offsets `x = (handleRect.left - nodeRect.left) / zoom`, `y = (handleRect.top - nodeRect.top)/zoom`, plus its own dimensions. Dividing by zoom converts screen pixels back into flow-space units so handle positions are zoom-independent.

### The update path (`packages/system/src/utils/store.ts:updateNodeInternals`)
`updateNodeInternals(updates: Map<string, InternalNodeUpdate>, nodeLookup, parentLookup, domNode, nodeOrigin?, nodeExtent?, zIndexMode?)`:
1. Reads `zoom` from the live `.xyflow__viewport` CSS transform via `new DOMMatrixReadOnly(style.transform).m22` (so measurement is correct mid-zoom).
2. Per update: `dimensions = getDimensions(update.nodeElement)`. It updates only when there are real dimensions **and** (`dimensionChanged || !handleBounds || update.force`).
3. On update it clamps `positionAbsolute` (parent box for `extent:'parent'`, else `nodeExtent`), writes `measured: dimensions` and `internals.handleBounds = { source: getHandleBounds('source', ...), target: getHandleBounds('target', ...) }`, updates child relationships, and emits a `dimensions` change (and queues `expandParent` work). Hidden nodes get `handleBounds: undefined`.

### Who feeds it (`@xyflow/react`)
- `container/NodeRenderer/useResizeObserver.ts`: creates **one** `ResizeObserver`; in its callback it builds a `Map<string, InternalNodeUpdate>` of `{ id, nodeElement, force: true }` keyed by `data-id` and calls `store.updateNodeInternals(updates)`.
- `components/NodeWrapper/useNodeObserver.ts`: observes/unobserves the node's element, and additionally forces an internals update when `type`/`sourcePosition`/`targetPosition` change (so handle bounds re-measure even without a size change).

So the loop is: **DOM resizes → ResizeObserver fires → `updateNodeInternals` re-measures via `getDimensions`/`getHandleBounds` → store `measured`/`handleBounds` update → edges/handles re-render.**

---

## Core utils deep-dive

### `utils/general.ts` — geometry & coordinates

| Symbol | Signature / behavior |
|---|---|
| `clamp(val, min=0, max=1)` | `Math.min(Math.max(val,min),max)` |
| `clampPosition(pos, extent, dims)` | clamps a position inside an extent accounting for node size |
| `clampPositionToParent(childPos, childDims, parent)` | clamps child inside parent's absolute box |
| `calcAutoPan(pos, bounds, speed=15, distance=40) => number[]` | returns `[xMovement, yMovement]`; non-zero only when the cursor is within `distance` px of an edge; uses the module-private `calcAutoPanVelocity(value, min, max)` (returns roughly -1..1: positive near the low edge, negative near the high edge, 0 in between) scaled by `speed` |
| `rectToBox` / `boxToRect` | convert `{x,y,w,h}` ↔ `{x,y,x2,y2}` |
| `getBoundsOfBoxes` / `getBoundsOfRects` | union of two boxes/rects |
| `nodeToRect(node, origin=[0,0])` / `nodeToBox(...)` | node → rect/box; uses `internals.positionAbsolute` for internal nodes, dimension fallback chain `measured ?? width ?? initialWidth ?? 0` |
| `getOverlappingArea(a, b)` | `ceil(xOverlap * yOverlap)`; 0 if disjoint |
| `snapPosition(pos, grid=[1,1])` | `grid[i]*round(pos/grid[i])` |
| `pointToRendererPoint({x,y}, [tx,ty,k], snap?, grid?)` | **screen→flow**: `(p - t)/k` |
| `rendererPointToPoint({x,y}, [tx,ty,k])` | **flow→screen**: `p*k + t` |
| `getViewportForBounds(bounds, width, height, minZoom, maxZoom, padding)` | computes the `Viewport` that centers `bounds` (used by `fitView`); zoom = `clamp(min(xZoom,yZoom), minZoom, maxZoom)`, with asymmetric padding offset correction |
| `getNodeDimensions(node)` | dimension fallback `measured ?? width ?? initialWidth ?? 0` |
| `nodeHasDimensions(node)` | whether width & height are known |
| `evaluateAbsolutePosition(pos, dims, parentId, lookup, origin)` | child→absolute using parent's `positionAbsolute` minus origin offset |
| `isCoordinateExtent(extent)` | type guard: not `undefined`/`null`/`'parent'` |
| `isMacOs()`, `isNumeric(n)`, `areSetsEqual(a,b)`, `withResolvers<T>()` | misc helpers (`withResolvers` is a `Promise.withResolvers` polyfill) |
| `devWarn(id, msg)` | dev-only console warning with `reactflow.dev/error#<id>` link |

### `utils/graph.ts` — graph queries & node position

| Symbol | Behavior |
|---|---|
| `isEdgeBase` / `isNodeBase` / `isInternalNodeBase` | type guards |
| `getOutgoers(node, nodes, edges)` / `getIncomers(...)` | neighbors via edges |
| `getNodePositionWithOrigin(node, origin=[0,0])` | applies origin offset to position |
| `getNodesBounds(nodes, ...)` | bounding rect of user nodes |
| `getInternalNodesBounds(nodeLookup, { filter? })` | bounding `Rect` of internal nodes/drag-items; accumulates `getBoundsOfBoxes(box, nodeToBox(node))`; returns `{0,0,0,0}` if none |
| `getNodesInside(nodes, rect, transform, partially?, excludeNonSelectable?)` | nodes overlapping a (screen) rect; converts rect to flow space, compares `getOverlappingArea` to node area; always includes un-measured nodes (`forceInitialRender`) and currently dragging nodes |
| `getConnectedEdges(nodes, edges)` | edges where source or target is in `nodes` |
| `fitViewport({nodes,width,height,panZoom,minZoom,maxZoom}, options?)` | filters visible nodes (`getFitViewNodes`), `getInternalNodesBounds`, `getViewportForBounds`, then `panZoom.setViewport(...)` with duration/ease/interpolate — the engine behind `fitView()` |
| `calculateNodePosition({nodeId, nextPosition, nodeLookup, nodeOrigin, nodeExtent, onError})` | **the core position resolver**: resolves parent offset, builds the effective `extent` (parent box for `extent:'parent'`, or parent-relative coordinate extent), `clampPosition`s into it, and returns `{ position (parent-relative, origin-adjusted), positionAbsolute }`. Emits error `005` ("Only child nodes can use a parent extent." — fired when `extent:'parent'` but no `parentNode`) / `015` ("...trying to drag a node that is not initialized..." — fired when `node.measured.width/height` is `undefined`) via `onError` (`constants.ts:error005`/`error015`, thrown at `graph.ts:417`/`graph.ts:441`). Used by `XYDrag.updateNodes`. |
| `getElementsToRemove({...})` | **async** (`graph.ts:getElementsToRemove`, signature `{ nodesToRemove, edgesToRemove, nodes, edges, onBeforeDelete? } => Promise<{ nodes, edges }>`). Resolves the *actual* set to delete: (1) skips any node with `deletable === false`, includes a node if its id is in `nodesToRemove` **or** if its `parentId` is already in the matched set (so descendants of a deleted parent are pulled in); (2) from the `deletable !== false` edges it takes `getConnectedEdges(matchingNodes, ...)` (edges attached to removed nodes) **plus** any edge explicitly listed in `edgesToRemove`; (3) if no `onBeforeDelete` hook, returns those two arrays directly; otherwise `await onBeforeDelete({nodes, edges})` — a `boolean` result means delete-all (`true`) or delete-nothing (`false`, returns `{nodes:[],edges:[]}`), and an object result `{nodes, edges}` replaces the sets entirely (lets the hook filter/augment what gets removed). |

### `utils/store.ts` — store-side helpers
`adoptUserNodes` (`store.ts:adoptUserNodes`, signature `(nodes, nodeLookup, parentLookup, options?) => { nodesInitialized, hasSelectedNodes }`) **rebuilds** `nodeLookup`/`parentLookup` from the user `nodes` array — it `clear()`s both maps, snapshots the old lookup as `tmpLookup`, then for each user node either reuses the existing internal node (fast path: when `checkEquality` is on and the same `userNode` reference is still present) or constructs a fresh `InternalNodeBase` by merging `options.defaults` + the user node and seeding `measured` (`{width,height}` from `userNode.measured`), `internals.positionAbsolute` (`clampPosition` of origin-adjusted position into the node's `extent`/`nodeExtent`), `internals.handleBounds` (via `parseHandles` — derived from `userNode.handles`, or reset to re-measure when `measured` is cleared), `internals.z` (`calculateZ`, elevating selected nodes by `SELECTED_NODE_Z` when `elevateNodesOnSelect` and not manual z-index mode), and `internals.userNode` (back-reference). Children (`userNode.parentId`) are routed through `updateChildNode` to populate `parentLookup`. Returns `nodesInitialized` (false if any visible node lacks `measured.width/height`) and `hasSelectedNodes`. Options merge over `adoptUserNodesDefaultOptions` (`checkEquality: true`). `parseHandles` defaults handle `width`/`height` to `1`. `updateAbsolutePositions`, `updateNodeInternals` (above), `panBy({delta, panZoom, transform, translateExtent, width, height})` (calls `setViewportConstrained` and reports whether the transform actually changed), `handleExpandParent`, `updateConnectionLookup`. `panBy` is what `XYDrag`/`XYHandle` auto-pan call through the store.

### Key types
```ts
export type NodeDragItem = {
  id: string;
  position: XYPosition;
  distance: XYPosition;               // cursor→node offset captured at drag start
  measured: { width: number; height: number };
  internals: { positionAbsolute: XYPosition };
} & Pick<InternalNodeBase, 'extent' | 'parentId' | 'origin' | 'expandParent' | 'dragging'>;

export type InternalNodeBase<NodeType = NodeBase> = Omit<NodeType, 'measured'> & {
  measured: { width?: number; height?: number };
  internals: {
    positionAbsolute: XYPosition;
    z: number;
    rootParentIndex?: number;
    userNode: NodeType;               // reference to the original user node (optimization)
    handleBounds?: NodeHandleBounds;
    bounds?: NodeBounds;
  };
};
export type NodeOrigin = [number, number];                 // [0,0]=top-left … [1,1]=bottom-right
export type NodeLookup<N = InternalNodeBase> = Map<string, N>;
```

---

## Cross-cutting patterns to remember

- **Stale-closure avoidance:** every factory reads state through `getStoreItems()`/`getTransform()` at event time, never from a captured snapshot. This is why adapters can create the instance once and only re-`update()` for DOM/option changes.
- **Coordinate spaces:** screen→flow is `pointToRendererPoint` `(p-t)/k`; flow→screen is `rendererPointToPoint` `p*k+t`. Handle bounds and the drag threshold are deliberately kept in **client/screen space ÷ zoom** so behavior is zoom-independent.
- **`internal`/`sync` event flags:** programmatic d3-zoom operations are tagged (`{ internal: true }`, `{ sync: true }`) so the zoom handlers skip user callbacks and avoid store echo loops.
- **Callbacks out, store in:** the system layer pushes results out (`onTransformChange`, `updateNodePositions`, `updateConnection`, `onChange`); it never imports React or Svelte.
- **`update`/`destroy` contract** is uniform across `XYDrag`, `XYPanZoom`, `XYResizer`, `XYMinimap`; `XYHandle` is the exception (singleton with self-managed per-gesture listeners).

*Versions referenced: `@xyflow/system@0.0.76`, `@xyflow/react@12.10.2`, `@xyflow/svelte@1.5.2`. All paths are relative to `xyflow/packages/`.*
