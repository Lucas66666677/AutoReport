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

type SpectralBand = {
  color: string
  glow: string
  ior: number
  label: string
  width: number
}

type SegmentClip = {
  blocked: boolean
  end: Point
  t: number
}

type Trace = SpectralBand & {
  entry: Point
  exit: Point
  inputBlocked: boolean
  internalBlocked: boolean
  internalEnd: Point
  internalFullEnd: Point
  outputBlocked: boolean
  outputEnd: Point
  outputFullEnd: Point
  sampleIntensity: number
  sampleOffset: number
  source: Point
}

type WhiteSegment = {
  blocked: boolean
  end: Point
  fullEnd: Point
  sampleIntensity: number
  sampleOffset: number
  source: Point
}

const VIEWBOX_WIDTH = 1000
const VIEWBOX_HEIGHT = 620
const AIR_IOR = 1
const PRISM_CENTER: Point = { x: 500, y: 302 }
const PRISM_SIDE = 282
const PRISM_HEIGHT = (Math.sqrt(3) / 2) * PRISM_SIDE
const LIGHT_SOURCE: Point = { x: -96, y: 302 }
const INCIDENT_DIRECTION = normalize({ x: 1, y: -0.08 })
const CURSOR_SAFETY_PIXELS = 0.15
const BEAM_SAMPLE_OFFSETS = [-9, -6, -3, 0, 3, 6, 9]

const PRISM_POINTS: Point[] = [
  { x: 0, y: -(2 / 3) * PRISM_HEIGHT },
  { x: -PRISM_SIDE / 2, y: PRISM_HEIGHT / 3 },
  { x: PRISM_SIDE / 2, y: PRISM_HEIGHT / 3 },
]

const SPECTRUM: SpectralBand[] = [
  { color: '#ff6f77', glow: '#ffb2b8', ior: 1.510, label: 'red', width: 1.8 },
  { color: '#ff9d4d', glow: '#ffd2a3', ior: 1.512, label: 'orange', width: 1.7 },
  { color: '#ffe66d', glow: '#fff4b0', ior: 1.514, label: 'yellow', width: 1.65 },
  { color: '#8ff0a4', glow: '#c4ffd3', ior: 1.517, label: 'green', width: 1.65 },
  { color: '#6ee7f9', glow: '#c0f8ff', ior: 1.520, label: 'cyan', width: 1.7 },
  { color: '#8fa8ff', glow: '#c3ceff', ior: 1.524, label: 'blue', width: 1.75 },
  { color: '#c084fc', glow: '#dec4ff', ior: 1.528, label: 'violet', width: 1.85 },
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

function seededUnit(seed: number) {
  const value = Math.sin(seed * 34.321) * 38271.512
  return value - Math.floor(value)
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

function extendToBounds(start: Point, direction: Point) {
  const candidates: number[] = []

  if (Math.abs(direction.x) > 0.00001) {
    candidates.push((0 - start.x) / direction.x)
    candidates.push((VIEWBOX_WIDTH - start.x) / direction.x)
  }
  if (Math.abs(direction.y) > 0.00001) {
    candidates.push((0 - start.y) / direction.y)
    candidates.push((VIEWBOX_HEIGHT - start.y) / direction.y)
  }

  const t = Math.min(...candidates.filter((candidate) => candidate > 0))
  return Number.isFinite(t) ? add(start, scale(direction, t)) : add(start, scale(direction, 700))
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

function traceBand(
  band: SpectralBand,
  edges: Edge[],
  source: Point,
  incidentDirection: Point,
  sampleOffset: number,
  sampleIntensity: number,
) {
  const entryHit = intersectRayWithPolygon(source, incidentDirection, edges)
  if (!entryHit) return null

  const entryNormal = normalAgainstIncident(entryHit.edge, incidentDirection)
  const internalDirection = refract(incidentDirection, entryNormal, AIR_IOR, band.ior)
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
    sampleIntensity,
    sampleOffset,
    source,
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

  const dust = useMemo(
    () =>
      Array.from({ length: 64 }, (_, index) => ({
        cx: 28 + seededUnit(index + 1) * 944,
        cy: 26 + seededUnit(index + 2) * 568,
        opacity: 0.06 + seededUnit(index + 3) * 0.16,
        r: 0.4 + seededUnit(index + 4) * 0.72,
      })),
    [],
  )

  const geometry = useMemo(() => {
    const prismPoints = PRISM_POINTS.map((point) => rotatePoint(point, rotation))
    const edges = getTriangleEdges(prismPoints)
    const beamNormal = normalize({ x: -INCIDENT_DIRECTION.y, y: INCIDENT_DIRECTION.x })
    const sampledRays = BEAM_SAMPLE_OFFSETS.map((offset) => ({
      direction: INCIDENT_DIRECTION,
      intensity: 1 - (Math.abs(offset) / 9) * 0.46,
      offset,
      source: add(LIGHT_SOURCE, scale(beamNormal, offset)),
    }))
    const sampledOptics = sampledRays.map((ray) => {
      const rawTraces = SPECTRUM.map((band) =>
        traceBand(band, edges, ray.source, ray.direction, ray.offset, ray.intensity),
      ).filter((trace): trace is NonNullable<typeof trace> => Boolean(trace))
      const referenceTrace = rawTraces[Math.floor(rawTraces.length / 2)] ?? null
      const whiteTarget = referenceTrace?.entry ?? extendToBounds(ray.source, ray.direction)
      const whiteClip = clipSegmentByCursor(ray.source, whiteTarget, cursor)

      return {
        rawTraces,
        whiteSegment: {
          blocked: whiteClip.blocked,
          end: whiteClip.end,
          fullEnd: whiteTarget,
          sampleIntensity: ray.intensity,
          sampleOffset: ray.offset,
          source: ray.source,
        } satisfies WhiteSegment,
      }
    })
    const whiteSegments = sampledOptics.map((sample) => sample.whiteSegment)
    const rawTraces = sampledOptics.flatMap((sample) =>
      sample.rawTraces.map((trace) => ({
        ...trace,
        inputBlocked: sample.whiteSegment.blocked,
      })),
    )
    const traces: Trace[] = rawTraces.map((trace) => {
      const outputFullEnd = extendToBounds(trace.exit, trace.outputDirection)
      const outputClip = !trace.inputBlocked
        ? clipSegmentByCursor(trace.exit, outputFullEnd, cursor)
        : { blocked: false, end: trace.exit, t: 0 }
      const internalClip = !trace.inputBlocked
        ? clipSegmentByCursor(trace.entry, trace.exit, cursor)
        : { blocked: false, end: trace.entry, t: 0 }

      return {
        ...trace,
        internalBlocked: !trace.inputBlocked && internalClip.blocked,
        internalEnd: internalClip.end,
        internalFullEnd: trace.exit,
        outputBlocked: !trace.inputBlocked && outputClip.blocked,
        outputEnd: outputClip.end,
        outputFullEnd,
      }
    })
    const coreTraces = traces.filter((trace) => trace.sampleOffset === 0)
    const referenceTrace = coreTraces[Math.floor(coreTraces.length / 2)] ?? traces[Math.floor(traces.length / 2)] ?? null
    const primaryWhiteSegment =
      whiteSegments.find((segment) => segment.sampleOffset === 0) ??
      whiteSegments[Math.floor(whiteSegments.length / 2)] ?? {
        blocked: false,
        end: extendToBounds(LIGHT_SOURCE, INCIDENT_DIRECTION),
        fullEnd: extendToBounds(LIGHT_SOURCE, INCIDENT_DIRECTION),
        sampleIntensity: 1,
        sampleOffset: 0,
        source: LIGHT_SOURCE,
      }
    const prismReceivesLight = Boolean(referenceTrace && whiteSegments.some((segment) => !segment.blocked))

    return {
      coreTraces,
      entry: referenceTrace?.entry ?? null,
      polygon: prismPoints.map(pointToString).join(' '),
      primaryWhiteSegment,
      prismPoints,
      prismReceivesLight,
      traces,
      whiteSegments,
    }
  }, [cursor, rotation])

  const energized = geometry.prismReceivesLight
  const intensity = isIgnited ? 1 : isDragging ? 0.86 : cursor ? 0.72 : 0.5

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

    const nearPrism = pointDistance(nextCursor.tip, PRISM_CENTER) < 168

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
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient
            id="whiteBeamCore"
            gradientUnits="userSpaceOnUse"
            x1={geometry.primaryWhiteSegment.source.x}
            x2={geometry.primaryWhiteSegment.fullEnd.x}
            y1={geometry.primaryWhiteSegment.source.y}
            y2={geometry.primaryWhiteSegment.fullEnd.y}
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity={0.2 + intensity * 0.28} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.72 + intensity * 0.2} />
          </linearGradient>
          <linearGradient id="prismGlass" x1="34%" x2="72%" y1="12%" y2="92%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.045 + intensity * 0.06} />
            <stop offset="56%" stopColor="#d9fbff" stopOpacity={0.025 + intensity * 0.045} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.012" />
          </linearGradient>
          {geometry.coreTraces.map((trace) => (
            <linearGradient
              key={`gradient-${trace.label}`}
              gradientUnits="userSpaceOnUse"
              id={`spectrum-${trace.label}`}
              x1={trace.exit.x}
              x2={trace.outputFullEnd.x}
              y1={trace.exit.y}
              y2={trace.outputFullEnd.y}
            >
              <stop offset="0%" stopColor={trace.color} stopOpacity={0.72 + intensity * 0.16} />
              <stop offset="100%" stopColor={trace.color} stopOpacity="0.06" />
            </linearGradient>
          ))}
        </defs>

        <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="#050507" />
        <g className="landing-optics-dust">
          {dust.map((dot) => (
            <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} fill="#ffffff" opacity={dot.opacity} r={dot.r} />
          ))}
        </g>

        <g className={isIgnited ? 'landing-login-flash' : undefined}>
          <line
            data-ray="white-halo-wide"
            stroke="#ffffff"
            strokeLinecap="round"
            strokeOpacity={energized ? 0.045 + intensity * 0.045 : 0.018}
            strokeWidth={energized ? 15 : 8}
            x1={geometry.primaryWhiteSegment.source.x}
            x2={geometry.primaryWhiteSegment.end.x}
            y1={geometry.primaryWhiteSegment.source.y}
            y2={geometry.primaryWhiteSegment.end.y}
          />
          <line
            data-ray="white-halo"
            stroke="#ffffff"
            strokeLinecap="round"
            strokeOpacity={energized ? 0.1 + intensity * 0.08 : 0.03}
            strokeWidth={energized ? 6.6 : 3.5}
            x1={geometry.primaryWhiteSegment.source.x}
            x2={geometry.primaryWhiteSegment.end.x}
            y1={geometry.primaryWhiteSegment.source.y}
            y2={geometry.primaryWhiteSegment.end.y}
          />
          {geometry.whiteSegments.map((segment, index) => (
            <line
              data-ray={segment.sampleOffset === 0 ? 'white-core' : `white-sample-${index}`}
              key={`white-${segment.sampleOffset}`}
              stroke={segment.sampleOffset === 0 ? 'url(#whiteBeamCore)' : '#ffffff'}
              strokeLinecap="round"
              strokeOpacity={
                segment.sampleOffset === 0
                  ? undefined
                  : segment.blocked
                    ? 0.2
                    : (energized ? 0.075 + intensity * 0.055 : 0.025) * segment.sampleIntensity
              }
              strokeWidth={segment.sampleOffset === 0 ? (energized ? 1.9 : 1.15) : 0.62 + segment.sampleIntensity * 0.42}
              x1={segment.source.x}
              x2={segment.end.x}
              y1={segment.source.y}
              y2={segment.end.y}
            />
          ))}

          {energized && (
            <g>
              {geometry.traces.map((trace) => (
                <line
                  data-ray={`internal-${trace.label}-${trace.sampleOffset}`}
                  key={`internal-${trace.label}-${trace.sampleOffset}`}
                  stroke={trace.color}
                  strokeLinecap="round"
                  strokeOpacity={
                    trace.inputBlocked
                      ? 0
                      : trace.internalBlocked
                        ? 0.18
                        : trace.sampleOffset === 0
                          ? 0.13 + intensity * 0.08
                          : (0.032 + intensity * 0.045) * trace.sampleIntensity
                  }
                  strokeWidth={trace.sampleOffset === 0 ? 0.9 : 0.42 + trace.sampleIntensity * 0.14}
                  x1={trace.entry.x}
                  x2={trace.internalEnd.x}
                  y1={trace.entry.y}
                  y2={trace.internalEnd.y}
                />
              ))}

              {geometry.entry && (
                <circle
                  cx={geometry.entry.x}
                  cy={geometry.entry.y}
                  fill="#ffffff"
                  opacity={0.32 + intensity * 0.22}
                  r={1.4 + intensity * 0.6}
                />
              )}

              {geometry.coreTraces.map((trace) => (
                <circle
                  cx={trace.exit.x}
                  cy={trace.exit.y}
                  fill={trace.color}
                  key={`exit-${trace.label}`}
                  opacity={0.22 + intensity * 0.18}
                  r={0.9 + intensity * 0.35}
                />
              ))}
            </g>
          )}

          {geometry.traces.map((trace) => (
            <line
              data-ray={`spectrum-sample-${trace.label}-${trace.sampleOffset}`}
              key={`spectrum-sample-${trace.label}-${trace.sampleOffset}`}
              stroke={trace.color}
              strokeLinecap="round"
              strokeOpacity={
                trace.inputBlocked ? 0 : trace.outputBlocked ? 0.16 : (0.035 + intensity * 0.055) * trace.sampleIntensity
              }
              strokeWidth={trace.width * (trace.sampleOffset === 0 ? 1.25 : 0.95)}
              x1={trace.exit.x}
              x2={trace.outputEnd.x}
              y1={trace.exit.y}
              y2={trace.outputEnd.y}
            />
          ))}

          {geometry.coreTraces.map((trace, index) => (
            <g key={`spectrum-core-${trace.label}`} opacity={trace.inputBlocked ? 0 : energized ? 0.58 + intensity * 0.34 : 0.025}>
              <line
                data-ray={`spectrum-halo-${index}`}
                stroke={trace.glow}
                strokeLinecap="round"
                strokeOpacity={trace.outputBlocked ? 0.12 : 0.08 + intensity * 0.08}
                strokeWidth={trace.width * 2.5}
                x1={trace.exit.x}
                x2={trace.outputEnd.x}
                y1={trace.exit.y}
                y2={trace.outputEnd.y}
              />
              <line
                data-ray={`spectrum-core-${index}`}
                stroke={`url(#spectrum-${trace.label})`}
                strokeLinecap="round"
                strokeOpacity={trace.outputBlocked ? 0.84 : 0.74 + intensity * 0.14}
                strokeWidth={trace.width}
                x1={trace.exit.x}
                x2={trace.outputEnd.x}
                y1={trace.exit.y}
                y2={trace.outputEnd.y}
              />
            </g>
          ))}
        </g>

        <polygon
          className={isDragging ? 'landing-prism-dragging' : undefined}
          fill="url(#prismGlass)"
          points={geometry.polygon}
          stroke="#f8fbff"
          strokeOpacity={0.34 + intensity * 0.26}
          strokeWidth="1.55"
        />
        <polygon
          fill="none"
          points={geometry.polygon}
          stroke="#ffffff"
          strokeOpacity={energized ? 0.2 + intensity * 0.16 : 0.11}
          strokeWidth="2.8"
        />
      </svg>
      <div className="landing-optics-vignette absolute inset-0" />
    </div>
  )
}
