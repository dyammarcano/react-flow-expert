export const meta = {
  name: 'build-react-flow-expert',
  description: 'Mine a deep React Flow knowledge base from 4 local repos and assemble a global Claude skill + subagent',
  phases: [
    { title: 'Extract', detail: 'One agent per reference doc reads real source and writes it' },
    { title: 'Verify', detail: 'Adversarial fact-check each doc against live source; fix fabrications' },
    { title: 'Synthesize', detail: 'Write SKILL.md + subagent definition' },
    { title: 'Polish', detail: 'Coherence pass: cross-links, placeholders, routing accuracy' },
  ],
}

const XYFLOW = 'C:/Users/dyamm/Downloads/react-flow/xyflow'
const WEB = 'C:/Users/dyamm/Downloads/react-flow/web'
const STRUDEL = 'C:/Users/dyamm/Downloads/react-flow/strudel-flow'
const AWESOME = 'C:/Users/dyamm/Downloads/react-flow/awesome-node-based-uis'
const OUT = 'C:/Users/dyamm/.claude/skills/react-flow-expert'

const SHARED = [
  'SOURCE REPOS (absolute paths, all local, already cloned):',
  '- xyflow core monorepo: ' + XYFLOW + '  (packages/system, packages/react, packages/svelte each have src/)',
  '- web docs+site monorepo: ' + WEB + '  (sites/ hold reactflow.dev + svelteflow.dev docs as .mdx; apps/example-apps; apps/ui-components)',
  '- strudel-flow real app: ' + STRUDEL + '  (src/ uses @xyflow/react v12 with a zustand store)',
  '- ecosystem list: ' + AWESOME + '/README.md',
  '',
  'REPO MAP HINTS (Glob/Grep to confirm exact paths):',
  '- system internals: ' + XYFLOW + '/packages/system/src/{xydrag,xypanzoom,xyhandle,xyresizer,xyminimap,utils,types,index.ts}',
  '- react: ' + XYFLOW + '/packages/react/src/{container,components,hooks,store,types,index.ts}',
  '- svelte: ' + XYFLOW + '/packages/svelte/src/{lib,...}',
  '- docs MDX: Glob ' + WEB + '/**/*.mdx and ' + WEB + '/**/*.md',
  '',
  'VERSIONS to pin: @xyflow/react 12.10.2, @xyflow/svelte 1.5.2, @xyflow/system 0.0.76.',
  '',
  'HARD RULES:',
  '1. Read ACTUAL source before writing. Use Glob then Grep then Read. For very large files prefer ctx_execute_file to keep your own context lean. NEVER invent an API, prop, hook, type, or signature. If you cannot find something, say so in gaps rather than guessing.',
  '2. Cite sources inline in the doc as path:Symbol (relative to the repo) so every concrete claim is verifiable.',
  '3. INTERNALS-DEEP: explain HOW it works, not just how to use it. Include real signatures, real type definitions copied from source, and short real code examples.',
  '4. Be comprehensive and long. This is a reference doc, not a summary. Use markdown headings, tables for props/params, and fenced code blocks.',
  '5. Begin the file with a level-2 heading "What this covers" plus a single load-bearing summary sentence, then go deep.',
  '6. Write the file with the Write tool to the exact path given. Then return ONLY the structured summary object (your final message is parsed as data, not shown to a human).',
].join('\n')

const DOCS = [
  { file: '01-architecture.md', title: 'Architecture & mental model', brief:
    'The three-package architecture and how data flows. Cover: @xyflow/system as the framework-agnostic core and exactly how @xyflow/react and @xyflow/svelte consume it (what system exports from packages/system/src/index.ts). The end-to-end data flow: nodes/edges state -> store -> GraphView -> NodeRenderer/EdgeRenderer -> Pane/Viewport -> DOM. Coordinate systems: flow/position coords vs rendered/screen coords, the viewport transform [x,y,zoom], and the transform helpers (pointToRendererPoint, rendererPointToPoint, and the screenToFlowPosition / flowToScreenPosition instance methods). The store concept (Zustand in react, Svelte stores in svelte). Where to look: ' + XYFLOW + '/README.md; ' + XYFLOW + '/packages/system/src/index.ts; ' + XYFLOW + '/packages/react/src/container (GraphView, FlowRenderer, Viewport, Pane, NodeRenderer, EdgeRenderer); ' + XYFLOW + '/packages/system/src/utils/general.ts; web docs concepts/terms-and-definitions and core-concepts (Glob ' + WEB + ' for the-viewport, terms, core-concepts).' },
  { file: '02-system-internals.md', title: '@xyflow/system internals', brief:
    'Deep dive into the framework-agnostic core. For EACH of XYDrag, XYPanZoom, XYHandle, XYResizer, XYMinimap: responsibility, the public factory/class API (constructor args, update(), destroy()), the key internal logic, and how react/svelte wire into it. Cover the d3-zoom / d3-drag / d3-selection integration. Cover node measurement (how dimensions are measured, ResizeObserver usage). Cover core utils (utils/general.ts, utils/graph.ts). Where to look: ' + XYFLOW + '/packages/system/src/{xydrag,xypanzoom,xyhandle,xyresizer,xyminimap}/ (read each index.ts) and ' + XYFLOW + '/packages/system/src/utils/.' },
  { file: '03-edge-paths.md', title: 'Edge path algorithms & markers', brief:
    'The edge path math. For getBezierPath, getSmoothStepPath, getStraightPath, getSimpleBezierPath: full TypeScript signature, every parameter (source/target x/y, sourcePosition/targetPosition, curvature, borderRadius, offset, centerX/centerY), the exact return tuple [path, labelX, labelY, offsetX, offsetY], and the ACTUAL control-point / routing math copied and explained. Also getEdgeCenter, getBezierEdgeCenter, and the marker system (MarkerType enum, how markerStart/markerEnd resolve to SVG defs). Where to look: ' + XYFLOW + '/packages/system/src/utils/edges/ (bezier-edge.ts, smoothstep-edge.ts, straight-edge.ts, simple-bezier-edge.ts, general.ts); ' + XYFLOW + '/packages/react/src/components/Edges/ and BaseEdge; marker types in ' + XYFLOW + '/packages/system/src/types/edges.ts.' },
  { file: '04-react-components.md', title: 'React components & <ReactFlow> props', brief:
    'Every React component. For <ReactFlow>: enumerate EVERY prop from its props type, grouped (core data: nodes/edges/nodeTypes/edgeTypes/defaultNodes; viewport: defaultViewport/fitView/fitViewOptions/minZoom/maxZoom/translateExtent/nodeExtent; interaction: nodesDraggable/nodesConnectable/elementsSelectable/panOnDrag/panOnScroll/zoomOnScroll/selectionMode; connection: connectionMode/connectionLineType/connectionRadius/isValidConnection; keyboard: deleteKeyCode/selectionKeyCode/multiSelectionKeyCode; styling; and ALL callbacks: onNodesChange/onEdgesChange/onConnect/onNodeClick/onNodeDrag*/onEdgeClick/onConnectStart/onConnectEnd/onSelectionChange/onMove/onInit etc.) with type and default. Then document Background (variants: dots/lines/cross, gap, size), Controls, MiniMap, Panel, Handle, NodeResizer, NodeToolbar, EdgeLabelRenderer, BaseEdge, ViewportPortal, EdgeText. Where to look: ' + XYFLOW + '/packages/react/src/container/ReactFlow/ (index.tsx + types.ts for the props type); ' + XYFLOW + '/packages/react/src/components/; web docs api-reference/components (Glob ' + WEB + ').' },
  { file: '05-react-hooks.md', title: 'React hooks (every hook)', brief:
    'Every hook exported by @xyflow/react. List them by reading ' + XYFLOW + '/packages/react/src/hooks/ and the package index exports. For each hook give: exact signature, params, return type, what it does internally (which store slice it subscribes to), and when to use it. Include at least: useReactFlow, useStore, useStoreApi, useNodes, useEdges, useNodesState, useEdgesState, useViewport, useUpdateNodeInternals, useNodesData, useNodeConnections, useHandleConnections (note deprecation if any), useNodesInitialized, useConnection, useInternalNode, useNodeId, useKeyPress, useOnViewportChange, useOnSelectionChange. Where to look: ' + XYFLOW + '/packages/react/src/hooks/*.ts; web docs api-reference/hooks (Glob ' + WEB + ').' },
  { file: '06-svelte.md', title: 'Svelte Flow', brief:
    'Svelte Flow (@xyflow/svelte 1.5.2, Svelte 5). Cover: <SvelteFlow> component and props; Svelte 5 runes usage ($state, $derived, $props, $bindable) and how nodes/edges bind (bind:nodes / bind:edges or the $state pattern actually used in this version); the store access (useStore / useSvelteFlow); components (Background, Controls, MiniMap, Panel, Handle, NodeResizer, NodeToolbar, EdgeLabelRenderer); helper hooks (useSvelteFlow, useNodes, useEdges, useConnection, useNodeConnections); and the concrete DIFFERENCES from React Flow that trip people up. Where to look: ' + XYFLOW + '/packages/svelte/src/ (Glob it; look for lib/, container/SvelteFlow, components, hooks, store); web docs svelteflow.dev (Glob ' + WEB + ' for svelte).' },
  { file: '07-state-management.md', title: 'State management & the store', brief:
    'How state works. Controlled (nodes + onNodesChange + applyNodeChanges, edges + onEdgesChange + applyEdgeChanges) vs uncontrolled (defaultNodes/defaultEdges). The change system: the NodeChange and EdgeChange union types (add, remove, position, dimensions, select, replace) and the exact applyNodeChanges/applyEdgeChanges implementation. The store shape (key fields). The useNodesState/useEdgesState convenience hooks. Performance: selective subscription via useStore(selector, equalityFn), WHY nodeTypes/edgeTypes must be stable references, and how changes are batched. Where to look: ' + XYFLOW + '/packages/system/src/utils/changes.ts; ' + XYFLOW + '/packages/react/src/store/ (index.ts, initialState.ts, utils.ts); ' + XYFLOW + '/packages/react/src/hooks/useNodesEdgesState.ts; web docs guides/state-management or learn.' },
  { file: '08-custom-nodes-edges.md', title: 'Custom nodes, edges & the handle/connection system', brief:
    'Building custom nodes and edges + the connection internals. Full field lists for NodeProps (id, data, type, selected, dragging, isConnectable, sourcePosition, targetPosition, dragHandle, zIndex, width/height, parentId, positionAbsoluteX/Y) and EdgeProps (id, source, target, sourceX/sourceY/targetX/targetY, sourcePosition/targetPosition, data, selected, markerStart/markerEnd, label, style, interactionWidth). The Handle component: every prop (type source/target, position, id, isConnectable, isConnectableStart, isConnectableEnd, onConnect, isValidConnection). The connection/handle system internals: how XYHandle resolves a valid connection target, connection state, connectionMode loose/strict. Dynamic handles and why/when updateNodeInternals is required. nodeTypes/edgeTypes registration. Where to look: ' + XYFLOW + '/packages/react/src/types/{nodes.ts,edges.ts}; ' + XYFLOW + '/packages/react/src/components/Handle/; ' + XYFLOW + '/packages/system/src/xyhandle/; web docs learn/customization (custom-nodes, custom-edges, handles).' },
  { file: '09-patterns-recipes.md', title: 'Patterns & recipes (incl. strudel-flow)', brief:
    'Battle-tested patterns with REAL code. Auto-layout with dagre and elkjs. Drag-and-drop node creation from a sidebar (onDragOver/onDrop + screenToFlowPosition). Sub-flows / parent-child nodes (parentId, extent:"parent", relative positioning). Computing flows / propagating data between connected nodes (useNodesData + useNodeConnections). Connection validation. Then a concrete case study of strudel-flow: how it structures its zustand store, its custom node/edge types, dynamic audio nodes, and dagre layout. Pull actual code. Where to look: ' + WEB + '/apps/example-apps (Glob for layouting, drag-and-drop, sub-flows, computing-flows, dynamic examples); ' + STRUDEL + '/src/ (store, nodes, components, hooks).' },
  { file: '10-gotchas-errors.md', title: 'Gotchas, error codes & performance', brief:
    'Errors and pitfalls. Find the xyflow error/warning code system in source (Grep for "error", "errorMessages", "It looks like", or "#0" across ' + XYFLOW + '/packages) and map each code to cause + fix. Document the classic pitfalls: recreating nodeTypes/edgeTypes inline each render (the warning + the fix: module-scope or useMemo), forgetting updateNodeInternals after adding/moving handles, missing parent dimensions, using useReactFlow/hooks outside <ReactFlowProvider>, mixing controlled + uncontrolled, fitView timing before nodes are measured, edges needing unique ids. Performance: selector subscriptions, memoizing custom nodes, avoiding inline objects. Where to look: Grep ' + XYFLOW + '/packages for error definitions; web docs error / troubleshooting / common-errors MDX (Glob ' + WEB + ').' },
  { file: '11-migration.md', title: 'Migration v11 -> v12', brief:
    'Migrating reactflow v11 to @xyflow/react v12. The package rename (reactflow -> @xyflow/react) and CSS import path change. Key breaking changes: node dimensions moved to node.measured (width/height), nodeInternals store map removed, new types, defaultEdgeOptions, hook renames, and any prop changes. Provide a concrete step-by-step migration checklist. Note that v11 lives on the v11 branch and is still maintained as reactflow. Where to look: web docs migration guide (Glob ' + WEB + ' for migrate-to-v12 / migration); ' + XYFLOW + '/packages/react/CHANGELOG.md and any MIGRATION/CHANGELOG files.' },
  { file: '12-ecosystem.md', title: 'Node-UI ecosystem & when to choose what', brief:
    'The wider ecosystem and decision guidance. Summarize the categories from the awesome list (renderers, framework-specific libs, utilities). For each major alternative (rete, vue-flow, X6, GoJS, jointjs, litegraph.js, reaflow, Foblex Flow, ngx-vflow, cytoscape.js, sigma.js, mermaid, baklavajs, react-digraph), give a one-line "what it is + when to pick it over React Flow". End with a crisp decision guide: React/Svelte + deep customization -> xyflow; Vue -> vue-flow; Angular -> Foblex/ngx-vflow; very large graphs -> sigma/cytoscape; computational/dataflow graphs -> rete/litegraph; static docs diagrams -> mermaid. Where to look: ' + AWESOME + '/README.md.' },
  { file: '13-types.md', title: 'TypeScript types reference', brief:
    'A reference of the key exported TypeScript types with their ACTUAL definitions copied from source and field-by-field explanation. Include: Node<NodeData, NodeType>, Edge<EdgeData, EdgeType>, NodeProps, EdgeProps, ReactFlowInstance, Viewport, XYPosition, Position (enum), Connection, ConnectionState / ConnectionInProgress, HandleType, NodeChange, EdgeChange, CoordinateExtent, FitViewOptions, DefaultEdgeOptions, MarkerType, ConnectionMode, ConnectionLineType, PanOnScrollMode. Explain the generics for typing custom node/edge data. Where to look: ' + XYFLOW + '/packages/system/src/types/*.ts; ' + XYFLOW + '/packages/react/src/types/*.ts.' },
]

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    doc: { type: 'string' },
    filePath: { type: 'string' },
    symbolsCovered: { type: 'array', items: { type: 'string' } },
    sourcesCited: { type: 'array', items: { type: 'string' } },
    wordCount: { type: 'number' },
    gaps: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['complete', 'partial'] },
  },
  required: ['doc', 'filePath', 'status', 'symbolsCovered'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    doc: { type: 'string' },
    claimsChecked: { type: 'number' },
    issuesFound: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { claim: { type: 'string' }, problem: { type: 'string' }, severity: { type: 'string' } },
        required: ['claim', 'problem'],
      },
    },
    fixesApplied: { type: 'boolean' },
    verdict: { type: 'string', enum: ['accurate', 'fixed', 'needs-human'] },
  },
  required: ['doc', 'verdict', 'fixesApplied'],
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    skillPath: { type: 'string' },
    agentPath: { type: 'string' },
    description: { type: 'string' },
    sectionsInSkill: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['complete', 'partial'] },
  },
  required: ['skillPath', 'agentPath', 'status'],
}

const POLISH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    filesChecked: { type: 'number' },
    brokenLinksFixed: { type: 'number' },
    placeholdersFound: { type: 'array', items: { type: 'string' } },
    routingAccurate: { type: 'boolean' },
    finalVerdict: { type: 'string' },
  },
  required: ['finalVerdict'],
}

function extractPrompt(doc) {
  return [
    'You are a React Flow internals expert mining ONE reference doc for a knowledge base, from REAL SOURCE.',
    '',
    SHARED,
    '',
    'YOUR DOC: ' + doc.title,
    'WRITE THE FINISHED MARKDOWN TO: ' + OUT + '/reference/' + doc.file,
    '',
    'WHAT TO COVER + WHERE TO LOOK:',
    doc.brief,
    '',
    'Make it the single best reference on this topic that exists. Then return the structured summary (doc = "' + doc.file + '", filePath = the path you wrote, symbolsCovered, sourcesCited, wordCount, gaps, status).',
  ].join('\n')
}

function verifyPrompt(doc) {
  return [
    'You are an ADVERSARIAL fact-checker for a React Flow knowledge base. Your job is to find and fix FABRICATIONS.',
    '',
    SHARED,
    '',
    'DOC FILE TO CHECK (already written by an extractor): ' + OUT + '/reference/' + doc.file,
    '',
    'PROCEDURE:',
    '1. Read the doc file.',
    '2. For every concrete claim (API name, hook name, component prop, TS type, function signature, error code, and every path:Symbol citation) verify it against the LIVE source with Grep/Read. Assume each claim is WRONG until the source proves it right.',
    '3. For any fabrication, wrong signature, nonexistent symbol, or broken citation: FIX it directly in the file with Edit so it matches source. Correct it; only remove if it cannot be substantiated. Preserve the depth and length - fix, do not gut.',
    '4. Keep it internals-deep and well-cited.',
    '',
    'Return the structured verdict (doc = "' + doc.file + '", claimsChecked, issuesFound, fixesApplied, verdict).',
  ].join('\n')
}

function synthPrompt(manifestJson) {
  return [
    'You are assembling the entry point and subagent for the global "react-flow-expert" Claude skill.',
    '',
    'The reference KB is COMPLETE and verified at: ' + OUT + '/reference/  (13 docs).',
    'Read the actual reference docs (Read/Glob ' + OUT + '/reference/) so your routing and mental model are accurate.',
    '',
    'Coverage manifest from extraction:',
    manifestJson,
    '',
    'TASK 1 - Write ' + OUT + '/SKILL.md with:',
    '- YAML frontmatter: name: react-flow-expert ; description: a single trigger sentence beginning with "Use when" that covers building node-based UIs with React Flow / Svelte Flow / @xyflow (custom nodes & edges, handles, layouting, viewport, state, or debugging xyflow internals).',
    '- A tight "Core mental model" section: the three-package architecture (@xyflow/system core powering @xyflow/react and @xyflow/svelte), the store, coordinate systems + viewport transform, and controlled-vs-uncontrolled state. This is the always-loaded orientation - keep it sharp and correct, depth lives in reference/.',
    '- A "Reference map" routing table: for each reference/NN-*.md, one line on WHEN to open it.',
    '- A "Top gotchas" short list (stable nodeTypes/edgeTypes, updateNodeInternals, provider scope, measured dimensions).',
    'Keep SKILL.md focused and skimmable (the reference docs hold the depth).',
    '',
    'TASK 2 - Write ' + OUT + '/agents/react-flow-expert.md: a subagent definition with YAML frontmatter (name: react-flow-expert ; description: when to dispatch it - deep React Flow Q&A and building React Flow / Svelte Flow features ; tools: Read, Grep, Glob, Edit, Write, Bash). Body: instruct it to consult the reference/ docs in this skill, cite them, prefer real source over memory, and follow the core mental model. Note the pinned versions.',
    '',
    'Return the structured summary.',
  ].join('\n')
}

function polishPrompt() {
  return [
    'You are the final coherence reviewer for the global "react-flow-expert" Claude skill.',
    'Skill root: ' + OUT,
    '',
    'CHECK AND FIX (use Read/Glob/Grep then Edit):',
    '1. SKILL.md frontmatter is valid YAML with name + description; description starts with "Use when".',
    '2. Every reference/NN-*.md mentioned in SKILL.md routing actually exists; every existing reference doc is mentioned. Fix mismatches.',
    '3. No placeholder/TODO/TBD/"..." stubs or empty sections left in any file. List any you find; fix trivial ones.',
    '4. Internal cross-links between docs resolve to real files.',
    '5. agents/react-flow-expert.md has valid frontmatter and points at the reference docs.',
    '',
    'Return the structured final report (filesChecked, brokenLinksFixed, placeholdersFound, routingAccurate, finalVerdict).',
  ].join('\n')
}

// PHASE A + B: extract each doc, then adversarially verify it - pipelined so each doc verifies as soon as it is written.
log('Mining ' + DOCS.length + ' reference docs from source, then verifying each against live code...')
const results = await pipeline(
  DOCS,
  (doc) => agent(extractPrompt(doc), { label: 'extract:' + doc.file, phase: 'Extract', schema: EXTRACT_SCHEMA, agentType: 'general-purpose' }),
  (extractRes, doc) =>
    agent(verifyPrompt(doc), { label: 'verify:' + doc.file, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })
      .then((v) => ({ doc, extract: extractRes, verify: v })),
)

const good = results.filter(Boolean)
log('Extracted + verified ' + good.length + '/' + DOCS.length + ' docs. Synthesizing skill...')

// PHASE C: synthesize SKILL.md + subagent (barrier already passed - all docs done)
const manifest = good.map((r) => ({
  doc: r.doc.file,
  title: r.doc.title,
  symbols: r.extract ? r.extract.symbolsCovered : [],
  verdict: r.verify ? r.verify.verdict : 'unknown',
  gaps: r.extract ? r.extract.gaps : [],
}))
const synth = await agent(synthPrompt(JSON.stringify(manifest, null, 2)), {
  label: 'synthesize-skill',
  phase: 'Synthesize',
  schema: SYNTH_SCHEMA,
  agentType: 'general-purpose',
})

// PHASE D: coherence polish
const polish = await agent(polishPrompt(), { label: 'polish-coherence', phase: 'Polish', schema: POLISH_SCHEMA, agentType: 'general-purpose' })

return {
  extracted: good.length,
  total: DOCS.length,
  docs: manifest.map((m) => ({ doc: m.doc, verdict: m.verdict, gaps: m.gaps })),
  synth,
  polish,
}
