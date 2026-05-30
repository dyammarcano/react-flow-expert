# Node-UI Ecosystem & When to Choose What

## What this covers

The wider landscape of node-based / graph / diagramming UI libraries as catalogued by the React Flow team's own [awesome-node-based-uis](https://github.com/xyflow/awesome-node-based-uis) list, and a source-grounded decision guide for when to reach for xyflow (React Flow / Svelte Flow) versus rete, vue-flow, X6, GoJS, jointjs, litegraph.js, reaflow, Foblex Flow, ngx-vflow, cytoscape.js, sigma.js, mermaid, baklavajs, react-digraph, and the rest — so you pick the right renderer for the framework, graph size, and interaction model in front of you.

> Source of truth for this catalogue: `awesome-node-based-uis/README.md` (curated by Christopher, John and Moritz from React Flow / Svelte Flow). Every library named below appears in that file; section/line references are given inline.
>
> xyflow versions pinned in this skill (verified from real `package.json` files): `@xyflow/react` **12.10.2** (`xyflow/packages/react/package.json`), `@xyflow/svelte` **1.5.2** (`xyflow/packages/svelte/package.json`), `@xyflow/system` **0.0.76** (`xyflow/packages/system/package.json`). The shared `@xyflow/system` package is the framework-agnostic core that both React Flow and Svelte Flow are built on — this is why a single mental model transfers between the two.

---

## 1. How the awesome list is organized

The `awesome-node-based-uis/README.md` splits the field into **libraries** (things you build with) and **applications** (finished products built on top of such libraries). The library side is grouped by language runtime, and within JavaScript, by role:

| Top-level group | Subsections (from `README.md`) | What it contains |
|---|---|---|
| **Javascript Libraries** | Renderers, Layouting, Graph Utilities, Misc | The competitive set for "I want to render an interactive node graph in the browser" |
| **C Libraries** | Renderers | Native/immediate-mode editors (`graphviz`, `imnodes`, Dear ImGui node editors) |
| **.NET Libraries** | — | Blazor / WPF / WinForms node editors (`Blazor.Diagrams`, `nodify`, `NodeNetwork`, `STNodeEditor`) |
| **Rust Libraries** | — | `egui_node_graph`, `egui-snarl` (egui-based) |
| **Swift Libraries** | — | AudioKit `Flow` |
| **Go Libraries** | Diagramming | `d2` (text → diagram) |
| **Applications** | Workflow & Automation, AI, Diagramming, Data Processing, 3D & Visuals, Audio, Scripting, Misc | n8n, node-red, ComfyUI, Blender, Houdini, Stately, etc. |

The three JavaScript subsections that matter most when choosing a library are **Renderers**, **Layouting**, and **Graph Utilities** — they answer three orthogonal questions:

1. **Renderers** — who draws the nodes/edges and handles interaction (drag, pan, zoom, connect)? This is where React Flow / Svelte Flow compete.
2. **Layouting** — who computes *positions* (you usually pair one of these with a renderer)? `elkjs`, `dagrejs` (dagre), `d3-hierarchy`, `d3-force`, `d3-dag`, `graphology-layout`, `springy`.
3. **Graph Utilities** — who provides graph *data structures and algorithms* (traversal, cycles, topological sort)? `graphlib`, `graphology`, `behave-graph`.

> Key architectural takeaway from the list's own structure: **a renderer is not a layout engine.** React Flow deliberately does *not* ship a built-in auto-layout — the canonical pattern is "React Flow renderer + dagre/elkjs for positions." Libraries like GoJS, mermaid, and cytoscape.js bundle layout *and* rendering together, which is a major axis of the decision below.

---

## 2. The Renderers category, decoded

`README.md` → *Javascript Libraries → Renderers* lists (alphabetically): baklavajs, beautiful-react-diagrams, butterfly, cytoscape.js, diagram-maker, Flowy, flow-builder, Foblex Flow, GoJS, jointjs, jsplumb, kedro-viz, litegraph.js, mermaid, ngx-graph, ngx-vflow, nice-dag, nodl, react-dag-editor, react-digraph, **React Flow**, reaflow, rete, Sequential Workflow Designer, sigma.js, **Svelte Flow**, vue-flow, X6, yFiles.

It helps to re-cluster these renderers by the *real* decision axis rather than alphabetically:

### 2a. Framework binding (which UI framework do you live in?)

| Framework | Library in list | Notes |
|---|---|---|
| **React** | React Flow, reaflow, beautiful-react-diagrams, react-dag-editor, react-digraph, flow-builder | React Flow is the de-facto standard; others are narrower. |
| **Svelte** | Svelte Flow | Same `@xyflow/system` core as React Flow. |
| **Vue 3** | vue-flow, baklavajs | vue-flow is explicitly modeled on React Flow's API. |
| **Angular** | Foblex Flow, ngx-vflow, ngx-graph | Foblex Flow & ngx-vflow are the modern node-UI choices; ngx-graph is older/viz-oriented. |
| **Framework-agnostic / vanilla** | rete, X6, GoJS, jointjs, litegraph.js, cytoscape.js, sigma.js, jsplumb, butterfly, mermaid, Sequential Workflow Designer, yFiles | Work with any framework (or none); you wire your own UI layer. |

### 2b. Rendering technology

| Tech | Libraries | Trade-off |
|---|---|---|
| **DOM/SVG/HTML** | React Flow, Svelte Flow, vue-flow, X6, jointjs, GoJS (SVG), Foblex Flow | Each node is real DOM → arbitrary HTML/React content, easy styling/accessibility; cost grows with node count (hundreds → low thousands comfortably). |
| **Canvas 2D** | cytoscape.js, litegraph.js, butterfly (some) | Faster for many simple nodes; you lose DOM ergonomics (no nesting React components, manual hit-testing). |
| **WebGL** | sigma.js | Scales to tens/hundreds of thousands of nodes; nodes are points/sprites, not rich widgets. |
| **Static text → SVG** | mermaid, d2 | No live interaction model; you author text, it emits a picture. |

> Why React Flow uses DOM, not canvas: in xyflow, a node is a React component rendered into an absolutely-positioned wrapper, and the viewport is a single CSS `transform: translate(x,y) scale(zoom)` applied to the node container. The pan/zoom math lives in `@xyflow/system` (`xyflow/packages/system/src/xypanzoom`) and is shared by React and Svelte. This is precisely what lets a node be *any* React subtree (forms, charts, images). The cost is that very large graphs need virtualization or a switch to a canvas/WebGL renderer like sigma.js.

---

## 3. Library-by-library: what it is + when to pick it over React Flow

Each entry below is grounded in the `README.md` one-liner plus the well-known positioning of the library. The "**Pick it over React Flow when**" line is the load-bearing part.

### React Flow (`xyflow/xyflow`, `@xyflow/react` 12.10.2)
- **What it is:** React library for rendering node-based UIs; DOM/SVG renderer with first-class custom nodes/edges, controlled state (`nodes`/`edges` + `onNodesChange`/`onEdgesChange`), zustand store, and a deep imperative API (`useReactFlow`, `useStore`).
- **Pick it when:** you're in React and want maximum customization of node *content* (rich HTML), full control of state, and a large plugin/example ecosystem. This is the default for interactive editors, flow builders, and dashboards in React.

### Svelte Flow (`xyflow/xyflow`, `@xyflow/svelte` 1.5.2)
- **What it is:** Svelte library for node-based UIs, sharing the `@xyflow/system` 0.0.76 core (drag, pan/zoom, handles, resizer, minimap) with React Flow.
- **Pick it over React Flow when:** your app is built in Svelte. You get the same conceptual API and shared core behavior without pulling React in.

### vue-flow (`bcakmakoglu/vue-flow`)
- **What it is (list):** "Flowchart component for Vue 3."
- **Pick it over React Flow when:** your app is Vue 3. vue-flow's API is intentionally close to React Flow (nodes/edges, custom node components, handles, controls/minimap), so the mental model transfers — but it is an independent project, not part of xyflow.

### rete (`retejs/rete`)
- **What it is (list):** "Framework for visual programming and node editors."
- **Pick it over React Flow when:** you're building a **dataflow / computational** graph where nodes have typed input/output sockets and the graph *executes* (values flow along connections, a node recomputes when inputs change). Rete ships a dataflow/control-flow engine and a plugin architecture (with React/Vue/Angular render plugins). React Flow renders such graphs beautifully but leaves the *execution engine* to you. Choose rete when the computation model is the point, not just the picture.

### litegraph.js (`jagenjo/litegraph.js`)
- **What it is (list):** "A graph node engine and editor."
- **Pick it over React Flow when:** you want a **canvas-based node engine with a built-in execution graph** out of the box (the engine ComfyUI is built on). Strong for self-contained node-graph tools, shader/AI pipelines, and game-ish editors where you want bundled runtime + editor and don't need DOM-rich nodes.

### X6 (`antvis/X6`)
- **What it is (list):** "Diagramming library that uses SVG and HTML."
- **Pick it over React Flow when:** you want a **framework-agnostic** diagramming toolkit (AntV ecosystem) with batteries-included graph editing (ports, routers, connectors, built-in shapes, undo/redo, keyboard, snaplines) and you're *not* committed to React, or you want a richer out-of-the-box editor feature set without assembling it from plugins.

### GoJS (`gojs.net`)
- **What it is (list):** "Diagramming library with a focus on customization and interactivity."
- **Pick it over React Flow when:** you need a **commercial, batteries-included, framework-agnostic** diagramming library with deep built-in features (data binding, many layouts, tooltips, context menus, palettes, printing/export, undo manager) and want vendor support/licensing rather than assembling an OSS stack. Trade-off: commercial license and a non-React, non-DOM-component programming model.

### jointjs (`jointjs.com`)
- **What it is (list):** "JavaScript diagramming library."
- **Pick it over React Flow when:** you want a mature, **vanilla-JS SVG** diagramming foundation (the OSS core under the commercial JointJS+ / Rappid toolkit) for ERDs, BPMN, UML, and engineering diagrams, independent of any UI framework. Good when you need precise shape/link geometry and routing more than React-component-rich nodes.

### reaflow (`reaviz/reaflow`)
- **What it is (list):** "React library for building workflow editors."
- **Pick it over React Flow when:** you specifically want **automatic layout baked in** (reaflow uses ELK for layout by default) and a more opinionated, workflow-editor-shaped API. React Flow gives more control but expects you to bring your own layout (dagre/elkjs); reaflow trades some flexibility for auto-layout convenience.

### Foblex Flow (`foblex/f-flow`)
- **What it is (list):** "Angular library for rendering node-based UIs."
- **Pick it over React Flow when:** you're building in **Angular** and want a React-Flow-style declarative node/connection API native to Angular components. This is the natural Angular analogue.

### ngx-vflow (`artem-mangilev/ngx-vflow`)
- **What it is (list):** "An open source library to build node-based UI with Angular."
- **Pick it over React Flow when:** you're in **Angular** and want a node-UI library that closely mirrors React Flow's model (it is explicitly inspired by it). Choose between Foblex Flow and ngx-vflow based on API fit and maintenance; both are valid Angular picks.

### cytoscape.js (`js.cytoscape.org`)
- **What it is (list):** "Canvas based renderer with utilities and algorithms."
- **Pick it over React Flow when:** your problem is **graph analysis/visualization**, not authoring an editor. Cytoscape ships a huge library of graph algorithms (BFS/DFS, centrality, shortest paths, clustering) and many layout extensions, with a canvas renderer that handles **large** graphs far better than DOM. Choose it for network/biology/social-graph exploration where algorithms + scale matter more than rich-HTML node content.

### sigma.js (`jacomyal/sigma.js`)
- **What it is (list):** "Visualization framework for large graphs."
- **Pick it over React Flow when:** you must render **very large graphs (tens of thousands+ of nodes/edges)** at interactive frame rates. sigma.js uses **WebGL** and pairs with `graphology` (a Graph Utilities entry) for the data model. Nodes are points/labels, not interactive widgets — so this is for exploration/visualization, not node editing.

### mermaid (`mermaid-js.github.io/mermaid`)
- **What it is (list, two entries):** "Static diagrams for documentation" and "Flowchart and sequence diagrams generation."
- **Pick it over React Flow when:** you want **diagrams-as-code** for docs/READMEs/wikis — author a flowchart, sequence, or ER diagram in a tiny text DSL and render to SVG. There is no live drag/connect editing model. Use mermaid when the diagram is *output* (documentation), not an interactive *application*.

### baklavajs (`newcat/baklavajs`)
- **What it is (list):** "Graph/node editor for VueJs."
- **Pick it over React Flow when:** you're in **Vue** and specifically want a **node-editor with a built-in graph engine** (typed interfaces, a computation/dataflow engine, plus an optional Vue renderer). It's closer to "rete-for-Vue" than to "vue-flow": choose baklavajs when you need the execution engine, vue-flow when you mainly need the renderer.

### react-digraph (`uber/react-digraph`)
- **What it is (list):** "A library for creating directed graph editors."
- **Pick it over React Flow when:** rarely, today. It's an older React **SVG directed-graph editor** (from Uber) focused on a simpler node/edge editing use case. React Flow has largely superseded it in features, maintenance, and ecosystem; prefer react-digraph only if you already depend on it or need its specific minimal model.

---

## 4. Layouting & Graph Utilities you'll pair with a renderer

Because React Flow / Svelte Flow are renderers, not layout engines, the **Layouting** and **Graph Utilities** sections of the list are the other half of most real projects:

| Need | List entry (section) | Use with React Flow how |
|---|---|---|
| Hierarchical DAG layout | `dagrejs` / dagre (Layouting) | Compute `x,y` per node from edges, then set `position` on each React Flow node. The classic auto-layout recipe. |
| Advanced/orthogonal layout | `elkjs` (Layouting) | ELK (Eclipse Layout Kernel) port; richer layered/orthogonal routing than dagre. reaflow uses ELK internally. |
| Tree layout | `d3-hierarchy` (Layouting) | Tidy-tree positions for hierarchies. |
| Force-directed | `d3-force` (Layouting) | Physics layout for general graphs (also how many network views position nodes). |
| DAG-specific | `d3-dag` (Layouting) | Sugiyama-style DAG layouts. |
| Graph data structures/algorithms | `graphology` / `graphlib` (Graph Utilities) | Hold the model + run traversals/cycle detection; feed results into the renderer. `graphology` is also sigma.js's data model. |
| Behaviour/dataflow execution | `behave-graph` (Graph Utilities) | Execution engine; `behave-flow` is a React Flow UI on top of it (an example of "React Flow as the editor for someone else's engine"). |

> Mental model: **graphology/graphlib = the data**, **dagre/elkjs/d3-* = the positions**, **React Flow = the pixels + interaction.** Libraries like GoJS, cytoscape.js, and mermaid collapse two or three of these layers into one — convenient, but less swappable.

---

## 5. Applications as positioning signal

The *Applications* section is useful for "what is each library actually good for," because famous products reveal a renderer's sweet spot:

- **node-red** (Data Processing) and **n8n** (Workflow & Automation) — flow/workflow automation; the canonical React-Flow-shaped problem (discrete nodes, typed-ish connections, an execution backend you own).
- **ComfyUI** (AI / 3D & Visuals) — built on **litegraph.js**; a canvas node engine with an execution graph. Signals litegraph's fit for self-contained pipeline editors.
- **Stately** (Workflow & Automation) — statechart visualizer; another "interactive editor over a formal model" case React Flow excels at.
- **Blender / Houdini / Natron / Nodebox / Pure Data** (3D & Visuals) and **Max / Reaktor / Audulus** (Audio) — native node editors; the C/Rust/Swift library sections exist for this class.
- **mermaid.live / draw.io / Lucidchart / Miro** (Diagramming) — diagramming/whiteboarding; mermaid for text-driven docs, the others for freeform canvases.

If your product looks like one of these, copy its renderer choice as a strong prior.

---

## 6. The decision guide

Use this top-down. Stop at the first rule that matches.

### By framework (you want an interactive node editor with rich custom nodes)

| You are in… | Choose | Why |
|---|---|---|
| **React** + deep customization | **React Flow** (`@xyflow/react`) | DOM nodes = arbitrary React content; controlled state; biggest ecosystem. |
| **Svelte** + deep customization | **Svelte Flow** (`@xyflow/svelte`) | Same `@xyflow/system` core, idiomatic Svelte. |
| **Vue 3** (renderer-first) | **vue-flow** | React-Flow-like API for Vue 3. |
| **Vue 3** (need a dataflow engine) | **baklavajs** | Node editor + built-in computation engine. |
| **Angular** | **Foblex Flow** or **ngx-vflow** | The two modern Angular node-UI libraries; pick by API fit. |
| **No framework / vanilla, batteries-included** | **X6** (OSS) or **GoJS / jointjs** (feature-rich/commercial) | Framework-agnostic diagram editors with built-in shapes, routing, undo. |

### By workload (these can override the framework rule)

| Your dominant need | Choose | Why |
|---|---|---|
| **Very large graphs** (tens of thousands+ nodes), exploration/visualization | **sigma.js** (WebGL, with graphology) or **cytoscape.js** (canvas + algorithms) | DOM renderers (React Flow & co.) don't scale to that node count; these do, at the cost of rich-HTML nodes. |
| **Graph analysis / algorithms** (centrality, shortest path, clustering) on medium-to-large graphs | **cytoscape.js** | Ships the algorithm library; canvas scales further than DOM. |
| **Computational / dataflow graphs** where the graph *executes* (typed sockets, recompute-on-change) | **rete** (any framework) or **litegraph.js** (canvas, bundled engine) | Execution engine is built in; React Flow renders but leaves execution to you. |
| **Static diagrams for documentation** (READMEs, wikis, generated from text) | **mermaid** (or **d2** in Go-land) | Diagrams-as-code, SVG output, zero interactive runtime. |
| **Auto-layout is mandatory and you don't want to wire dagre/elkjs** | **reaflow** (ELK built in) — or React Flow **+ dagre/elkjs** | reaflow trades flexibility for built-in layout; React Flow + a layout lib keeps control. |
| **Commercial support / licensing required**, framework-agnostic | **GoJS** / **jointjs+ (Rappid)** / **yFiles** | Vendor-backed, feature-complete diagramming. |

### One-paragraph summary

If you're in **React or Svelte and want deep customization of interactive node UIs, choose xyflow (React Flow / Svelte Flow)** — DOM-rendered nodes give you arbitrary component content and the shared `@xyflow/system` core gives you battle-tested drag/pan/zoom/handles. In **Vue**, reach for **vue-flow** (renderer) or **baklavajs** (renderer + engine); in **Angular**, **Foblex Flow** or **ngx-vflow**. When the graph is **very large**, drop DOM and use **sigma.js** (WebGL) or **cytoscape.js** (canvas + algorithms). When the graph is **computational/dataflow** and must execute, use **rete** or **litegraph.js**. When you just need a **static diagram for docs**, use **mermaid**. And in every interactive case, remember that a renderer is not a layout engine: pair React Flow with **dagre/elkjs** for positions and **graphology/graphlib** for the data model.

---

## 7. Sources

- `awesome-node-based-uis/README.md` — entire catalogue: *Javascript Libraries → Renderers* (lines ~13–43), *Layouting* (~45–53), *Graph Utilities* (~55–60), *Misc* (~62–67), and *Applications* subsections (~100–219). Curated by the React Flow / Svelte Flow team.
- `xyflow/packages/react/package.json` — `@xyflow/react` version **12.10.2**.
- `xyflow/packages/svelte/package.json` — `@xyflow/svelte` version **1.5.2**.
- `xyflow/packages/system/package.json` — `@xyflow/system` version **0.0.76** (shared core: `xyflow/packages/system/src/{xydrag,xypanzoom,xyhandle,xyresizer,xyminimap}`).
