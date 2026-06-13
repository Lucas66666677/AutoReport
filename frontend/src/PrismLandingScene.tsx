import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

type Point = {
  x: number
  y: number
}

type CursorObstacle = {
  scale: number
  tip: Point
}

type Edge = {
  a: Point
  b: Point
  index: number
}

type Hit = {
  edge: Edge
  point: Point
  t: number
}

type SegmentClip = {
  blocked: boolean
  end: Point
  t: number
}

type SpectralBand = {
  color: string
  ior: number
  label: string
}

type Trace = SpectralBand & {
  displayEnd: Point
  displayFullEnd: Point
  displayStart: Point
  entry: Point
  exit: Point
  inputBlocked: boolean
  internalDirection: Point
  outputBlocked: boolean
  outputDirection: Point
  polygon: string
}

const VIEWBOX_WIDTH = 1200
const VIEWBOX_HEIGHT = 640
const AIR_IOR = 1
const PRISM_CENTER: Point = { x: 612, y: 336 }
const PRISM_SIDE = 300
const PRISM_HEIGHT = (Math.sqrt(3) / 2) * PRISM_SIDE
const LIGHT_SOURCE: Point = { x: -145, y: 488 }
const INCIDENT_DIRECTION = normalize({ x: 1, y: -0.255 })
const CURSOR_SAFETY_PIXELS = 0.08
const SPECTRUM_BAND_WIDTH = 21
const SPECTRUM_SPACING = 17

const PRISM_POINTS: Point[] = [
  { x: 0, y: -(2 / 3) * PRISM_HEIGHT },
  { x: -PRISM_SIDE / 2, y: PRISM_HEIGHT / 3 },
  { x: PRISM_SIDE / 2, y: PRISM_HEIGHT / 3 },
]

const SPECTRUM: SpectralBand[] = [
  { color: '#ff1200', ior: 1.502, label: 'red' },
  { color: '#ff7a00', ior: 1.508, label: 'orange' },
  { color: '#fff200', ior: 1.514, label: 'yellow' },
  { color: '#42d900', ior: 1.520, label: 'green' },
  { color: '#00b7ff', ior: 1.527, label: 'cyan' },
  { color: '#2436ff', ior: 1.535, label: 'blue' },
  { color: '#9220b8', ior: 1.544, label: 'violet' },
]

const CURSOR_OBSTACLE_OFFSETS: Point[] = [
  { x: 0, y: 0 },
  { x: 0.4, y: 12.8 },
  { x: 3.8, y: 9.8 },
  { x: 6.1, y: 15.8 },
  { x: 8.9, y: 14.6 },
  { x: 6.7, y: 8.8 },
  { x: 11.2, y: 8.9 },
]

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function cross(a: Point, b: Point) {
  return a.x * b.y - a.y * b.x
}

function dot(a: Point, b: Point) {
  return a.x * b.x + a.y * b.y
}

function length(vector: Point) {
  return Math.hypot(vector.x, vector.y)
}

function normalize(vector: Point): Point {
  const size = length(vector)
  return size < 0.00001 ? { x: 0, y: 0 } : { x: vector.x / size, y: vector.y / size }
}

function perpendicular(vector: Point): Point {
  const unit = normalize(vector)
  return { x: -unit.y, y: unit.x }
}

function scale(vector: Point, scalar: number): Point {
  return { x: vector.x * scalar, y: vector.y * scalar }
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function rotatePoint(point: Point, degrees: number): Point {
  const radians = degreesToRadians(degrees)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return {
    x: PRISM_CENTER.x + point.x * cos - point.y * sin,
    y: PRISM_CENTER.y + point.x * sin + point.y * cos,
  }
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function angleFromCenter(point: Point) {
  return (Math.atan2(point.y - PRISM_CENTER.y, point.x - PRISM_CENTER.x) * 180) / Math.PI
}

function pointToString(point: Point) {
  return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
}

function isInteractiveElement(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('button, input, a, form'))
}

function shortestAngleDelta(nextAngle: number, previousAngle: number) {
  return ((nextAngle - previousAngle + 540) % 360) - 180
}

function getTriangleEdges(points: Point[]): Edge[] {
  return points.map((point, index) => ({
    a: point,
    b: points[(index + 1) % points.length],
    index,
  }))
}

function intersectRayWithSegment(origin: Point, direction: Point, a: Point, b: Point) {
  const segment = subtract(b, a)
  const denominator = cross(direction, segment)

  if (Math.abs(denominator) < 0.00001) return null

  const diff = subtract(a, origin)
  const t = cross(diff, segment) / denominator
  const u = cross(diff, direction) / denominator

  if (t < 0 || u < -0.0001 || u > 1.0001) return null

  return {
    point: add(origin, scale(direction, t)),
    t,
    u,
  }
}

function intersectRayWithPolygon(origin: Point, direction: Point, edges: Edge[], ignoredEdge?: number): Hit | null {
  let closest: Hit | null = null

  for (const edge of edges) {
    if (edge.index === ignoredEdge) continue

    const hit = intersectRayWithSegment(origin, direction, edge.a, edge.b)
    if (!hit || hit.t < 0.25) continue

    if (!closest || hit.t < closest.t) {
      closest = {
        edge,
        point: hit.point,
        t: hit.t,
      }
    }
  }

  return closest
}

function normalAgainstIncident(edge: Edge, incidentDirection: Point) {
  const edgeVector = subtract(edge.b, edge.a)
  const n1 = normalize({ x: -edgeVector.y, y: edgeVector.x })
  const n2 = scale(n1, -1)

  return dot(n1, incidentDirection) < dot(n2, incidentDirection) ? n1 : n2
}

function refract(incidentDirection: Point, normal: Point, fromIor: number, toIor: number) {
  const incident = normalize(incidentDirection)
  const surfaceNormal = normalize(normal)
  const cosIncident = -dot(surfaceNormal, incident)
  const ratio = fromIor / toIor
  const discriminant = 1 - ratio * ratio * (1 - cosIncident * cosIncident)

  if (discriminant < 0) return null

  return normalize(add(scale(incident, ratio), scale(surfaceNormal, ratio * cosIncident - Math.sqrt(discriminant))))
}

function getCursorPolygon(cursor: CursorObstacle | null) {
  if (!cursor) return null

  return CURSOR_OBSTACLE_OFFSETS.map((offset) => ({
    x: cursor.tip.x + offset.x * cursor.scale,
    y: cursor.tip.y + offset.y * cursor.scale,
  }))
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]
    const b = polygon[previous]
    const intersects =
      a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x

    if (intersects) inside = !inside
  }

  return inside
}

function clipSegmentByCursor(start: Point, end: Point, cursor: CursorObstacle | null): SegmentClip {
  const polygon = getCursorPolygon(cursor)

  if (!polygon) {
    return {
      blocked: false,
      end,
      t: 1,
    }
  }

  const segment = subtract(end, start)
  const segmentLength = length(segment)

  if (segmentLength < 0.00001) {
    return {
      blocked: false,
      end,
      t: 1,
    }
  }

  if (pointInPolygon(start, polygon)) {
    return {
      blocked: true,
      end: start,
      t: 0,
    }
  }

  let firstT = Number.POSITIVE_INFINITY

  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const hit = intersectRayWithSegment(start, normalize(segment), a, b)

    if (!hit || hit.t > segmentLength) continue
    firstT = Math.min(firstT, hit.t / segmentLength)
  }

  if (!Number.isFinite(firstT)) {
    return {
      blocked: false,
      end,
      t: 1,
    }
  }

  const safeT = Math.max(0, firstT - (cursor?.scale ?? 1) * CURSOR_SAFETY_PIXELS / segmentLength)

  return {
    blocked: true,
    end: add(start, scale(segment, safeT)),
    t: safeT,
  }
}

function makeBandPolygon(start: Point, end: Point, width: number) {
  const normal = perpendicular(subtract(end, start))
  const halfWidth = width / 2
  const points = [
    add(start, scale(normal, -halfWidth)),
    add(start, scale(normal, halfWidth)),
    add(end, scale(normal, halfWidth)),
    add(end, scale(normal, -halfWidth)),
  ]

  return points.map(pointToString).join(' ')
}

function traceBand(band: SpectralBand, edges: Edge[]) {
  const entryHit = intersectRayWithPolygon(LIGHT_SOURCE, INCIDENT_DIRECTION, edges)
  if (!entryHit) return null

  const entryNormal = normalAgainstIncident(entryHit.edge, INCIDENT_DIRECTION)
  const internalDirection = refract(INCIDENT_DIRECTION, entryNormal, AIR_IOR, band.ior)
  if (!internalDirection) return null

  const internalOrigin = add(entryHit.point, scale(internalDirection, 0.5))
  const exitHit = intersectRayWithPolygon(internalOrigin, internalDirection, edges, entryHit.edge.index)
  if (!exitHit) return null

  const exitNormal = normalAgainstIncident(exitHit.edge, internalDirection)
  const outputDirection = refract(internalDirection, exitNormal, band.ior, AIR_IOR)
  if (!outputDirection) return null

  return {
    ...band,
    entry: entryHit.point,
    exit: exitHit.point,
    internalDirection,
    outputDirection,
  }
}

export default function PrismLandingScene({ activationKey = 0 }: { activationKey?: number }) {
  const [cursor, setCursor] = useState<CursorObstacle | null>(null)
  const [rotation, setRotation] = useState(-3)
  const [isDragging, setIsDragging] = useState(false)
  const [isIgnited, setIsIgnited] = useState(false)
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ lastAngle: number; rotation: number } | null>(null)

  useEffect(() => {
    if (activationKey <= 0) return

    const startTimer = window.setTimeout(() => setIsIgnited(true), 0)
    const stopTimer = window.setTimeout(() => setIsIgnited(false), 1900)
    return () => {
      window.clearTimeout(startTimer)
      window.clearTimeout(stopTimer)
    }
  }, [activationKey])

  useEffect(() => {
    function handleWindowPointerMove(event: PointerEvent) {
      const nextCursor = clientPointToViewBox(event.clientX, event.clientY)
      setCursor(nextCursor)

      if (nextCursor && isDragging) {
        updateDragRotation(nextCursor.tip)
      }
    }

    function handleWindowPointerUp() {
      setIsDragging(false)
      dragStateRef.current = null
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
    }
  }, [isDragging])

  const geometry = useMemo(() => {
    const prismPoints = PRISM_POINTS.map((point) => rotatePoint(point, rotation))
    const edges = getTriangleEdges(prismPoints)
    const rawTraces = SPECTRUM.map((band) => traceBand(band, edges)).filter((trace): trace is NonNullable<typeof trace> =>
      Boolean(trace),
    )
    const coreTrace = rawTraces[Math.floor(rawTraces.length / 2)] ?? null
    const whiteTarget = coreTrace?.entry ?? add(LIGHT_SOURCE, scale(INCIDENT_DIRECTION, 900))
    const whiteClip = clipSegmentByCursor(LIGHT_SOURCE, whiteTarget, cursor)
    const prismReceivesLight = Boolean(coreTrace && !whiteClip.blocked)
    const centerOffset = (rawTraces.length - 1) / 2
    const traces: Trace[] = rawTraces.map((trace, index) => {
      const outputNormal = perpendicular(trace.outputDirection)
      const visualOffset = (index - centerOffset) * SPECTRUM_SPACING
      const displayStart = add(trace.exit, scale(outputNormal, visualOffset * 0.16))
      const displayFullEnd = add(displayStart, scale(trace.outputDirection, 820))
      const displayClip = prismReceivesLight
        ? clipSegmentByCursor(displayStart, displayFullEnd, cursor)
        : { blocked: false, end: displayStart, t: 0 }

      return {
        ...trace,
        displayEnd: displayClip.end,
        displayFullEnd,
        displayStart,
        inputBlocked: whiteClip.blocked,
        outputBlocked: prismReceivesLight && displayClip.blocked,
        polygon: makeBandPolygon(displayStart, displayClip.end, SPECTRUM_BAND_WIDTH),
      }
    })
    const innerPolygon =
      prismReceivesLight && traces.length > 0
        ? [coreTrace.entry, traces[0].displayStart, traces[traces.length - 1].displayStart].map(pointToString).join(' ')
        : ''

    return {
      coreTrace,
      innerPolygon,
      polygon: prismPoints.map(pointToString).join(' '),
      prismPoints,
      prismReceivesLight,
      traces,
      whiteBlocked: whiteClip.blocked,
      whiteEnd: whiteClip.end,
      whiteFullEnd: whiteTarget,
      whiteStart: LIGHT_SOURCE,
    }
  }, [cursor, rotation])

  const energized = geometry.prismReceivesLight
  const intensity = isIgnited ? 1 : isDragging ? 0.9 : cursor ? 0.78 : 0.62

  function clientPointToViewBox(clientX: number, clientY: number): CursorObstacle | null {
    const rect = sceneRef.current?.getBoundingClientRect()
    if (!rect) return null

    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null
    }

    const scale = Math.max(rect.width / VIEWBOX_WIDTH, rect.height / VIEWBOX_HEIGHT)
    const renderedWidth = VIEWBOX_WIDTH * scale
    const renderedHeight = VIEWBOX_HEIGHT * scale
    const offsetX = (rect.width - renderedWidth) / 2
    const offsetY = (rect.height - renderedHeight) / 2

    return {
      scale: 1 / scale,
      tip: {
        x: (clientX - rect.left - offsetX) / scale,
        y: (clientY - rect.top - offsetY) / scale,
      },
    }
  }

  function updateDragRotation(nextPointer: Point) {
    if (!dragStateRef.current) return

    const nextAngle = angleFromCenter(nextPointer)
    const delta = shortestAngleDelta(nextAngle, dragStateRef.current.lastAngle)
    const nextRotation = dragStateRef.current.rotation + delta
    dragStateRef.current = {
      lastAngle: nextAngle,
      rotation: nextRotation,
    }
    setRotation(nextRotation)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const nextCursor = clientPointToViewBox(event.clientX, event.clientY)
    setCursor(nextCursor)

    if (nextCursor && isDragging) {
      updateDragRotation(nextCursor.tip)
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isInteractiveElement(event.target)) return

    const nextCursor = clientPointToViewBox(event.clientX, event.clientY)
    if (!nextCursor) return

    const nearPrism = pointDistance(nextCursor.tip, PRISM_CENTER) < PRISM_SIDE * 0.7

    setCursor(nextCursor)
    if (!nearPrism) return

    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    dragStateRef.current = {
      lastAngle: angleFromCenter(nextCursor.tip),
      rotation,
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (isDragging) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
    dragStateRef.current = null
  }

  return (
    <div
      aria-hidden="true"
      className="landing-optics-scene absolute inset-0 overflow-hidden"
      ref={sceneRef}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => {
        setCursor(null)
        setIsDragging(false)
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="landing-optics-background absolute inset-0" />
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      >
        <defs>
          <linearGradient
            gradientUnits="userSpaceOnUse"
            id="whiteBeamCore"
            x1={geometry.whiteStart.x}
            x2={geometry.whiteFullEnd.x}
            y1={geometry.whiteStart.y}
            y2={geometry.whiteFullEnd.y}
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="68%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.96" />
          </linearGradient>
          <linearGradient
            gradientUnits="userSpaceOnUse"
            id="insideWhite"
            x1={geometry.coreTrace?.entry.x ?? 0}
            x2={geometry.coreTrace?.exit.x ?? 1}
            y1={geometry.coreTrace?.entry.y ?? 0}
            y2={geometry.coreTrace?.exit.y ?? 1}
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.92 * intensity} />
            <stop offset="42%" stopColor="#ffffff" stopOpacity={0.56 * intensity} />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="prismInterior" cx="50%" cy="58%" r="58%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.98" />
            <stop offset="58%" stopColor="#000000" stopOpacity="0.92" />
            <stop offset="82%" stopColor="#071014" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#d7efff" stopOpacity={0.42 + intensity * 0.18} />
          </radialGradient>
        </defs>

        <rect fill="#000000" height={VIEWBOX_HEIGHT} width={VIEWBOX_WIDTH} />

        <polygon fill="url(#prismInterior)" points={geometry.polygon} />

        <g className={isIgnited ? 'landing-login-flash' : undefined}>
          <line
            data-ray="white-core"
            stroke="url(#whiteBeamCore)"
            strokeLinecap="butt"
            strokeWidth={geometry.whiteBlocked ? 4.6 : 6.2}
            x1={geometry.whiteStart.x}
            x2={geometry.whiteEnd.x}
            y1={geometry.whiteStart.y}
            y2={geometry.whiteEnd.y}
          />

          {energized &&
            geometry.traces.map((trace, index) => (
              <polygon
                data-ray={`spectrum-band-${index}`}
                fill={trace.color}
                key={`band-${trace.label}`}
                opacity={trace.outputBlocked ? 0.82 : 1}
                points={trace.polygon}
              />
            ))}

          {energized && geometry.innerPolygon && (
            <polygon data-ray="internal-wedge" fill="url(#insideWhite)" points={geometry.innerPolygon} />
          )}

          {geometry.traces.map((trace, index) => (
            <line
              data-ray={`spectrum-core-${index}`}
              key={`core-${trace.label}`}
              opacity="0"
              stroke={trace.color}
              strokeWidth="1"
              x1={trace.displayStart.x}
              x2={trace.displayEnd.x}
              y1={trace.displayStart.y}
              y2={trace.displayEnd.y}
            />
          ))}
        </g>

        <polygon fill="none" points={geometry.polygon} stroke="#d9efff" strokeOpacity="0.18" strokeWidth="15" />
        <polygon fill="none" points={geometry.polygon} stroke="#cfeaff" strokeOpacity="0.42" strokeWidth="7" />
        <polygon fill="none" points={geometry.polygon} stroke="#f8fcff" strokeOpacity={0.78 + intensity * 0.16} strokeWidth="2.6" />
      </svg>
    </div>
  )
}
