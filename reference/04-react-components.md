## What this covers

Every public React component exported by `@xyflow/react` v12.10.2 — the heart `<ReactFlow>` component with its complete, source-verified prop surface (every prop grouped by concern, with type and real default), plus the auxiliary components (`Background`, `Controls`, `MiniMap`, `Panel`, `Handle`, `NodeResizer`, `NodeToolbar`, `EdgeToolbar`, `EdgeLabelRenderer`, `BaseEdge`, `EdgeText`, `ViewportPortal`) — explained at the implementation level so you can predict exactly how each prop flows into the internal store and renderers.

> Versions pinned: `@xyflow/react` **12.10.2**, `@xyflow/system` **0.0.76**, `@xyflow/svelte` **1.5.2**. Source: `packages/react/package.json:version`.

---

## Architecture: how `<ReactFlow>` decomposes its props

`<ReactFlow>` is a thin forwardRef wrapper. It does **not** itself own state. Looking at `container/ReactFlow/index.tsx:ReactFlow`, the props are destructured (with all defaults applied inline) and then **fanned out into three internal sinks** wrapped by `<Wrapper>` (which mounts the zustand store via `BatchProvider`/`StoreUpdater`):

| Sink | File | Receives |
|------|------|----------|
| `<Wrapper>` | `container/ReactFlow/Wrapper.tsx` | `nodes`, `edges`, `width`, `height`, `fitView`, `fitViewOptions`, `minZoom`, `maxZoom`, `nodeOrigin`, `nodeExtent`, `zIndexMode` — the bits needed to initialize the store. |
| `<StoreUpdater>` | `components/StoreUpdater/index.tsx` | Almost every controlled value + callback. Each is synced into the zustand store on change, so internal code reads them via `useStore`. |
| `<GraphView>` | `container/GraphView` | Rendering + viewport/interaction props (`nodeTypes`, `edgeTypes`, pan/zoom config, pane handlers, connection-line config). |

A 4th group — `<SelectionListener onSelectionChange>`, `<Attribution proOptions position>`, `<A11yDescriptions>` — handles selection diffing, the bottom-right attribution badge, and ARIA live regions.

**Implication:** any prop you pass is *controlled* — React Flow does not mutate it. Callbacks like `onNodesChange` are how you observe internal interactions; if you pass `nodes` but no `onNodesChange`, the graph appears frozen because internal change-events have nowhere to write.

The type is `ReactFlowProps<NodeType extends Node = Node, EdgeType extends Edge = Edge>` and it **extends `Omit<HTMLAttributes<HTMLDivElement>, 'onError'>`** (`types/component-props.ts:ReactFlowProps`) — so any standard div attribute (`onScroll`, `tabIndex`, `data-*`, `aria-*`) is also valid and spread onto the root `<div className="react-flow">` via `...rest`.

```tsx
export default fixedForwardRef(ReactFlow); // container/ReactFlow/index.tsx
// → import { ReactFlow } from '@xyflow/react';   (named, NOT default)
```

The root DOM is `<div data-testid="rf__wrapper" className="react-flow" role="application">` with inline `wrapperStyle = { width:'100%', height:'100%', overflow:'hidden', position:'relative', zIndex:0 }` (`container/ReactFlow/index.tsx`). The container must have a height — `100%` collapses to 0 if the parent is unsized.

---

## `<ReactFlow>` props — complete reference

All defaults below are the **literal** values from `container/ReactFlow/index.tsx` (destructuring defaults) and `types/component-props.ts` (`@default` tags). Where the prop has no destructuring default, the store/system applies the effective default noted.

### Core data

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `nodes` | `NodeType[]` | `[]` | Controlled nodes. Pair with `onNodesChange`. |
| `edges` | `EdgeType[]` | `[]` | Controlled edges. Pair with `onEdgesChange`. |
| `defaultNodes` | `NodeType[]` | — | Initial nodes for an **uncontrolled** flow (React Flow owns state internally). |
| `defaultEdges` | `EdgeType[]` | — | Initial edges, uncontrolled. |
| `defaultEdgeOptions` | `DefaultEdgeOptions` (`= DefaultEdgeOptionsBase<Edge>`) | — | Merged into every newly created edge (e.g. via `onConnect`/`addEdge`). Per-edge props win. Applied in `Handle.onConnectExtended`. |
| `nodeTypes` | `NodeTypes` (`Record<string, ComponentType<NodeProps & {data:any; type:any}>>`) | `{ input, default, output, group }` | Maps `node.type` → component. Define **outside render** or memoize, or every node remounts. |
| `edgeTypes` | `EdgeTypes` | `{ default, straight, step, smoothstep, simplebezier }` → internally the `*Internal` variants (`BezierEdgeInternal`, `StraightEdgeInternal`, `StepEdgeInternal`, `SmoothStepEdgeInternal`, `SimpleBezierEdgeInternal`) in `components/EdgeWrapper/utils.ts:builtinEdgeTypes` | Maps `edge.type` → component. Same memoization caveat. (Exported non-internal `BezierEdge` etc. are the public building blocks.) |

```ts
// types/general.ts
export type NodeTypes = Record<string, ComponentType<NodeProps & { data: any; type: any }>>;
export type EdgeTypes = Record<string, ComponentType<EdgeProps & { data: any; type: any }>>;
```

### Viewport & fitting

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `defaultViewport` | `Viewport` (`{x,y,zoom}`) | `{ x:0, y:0, zoom:1 }` (`init-values.ts`) | Initial uncontrolled viewport. Ignored if `fitView` is set. |
| `viewport` | `Viewport` | — | **Controlled** viewport. Must be paired with `onViewportChange`. |
| `onViewportChange` | `(viewport: Viewport) => void` | — | Required when `viewport` is controlled. |
| `fitView` | `boolean` | `undefined` (falsy) | Zoom/pan to fit all nodes on init. |
| `fitViewOptions` | `FitViewOptions` (`= FitViewOptionsBase<NodeType>`) | — | `{ padding, includeHiddenNodes, minZoom, maxZoom, duration, nodes }` to tune the initial fit. |
| `minZoom` | `number` | `0.5` | |
| `maxZoom` | `number` | `2` | |
| `translateExtent` | `CoordinateExtent` (`[[minX,minY],[maxX,maxY]]`) | `infiniteExtent` (`[[-∞,-∞],[+∞,+∞]]`) | Pan boundary for the viewport. |
| `nodeExtent` | `CoordinateExtent` | — | Boundary that node *positions* are clamped to. |
| `nodeOrigin` | `NodeOrigin` (`[number, number]`) | `[0, 0]` (`defaultNodeOrigin`) | `[0,0]` top-left, `[0.5,0.5]` center, `[1,1]` bottom-right anchor. |
| `width` | `number` | — | Fixed flow width (useful for SSR / headless). |
| `height` | `number` | — | Fixed flow height. |

### Interaction — drag / pan / zoom / select

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `nodesDraggable` | `boolean` | `true` (store, `initialState.ts:118`) | Global; per-node `draggable` overrides. |
| `nodesConnectable` | `boolean` | `true` (store, `initialState.ts:119`) | Global; per-node `connectable` overrides. |
| `nodesFocusable` | `boolean` | `true` (store, `initialState.ts:120`) | Tab/Enter focus cycling. |
| `edgesFocusable` | `boolean` | `true` (store, `initialState.ts:121`) | |
| `edgesReconnectable` | `boolean` | `true` (store, `initialState.ts:122`) | Needs an `onReconnect` handler to actually reconnect. |
| `elementsSelectable` | `boolean` | `true` (store, `initialState.ts:123`) | Click-to-select nodes & edges. |
| `selectNodesOnDrag` | `boolean` | `true` (store, `initialState.ts:126`) | Select a node when you start dragging it. |
| `panOnDrag` | `boolean \| number[]` | `true` | `true` = left-drag pans. Array limits mouse buttons, e.g. `[0,2]` (left+right), `[1]` (middle). |
| `panOnScroll` | `boolean` | `false` | Scroll-to-pan (trackpad). |
| `panOnScrollSpeed` | `number` | `0.5` | |
| `panOnScrollMode` | `PanOnScrollMode` | `PanOnScrollMode.Free` (`'free'`) | `'free' \| 'vertical' \| 'horizontal'`. |
| `zoomOnScroll` | `boolean` | `true` | |
| `zoomOnPinch` | `boolean` | `true` | Touch pinch-zoom. |
| `zoomOnDoubleClick` | `boolean` | `true` | |
| `preventScrolling` | `boolean` | `true` | Stops the page scrolling when pointer is over the flow. |
| `selectionOnDrag` | `boolean` | `false` | Draw a selection box on drag **without** holding `selectionKeyCode`. |
| `selectionMode` | `SelectionMode` | `SelectionMode.Full` (`'full'`) | `'full'` = node must be fully inside box; `'partial'` = partial overlap selects. |
| `nodeDragThreshold` | `number` | `1` | Pixels of movement before a drag fires (1 prevents clicks becoming drags). |
| `connectionDragThreshold` | `number` | `1` | Pixels before a connection line starts dragging from a handle. |
| `paneClickDistance` | `number` | `1` | Max mouse travel between down/up still counted as a click. |
| `nodeClickDistance` | `number` | `0` | Same, for node clicks. |
| `autoPanOnNodeDrag` | `boolean` | `true` (store, `initialState.ts:140`) | Auto-pan when dragging a node to the viewport edge. |
| `autoPanOnConnect` | `boolean` | `true` (store, `initialState.ts:139`) | Auto-pan while drawing a connection. |
| `autoPanOnSelection` | `boolean` | `true` | Auto-pan while drawing a selection box. |
| `autoPanOnNodeFocus` | `boolean` | `true` (store, `initialState.ts:141`) | Pan to a node when it receives focus. |
| `autoPanSpeed` | `number` | `15` (store, `initialState.ts:142`) | |
| `onlyRenderVisibleElements` | `boolean` | `false` | Virtualization: only render nodes/edges in viewport. Adds overhead; win only for very large graphs. |
| `elevateNodesOnSelect` | `boolean` | `true` | Raise z-index of selected nodes. |
| `elevateEdgesOnSelect` | `boolean` | `false` | Raise z-index of selected edges. |
| `zIndexMode` | `ZIndexMode` | `'basic'` | `'auto'` (selections + subflows), `'basic'` (selections only), `'manual'` (no auto z-indexing). |

### Connection

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `connectionMode` | `ConnectionMode` | `ConnectionMode.Strict` (`'strict'`) (store, `initialState.ts:107`) | `Strict='strict'` (source→target only); `Loose='loose'` (also source↔source, target↔target). |
| `connectionLineType` | `ConnectionLineType` | `ConnectionLineType.Bezier` (`'default'`) | Path style of the *in-progress* connection line. Enum: `Bezier='default'`, `Straight='straight'`, `Step='step'`, `SmoothStep='smoothstep'`, `SimpleBezier='simplebezier'`. |
| `connectionLineStyle` | `CSSProperties` | — | Style on the connection line path. |
| `connectionLineComponent` | `ConnectionLineComponent<NodeType>` | — | Full custom connection-line component (see props below). |
| `connectionLineContainerStyle` | `CSSProperties` | — | Style on the connection line's SVG container. |
| `connectionRadius` | `number` | `20` (store, `initialState.ts:144`) | Drop radius around a handle that snaps a new edge. |
| `connectOnClick` | `boolean` | `true` (store, `initialState.ts:136`) | Click source handle then click target handle to connect (vs. drag-only). Gates `Handle`'s `onClick`. |
| `isValidConnection` | `IsValidConnection<EdgeType>` (`(edge: EdgeType \| Connection) => boolean`) | — | Validate connections globally; return `false` to reject. Preferred over per-handle for perf. |

#### Store-side defaults — byte-confirmed from `store/initialState.ts`

These interaction/connection booleans and numbers have **no destructuring default** in `container/ReactFlow/index.tsx`; their effective default is the value the zustand store is seeded with in `getInitialState()` (`packages/react/src/store/initialState.ts`). Verified verbatim against that file for `@xyflow/react` 12.10.2:

| Prop | Store field (exact source) | Default | `initialState.ts` line |
|------|----------------------------|---------|------------------------|
| `nodesDraggable` | `nodesDraggable: true` | `true` | 118 |
| `nodesConnectable` | `nodesConnectable: true` | `true` | 119 |
| `nodesFocusable` | `nodesFocusable: true` | `true` | 120 |
| `edgesFocusable` | `edgesFocusable: true` | `true` | 121 |
| `edgesReconnectable` | `edgesReconnectable: true` | `true` | 122 |
| `elementsSelectable` | `elementsSelectable: true` | `true` | 123 |
| `connectOnClick` | `connectOnClick: true` | `true` | 136 |
| `connectionMode` | `connectionMode: ConnectionMode.Strict` | `ConnectionMode.Strict` (`'strict'`) | 107 |
| `connectionRadius` | `connectionRadius: 20` | `20` | 144 |
| `autoPanOnNodeDrag` | `autoPanOnNodeDrag: true` | `true` | 140 |
| `autoPanOnConnect` | `autoPanOnConnect: true` | `true` | 139 |
| `autoPanSpeed` | `autoPanSpeed: 15` | `15` | 142 |

Related store-seeded interaction defaults in the same object (for completeness): `selectNodesOnDrag: true` (126), `elevateNodesOnSelect: true` (124), `elevateEdgesOnSelect: true` (125 — note the store seeds `true`, whereas the component-prop `@default` documented above is `false`; the component supplies its own default), `autoPanOnNodeFocus: true` (141), `nodeDragThreshold: 1` (112), `connectionDragThreshold: 1` (113), `snapGrid: [15, 15]` (115), `snapToGrid: false` (116). These are the *store* seeds, not necessarily the value applied when the prop is omitted from `<ReactFlow>` (a prop with a destructuring default in `index.tsx` overrides the store seed on mount via `<StoreUpdater>`).
| `onConnect` | `OnConnect` | — | Fires with the new `Connection` when a connection completes. Use `addEdge`. |
| `onConnectStart` | `OnConnectStart` | — | User begins dragging a connection. |
| `onConnectEnd` | `OnConnectEnd` | — | Fires regardless of success; 2nd arg `connectionState` lets you branch on failure. |
| `onClickConnectStart` | `OnConnectStart` | — | Connect-on-click variant (first click). |
| `onClickConnectEnd` | `OnConnectEnd` | — | Connect-on-click variant (second click). |
| `reconnectRadius` | `number` | `10` | Radius that triggers an edge reconnection. |
| `onReconnect` | `OnReconnect<EdgeType>` | — | Edge source/target dragged to a new handle. Use `reconnectEdge`. |
| `onReconnectStart` | `(event, edge, handleType) => void` | — | |
| `onReconnectEnd` | `(event, edge, handleType, connectionState: FinalConnectionState) => void` | — | Fires even if no update happened. |

```ts
// ConnectionLineComponentProps (react/src/types/edges.ts:ConnectionLineComponentProps) — props your custom line receives
type ConnectionLineComponentProps<NodeType extends Node = Node> = {
  connectionLineStyle?: CSSProperties;
  connectionLineType: ConnectionLineType;
  fromNode: InternalNode<NodeType>;
  fromHandle: Handle; fromX: number; fromY: number;
  toX: number; toY: number;
  fromPosition: Position; toPosition: Position;
  connectionStatus: 'valid' | 'invalid' | null;
  toNode: InternalNode<NodeType> | null;
  toHandle: Handle | null;
  pointer: XYPosition;
};
```

### Keyboard

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `deleteKeyCode` | `KeyCode \| null` | `'Backspace'` | Key(s) that delete selection. Array = multiple, e.g. `['Delete','Backspace']`. `null` disables. |
| `selectionKeyCode` | `KeyCode \| null` | `'Shift'` | Hold to draw a selection box. |
| `multiSelectionKeyCode` | `KeyCode \| null` | `'Meta'` (macOS) / `'Control'` (other) via `isMacOs()` | Click-to-multiselect modifier. |
| `panActivationKeyCode` | `KeyCode \| null` | `'Space'` | Hold to pan even when `panOnScroll` is false. `null` disables. |
| `zoomActivationKeyCode` | `KeyCode \| null` | `'Meta'`/`'Control'` via `isMacOs()` | Hold to zoom even when `panOnScroll` is false. |

`KeyCode` is `string | string[]` (a key name like `'a'`, a code, or a `+`-joined chord).

### Styling, identity & class-name escape hatches

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `className` | `string` | — | Added to root, alongside `react-flow` + color-mode class. |
| `style` | `CSSProperties` | — | Merged **before** the fixed `wrapperStyle`, so you cannot override width/height/overflow/position via `style`. |
| `id` | `string` | `'1'` (`rfId`) | Disambiguates multiple flows on a page; drives internal element ids. |
| `colorMode` | `ColorMode` | `'light'` | `'light' \| 'dark' \| 'system'`. Adds `dark`/`light` class via `useColorModeClass`. |
| `noDragClassName` | `string` | `'nodrag'` | Elements with this class won't start a node drag. |
| `noWheelClassName` | `string` | `'nowheel'` | Elements with this class let the wheel scroll instead of zoom. |
| `noPanClassName` | `string` | `'nopan'` | Elements with this class won't pan the pane. |
| `defaultMarkerColor` | `string \| null` | `'#b1b1b7'` | Color of edge markers; `null` uses CSS var `--xy-edge-stroke`. |
| `snapToGrid` | `boolean` | — | Snap dragged nodes to a grid. |
| `snapGrid` | `SnapGrid` (`[number, number]`) | — | Grid step when `snapToGrid`, e.g. `[20,20]`. |
| `attributionPosition` | `PanelPosition` | `'bottom-right'` | Where the attribution badge sits. |
| `proOptions` | `ProOptions` (`{ account?: string; hideAttribution: boolean }`) | — | `{ hideAttribution: true }` removes the badge (see removing-attribution guide). |
| `ariaLabelConfig` | `Partial<AriaLabelConfig>` | — | Override built-in ARIA strings / labels (localization). |
| `disableKeyboardA11y` | `boolean` | `false` | Disables arrow-key move + keyboard selection. |
| `debug` | `boolean` | `false` | Logs fired events to the console. |
| `onError` | `OnError` (`(id: string, message: string) => void`) | — | Called instead of throwing on internal errors. |

### Callbacks — node events

All node mouse handlers are `NodeMouseHandler<NodeType>` `= (event: ReactMouseEvent, node: NodeType) => void` unless noted. Drag handlers are `OnNodeDrag<NodeType>`.

| Prop | Type | Fires when |
|------|------|-----------|
| `onNodeClick` | `NodeMouseHandler<NodeType>` | Node clicked. |
| `onNodeDoubleClick` | `NodeMouseHandler<NodeType>` | Node double-clicked. |
| `onNodeMouseEnter` / `onNodeMouseMove` / `onNodeMouseLeave` | `NodeMouseHandler<NodeType>` | Pointer enter/move/leave on a node. |
| `onNodeContextMenu` | `NodeMouseHandler<NodeType>` | Right-click on a node. |
| `onNodeDragStart` / `onNodeDrag` / `onNodeDragStop` | `OnNodeDrag<NodeType>` | Drag lifecycle. |
| `onNodesChange` | `OnNodesChange<NodeType>` (`(changes: NodeChange<NodeType>[]) => void`) | Any node interaction (move/select/dimensions/remove). **Required for controlled `nodes`.** |
| `onNodesDelete` | `OnNodesDelete<NodeType>` (`(nodes: NodeType[]) => void`) | Nodes deleted. |

### Callbacks — edge events

| Prop | Type | Fires when |
|------|------|-----------|
| `onEdgeClick` | `(event: ReactMouseEvent, edge: EdgeType) => void` | Edge clicked. |
| `onEdgeDoubleClick` / `onEdgeContextMenu` / `onEdgeMouseEnter` / `onEdgeMouseMove` / `onEdgeMouseLeave` | `EdgeMouseHandler<EdgeType>` | Edge mouse events. |
| `onEdgesChange` | `OnEdgesChange<EdgeType>` (`(changes: EdgeChange<EdgeType>[]) => void`) | Edge select/remove. **Required for controlled `edges`.** |
| `onEdgesDelete` | `OnEdgesDelete<EdgeType>` | Edges deleted. |

### Callbacks — selection, deletion, viewport, lifecycle

| Prop | Type | Notes |
|------|------|-------|
| `onSelectionChange` | `OnSelectionChangeFunc<NodeType, EdgeType>` (`(params: { nodes; edges }) => void`) | Selection set changed (driven by `<SelectionListener>`). |
| `onSelectionDragStart` / `onSelectionDrag` / `onSelectionDragStop` | `SelectionDragHandler<NodeType>` | Dragging the selection box of nodes. |
| `onSelectionStart` / `onSelectionEnd` | `(event: ReactMouseEvent) => void` | Begin/finish drawing selection box. |
| `onSelectionContextMenu` | `(event: ReactMouseEvent, nodes: NodeType[]) => void` | Right-click on a node selection. |
| `onDelete` | `OnDelete<NodeType, EdgeType>` (`(params: { nodes; edges }) => void`) | Any node/edge deletion (combined). |
| `onBeforeDelete` | `OnBeforeDelete<NodeType, EdgeType>` | Async gate: return `false` to abort, or return `{nodes, edges}` to modify what gets deleted. |
| `onMove` | `OnMove` | During pan/zoom. |
| `onMoveStart` | `OnMoveStart` | Pan/zoom begins. |
| `onMoveEnd` | `OnMoveEnd` | Pan/zoom ends (`event` is `null` if not user-initiated). |
| `onInit` | `OnInit<NodeType, EdgeType>` (`(instance: ReactFlowInstance) => void`) | Viewport initialized; safe point to call `fitView`/`zoomTo`. |

### Callbacks — pane events

| Prop | Type |
|------|------|
| `onPaneClick` | `(event: ReactMouseEvent) => void` |
| `onPaneContextMenu` | `(event: ReactMouseEvent \| MouseEvent) => void` |
| `onPaneScroll` | `(event?: WheelEvent) => void` |
| `onPaneMouseEnter` / `onPaneMouseMove` / `onPaneMouseLeave` | `(event: ReactMouseEvent) => void` |

> Note `onScroll` is **not** a React Flow prop — it comes from `HTMLAttributes`. `<ReactFlow>` intercepts it (`wrapperOnScroll` resets scroll to `{top:0,left:0}` so focusing offscreen nodes doesn't shift the wrapper) and then calls your `onScroll`.

### Minimal controlled vs. uncontrolled

```tsx
// Controlled — you own state, you must wire change handlers
import { ReactFlow, useNodesState, useEdgesState, addEdge } from '@xyflow/react';
const [nodes, , onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
const onConnect = useCallback((c) => setEdges((eds) => addEdge(c, eds)), []);
<ReactFlow nodes={nodes} edges={edges}
  onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView />

// Uncontrolled — React Flow owns state internally
<ReactFlow defaultNodes={initialNodes} defaultEdges={initialEdges} fitView />
```

Real-world (strudel-flow `src/components/workflow/index.tsx:48`): `<ReactFlow … >` with a child `<Background />` (line 62); the app wraps the tree in `<ReactFlowProvider>` (`src/main.tsx:19`) so hooks work outside `<ReactFlow>`.

---

## `<Background>`

Source: `additional-components/Background/Background.tsx:Background` (a `memo`). Renders an `<svg className="react-flow__background">` containing a `<pattern>` and a full-size `<rect>` filled with it. It subscribes to the store's `transform` so the pattern scales/offsets with the viewport: `scaledGap = gap * transform[2]`, `scaledSize = patternSize * transform[2]`.

```ts
export enum BackgroundVariant { Lines = 'lines', Dots = 'dots', Cross = 'cross' } // Background/types.ts
```

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `variant` | `BackgroundVariant` | `Dots` (`'dots'`) | `'dots' \| 'lines' \| 'cross'`. |
| `gap` | `number \| [number, number]` | `20` | Pattern spacing; tuple = independent x/y. |
| `size` | `number` | `defaultSize[variant]` → Dots `1`, Lines `1`, Cross `6` | Dot radius / cross arm size. |
| `lineWidth` | `number` | `1` | Stroke thickness for lines & cross. |
| `offset` | `number \| [number, number]` | `0` | Pattern offset. |
| `color` | `string` | CSS var | Pattern color → `--xy-background-pattern-color-props`. |
| `bgColor` | `string` | — | Background fill → `--xy-background-color-props`. |
| `id` | `string` | — | **Required to be unique** when stacking multiple `<Background>`s (drives the SVG `<pattern id>`). |
| `className` | `string` | — | On the container svg. |
| `patternClassName` | `string` | — | On the pattern element. |
| `style` | `CSSProperties` | — | On the container. |

Stacking two grids:
```tsx
<Background id="1" gap={10} color="#f1f1f1" variant={BackgroundVariant.Lines} />
<Background id="2" gap={100} color="#ccc"    variant={BackgroundVariant.Lines} />
```

---

## `<Controls>` and `<ControlButton>`

Source: `additional-components/Controls/Controls.tsx`. Renders a `<Panel>` of buttons; reads `isInteractive`, `minZoomReached`, `maxZoomReached`, and `ariaLabelConfig` from the store. Each button's default behavior is built in (zoom in/out call the viewport helpers, fit-view fits, lock toggles interactivity); your callbacks run *in addition*.

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `showZoom` | `boolean` | `true` | Show +/- buttons. |
| `showFitView` | `boolean` | `true` | Show fit-view button. |
| `showInteractive` | `boolean` | `true` | Show lock/unlock toggle. |
| `fitViewOptions` | `FitViewOptions` | — | Options for the fit-view button. |
| `onZoomIn` / `onZoomOut` | `() => void` | — | Called *in addition* to default zoom. |
| `onFitView` | `() => void` | — | If provided, replaces the default fit behavior. |
| `onInteractiveChange` | `(interactiveStatus: boolean) => void` | — | Lock toggled. |
| `position` | `PanelPosition` | `'bottom-left'` | |
| `orientation` | `'horizontal' \| 'vertical'` | `'vertical'` | Adds the matching class. |
| `aria-label` | `string` | `ariaLabelConfig['controls.ariaLabel']` ("Control Panel" — `system/src/constants.ts:defaultAriaLabelConfig`) | The runtime default is `'Control Panel'`; the `@default 'React Flow controls'` JSDoc tag in `Controls/types.ts` is stale. |
| `style` / `className` | `CSSProperties` / `string` | — | On container. |
| `children` | `ReactNode` | — | Extra custom buttons. |

`<ControlButton>` props = `ControlButtonProps` = `ButtonHTMLAttributes<HTMLButtonElement>` (a plain styled `<button>`). Use it inside `<Controls>` to add your own actions.

---

## `<MiniMap>`

Source: `additional-components/MiniMap/MiniMap.tsx`. `MiniMapProps<NodeType>` = `Omit<HTMLAttributes<SVGSVGElement>, 'onClick'> & {…}`. Node attribute props accept either a constant or a per-node function `GetMiniMapNodeAttribute<NodeType> = (node) => string`.

| Prop | Type | Default |
|------|------|---------|
| `nodeColor` | `string \| (node) => string` | `"#e2e2e2"` |
| `nodeStrokeColor` | `string \| (node) => string` | `"transparent"` |
| `nodeClassName` | `string \| (node) => string` | `""` |
| `nodeBorderRadius` | `number` | `5` |
| `nodeStrokeWidth` | `number` | `2` |
| `nodeComponent` | `ComponentType<MiniMapNodeProps>` | built-in `MiniMapNode` |
| `bgColor` | `string` | — |
| `maskColor` | `string` | `"rgba(240, 240, 240, 0.6)"` |
| `maskStrokeColor` | `string` | `transparent` |
| `maskStrokeWidth` | `number` | `1` |
| `position` | `PanelPosition` | `'bottom-right'` |
| `onClick` | `(event: MouseEvent, position: XYPosition) => void` | — |
| `onNodeClick` | `(event: MouseEvent, node: NodeType) => void` | — |
| `pannable` | `boolean` | `false` |
| `zoomable` | `boolean` | `false` |
| `ariaLabel` | `string \| null` | `"Mini Map"` |
| `inversePan` | `boolean` | — |
| `zoomStep` | `number` | `1` (`MiniMap.tsx:zoomStep = 1`; the `@default 10` JSDoc in `MiniMap/types.ts` is stale) |
| `offsetScale` | `number` | `5` |

A custom node component receives `MiniMapNodeProps` (`MiniMap/types.ts`): `{ id, x, y, width, height, borderRadius, className, color?, shapeRendering, strokeColor?, strokeWidth?, style?, selected, onClick? }` — it **must render an SVG element**. `MiniMapNode` is also exported for reuse.

---

## `<Panel>`

Source: `components/Panel/index.tsx:Panel` (a `forwardRef<HTMLDivElement>`). `PanelProps = HTMLAttributes<HTMLDivElement> & { position?: PanelPosition }`. It splits `position` on `-` and applies the parts as classes on `react-flow__panel` — that's the entire mechanism. Used internally by `<Controls>` and `<MiniMap>`.

| Prop | Type | Default |
|------|------|---------|
| `position` | `PanelPosition` | `'top-left'` |

`PanelPosition` (system) = `'top-left' \| 'top-center' \| 'top-right' \| 'bottom-left' \| 'bottom-center' \| 'bottom-right' \| 'center-left' \| 'center-right'`.

```tsx
<Panel position="top-right" className="flex flex-col gap-2">…</Panel> // strudel-flow controls.tsx:68
```

---

## `<Handle>`

Source: `components/Handle/index.tsx:Handle` (`memo(fixedForwardRef(...))`). `HandleProps = HandlePropsSystem & Omit<HTMLAttributes<HTMLDivElement>, 'id'> & { onConnect?: OnConnect }`.

From the **system** base (`system/types/handles.ts:HandleProps`):

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `type` | `HandleType` (`'source' \| 'target'`) | `'source'` | |
| `position` | `Position` | `Position.Top` | `Top \| Right \| Bottom \| Left`. |
| `isConnectable` | `boolean` | `true` | Can connect to/from this handle at all. |
| `isConnectableStart` | `boolean` | `true` | Can a connection *start* here. |
| `isConnectableEnd` | `boolean` | `true` | Can a connection *end* here. |
| `isValidConnection` | function | — | Per-handle validator (the global `isValidConnection` prop is preferred for perf). |
| `id` | `string` | `null` | Distinguish multiple handles on one node (`data-handleid`). |
| `onConnect` | `OnConnect` | — | Fires for connections made from this handle. |

**How it works:** on pointer-down it delegates to `XYHandle.onPointerDown` (system) with the live store snapshot (`nodeLookup`, `connectionMode`, `connectionRadius`, `autoPanOnConnect`, `panBy`, `updateConnection`, `dragThreshold: connectionDragThreshold`, etc.). When `connectOnClick` is true it also wires `onClick`, using `store.connectionClickStartHandle` to implement two-click connecting and `XYHandle.isValid` to validate. New edges merge `defaultEdgeOptions` and, if the flow has default (uncontrolled) edges, call `setEdges(addEdge(...))`. The DOM is a `<div className="react-flow__handle …">` carrying `data-handleid/data-nodeid/data-handlepos/data-id` and a rich set of state classes (`source`/`target`/`connectable`/`connectingfrom`/`connectingto`/`valid`/`connectionindicator`/…). Must be used inside a custom node (reads `useNodeId`; logs error `010` if missing).

```tsx
<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />
```

---

## `<NodeResizer>` and `<NodeResizeControl>`

Source: `additional-components/NodeResizer/`. `<NodeResizer>` renders 8 controls (4 line + 4 corner handles) that drive `XYResizer` in the system package.

`NodeResizerProps`:

| Prop | Type | Default |
|------|------|---------|
| `nodeId` | `string` | — (optional inside a custom node) |
| `color` | `string` | — |
| `handleClassName` / `handleStyle` | `string` / `CSSProperties` | — |
| `lineClassName` / `lineStyle` | `string` / `CSSProperties` | — |
| `isVisible` | `boolean` | `true` |
| `minWidth` | `number` | `10` |
| `minHeight` | `number` | `10` |
| `maxWidth` | `number` | `Number.MAX_VALUE` |
| `maxHeight` | `number` | `Number.MAX_VALUE` |
| `keepAspectRatio` | `boolean` | `false` |
| `autoScale` | `boolean` | `true` |
| `shouldResize` | `ShouldResize` | — |
| `onResizeStart` / `onResize` / `onResizeEnd` | `OnResizeStart` / `OnResize` / `OnResizeEnd` | — |

`<NodeResizeControl>` (`ResizeControlProps`) renders a **single** control — picks the props above plus:

| Prop | Type | Default |
|------|------|---------|
| `position` | `ControlPosition` (`'top-left'\|'top-right'\|'bottom-left'\|'bottom-right'` + line positions) | — |
| `variant` | `ResizeControlVariant` (`Handle='handle'`, `Line='line'`) | `"handle"` |
| `resizeDirection` | `ResizeControlDirection` (`'horizontal' \| 'vertical'`) | — (any direction if omitted) |
| `className` / `style` / `children` | — | — |

`ResizeControlLineProps = Omit<ResizeControlProps,'resizeDirection'> & { position?: ControlLinePosition }`.

---

## `<NodeToolbar>`

Source: `additional-components/NodeToolbar/NodeToolbar.tsx` — renders into a portal positioned relative to a node; visible only when its node is selected (and no other node is) unless `isVisible` is set. `NodeToolbarProps = HTMLAttributes<HTMLDivElement> & {…}`.

| Prop | Type | Default |
|------|------|---------|
| `nodeId` | `string \| string[]` | — (one toolbar can serve a group of nodes) |
| `isVisible` | `boolean` | — (auto: visible iff node selected & sole selection) |
| `position` | `Position` | `Position.Top` |
| `offset` | `number` | `10` |
| `align` | `Align` (`'start' \| 'center' \| 'end'`) | `'center'` |

```tsx
<NodeToolbar isVisible={data.toolbarVisible} position={Position.Top}>…</NodeToolbar>
```

---

## `<EdgeToolbar>`

Source: `additional-components/EdgeToolbar/`. `EdgeToolbarProps = EdgeToolbarBaseProps & HTMLAttributes<HTMLDivElement> & { edgeId: string; children?: ReactNode }`. Unlike the node toolbar, it is positioned by explicit `x`/`y` and aligned with `alignX`/`alignY`.

From `EdgeToolbarBaseProps` (system `types/edges.ts`):

| Prop | Type | Default |
|------|------|---------|
| `edgeId` | `string` | — (required) |
| `x` | `number` | — (required) |
| `y` | `number` | — (required) |
| `isVisible` | `boolean` | `false` (else shown when edge selected) |
| `alignX` | `'left' \| 'center' \| 'right'` | `'center'` |
| `alignY` | `'top' \| 'center' \| 'bottom'` | `'center'` |

---

## `<EdgeLabelRenderer>`

Source: `components/EdgeLabelRenderer/index.tsx`. `EdgeLabelRendererProps = { children: ReactNode }`. A **portal**: it finds `.react-flow__edgelabel-renderer` in the store's `domNode` and `createPortal`s children there, so you can render HTML-div labels on top of SVG edges. Returns `null` until that node exists.

> The renderer container has `pointer-events: none` by default. To make a label interactive, set `style={{ pointerEvents: 'all' }}` and add the `nopan` class.

```tsx
<EdgeLabelRenderer>
  <div className="nopan" style={{ position:'absolute',
    transform:`translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}>{data.label}</div>
</EdgeLabelRenderer>
```

---

## `<BaseEdge>`

Source: `components/Edges/BaseEdge.tsx:BaseEdge`. Used internally by every built-in edge; meant to be the root of your custom edges. It draws the visible `<path className="react-flow__edge-path">`, an invisible wider interaction path, and (when `label` + numeric `labelX/labelY`) an `<EdgeText>`.

`BaseEdgeProps = Omit<SVGAttributes<SVGPathElement>, 'd'|'path'|'markerStart'|'markerEnd'> & EdgeLabelOptions & {…}`:

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `path` | `string` | — (required) | SVG path, e.g. from `getBezierPath`. |
| `interactionWidth` | `number` | `20` | Invisible hit-area width; `0` disables the extra path. |
| `labelX` / `labelY` | `number` | — | Label anchor. |
| `markerStart` / `markerEnd` | `string` | — | `url(#markerId)` references. |
| + `EdgeLabelOptions` | — | — | `label?`, `labelStyle?`, `labelShowBg?`, `labelBgStyle?`, `labelBgPadding?`, `labelBgBorderRadius?`. |

```tsx
export function CustomEdge({ sourceX, sourceY, targetX, targetY, ...props }) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge path={edgePath} {...props} />;
}
```

---

## `<EdgeText>`

Source: `components/Edges/EdgeText.tsx:EdgeText` (a `memo`). Renders an SVG `<g>` containing an optional background `<rect className="react-flow__edge-textbg">` and the `<text className="react-flow__edge-text">`. It measures the text via `getBBox()` in a `useEffect` and recenters around `(x, y)`. `EdgeTextProps = Omit<SVGAttributes<SVGElement>, 'x'|'y'> & EdgeLabelOptions & { x: number; y: number }`.

| Prop | Type | Default |
|------|------|---------|
| `x` / `y` | `number` | — (required) |
| `label` | `ReactNode` | — (renders `null` if falsy) |
| `labelStyle` | `CSSProperties` | — |
| `labelShowBg` | `boolean` | `true` |
| `labelBgStyle` | `CSSProperties` | — |
| `labelBgPadding` | `[number, number]` | `[2, 4]` |
| `labelBgBorderRadius` | `number` | `2` |

---

## `<ViewportPortal>`

Source: `components/ViewportPortal/index.tsx`. `props = { children: ReactNode }`. A portal into `.react-flow__viewport-portal` (found on the store's `domNode`), so your content lives **inside** the transformed viewport and is therefore affected by pan/zoom — use absolute positioning + `translate(...)` in flow coordinates. Returns `null` until the target exists.

```tsx
<ViewportPortal>
  <div style={{ transform: 'translate(100px, 100px)', position: 'absolute' }}>
    Positioned at flow [100,100]
  </div>
</ViewportPortal>
```

---

## Export map (what you import)

From `packages/react/src/index.ts` and `additional-components/index.ts`:

- **Core:** `ReactFlow` (named), `ReactFlowProvider`.
- **Custom-node/edge building blocks:** `Handle` (+`HandleProps`), `BaseEdge`, `EdgeText`, `EdgeLabelRenderer` (+`EdgeLabelRendererProps`), `ViewportPortal`, `Panel` (+`PanelProps`).
- **Built-in edges:** `BezierEdge`, `StraightEdge`, `StepEdge`, `SmoothStepEdge`, `SimpleBezierEdge` (+ `getSimpleBezierPath`).
- **Additional components:** `Background` (+`BackgroundVariant`, `BackgroundProps`), `Controls` (+`ControlButton`, `ControlProps`, `ControlButtonProps`), `MiniMap` (+`MiniMapNode`, `MiniMapProps`, `MiniMapNodeProps`), `NodeResizer` (+`NodeResizeControl`), `NodeToolbar` (+`NodeToolbarProps`), `EdgeToolbar` (+`EdgeToolbarProps`).
- **Enums/types re-exported from system:** `ConnectionLineType`, `ConnectionMode`, `PanOnScrollMode`, `SelectionMode`, `Position`, `MarkerType`, `PanelPosition`, `ProOptions`, etc.

---

## Gotchas verified from source

- `nodeTypes`/`edgeTypes` are read by reference into the store — define them module-level or `useMemo`, otherwise every render swaps the map and remounts every custom component.
- `style` cannot override the flow container's `width/height/overflow/position/zIndex` because `wrapperStyle` is spread **after** `style` (`{ ...style, ...wrapperStyle }`).
- The flow needs an explicitly sized parent; `100%` of a 0-height parent renders nothing.
- Controlled `nodes`/`edges` without `onNodesChange`/`onEdgesChange` look frozen — internal interaction events have no sink.
- `defaultMarkerColor: null` and `bgColor`/`color` on `<Background>` route through CSS custom properties, so theming via CSS vars works without prop changes.
- `connectionDragThreshold` (default 1) flows into `Handle` → `XYHandle.onPointerDown` as `dragThreshold`; raising it prevents accidental connections on handle clicks.
