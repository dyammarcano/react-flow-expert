## What this covers

Battle-tested React Flow patterns mined from real source — auto-layout (dagre, elkjs), drag-and-drop node creation, sub-flows/parent-child nodes, data propagation between connected nodes, and connection validation — capped by a full case study of **strudel-flow**, a real `@xyflow/react` v12 app that compiles a node graph into live audio. Every signature, prop, and code block below is copied from the cloned repos; nothing is invented.

**Pinned versions:** `@xyflow/react` 12.10.2 · `@xyflow/svelte` 1.5.2 · `@xyflow/system` 0.0.76.

The single load-bearing idea: React Flow gives you `nodes`/`edges` arrays plus a coordinate system (`screenToFlowPosition`) and a reactive connection index (`connectionLookup`); every pattern here is just a way to *read*, *transform*, or *react to* those three things.

---

## 1. Auto-layout

React Flow ships **no built-in layout engine** — it only renders nodes at the `position` you give them. Layout is "run an external graph algorithm, write the result back into `node.position`." The two canonical engines are **dagre** (`@dagrejs/dagre`, synchronous, simple DAGs) and **elkjs** (`elkjs`, async, multi-handle/port-aware). Both examples below are real.

### 1.1 dagre

Source: `web/apps/example-apps/react/examples/layout/dagre/App.tsx`.

dagre anchors nodes at their **center**; React Flow anchors at the **top-left**. The single most important line in any dagre integration is the `x - width/2`, `y - height/2` shift.

```tsx
import dagre from '@dagrejs/dagre';
import { Position, ConnectionLineType, useNodesState, useEdgesState } from '@xyflow/react';

const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
const nodeWidth = 172;
const nodeHeight = 36;

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom',
      // shift dagre's center anchor to React Flow's top-left anchor
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: newNodes, edges };
};
```

Driving it from a `Panel` button (`App.tsx:72-103`):

```tsx
const onLayout = useCallback(
  (direction) => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges, direction);
    setNodes([...layoutedNodes]);   // spread → new array reference → re-render
    setEdges([...layoutedEdges]);
  },
  [nodes, edges],
);
```

**Notes from source.**
- `rankdir: 'TB' | 'LR'` flips the flow direction; the example also swaps `sourcePosition`/`targetPosition` so handles point the right way.
- `setSourcePosition`/`setTargetPosition` only matter for the *default* node types — custom nodes place their own `<Handle position={...} />`.
- The dagre graph object is created **once at module scope** and reused — dagre mutates it in place on each `dagre.layout()`.
- After layout, call `fitView()` (or render `<ReactFlow fitView>`) so the viewport frames the new positions.

**Pitfall:** dagre needs real `width`/`height`. The example hard-codes `172×36`. For variable-size nodes, measure first (see §1.3 `useNodesInitialized`) and pass `node.measured?.width ?? fallback`.

### 1.2 elkjs (multi-handle / port-aware)

Source: `web/apps/example-apps/react/examples/layout/elkjs-multiple-handles/useLayoutNodes.ts`. elkjs is **async** (`await elk.layout(graph)`) and understands **ports** — so multiple source/target handles per node lay out without edge crossings.

```ts
import ELK from 'elkjs/lib/elk.bundled.js';
import { type Edge, useNodesInitialized, useReactFlow } from '@xyflow/react';

const layoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.edgeNodeBetweenLayers': '40',
  'elk.spacing.nodeNode': '40',
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
};
const elk = new ELK();

export const getLayoutedNodes = async (nodes, edges: Edge[]) => {
  const graph = {
    id: 'root',
    layoutOptions,
    children: nodes.map((n) => {
      const targetPorts = n.data.targetHandles.map((t) => ({
        id: t.id,
        // ⚠️ tell elk which side the port is on
        properties: { side: 'WEST' },
      }));
      const sourcePorts = n.data.sourceHandles.map((s) => ({
        id: s.id,
        properties: { side: 'EAST' },
      }));

      return {
        id: n.id,
        width: n.width ?? 150,
        height: n.height ?? 50,
        // ⚠️ fix port order to reduce edge crossings
        properties: { 'org.eclipse.elk.portConstraints': 'FIXED_ORDER' },
        ports: [{ id: n.id }, ...targetPorts, ...sourcePorts],
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.sourceHandle || e.source],
      targets: [e.targetHandle || e.target],
    })),
  };

  const layoutedGraph = await elk.layout(graph);

  return nodes.map((node) => {
    const lgNode = layoutedGraph.children?.find((n) => n.id === node.id);
    return { ...node, position: { x: lgNode?.x ?? 0, y: lgNode?.y ?? 0 } };
  });
};
```

The node data carries the handle ids so both the layout *and* the rendered `<Handle>`s share one source of truth (`nodes.ts`):

```ts
export type ElkNodeData = {
  label: string;
  sourceHandles: { id: string }[];
  targetHandles: { id: string }[];
};
export type ElkNode = Node<ElkNodeData, 'elk'>;
// e.g. sourceHandles: [{ id: 'a-s-a' }, { id: 'a-s-b' }, { id: 'a-s-c' }]
```

### 1.3 The `useNodesInitialized` gate

Both engines need node dimensions. React Flow measures nodes **after first paint**, so layout that runs on mount sees `width === undefined`. The elkjs example gates on `useNodesInitialized` (`useLayoutNodes.ts:78-96`):

```ts
export default function useLayoutNodes() {
  const nodesInitialized = useNodesInitialized();
  const { getNodes, getEdges, setNodes, fitView } = useReactFlow<ElkNode>();

  useEffect(() => {
    if (nodesInitialized) {
      const layoutNodes = async () => {
        const layoutedNodes = await getLayoutedNodes(getNodes() as ElkNode[], getEdges());
        setNodes(layoutedNodes);
        fitView();
      };
      layoutNodes();
    }
  }, [nodesInitialized, getNodes, getEdges, setNodes, fitView]);

  return null;
}
```

| Engine | Package | Sync? | Ports/handles | Best for |
|--------|---------|-------|---------------|----------|
| dagre | `@dagrejs/dagre` | yes | no (one in/out per node) | quick DAG/tree layouts |
| elkjs | `elkjs` | no (Promise) | yes (`FIXED_ORDER`) | many handles, fewer crossings |

---

## 2. Drag-and-drop node creation from a sidebar

There are **two** real implementations in the repos, and they differ fundamentally. Know which one you're copying.

### 2.1 HTML5 native DnD (`dataTransfer` + `onDragOver`/`onDrop`) — the classic

This is what **strudel-flow** uses. The flow pane registers `onDragOver`/`onDrop`; the sidebar item is `draggable` and stuffs a payload into `event.dataTransfer`.

Drop handler — `strudel-flow/src/hooks/use-drag-and-drop.ts`:

```ts
import { useReactFlow } from '@xyflow/react';
import { createNodeByType } from '@/components/nodes';

export function useDragAndDrop() {
  const { screenToFlowPosition } = useReactFlow();
  const { addNode } = useAppStore(useShallow(selector));

  const onDrop: React.DragEventHandler = useCallback(
    (event) => {
      const nodeProps = JSON.parse(event.dataTransfer.getData('application/reactflow'));
      if (!nodeProps) return;

      // ⚠️ screen px → flow coords, accounting for pan & zoom
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      addNode(createNodeByType({ type: nodeProps.id, position }));
    },
    [addNode, screenToFlowPosition],
  );

  // ⚠️ preventDefault in onDragOver or the browser rejects the drop
  const onDragOver: React.DragEventHandler = useCallback(
    (event) => event.preventDefault(),
    [],
  );

  return useMemo(() => ({ onDrop, onDragOver }), [onDrop, onDragOver]);
}
```

Drag **source** — `strudel-flow/src/components/layouts/sidebar-layout/app-sidebar.tsx:215-221`:

```tsx
const onDragStart = useCallback(
  (e: React.DragEvent) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(props)); // props = NodeConfig
    setIsDragging(true);
  },
  [props],
);
// <SidebarMenuItem draggable onDragStart={onDragStart} … />
```

Wiring — `strudel-flow/src/components/workflow/index.tsx:44-61`:

```tsx
const { onDragOver, onDrop } = useDragAndDrop();
// …
<ReactFlow
  /* … */
  onDragOver={onDragOver}
  onDrop={onDrop}
  nodeDragThreshold={30}
  fitView
/>
```

**Three load-bearing rules**, all visible above:
1. `onDragOver` **must** call `event.preventDefault()`, or `onDrop` never fires.
2. Convert the drop point with `screenToFlowPosition({ x: event.clientX, y: event.clientY })` — never use raw client coords as a node position (they ignore pan/zoom).
3. The component using `useReactFlow()` must be **inside** `<ReactFlowProvider>` (strudel-flow renders the provider at app root).

### 2.2 Pointer-events DnD (touch-friendly, context-based) — the newer example

Source: `web/apps/example-apps/react/examples/interaction/drag-and-drop-custom/`. This avoids the HTML5 drag API entirely (which is flaky on touch) and uses **pointer events + `setPointerCapture`** plus a React context (`useDnD`) so the sidebar needs no callbacks wired in `App.tsx`.

Key mechanics from `useDnD.tsx`:

```ts
const onDragStart = useCallback(
  (event: React.PointerEvent<HTMLDivElement>, onDrop: OnDropAction) => {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    setIsDragging(true);
    setDropAction(onDrop);
  },
  [setIsDragging, setDropAction],
);

const onDragEnd = useCallback((event: PointerEvent) => {
  // hit-test the element under the pointer
  const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY);
  const isDroppingOnFlow = elementUnderPointer?.closest('.react-flow');
  if (isDroppingOnFlow) {
    const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    dropAction?.({ position: flowPosition });
  }
  setIsDragging(false);
}, [screenToFlowPosition, setIsDragging, dropAction]);
```

A subtle but real gotcha the example documents: storing a function in `useState` requires the lazy-init guard, because `setState(fn)` treats `fn` as an updater. They wrap it (`useDnD.tsx:41`):

```ts
setDropAction: (action) => setDropAction(() => action),
```

The sidebar then calls `onDragStart(event, createAddNewNode('input'))` on `onPointerDown`, and `createAddNewNode` returns the `OnDropAction` that does `setNodes((nds) => nds.concat(newNode))` (`Sidebar.tsx:17-34`).

| Approach | Drag transport | Touch | Where used |
|----------|----------------|-------|------------|
| HTML5 native | `event.dataTransfer` | weak | strudel-flow, classic docs |
| Pointer-events | `setPointerCapture` + context | strong | `drag-and-drop-custom` example |

---

## 3. Sub-flows / parent-child nodes

Source: `web/sites/reactflow.dev/src/content/learn/layouting/sub-flows.mdx` + `web/apps/example-apps/react/learn/sub-flows-2/nodes.js`.

Adding `parentId` to a node does exactly **one** thing: it makes that node's `position` **relative to the parent's top-left** (`{ x: 0, y: 0 }` = parent's top-left corner). Move the parent → children move with it. Children are *not* DOM descendants.

Real node array (`sub-flows-2/nodes.js`):

```js
export const initialNodes = [
  {
    id: 'A',
    type: 'group',                          // convenience type: no handles, just a frame
    position: { x: 0, y: 0 },
    style: { width: 170, height: 140 },     // parent MUST have a size for extent clamping
  },
  {
    id: 'A-1',
    type: 'input',
    data: { label: 'Child Node 1' },
    position: { x: 10, y: 10 },             // relative to A's top-left
    parentId: 'A',
    extent: 'parent',                       // clamp: child cannot leave the parent
  },
  { id: 'A-2', data: { label: 'Child Node 2' }, position: { x: 10, y: 90 }, parentId: 'A', extent: 'parent' },
  { id: 'B', type: 'output', position: { x: -100, y: 200 }, data: { label: 'Node B' } },
  { id: 'C', type: 'output', position: { x: 100, y: 200 }, data: { label: 'Node C' } },
];
```

The relevant type fields, from `xyflow/packages/system/src/types/nodes.ts:53-65`:

```ts
/** Parent node id, used for creating sub-flows. */
parentId?: string;
/**
 * Boundary a node can be moved in.
 * @example 'parent' or [[0, 0], [100, 100]]
 */
extent?: 'parent' | CoordinateExtent | null;   // CoordinateExtent = [[number,number],[number,number]]
/** When `true`, the parent node will automatically expand if this node is dragged to the edge of the parent's bounds. */
expandParent?: boolean;
```

**Hard rules from the docs MDX (`sub-flows.mdx`):**
- **Order matters:** a parent must appear **before** its children in the `nodes`/`defaultNodes` array, or processing breaks.
- `parentNode` was renamed to `parentId` in v11.11.0; old name removed in v12 — always use `parentId`.
- `extent: 'parent'` requires the parent to have a real width/height (via `style` or measured), or there's nothing to clamp against.
- The `group` type is "just a convenience node type that has no handles." Any type can be a parent.
- **Edge z-index quirk:** edges render below nodes by default, but an edge connected to a node *with a parent* renders **above** nodes. Override with `defaultEdgeOptions={{ zIndex: 1 }}`.
- `extent: [[x0,y0],[x1,y1]]` (a `CoordinateExtent`) clamps to an arbitrary rectangle instead of the parent; `expandParent: true` grows the parent instead of clamping.

---

## 4. Computing flows: propagating data between connected nodes

This is React Flow's "spreadsheet" pattern — a node reads its upstream neighbours' `data` and recomputes. Two hooks make it reactive: **`useNodeConnections`** (who am I wired to?) and **`useNodesData`** (what's their data?). Source: `web/apps/example-apps/react/examples/interaction/computing-flows/`.

### 4.1 The two hooks (real signatures from source)

`useNodeConnections` — `xyflow/packages/react/src/hooks/useNodeConnections.ts:37-73`. It subscribes to the store's `connectionLookup` (an indexed `Map`), so it re-renders only when *this node's* connections change:

```ts
export function useNodeConnections({
  id, handleType, handleId, onConnect, onDisconnect,
}: UseNodeConnectionsParams = {}): NodeConnection[] {
  const nodeId = useNodeId();              // auto-filled inside a custom node
  const currentNodeId = id ?? nodeId;
  // …reads state.connectionLookup.get(`${id}-${handleType}-${handleId}`)…
  return useMemo(() => Array.from(connections?.values() ?? []), [connections]);
}
```

`NodeConnection` (`system/src/types/general.ts:97-99`) is a `Connection` (`general.ts:75-84`) plus an `edgeId`:

```ts
export type Connection = {
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};
export type NodeConnection = Connection & { edgeId: string };
```

`useNodesData` — `xyflow/packages/react/src/hooks/useNodesData.ts:25-32` — overloaded for one id or many, returning only `id | type | data`:

```ts
export function useNodesData<NodeType extends Node = Node>(
  nodeId: string
): DistributivePick<NodeType, 'id' | 'type' | 'data'> | null;
export function useNodesData<NodeType extends Node = Node>(
  nodeIds: string[]
): DistributivePick<NodeType, 'id' | 'type' | 'data'>[];
```

### 4.2 Single-input transform node

`computing-flows/UppercaseNode.tsx` — reads the one upstream `text`, uppercases it, writes it back into **its own** data via `updateNodeData` so *downstream* nodes can read it:

```tsx
function UppercaseNode({ id }: NodeProps) {
  const { updateNodeData } = useReactFlow();
  const connections = useNodeConnections({ handleType: 'target' });
  const nodesData = useNodesData<MyNode>(connections[0]?.source);
  const textNode = isTextNode(nodesData) ? nodesData : null;

  useEffect(() => {
    updateNodeData(id, { text: textNode?.data.text.toUpperCase() });
  }, [textNode]);

  return (
    <div>
      <Handle type="target" position={Position.Left} isConnectable={connections.length === 0} />
      <div>uppercase transform</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

Two real techniques: (a) `isConnectable={connections.length === 0}` caps the target handle at **one** incoming edge; (b) the node is both a consumer (reads upstream) and a producer (writes its own `data`), so transforms chain.

### 4.3 Multi-input aggregator node

`computing-flows/ResultNode.tsx` — maps **all** target connections to source ids, fetches them as an array, filters by a type guard:

```tsx
function ResultNode() {
  const connections = useNodeConnections({ handleType: 'target' });
  const nodesData = useNodesData<MyNode>(connections.map((c) => c.source));
  const textNodes = nodesData.filter(isTextNode);

  return (
    <div>
      <Handle type="target" position={Position.Left} />
      <div>incoming texts: {textNodes.map(({ data }, i) => <div key={i}>{data.text}</div>)}</div>
    </div>
  );
}
```

The producer end — `TextNode.tsx` — writes user input straight into `data`, which propagates because `useNodesData` is reactive:

```tsx
<input onChange={(e) => updateNodeData(id, { text: e.target.value })} value={data.text} />
```

The type guard pattern that makes this type-safe (`initialElements.ts`):

```ts
export type TextNode = Node<{ text: string }, 'text'>;
export function isTextNode(node: any): node is TextNode | UppercaseNode | undefined {
  return !node ? false : node.type === 'text' || node.type === 'uppercase';
}
```

> `useHandleConnections` is **deprecated** — it `console.warn`s `'[DEPRECATED] useHandleConnections is deprecated. Instead use useNodeConnections'` (`useHandleConnections.ts:40`) but still runs its own full implementation (it does *not* delegate to `useNodeConnections`; the two share the same `connectionLookup` store read). Its param shape also differs: `{ type, id, nodeId, onConnect, onDisconnect }` (`useHandleConnections.ts:13-24`) vs `useNodeConnections`'s `{ id, handleType, handleId, … }`. Always use `useNodeConnections`.

---

## 5. Connection validation

Source: `web/apps/example-apps/react/examples/interaction/validation/App.jsx`. The `isValidConnection` prop runs **while the user drags a connection** and decides whether the target handle is droppable (visual feedback + blocks `onConnect`).

```jsx
const isValidConnection = (connection) => connection.target === 'B';

<ReactFlow
  isValidConnection={isValidConnection}
  onConnectStart={(_, { nodeId, handleType }) => console.log('start', { nodeId, handleType })}
  onConnectEnd={(event) => console.log('end', event)}
  onConnect={(params) => setEdges((els) => addEdge(params, els))}
  selectNodesOnDrag={false}
/>
```

Real signature — `system/src/types/general.ts:156`:

```ts
export type IsValidConnection<EdgeType extends EdgeBase = EdgeBase> =
  (edge: EdgeType | Connection) => boolean;
```

`isValidConnection` can also be set **per handle**: `<Handle isValidConnection={fn} />`. Common predicates you can build from the `Connection` argument (`{ source, target, sourceHandle, targetHandle }`): forbid self-loops (`source !== target`), enforce type pairing (look the nodes up in a `Map`/store), or cap fan-in (combine with `isConnectable={connections.length === 0}` as in §4.2). strudel-flow rejects self-connections inside `onConnect` instead — `if (connection.source === connection.target) return;` (`app-store.ts:64`).

---

## 6. Case study: strudel-flow

`strudel-flow` is a real `@xyflow/react` v12 app (`strudel-flow/src/`) that turns a node graph into **live audio**: each node emits a fragment of [Strudel](https://strudel.cc) pattern code, the graph is compiled top-to-bottom into one program string, and `@strudel/web`'s `evaluate()` plays it. It's the best real-world example of "the graph *is* the program."

### 6.1 Two zustand stores, cleanly split

strudel-flow runs **two** stores so React Flow churn never re-renders the audio engine and vice-versa.

**`app-store.ts`** — the graph. Note `subscribeWithSelector` middleware and the standard React Flow trio of change handlers built on `applyNodeChanges`/`applyEdgeChanges`/`addEdge`:

```ts
export const useAppStore = create<AppStore>()(
  subscribeWithSelector((set, get) => ({
    nodes: initialNodes,
    edges: initialEdges,
    colorMode: 'light',
    theme: 'supabase',

    onNodesChange: async (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
    onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

    onConnect: (connection) => {
      if (connection.source === connection.target) return;   // no self-loops
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

    addNode: (node) => set({ nodes: [...get().nodes, node] }),
    removeNode: (nodeId) => set({ nodes: get().nodes.filter((n) => n.id !== nodeId) }),
    updateNodeData: (nodeId, updates) =>
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n),
      })),
  })),
);

// derived side-effect: toggle <html class="dark"> when colorMode changes
useAppStore.subscribe(
  (state) => state.colorMode,
  (colorMode) => document.querySelector('html')?.classList.toggle('dark', colorMode === 'dark'),
);
```

`subscribeWithSelector` is the reason that last `useAppStore.subscribe((s) => s.colorMode, …)` works — it lets you subscribe to a **slice** with a side-effect, outside React.

**`strudel-store.ts`** — the audio/transport state, deliberately tiny and decoupled:

```ts
export const useStrudelStore = create<StrudelStore>((set) => ({
  pattern: '',
  cpm: '120',     // cycles per minute (tempo)
  bpc: '4',       // beats per cycle
  setPattern: (pattern) => set({ pattern }),
  setCpm: (cpm) => set({ cpm }),
  setBpc: (bpc) => set({ bpc }),
}));
```

The `<ReactFlow>` wrapper subscribes with `useShallow` so it only re-renders on the slice it uses (`workflow/index.tsx:29-39`):

```tsx
const { nodes, edges, colorMode, theme, onNodesChange, onEdgesChange, onConnect } =
  useAppStore(useShallow((s) => ({ nodes: s.nodes, edges: s.edges, /* … */ })));
```

### 6.2 Custom node & edge type registries

strudel-flow registers **26 node types** plus one custom edge. Node types map a string → component (`components/nodes/index.tsx:296-323`), and `AppNode` is a discriminated union so `node.type` narrows `node.data`:

```ts
export const nodeTypes = {
  'synth-select-node': SynthSelectNode, 'pad-node': PadNode, 'arpeggiator-node': ArpeggiatorNode,
  'lpf-node': LpfNode, 'gain-node': GainNode, 'rev-node': RevNode, 'fast-node': FastNode, /* …26 total… */
};

export type AppNode =
  | Node<WorkflowNodeData, 'pad-node'>
  | Node<WorkflowNodeData, 'gain-node'>
  | /* … one union member per registered type … */;
export type AppNodeType = NonNullable<AppNode['type']>;
```

A single `nodesConfig: Record<AppNodeType, NodeConfig>` table drives the sidebar, icons, and categories (`Instruments | Synths | Audio Effects | Time Effects`) — categories later decide what's a sound *source* vs an *effect* (§6.4).

The edge type registry is defined inline and the custom edge adds a delete button (`workflow/index.tsx:17-19`, `+ onConnect` always tags new edges `type: 'default'`):

```tsx
const edgeTypes = { default: deleteEdge };
// <ReactFlow nodeTypes={nodeTypes} edgeTypes={edgeTypes} … />
```

### 6.3 Dynamic node factory + drag-creation

New nodes are minted by `createNodeByType` (`nodes/index.tsx:325-355`), which pulls defaults from `nodesConfig` and assigns a `nanoid()` id:

```ts
export function createNodeByType({ type, id, position, data }): AppNode {
  const node = nodesConfig[type];
  return {
    id: id ?? nanoid(),
    data: data ?? { title: node.title, sound: node.sound, notes: node.notes, icon: node.icon, state: 'running' },
    position: { x: position?.x || 0, y: position?.y || 0 },
    type,
  } as AppNode;
}
```

The sidebar serialises a `NodeConfig` into `dataTransfer`; the drop handler (§2.1) deserialises it, `screenToFlowPosition`s the pointer, and `addNode(createNodeByType(...))`. That's the entire create-by-drag loop.

### 6.4 The graph → audio compiler (the heart)

This is where strudel-flow is most instructive. `generateOutput` (`lib/strudel.ts:37-126`) compiles the **whole** node graph into one Strudel program every time nodes/edges/tempo change. The pattern: each node *component* carries a static `strudelOutput` method, and the compiler walks connected components.

**Per-node code emission via a static method.** Each effect node attaches `strudelOutput` to the component function itself (`effects/gain-node.tsx:45-51`):

```ts
GainNode.strudelOutput = (node: AppNode, strudelString: string) => {
  const gain = node.data.gain ? parseFloat(node.data.gain) : 1;
  if (gain === 1) return strudelString;        // identity / no-op
  const gainCall = `gain(${gain})`;
  return strudelString ? `${strudelString}.${gainCall}` : gainCall;  // chain onto upstream
};
```

The compiler discovers these by indexing into the `nodeTypes` registry (`strudel.ts:10-13`):

```ts
export function getNodeStrudelOutput(nodeType: string) {
  const NodeComponent = nodeTypes[nodeType] as { strudelOutput?: (n: AppNode, s: string) => string };
  return NodeComponent?.strudelOutput;
}
```

**Connected-component traversal.** Audio chains are independent subgraphs, found with a plain DFS over edges (`lib/graph-utils.ts:4-40`). Undirected reachability groups every wired-together node:

```ts
export function findConnectedComponents(nodes: AppNode[], edges: Edge[]): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      const component: string[] = [];
      dfs(node.id, visited, component, edges);  // follows edge.source↔edge.target both ways
      if (component.length) components.push(component);
    }
  });
  return components;
}
```

**Compile each component into one line.** For every component: split nodes into **sources** (category `Instruments`) and **effects**; `stack(...)` multiple sources; fold every effect's `strudelOutput` over the accumulated pattern; honour per-node `state: 'paused'` by commenting the line out (`strudel.ts:58-122`):

```ts
const components = findConnectedComponents(nodes, edges);
for (const componentNodeIds of components) {
  const componentNodes = componentNodeIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean);
  const [sources, effects] = componentNodes.reduce(([src, eff], node) => {
    isSoundSource(node) ? src.push(node) : eff.push(node);   // category === 'Instruments'
    return [src, eff];
  }, [[], []]);
  if (sources.length === 0) continue;

  const allSourcesPaused = sources.every((node) => node.data.state === 'paused');
  // if the whole component is paused, still emit it (commented out); otherwise drop paused sources
  const activePatterns = (allSourcesPaused ? sources : sources.filter((n) => n.data.state !== 'paused'))
    .map((n) => nodePatterns[n.id]).filter(Boolean);
  if (activePatterns.length === 0) continue;

  let pattern = activePatterns.length === 1
    ? activePatterns[0]
    : `stack(${activePatterns.join(', ')})`;

  for (const effect of effects) {
    const strudelOutput = getNodeStrudelOutput(effect.type);
    if (strudelOutput && pattern) pattern = strudelOutput(effect, pattern);   // ⚠️ fold effects onto the chain
  }
  if (pattern) finalPatterns.push({ pattern: optimizeSoundCalls(pattern), paused: allSourcesPaused });
}

// emit one "$:" line per component (paused → commented out), then prefix with tempo
if (finalPatterns.length === 0) return '';
const result = finalPatterns
  .map(({ pattern, paused }) => (paused ? `// $: ${pattern}` : `$: ${pattern}`))
  .join('\n');
const bpm = parseInt(cpm) || 120;
const beatsPerCycle = parseInt(bpc) || 4;
return `setcpm(${bpm}/${beatsPerCycle})\n${result}`;
```

A small `optimizeSoundCalls` peephole pass collapses `.sound("a").sound("b")` → `.sound("a b")` repeatedly until fixpoint (`strudel.ts:15-31`).

### 6.5 Driving the audio engine reactively

`useWorkflowRunner` (`hooks/use-workflow-runner.tsx`) wires the compiler output to Strudel. It `useMemo`s `generateOutput(nodes, edges, cpm, bpc)`, pushes it into `strudel-store`, then debounces `evaluate()` calls:

```tsx
const generatedPattern = useMemo(
  () => generateOutput(nodes, edges, cpm, bpc),
  [nodes, edges, cpm, bpc],
);
useEffect(() => { setPattern(generatedPattern); }, [generatedPattern, setPattern]);

const debouncedEvaluate = useCallback((p: string) => {
  if (debounceTimerId.current !== null) window.clearTimeout(debounceTimerId.current);
  // tempo & scale changes evaluate immediately; everything else after 50ms
  if (p.includes('setcpm(') || p.includes('scale(')) { evaluatePattern(p); return; }
  debounceTimerId.current = window.setTimeout(() => evaluatePattern(p), 50);
}, [evaluatePattern]);
```

`evaluatePattern` strips commented (`//`) lines, dedupes against `lastEvaluatedPattern`, swallows two known Strudel warnings, and calls `hush()` when the program goes empty. `forceEvaluate` re-pulls **fresh** state via `useAppStore.getState()` / `useStrudelStore.getState()` (the imperative escape hatch) so a Play button compiles the latest graph without waiting for React (`use-workflow-runner.tsx:115-125`).

### 6.6 Group play/pause via connected components inside a node

`workflow-node.tsx` (the shared chrome every node wraps) demonstrates reading the graph **from inside a node** to pause an entire audio chain at once (`workflow-node.tsx:50-71`):

```tsx
const { connectedNodeIds } = useMemo(() => {
  const allComponents = findConnectedComponents(nodes, edges);
  const connectedComponent = allComponents.find((c) => c.includes(id)) || [id];
  return { connectedNodeIds: new Set(connectedComponent) };
}, [nodes, edges, id]);

const onPause = useCallback(() => {
  connectedNodeIds.forEach((nodeId) => updateNodeData(nodeId, { state: 'paused' }));
  forceEvaluate();
}, [forceEvaluate, connectedNodeIds, updateNodeData]);
```

Handles come from a thin `BaseHandle` wrapper over `<Handle>` (`base-handle.tsx`), and every workflow node renders one target (top) + one source (bottom):

```tsx
<BaseHandle position={Position.Top} type="target" />
<BaseHandle position={Position.Bottom} type="source" />
```

### 6.7 strudel-flow takeaways (transferable patterns)

| Pattern | Where | Transferable lesson |
|---------|-------|---------------------|
| Split stores (graph vs domain) | `app-store.ts` / `strudel-store.ts` | Keep React Flow state separate from engine state; subscribe with `useShallow`. |
| Static `strudelOutput` on node components | `gain-node.tsx`, `strudel.ts` | Co-locate "how this node compiles" with the node; the compiler stays generic. |
| Connected-component DFS | `graph-utils.ts` | Treat wired subgraphs as independent units of work. |
| Discriminated `AppNode` union + config table | `nodes/index.tsx` | One `nodesConfig` record drives sidebar, icons, factory, and source/effect classification. |
| `getState()` escape hatch | `use-workflow-runner.tsx` | Imperative reads sidestep stale closures for "act now" buttons. |
| Debounced recompute, immediate for tempo | `use-workflow-runner.tsx` | Debounce expensive graph→output work; bypass for latency-sensitive params. |

---

## 7. Quick reference

| Task | API / prop | Source |
|------|-----------|--------|
| Screen px → flow coords | `useReactFlow().screenToFlowPosition` | `use-drag-and-drop.ts`, `useDnD.tsx` |
| Allow a drop target | `onDragOver={(e) => e.preventDefault()}` | `use-drag-and-drop.ts` |
| Wait for measured sizes | `useNodesInitialized()` | `useLayoutNodes.ts` |
| Read this node's wiring | `useNodeConnections({ handleType })` | `useNodeConnections.ts` |
| Read upstream data | `useNodesData<T>(ids)` | `useNodesData.ts` |
| Write a node's data | `useReactFlow().updateNodeData(id, partial)` | `TextNode.tsx`, `app-store.ts` |
| Cap fan-in to one | `<Handle isConnectable={connections.length === 0} />` | `UppercaseNode.tsx` |
| Validate a connection | `<ReactFlow isValidConnection={fn} />` / `<Handle isValidConnection>` | `validation/App.jsx` |
| Nest a node | `parentId` + `extent: 'parent'` (+ optional `expandParent`) | `sub-flows-2/nodes.js`, `nodes.ts` |
| Re-render on slice only | `useStore(useShallow(selector))` | `workflow/index.tsx` |
| Side-effect on store slice | `subscribeWithSelector` + `store.subscribe(sel, fn)` | `app-store.ts` |
