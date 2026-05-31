# Edge path algorithms & markers

## What this covers

The exact control-point and orthogonal-routing math behind React Flow's four built-in edge path builders (`getBezierPath`, `getSmoothStepPath`, `getStraightPath`, `getSimpleBezierPath`), the shared label-center helpers (`getEdgeCenter`, `getBezierEdgeCenter`), and the SVG marker system (`MarkerType`, `createMarkerIds`, `getMarkerId`, `<marker>` defs, `url(#id)` resolution) — all copied verbatim from source so every coordinate, default, and return-tuple slot is verifiable.

Versions pinned: `@xyflow/system` **0.0.76**, `@xyflow/react` **12.10.2**, `@xyflow/svelte` **1.5.2**. All path math lives in `@xyflow/system` and is shared across the React and Svelte renderers. The React components (`BezierEdge`, `SmoothStepEdge`, etc.) are thin wrappers that call these system functions; Svelte has equivalent wrappers.

---

## 1. The common contract: the return tuple

Every path builder returns the **same 5-element tuple**, typed as a labeled tuple:

```ts
[path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

| Index | Name | Meaning |
|-------|------|---------|
| `[0]` | `path` | The SVG path string for the `<path d="...">` element. |
| `[1]` | `labelX` | X position to render the edge label (center of path). |
| `[2]` | `labelY` | Y position to render the edge label. |
| `[3]` | `offsetX` | **Absolute** difference between the source X and the path-center X. |
| `[4]` | `offsetY` | **Absolute** difference between the source Y and the path-center Y. |

This is a tuple (fixed-size array), deliberately, "to make it easier to work with multiple edge paths at once" — you typically destructure `const [path, labelX, labelY] = getBezierPath(...)` and ignore the offsets unless positioning a label background.

The `Position` enum (`packages/system/src/types/utils.ts:Position`) drives every algorithm:

```ts
export enum Position {
  Left = 'left',
  Top = 'top',
  Right = 'right',
  Bottom = 'bottom',
}
```

Source coordinates (`sourceX/sourceY`) and target coordinates (`targetX/targetY`) are already-computed **handle positions in flow coordinates** — these functions do no node geometry; they only connect two points given the side each handle exits from.

---

## 2. `getStraightPath` — the trivial case

File: `packages/system/src/utils/edges/straight-edge.ts:getStraightPath`

### Signature & params

```ts
export type GetStraightPathParams = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
};

export function getStraightPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: GetStraightPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

Note: `getStraightPath` takes **no** `sourcePosition`/`targetPosition` — a straight line ignores handle orientation entirely. (The JSDoc example misleadingly shows those props, but they are not in the type and are dropped.)

### Body (verbatim)

```ts
const [labelX, labelY, offsetX, offsetY] = getEdgeCenter({
  sourceX, sourceY, targetX, targetY,
});

return [`M ${sourceX},${sourceY}L ${targetX},${targetY}`, labelX, labelY, offsetX, offsetY];
```

The path is a single `M` (moveto) + `L` (lineto). The label sits at the geometric midpoint via `getEdgeCenter` (Section 6).

---

## 3. `getBezierPath` — the default edge

File: `packages/system/src/utils/edges/bezier-edge.ts:getBezierPath`

This is the default edge type (`ConnectionLineType.Bezier = 'default'`). It draws **one cubic Bézier** (`C` command) with two control points, one derived from each handle's side and the `curvature` setting.

### Signature & params

```ts
export type GetBezierPathParams = {
  sourceX: number;
  sourceY: number;
  /** @default Position.Bottom */
  sourcePosition?: Position;
  targetX: number;
  targetY: number;
  /** @default Position.Top */
  targetPosition?: Position;
  /** The curvature of the bezier edge. @default 0.25 */
  curvature?: number;
};

export function getBezierPath({
  sourceX,
  sourceY,
  sourcePosition = Position.Bottom,
  targetX,
  targetY,
  targetPosition = Position.Top,
  curvature = 0.25,
}: GetBezierPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

| Param | Default | Role |
|-------|---------|------|
| `sourceX`, `sourceY` | — | Source handle position. |
| `targetX`, `targetY` | — | Target handle position. |
| `sourcePosition` | `Position.Bottom` | Side the curve leaves the source; sets the direction of the source control point. |
| `targetPosition` | `Position.Top` | Side the curve enters the target; sets the direction of the target control point. |
| `curvature` | `0.25` | Strength of the bow. Higher = more pronounced curve. Only affects the "wrong way" (negative-distance) case — see below. |

### The control-point math (verbatim)

Two helpers compute how far the control point is pushed out from each handle:

```ts
function calculateControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) {
    return 0.5 * distance;
  }
  return curvature * 25 * Math.sqrt(-distance);
}

function getControlWithCurvature({ pos, x1, y1, x2, y2, c }: GetControlWithCurvatureParams): [number, number] {
  switch (pos) {
    case Position.Left:
      return [x1 - calculateControlOffset(x1 - x2, c), y1];
    case Position.Right:
      return [x1 + calculateControlOffset(x2 - x1, c), y1];
    case Position.Top:
      return [x1, y1 - calculateControlOffset(y1 - y2, c)];
    case Position.Bottom:
      return [x1, y1 + calculateControlOffset(y2 - y1, c)];
  }
}
```

**How to read this.** For a handle on a given side, the control point is pushed **outward along the axis normal to that side**, and the perpendicular coordinate (`y1` for Left/Right, `x1` for Top/Bottom) is kept equal to the handle's — so the curve always leaves the node perpendicular to the handle's edge. That perpendicular exit is what makes Bézier edges look like they "tuck into" the handle.

The `distance` passed to `calculateControlOffset` is the **signed gap toward the other node along the exit axis**:

- `Position.Right`: `distance = x2 - x1` (target X minus source X). If the target is to the right (positive), the curve is going "the natural way": offset = `0.5 * distance` (half the gap — a smooth S/arc). If the target is to the **left** (negative distance, edge bends back on itself), it switches to `curvature * 25 * Math.sqrt(-distance)` — a `curvature`-scaled, sub-linear (`sqrt`) bump that keeps the loop from exploding as the backtrack distance grows.
- `Position.Left`: mirror — `distance = x1 - x2`.
- `Position.Bottom`: `distance = y2 - y1`.
- `Position.Top`: `distance = y1 - y2`.

So `curvature` is a **no-op for normally-oriented edges** (positive distance → `0.5 * distance`); it only shapes the loop when a handle points away from its target.

### Assembling the curve (verbatim)

```ts
const [sourceControlX, sourceControlY] = getControlWithCurvature({
  pos: sourcePosition, x1: sourceX, y1: sourceY, x2: targetX, y2: targetY, c: curvature,
});
const [targetControlX, targetControlY] = getControlWithCurvature({
  pos: targetPosition, x1: targetX, y1: targetY, x2: sourceX, y2: sourceY, c: curvature,
});
const [labelX, labelY, offsetX, offsetY] = getBezierEdgeCenter({
  sourceX, sourceY, targetX, targetY,
  sourceControlX, sourceControlY, targetControlX, targetControlY,
});

return [
  `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
  labelX, labelY, offsetX, offsetY,
];
```

Note the target control call passes `x1/y1 = target` and `x2/y2 = source` — i.e. each control point looks "back toward the other endpoint" to decide its outward push. The final path is `M source C sourceControl targetControl target` — a single cubic Bézier.

### React wrapper

`packages/react/src/components/Edges/BezierEdge.tsx:BezierEdge` calls `getBezierPath` with `curvature: pathOptions?.curvature` (so a user sets it via `edge.pathOptions.curvature`, typed as `BezierPathOptions = { curvature?: number }` in `packages/system/src/types/edges.ts`).

---

## 4. `getSimpleBezierPath` — Bézier without curvature

File: `packages/react/src/components/Edges/SimpleBezierEdge.tsx:getSimpleBezierPath`

Unlike the other three, `getSimpleBezierPath` lives in the **React package**, not `@xyflow/system` (it is re-exported from `@xyflow/react`). It is a simpler cubic Bézier with **no `curvature` parameter** — control points are placed at the geometric midpoint along the exit axis.

### Signature & params

```ts
export interface GetSimpleBezierPathParams {  // declared as an `interface` in source
  sourceX: number;
  sourceY: number;
  /** @default Position.Bottom */
  sourcePosition?: Position;
  targetX: number;
  targetY: number;
  /** @default Position.Top */
  targetPosition?: Position;
}

export function getSimpleBezierPath({
  sourceX, sourceY, sourcePosition = Position.Bottom,
  targetX, targetY, targetPosition = Position.Top,
}: GetSimpleBezierPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

### Control-point math (verbatim)

```ts
function getControl({ pos, x1, y1, x2, y2 }: GetControlParams): [number, number] {
  if (pos === Position.Left || pos === Position.Right) {
    return [0.5 * (x1 + x2), y1];
  }
  return [x1, 0.5 * (y1 + y2)];
}
```

For a horizontal handle (Left/Right) the control point is `(midpoint of the two X's, this handle's Y)`. For a vertical handle (Top/Bottom) it is `(this handle's X, midpoint of the two Y's)`. No `curvature`, no `sqrt`, no sign handling — hence "simple". The body is otherwise identical to `getBezierPath`: build both controls, call `getBezierEdgeCenter`, emit `M...C...`.

```ts
const [sourceControlX, sourceControlY] = getControl({ pos: sourcePosition, x1: sourceX, y1: sourceY, x2: targetX, y2: targetY });
const [targetControlX, targetControlY] = getControl({ pos: targetPosition, x1: targetX, y1: targetY, x2: sourceX, y2: sourceY });
const [labelX, labelY, offsetX, offsetY] = getBezierEdgeCenter({ sourceX, sourceY, targetX, targetY, sourceControlX, sourceControlY, targetControlX, targetControlY });
return [`M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`, labelX, labelY, offsetX, offsetY];
```

---

## 5. `getSmoothStepPath` — orthogonal (step) routing

File: `packages/system/src/utils/edges/smoothstep-edge.ts:getSmoothStepPath`

This is the most involved algorithm. It "mimics orthogonal edge routing... not as good as a real orthogonal edge routing, but faster and good enough as a default for step and smooth step edges" (source comment). It produces an axis-aligned polyline with optionally **rounded corners** (quadratic Bézier bends).

### Signature & params

```ts
export interface GetSmoothStepPathParams {
  sourceX: number;
  sourceY: number;
  /** @default Position.Bottom */
  sourcePosition?: Position;
  targetX: number;
  targetY: number;
  /** @default Position.Top */
  targetPosition?: Position;
  /** @default 5 */
  borderRadius?: number;
  centerX?: number;
  centerY?: number;
  /** @default 20 */
  offset?: number;
  /** Controls where the bend occurs along the path.
   *  0 = at source, 1 = at target, 0.5 = midpoint. @default 0.5 */
  stepPosition?: number;
}

export function getSmoothStepPath({
  sourceX, sourceY, sourcePosition = Position.Bottom,
  targetX, targetY, targetPosition = Position.Top,
  borderRadius = 5,
  centerX, centerY,
  offset = 20,
  stepPosition = 0.5,
}: GetSmoothStepPathParams): [path: string, labelX: number, labelY: number, offsetX: number, offsetY: number]
```

| Param | Default | Role |
|-------|---------|------|
| `borderRadius` | `5` | Corner rounding radius. `0` → hard 90° corners (this is what `StepEdge` passes). |
| `offset` | `20` | Distance the path travels **straight out of each handle** before it is allowed to bend (the "gap"). |
| `centerX` / `centerY` | `undefined` | Override the auto-computed bend center. If supplied, used verbatim. |
| `stepPosition` | `0.5` | When source and target face opposite directions, where along the run the perpendicular jump happens. |

### Step 1 — handle direction unit vectors

```ts
const handleDirections = {
  [Position.Left]:   { x: -1, y: 0 },
  [Position.Right]:  { x: 1, y: 0 },
  [Position.Top]:    { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};
```

Each handle gets a unit vector pointing **away from its node**. The path first walks `offset` pixels along this vector to a "gapped" point:

```ts
const sourceDir = handleDirections[sourcePosition];
const targetDir = handleDirections[targetPosition];
const sourceGapped = { x: source.x + sourceDir.x * offset, y: source.y + sourceDir.y * offset };
const targetGapped = { x: target.x + targetDir.x * offset, y: target.y + targetDir.y * offset };
```

### Step 2 — primary direction

```ts
const getDirection = ({ source, sourcePosition, target }) => {
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    return source.x < target.x ? { x: 1, y: 0 } : { x: -1, y: 0 };
  }
  return source.y < target.y ? { x: 0, y: 1 } : { x: 0, y: -1 };
};
```

`dirAccessor` is `'x'` if the source handle is horizontal, else `'y'`. `currDir` is the sign of travel along that axis. This decides whether the routing is fundamentally horizontal- or vertical-first.

### Step 3 — the two routing branches

**Branch A — opposite handles** (`sourceDir[dirAccessor] * targetDir[dirAccessor] === -1`, e.g. Right→Left or Bottom→Top, the common default). The bend center is computed, with `stepPosition` interpolating along the primary axis and the override `center.x/center.y` taking precedence:

```ts
if (dirAccessor === 'x') {
  centerX = center.x ?? sourceGapped.x + (targetGapped.x - sourceGapped.x) * stepPosition;
  centerY = center.y ?? (sourceGapped.y + targetGapped.y) / 2;
} else {
  centerX = center.x ?? (sourceGapped.x + targetGapped.x) / 2;
  centerY = center.y ?? sourceGapped.y + (targetGapped.y - sourceGapped.y) * stepPosition;
}
```

Then it picks either a **vertical split** (jump happens on a vertical line at `centerX`) or a **horizontal split** (jump on a horizontal line at `centerY`):

```ts
const verticalSplit   = [{ x: centerX, y: sourceGapped.y }, { x: centerX, y: targetGapped.y }];
const horizontalSplit = [{ x: sourceGapped.x, y: centerY }, { x: targetGapped.x, y: centerY }];

if (sourceDir[dirAccessor] === currDir) {
  points = dirAccessor === 'x' ? verticalSplit : horizontalSplit;
} else {
  points = dirAccessor === 'x' ? horizontalSplit : verticalSplit;
}
```

**Branch B — same or mixed handles** (e.g. Right→Right, or Right→Bottom). It produces a **single** corner point, choosing whether to take X from source/Y from target (`sourceTarget`) or the opposite (`targetSource`):

```ts
const sourceTarget = [{ x: sourceGapped.x, y: targetGapped.y }];
const targetSource = [{ x: targetGapped.x, y: sourceGapped.y }];
if (dirAccessor === 'x') {
  points = sourceDir.x === currDir ? targetSource : sourceTarget;
} else {
  points = sourceDir.y === currDir ? sourceTarget : targetSource;
}
```

Branch B then handles two correctness fixes:

1. **Same-position overlap guard** — when `sourcePosition === targetPosition` and the handles are closer than `offset`, a `gapOffset` is added to avoid the gapped point overlapping the corner and producing a kinked path:
   ```ts
   if (diff <= offset) {
     const gapOffset = Math.min(offset - 1, offset - diff);
     ...
   }
   ```
2. **Mixed-position flip** — for combos like Right→Bottom it recomputes `flipSourceTarget` to decide which of `sourceTarget`/`targetSource` avoids a self-crossing.

Label center in Branch B is placed **on the longest segment**:

```ts
if (maxXDistance >= maxYDistance) {
  centerX = (sourceGapPoint.x + targetGapPoint.x) / 2;
  centerY = points[0].y;
} else {
  centerX = points[0].x;
  centerY = (sourceGapPoint.y + targetGapPoint.y) / 2;
}
```

### Step 4 — assembling the point list

```ts
const pathPoints = [
  source,
  ...(gappedSource differs from points[0] ? [gappedSource] : []),
  ...points,
  ...(gappedTarget differs from last point ? [gappedTarget] : []),
  target,
];
```

The duplicate-skip ("we only want to add the gapped source/target if they are different from the first/last point") prevents zero-length segments that would corrupt the bend math.

`getPoints` returns `[pathPoints, centerX, centerY, defaultOffsetX, defaultOffsetY]`. Note **the offsets here come from `getEdgeCenter`** on the raw source/target (`defaultOffsetX/Y`), *not* from the routed center.

### Step 5 — corners via `getBend`

The path string is built by walking interior points and rounding each corner:

```ts
let path = `M${points[0].x} ${points[0].y}`;
for (let i = 1; i < points.length - 1; i++) {
  path += getBend(points[i - 1], points[i], points[i + 1], borderRadius);
}
path += `L${points[points.length - 1].x} ${points[points.length - 1].y}`;
```

```ts
function getBend(a, b, c, size) {
  const bendSize = Math.min(distance(a, b) / 2, distance(b, c) / 2, size);
  const { x, y } = b;

  // straight-through, no corner
  if ((a.x === x && x === c.x) || (a.y === y && y === c.y)) {
    return `L${x} ${y}`;
  }

  // first segment horizontal
  if (a.y === y) {
    const xDir = a.x < c.x ? -1 : 1;
    const yDir = a.y < c.y ? 1 : -1;
    return `L ${x + bendSize * xDir},${y}Q ${x},${y} ${x},${y + bendSize * yDir}`;
  }

  const xDir = a.x < c.x ? 1 : -1;
  const yDir = a.y < c.y ? -1 : 1;
  return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`;
}
```

`bendSize` is **clamped to half the shorter adjoining segment** so corners never overshoot on short runs. Each corner becomes `L` (line up to `bendSize` before the corner) + `Q` (quadratic Bézier using the corner `b` as the control point) into the next segment. With `borderRadius = 0`, `bendSize` is `0`, so every `Q` collapses to a sharp 90° corner — that is exactly how `StepEdge` is implemented.

### `StepEdge` is `SmoothStepEdge` with `borderRadius: 0`

`packages/react/src/components/Edges/StepEdge.tsx:StepEdge`:

```tsx
<SmoothStepEdge
  {...props}
  id={_id}
  pathOptions={useMemo(() => ({ borderRadius: 0, offset: props.pathOptions?.offset }), [props.pathOptions?.offset])}
/>
```

The `SmoothStepPathOptions` type (`packages/system/src/types/edges.ts`) is `{ offset?: number; borderRadius?: number; stepPosition?: number }`; `StepPathOptions` is just `{ offset?: number }`.

---

## 5b. React edge-component prop types

The five exported React edge components (`BezierEdge`, `SmoothStepEdge`, `StepEdge`, `StraightEdge`, `SimpleBezierEdge`) are thin `memo` wrappers around the path builders. Their props are **not** the full `EdgeProps` a *custom* edge receives — they are a narrower `EdgeComponentProps`-derived type defined in `packages/react/src/types/edges.ts`. (Note: these `*Props` are distinct from `EdgeProps`, the wrapper props passed into a user's custom edge component.)

### Shared building blocks (verbatim, `packages/react/src/types/edges.ts`)

`EdgeLabelOptions` — the label/label-background fields all edge components share (re-used by `Edge`, `EdgeProps`, `BaseEdgeProps`, `EdgeTextProps`):

```ts
export type EdgeLabelOptions = {
  /** The label or custom element to render along the edge. This is commonly a text label or some
   *  custom controls. */
  label?: ReactNode;
  /** Custom styles to apply to the label. */
  labelStyle?: CSSProperties;
  labelShowBg?: boolean;
  labelBgStyle?: CSSProperties;
  labelBgPadding?: [number, number];
  labelBgBorderRadius?: number;
};
```

`EdgePosition` (imported from `@xyflow/system`, `packages/system/src/types/edges.ts:EdgePosition`) — the six required geometry fields:

```ts
export type EdgePosition = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
};
```

`EdgeComponentProps` — the common base for the exported edge components:

```ts
export type EdgeComponentProps = EdgePosition &
  EdgeLabelOptions & {
    id?: EdgeProps['id'];
    markerStart?: EdgeProps['markerStart'];   // string (already-resolved url('#...'))
    markerEnd?: EdgeProps['markerEnd'];        // string
    interactionWidth?: EdgeProps['interactionWidth'];  // number
    style?: EdgeProps['style'];                // CSSProperties
    sourceHandleId?: EdgeProps['sourceHandleId'];      // string | null
    targetHandleId?: EdgeProps['targetHandleId'];      // string | null
  };

export type EdgeComponentWithPathOptions<PathOptions> = EdgeComponentProps & {
  pathOptions?: PathOptions;
};
```

Because `markerStart`/`markerEnd` here are typed `EdgeProps['markerStart']` = `string` (see `EdgeProps` below), the value an edge component receives is the **already-resolved** `url('#…')` string produced by `EdgeWrapper` (Section 7.3), not the original `EdgeMarker` config.

### The five exported prop types (verbatim)

```ts
/** BezierEdge component props */
export type BezierEdgeProps = EdgeComponentWithPathOptions<BezierPathOptions>;

/** SmoothStepEdge component props */
export type SmoothStepEdgeProps = EdgeComponentWithPathOptions<SmoothStepPathOptions>;

/** StepEdge component props */
export type StepEdgeProps = EdgeComponentWithPathOptions<StepPathOptions>;

/** StraightEdge component props */
export type StraightEdgeProps = Omit<EdgeComponentProps, 'sourcePosition' | 'targetPosition'>;

/** SimpleBezier component props */
export type SimpleBezierEdgeProps = EdgeComponentProps;
```

| Component | Prop type | `pathOptions` type | Notes |
|-----------|-----------|--------------------|-------|
| `BezierEdge` | `BezierEdgeProps` | `BezierPathOptions` = `{ curvature?: number }` | full `EdgeComponentProps` + `pathOptions`. |
| `SmoothStepEdge` | `SmoothStepEdgeProps` | `SmoothStepPathOptions` = `{ offset?; borderRadius?; stepPosition? }` | full `EdgeComponentProps` + `pathOptions`. |
| `StepEdge` | `StepEdgeProps` | `StepPathOptions` = `{ offset?: number }` | wrapper forces `borderRadius: 0` (Section 5). |
| `StraightEdge` | `StraightEdgeProps` | — (no `pathOptions`) | **`sourcePosition`/`targetPosition` removed** via `Omit` — a straight line ignores handle sides. |
| `SimpleBezierEdge` | `SimpleBezierEdgeProps` | — (no `pathOptions`) | plain `EdgeComponentProps`; no curvature knob. |

Key takeaways: only the three step/bezier components carry `pathOptions`; `StraightEdge` is the only one that drops `sourcePosition`/`targetPosition` (matching its builder, which has no position params — Section 2); `SimpleBezierEdge` and `StraightEdge` are bare `EdgeComponentProps` aliases.

### `EdgeProps` vs these — the distinction

`EdgeProps` (the props your **custom** edge function receives) is a different, richer type:

```ts
export type EdgeProps<EdgeType extends Edge = Edge> = Pick<
  EdgeType,
  'id' | 'type' | 'animated' | 'data' | 'style' | 'selected' | 'source' | 'target' | 'selectable' | 'deletable'
> &
  EdgePosition &
  EdgeLabelOptions & {
    sourceHandleId?: string | null;
    targetHandleId?: string | null;
    markerStart?: string;
    markerEnd?: string;
    pathOptions?: any;   // @TODO: how can we get better types for pathOptions?
    interactionWidth?: number;
  };
```

So a custom edge additionally gets `type`, `animated`, `data`, `selected`, `source`, `target`, `selectable`, `deletable` — none of which the built-in exported edge components expose, and `pathOptions` is loosely typed `any`.

---

## 5c. `EdgeText` component — props & label-background defaults

File: `packages/react/src/components/Edges/EdgeText.tsx:EdgeText` (exported `memo(EdgeTextComponent)`). Helper for rendering a label + background `<rect>` inside a custom edge.

### Props type (verbatim, `packages/react/src/types/edges.ts:EdgeTextProps`)

```ts
export type EdgeTextProps = Omit<SVGAttributes<SVGElement>, 'x' | 'y'> &
  EdgeLabelOptions & {
    /** The x position where the label should be rendered. */
    x: number;
    /** The y position where the label should be rendered. */
    y: number;
  };
```

So `EdgeTextProps` = `EdgeLabelOptions` (`label`, `labelStyle`, `labelShowBg`, `labelBgStyle`, `labelBgPadding`, `labelBgBorderRadius`) **plus required** `x`/`y`, plus any passthrough `SVGAttributes` (minus `x`/`y`).

### Default values applied in the component (verbatim destructure)

```ts
function EdgeTextComponent({
  x,
  y,
  label,
  labelStyle,
  labelShowBg = true,
  labelBgStyle,
  labelBgPadding = [2, 4],
  labelBgBorderRadius = 2,
  children,
  className,
  ...rest
}: EdgeTextProps) {
```

| Prop | Default | Effect |
|------|---------|--------|
| `labelShowBg` | `true` | Whether the background `<rect>` is rendered at all. |
| `labelBgPadding` | `[2, 4]` | `[xPad, yPad]`. Rect width = `textWidth + 2*labelBgPadding[0]`, height = `textHeight + 2*labelBgPadding[1]`; rect is offset `x={-labelBgPadding[0]}`, `y={-labelBgPadding[1]}`. |
| `labelBgBorderRadius` | `2` | Applied to both `rx` and `ry` of the background rect. |
| `labelBgStyle` | `undefined` | Spread onto the rect's `style` (e.g. `{ fill: 'red' }`). |
| `labelStyle` | `undefined` | Spread onto the `<text>` element's `style`. |

These same six label props (with the **same** defaults) are threaded through every built-in edge component → `BaseEdge` → `EdgeText`. The built-in edge components (`BezierEdge`, etc.) pass `label`, `labelStyle`, `labelShowBg`, `labelBgStyle`, `labelBgPadding`, `labelBgBorderRadius` straight through to `BaseEdge` without supplying their own defaults — the defaults above are the single source of truth.

Render structure (verbatim): the component returns a `<g transform="translate(x - bboxW/2, y - bboxH/2)">` wrapper; when `labelShowBg` is true it renders:

```tsx
<rect
  width={edgeTextBbox.width + 2 * labelBgPadding[0]}
  x={-labelBgPadding[0]}
  y={-labelBgPadding[1]}
  height={edgeTextBbox.height + 2 * labelBgPadding[1]}
  className="react-flow__edge-textbg"
  style={labelBgStyle}
  rx={labelBgBorderRadius}
  ry={labelBgBorderRadius}
/>
```

followed by `<text className="react-flow__edge-text" y={bboxH/2} dy="0.3em" style={labelStyle}>`. If `label` is falsy the component returns `null` (renders nothing).

---

## 6. Label-center helpers

### `getEdgeCenter` — geometric midpoint

File: `packages/system/src/utils/edges/general.ts:getEdgeCenter`. Used by straight edges and simple smoothstep cases.

```ts
export function getEdgeCenter({ sourceX, sourceY, targetX, targetY }): [number, number, number, number] {
  const xOffset = Math.abs(targetX - sourceX) / 2;
  const centerX = targetX < sourceX ? targetX + xOffset : targetX - xOffset;

  const yOffset = Math.abs(targetY - sourceY) / 2;
  const centerY = targetY < sourceY ? targetY + yOffset : targetY - yOffset;

  return [centerX, centerY, xOffset, yOffset];
}
```

Returns `[centerX, centerY, xOffset, yOffset]`. `xOffset`/`yOffset` are **half the absolute span** (= distance from center to either endpoint), which is why the public offset tuple slots are described as "absolute difference between the source position and the path center."

### `getBezierEdgeCenter` — Bézier t=0.5 approximation

File: `packages/system/src/utils/edges/bezier-edge.ts:getBezierEdgeCenter`. Used by both Bézier builders.

```ts
export function getBezierEdgeCenter({
  sourceX, sourceY, targetX, targetY,
  sourceControlX, sourceControlY, targetControlX, targetControlY,
}): [number, number, number, number] {
  // cubic bezier t=0.5 mid point — not the true arc midpoint, but cheap to compute
  const centerX = sourceX * 0.125 + sourceControlX * 0.375 + targetControlX * 0.375 + targetX * 0.125;
  const centerY = sourceY * 0.125 + sourceControlY * 0.375 + targetControlY * 0.375 + targetY * 0.125;
  const offsetX = Math.abs(centerX - sourceX);
  const offsetY = Math.abs(centerY - sourceY);

  return [centerX, centerY, offsetX, offsetY];
}
```

The coefficients `0.125 / 0.375 / 0.375 / 0.125` are the **Bernstein basis weights of a cubic Bézier evaluated at t=0.5** (`(1-t)³, 3(1-t)²t, 3(1-t)t², t³` = `1/8, 3/8, 3/8, 1/8`). So the label sits at the parametric midpoint of the curve — not the arc-length midpoint, but visually close and O(1) to compute. Here `offsetX/offsetY` are measured **from the source** (`|center - source|`), unlike `getEdgeCenter` where they are half-spans.

---

## 7. The marker system

Markers (arrowheads) are SVG `<marker>` elements referenced by edges via `marker-start`/`marker-end` → `url(#id)`. There are three moving parts: the **type config**, the **id resolution**, and the **`<defs>` rendering**.

### 7.1 Types

File: `packages/system/src/types/edges.ts`.

```ts
export enum MarkerType {
  Arrow = 'arrow',
  ArrowClosed = 'arrowclosed',
}

export type EdgeMarker = {
  type: MarkerType | `${MarkerType}`;
  color?: string | null;
  width?: number;
  height?: number;
  markerUnits?: string;
  orient?: string;
  strokeWidth?: number;
};

export type EdgeMarkerType = string | EdgeMarker;

export type MarkerProps = EdgeMarker & { id: string };
```

`edge.markerStart` / `edge.markerEnd` are typed `EdgeMarkerType` on `EdgeBase` — they can be **either** a bare string (used directly as a marker id) **or** an `EdgeMarker` object (full config, from which an id is derived).

| `EdgeMarker` field | Default (at render) | Effect |
|--------------------|---------------------|--------|
| `type` | required | `'arrow'` (open polyline) or `'arrowclosed'` (filled triangle). |
| `color` | falls back to `defaultColor` | Stroke (and fill for closed) of the arrowhead. |
| `width` | `12.5` | `markerWidth`. |
| `height` | `12.5` | `markerHeight`. |
| `markerUnits` | `'strokeWidth'` | SVG `markerUnits`. |
| `orient` | `'auto-start-reverse'` | Rotates the marker to follow the edge; `-start-reverse` flips the start marker so both ends point outward. |
| `strokeWidth` | `1` | Arrowhead line thickness. |

### 7.2 ID resolution — `getMarkerId`

File: `packages/system/src/utils/marker.ts:getMarkerId`.

```ts
export function getMarkerId(marker: EdgeMarkerType | undefined, id?: string | null): string {
  if (!marker) return '';
  if (typeof marker === 'string') return marker;

  const idPrefix = id ? `${id}__` : '';
  return `${idPrefix}${Object.keys(marker).sort().map((key) => `${key}=${marker[key]}`).join('&')}`;
}
```

- A **string** marker is its own id (you reference an existing `<marker>`).
- An **object** marker gets a **deterministic id** built by sorting its keys and joining `key=value` pairs with `&`, optionally prefixed by the React Flow instance `id` (`rfId`) so multiple flows on one page don't collide. Two edges with identical marker config therefore share one `<marker>` def — automatic deduplication.

### 7.3 `url(#id)` wiring on the edge — `EdgeWrapper`

File: `packages/react/src/components/EdgeWrapper/index.tsx`. The wrapper turns the marker config into the actual SVG attribute value and passes it down to the edge component:

```ts
const markerStartUrl = useMemo(
  () => (edge.markerStart ? `url('#${getMarkerId(edge.markerStart, rfId)}')` : undefined),
  [edge.markerStart, rfId]
);
const markerEndUrl = useMemo(
  () => (edge.markerEnd ? `url('#${getMarkerId(edge.markerEnd, rfId)}')` : undefined),
  [edge.markerEnd, rfId]
);
// ...passed to the edge component as markerStart={markerStartUrl} markerEnd={markerEndUrl}
```

So the `markerStart`/`markerEnd` props a custom edge receives are **already the `url('#...')` strings**, not the original config. `BaseEdge` spreads them straight onto the `<path>` (`<path {...props} d={path} .../>`), where they become `marker-start`/`marker-end`.

### 7.4 The `<defs>` — `createMarkerIds` + `MarkerDefinitions`

File: `packages/system/src/utils/marker.ts:createMarkerIds` collects every **object-typed** marker across all edges (plus `defaultEdgeOptions.markerStart/End`), dedupes by id, sorts by id for stable render order, and produces `MarkerProps[]`:

```ts
[edge.markerStart || defaultMarkerStart, edge.markerEnd || defaultMarkerEnd].forEach((marker) => {
  if (marker && typeof marker === 'object') {
    const markerId = getMarkerId(marker, id);
    if (!ids.has(markerId)) {
      markers.push({ id: markerId, color: marker.color || defaultColor, ...marker });
      ids.add(markerId);
    }
  }
});
```

(String markers are skipped here — they're assumed to already exist as defs the user supplied.)

File: `packages/react/src/container/EdgeRenderer/MarkerDefinitions.tsx` renders one `<svg class="react-flow__marker"><defs>` containing a `<marker>` per id:

```tsx
<marker
  className="react-flow__arrowhead"
  id={id}
  markerWidth={`${width}`}     // default 12.5
  markerHeight={`${height}`}   // default 12.5
  viewBox="-10 -10 20 20"
  markerUnits={markerUnits}    // default 'strokeWidth'
  orient={orient}              // default 'auto-start-reverse'
  refX="0" refY="0"
>
  <Symbol color={color} strokeWidth={strokeWidth} />
</marker>
```

The comment explains the `rfId` prefix: *"when you have multiple flows on a page and you hide the first one, the other ones have no markers anymore when they do have markers with the same ids."*

### 7.5 The arrowhead glyphs — `MarkerSymbols`

File: `packages/react/src/container/EdgeRenderer/MarkerSymbols.tsx`. Each `MarkerType` maps to an SVG `<polyline>`:

```tsx
const ArrowSymbol = ({ color = 'none', strokeWidth = 1 }) => (
  <polyline className="arrow" style={{ strokeWidth, ...(color && { stroke: color }) }}
    strokeLinecap="round" fill="none" strokeLinejoin="round"
    points="-5,-4 0,0 -5,4" />            // open "V"
);

const ArrowClosedSymbol = ({ color = 'none', strokeWidth = 1 }) => (
  <polyline className="arrowclosed" style={{ strokeWidth, ...(color && { stroke: color, fill: color }) }}
    strokeLinecap="round" strokeLinejoin="round"
    points="-5,-4 0,0 -5,4 -5,-4" />      // closed triangle (note repeated start point + fill)
);

export const MarkerSymbols = {
  [MarkerType.Arrow]: ArrowSymbol,
  [MarkerType.ArrowClosed]: ArrowClosedSymbol,
};
```

`Arrow` is a 3-point open chevron with no fill; `ArrowClosed` adds a 4th point (`-5,-4` again) to close the triangle and fills it with `color`. The points live in the marker's `viewBox="-10 -10 20 20"` coordinate space.

`useMarkerSymbol(type)` looks the type up and, if missing, fires `onError('009', ...)` (message `Marker type "${type}" doesn't exist.` from `packages/system/src/constants.ts:error009`) and returns `null` — an unknown marker type renders nothing rather than throwing.

---

## 8. Quick reference: which builder does what

| Builder | File | Path command(s) | Curvature? | Position-aware? | Label center |
|---------|------|-----------------|------------|-----------------|--------------|
| `getStraightPath` | `system/.../straight-edge.ts` | `M…L…` | no | no | `getEdgeCenter` |
| `getBezierPath` | `system/.../bezier-edge.ts` | `M…C…` | yes (`curvature`, default 0.25; only on backtrack) | yes | `getBezierEdgeCenter` |
| `getSimpleBezierPath` | `react/.../SimpleBezierEdge.tsx` | `M…C…` | no | yes | `getBezierEdgeCenter` |
| `getSmoothStepPath` | `system/.../smoothstep-edge.ts` | `M…L…Q…L…` | no (`borderRadius` rounds corners, default 5) | yes (+ `offset`, `stepPosition`, `centerX/Y`) | longest-segment / split center |
| `getStepEdge` (component only) | `react/.../StepEdge.tsx` | via smoothstep, `borderRadius: 0` | — | yes | — |

All four return `[path, labelX, labelY, offsetX, offsetY]`. Defaults across builders: `sourcePosition = Position.Bottom`, `targetPosition = Position.Top`.

---

## 9. Practical usage in a custom edge

```tsx
import { BaseEdge, getSmoothStepPath, MarkerType } from '@xyflow/react';

function MyEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd }) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: 8, offset: 30,
  });
  // markerEnd here is ALREADY the url('#...') string (EdgeWrapper resolved it)
  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />;
}

// Edge config that auto-creates a <marker> def:
const edge = {
  id: 'e1', source: 'a', target: 'b', type: 'myedge',
  markerEnd: { type: MarkerType.ArrowClosed, color: '#ff0072', width: 20, height: 20 },
};
```

Because the marker is an **object**, `createMarkerIds` will mint a deduped `<marker id="type=arrowclosed&color=#ff0072&width=20&height=20" />` def and `getMarkerId` produces the matching `url('#…')` the edge points at.
