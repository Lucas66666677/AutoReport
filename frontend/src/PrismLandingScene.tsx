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

type SpectrumRay = {
  color: string
  glow: string
  offset: number
  width: number
}

type CursorObstacle = {
  scale: number
  tip: Point
}

const VIEWBOX_WIDTH = 1000
const VIEWBOX_HEIGHT = 620
const PRISM_CENTER: Point = { x: 500, y: 302 }
const PRISM_SIDE = 282
const PRISM_HEIGHT = (Math.sqrt(3) / 2) * PRISM_SIDE
const PRISM_POINTS: Point[] = [
  { x: 0, y: -(2 / 3) * PRISM_HEIGHT },
  { x: -PRISM_SIDE / 2, y: PRISM_HEIGHT / 3 },
  { x: PRISM_SIDE / 2, y: PRISM_HEIGHT / 3 },
]
const CURSOR_SAFETY_PIXELS = 0.2
const CURSOR_OBSTACLE_OFFSETS: Point[] = [
  { x: 0, y: 0 },
  { x: 0.2, y: 18 },
  { x: 4.8, y: 13.2 },
  { x: 8.2, y: 21.2 },
  { x: 11.2, y: 19.9 },
  { x: 7.7, y: 12 },
  { x: 15.4, y: 12.2 },
]

const SPECTRUM: SpectrumRay[] = [
  { color: '#ff6b7a', glow: '#ff9aa4', offset: -30, width: 3.2 },
  { color: '#ff9f43', glow: '#ffd08a', offset: -20, width: 3.1 },
  { color: '#ffe66d', glow: '#fff4a8', offset: -10, width: 3 },
  { color: '#8ff0a4', glow: '#b7ffd0', offset: 0, width: 3 },
  { color: '#6ee7f9', glow: '#b7f6ff', offset: 10, width: 3.1 },
  { color: '#8ea7ff', glow: '#b9c8ff', offset: 20, width: 3.2 },
  { color: '#c084fc', glow: '#ddc1ff', offset: 30, width: 3.3 },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
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

function midpoint(a: Point, b: Point): Point {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function cross(a: Point, b: Point) {
  return a.x * b.y - a.y * b.x
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

function angleFromCenter(point: Point) {
  return (Math.atan2(point.y - PRISM_CENTER.y, point.x - PRISM_CENTER.x) * 180) / Math.PI
}

function getCursorPolygon(cursor: CursorObstacle | null) {
  if (!cursor) return null

  return CURSOR_OBSTACLE_OFFSETS.map((offset) => ({
    x: cursor.tip.x + offset.x * cursor.scale,
    y: cursor.tip.y + offset.y * cursor.scale,
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

function clipSegmentByCursor(start: Point, end: Point, cursor: CursorObstacle | null) {
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

  const safeT = clamp(firstT - (cursor?.scale ?? 1) * CURSOR_SAFETY_PIXELS / segmentLength, 0, 1)

  return {
    blocked: true,
    end: add(start, scale(segment, safeT)),
    t: safeT,
  }
}

function vectorPoint(start: Point, degrees: number, distance: number): Point {
  const radians = degreesToRadians(degrees)

  return {
    x: start.x + Math.cos(radians) * distance,
    y: start.y + Math.sin(radians) * distance,
  }
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 34.321) * 38271.512
  return value - Math.floor(value)
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

export default function PrismLandingScene({ activationKey = 0 }: { activationKey?: number }) {
  const [pointer, setPointer] = useState<CursorObstacle | null>(null)
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
      const nextPointer = clientPointToViewBox(event.clientX, event.clientY)
      setPointer(nextPointer)

      if (nextPointer && isDragging) {
        updateDragRotation(nextPointer.tip)
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
      Array.from({ length: 72 }, (_, index) => ({
        cx: 28 + seededUnit(index + 1) * 944,
        cy: 26 + seededUnit(index + 2) * 568,
        opacity: 0.08 + seededUnit(index + 3) * 0.24,
        r: 0.45 + seededUnit(index + 4) * 0.9,
      })),
    [],
  )

  const geometry = useMemo(() => {
    const prismPoints = PRISM_POINTS.map((point) => rotatePoint(point, rotation))
    const entry = midpoint(prismPoints[0], prismPoints[1])
    const exit = midpoint(prismPoints[0], prismPoints[2])
    const whiteStart = { x: -28, y: entry.y + rotation * 0.16 }
    const whiteClip = clipSegmentByCursor(whiteStart, entry, pointer)
    const prismReceivesLight = !whiteClip.blocked
    const baseExitAngle = rotation * 0.82 + 2.5
    const internalStart = {
      x: entry.x + (exit.x - entry.x) * 0.08,
      y: entry.y + (exit.y - entry.y) * 0.1,
    }
    const internalEnd = {
      x: exit.x - Math.cos(degreesToRadians(baseExitAngle)) * 16,
      y: exit.y - Math.sin(degreesToRadians(baseExitAngle)) * 16,
    }
    const spectrum = SPECTRUM.map((ray) => {
      const end = vectorPoint(exit, baseExitAngle + ray.offset * 0.18, 640)
      const clip = prismReceivesLight
        ? clipSegmentByCursor(exit, end, pointer)
        : { blocked: false, end: exit, t: 0 }

      return {
        ...ray,
        start: exit,
        end: clip.end,
        blocked: prismReceivesLight && clip.blocked,
      }
    })

    return {
      prismPoints,
      entry,
      exit,
      whiteStart,
      whiteEnd: whiteClip.end,
      whiteBlocked: whiteClip.blocked,
      prismReceivesLight,
      internalStart,
      internalEnd,
      spectrum,
      polygon: prismPoints.map(pointToString).join(' '),
    }
  }, [pointer, rotation])

  const energized = geometry.prismReceivesLight
  const intensity = isIgnited ? 1 : isDragging ? 0.86 : pointer ? 0.72 : 0.48

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
    const nextPointer = clientPointToViewBox(event.clientX, event.clientY)
    setPointer(nextPointer)

    if (nextPointer && isDragging) {
      updateDragRotation(nextPointer.tip)
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isInteractiveElement(event.target)) return

    const nextPointer = clientPointToViewBox(event.clientX, event.clientY)
    if (!nextPointer) return

    const nearPrism = pointDistance(nextPointer.tip, PRISM_CENTER) < 168

    setPointer(nextPointer)
    if (!nearPrism) return

    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    dragStateRef.current = {
      lastAngle: angleFromCenter(nextPointer.tip),
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
        setPointer(null)
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
          <linearGradient id="whiteBeamCore" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity={0.18 + intensity * 0.34} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.76 + intensity * 0.22} />
          </linearGradient>
          <linearGradient id="prismGlass" x1="34%" x2="72%" y1="12%" y2="92%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.06 + intensity * 0.08} />
            <stop offset="52%" stopColor="#c8f7ff" stopOpacity={0.04 + intensity * 0.07} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.015" />
          </linearGradient>
          <radialGradient id="impactGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={energized ? 0.55 + intensity * 0.2 : 0.04} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <filter id="softBlur">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id="fineGlow">
            <feGaussianBlur stdDeviation="2.8" />
          </filter>
        </defs>

        <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="#050507" />
        <g className="landing-optics-dust">
          {dust.map((dot) => (
            <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill="#ffffff" opacity={dot.opacity} />
          ))}
        </g>

        <g className={isIgnited ? 'landing-login-flash' : undefined}>
          <line
            data-ray="white-glow"
            x1={geometry.whiteStart.x}
            y1={geometry.whiteStart.y}
            x2={geometry.whiteEnd.x}
            y2={geometry.whiteEnd.y}
            stroke="#ffffff"
            strokeLinecap="round"
            strokeOpacity={energized ? 0.08 + intensity * 0.18 : 0.03}
            strokeWidth={energized ? 25 + intensity * 18 : 14}
            filter="url(#softBlur)"
          />
          <line
            data-ray="white-core"
            x1={geometry.whiteStart.x}
            y1={geometry.whiteStart.y}
            x2={geometry.whiteEnd.x}
            y2={geometry.whiteEnd.y}
            stroke="url(#whiteBeamCore)"
            strokeLinecap="round"
            strokeWidth={energized ? 5.4 : 2.8}
            strokeDasharray={isIgnited ? '900' : undefined}
          />

          {energized && (
            <>
              <line
                x1={geometry.internalStart.x}
                y1={geometry.internalStart.y}
                x2={geometry.internalEnd.x}
                y2={geometry.internalEnd.y}
                stroke="#ffffff"
                strokeLinecap="round"
                strokeOpacity={0.1 + intensity * 0.28}
                strokeWidth={isIgnited ? 42 : 28}
                filter="url(#softBlur)"
              />
              <line
                x1={geometry.internalStart.x}
                y1={geometry.internalStart.y}
                x2={geometry.internalEnd.x}
                y2={geometry.internalEnd.y}
                stroke="#ffffff"
                strokeLinecap="round"
                strokeOpacity={0.28 + intensity * 0.28}
                strokeWidth="2.2"
              />
            </>
          )}

          <circle
            cx={geometry.entry.x}
            cy={geometry.entry.y}
            r={energized ? 74 + intensity * 20 : 20}
            fill="url(#impactGlow)"
            opacity={energized ? 0.42 + intensity * 0.22 : 0.08}
            filter="url(#softBlur)"
          />

          {geometry.spectrum.map((ray, index) => (
            <g key={ray.color} opacity={energized ? 0.24 + intensity * 0.6 : 0.02}>
              <line
                data-ray={`spectrum-glow-${index}`}
                x1={ray.start.x}
                y1={ray.start.y}
                x2={ray.end.x}
                y2={ray.end.y}
                stroke={ray.glow}
                strokeLinecap="round"
                strokeOpacity={ray.blocked ? 0.34 : 0.28 + intensity * 0.2}
                strokeWidth={ray.width * (isIgnited ? 5.8 : 4.3)}
                filter="url(#softBlur)"
              />
              <line
                data-ray={`spectrum-core-${index}`}
                x1={ray.start.x}
                y1={ray.start.y}
                x2={ray.end.x}
                y2={ray.end.y}
                stroke={ray.color}
                strokeLinecap="round"
                strokeOpacity={ray.blocked ? 0.62 : 0.54 + intensity * 0.3}
                strokeWidth={ray.width}
                filter="url(#fineGlow)"
              />
            </g>
          ))}
        </g>

        <polygon
          className={isDragging ? 'landing-prism-dragging' : undefined}
          points={geometry.polygon}
          fill="url(#prismGlass)"
          stroke="#f8fbff"
          strokeOpacity={0.32 + intensity * 0.34}
          strokeWidth="1.8"
        />
        <polygon
          points={geometry.polygon}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={energized ? 0.14 + intensity * 0.22 : 0.12}
          strokeWidth="5"
          filter="url(#fineGlow)"
        />
      </svg>
      <div className="landing-optics-vignette absolute inset-0" />
    </div>
  )
}
