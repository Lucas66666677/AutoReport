import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  CylinderGeometry,
  EdgesGeometry,
  type Group,
} from 'three'

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function PrismMesh() {
  const prismRef = useRef<Group>(null)
  const edgeGeometry = useMemo(
    () => new EdgesGeometry(new CylinderGeometry(1.02, 1.02, 2.25, 3, 1, false), 12),
    [],
  )

  useFrame(({ clock, pointer }) => {
    if (!prismRef.current) return

    const elapsed = clock.getElapsedTime()
    prismRef.current.rotation.x = 0.42 + pointer.y * 0.06 + Math.sin(elapsed * 0.42) * 0.035
    prismRef.current.rotation.y = -0.5 + pointer.x * 0.16 + elapsed * 0.08
    prismRef.current.rotation.z = 0.38 + Math.sin(elapsed * 0.28) * 0.045
  })

  return (
    <group ref={prismRef} position={[0, -0.08, 0]} scale={1.12}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[1.02, 1.02, 2.25, 3, 1, false]} />
        <meshPhysicalMaterial
          color="#d9f4ff"
          metalness={0}
          roughness={0.04}
          transmission={0.72}
          thickness={1.45}
          ior={1.48}
          transparent
          opacity={0.58}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </mesh>
      <lineSegments geometry={edgeGeometry}>
        <lineBasicMaterial color="#f8fbff" transparent opacity={0.38} />
      </lineSegments>
    </group>
  )
}

function LightParticles() {
  const positions = useMemo(() => {
    const values = new Float32Array(120 * 3)

    for (let index = 0; index < values.length; index += 3) {
      values[index] = (seededUnit(index + 1) - 0.5) * 9
      values[index + 1] = (seededUnit(index + 2) - 0.5) * 4.5
      values[index + 2] = -seededUnit(index + 3) * 3.5
    }

    return values
  }, [])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#f8fbff" size={0.012} transparent opacity={0.3} sizeAttenuation />
    </points>
  )
}

export default function PrismLandingScene() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#050507]" />
      <div className="landing-prism-aurora absolute inset-0" />

      <Canvas
        camera={{ position: [0, 0.15, 6.1], fov: 40 }}
        className="absolute inset-0"
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        shadows
      >
        <ambientLight intensity={0.78} />
        <directionalLight position={[-3.5, 2.4, 3.2]} intensity={2.2} color="#ffffff" />
        <pointLight position={[2.5, -1.2, 2.2]} intensity={2.4} color="#7dd3fc" />
        <pointLight position={[1.2, 1.1, 2.8]} intensity={1.8} color="#f0abfc" />
        <LightParticles />
        <PrismMesh />
      </Canvas>

      <svg
        className="landing-prism-rays absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="incomingWhite" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="34%" stopColor="#ffffff" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="spectrumRed" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#fb7185" stopOpacity="0.34" />
          </linearGradient>
          <linearGradient id="spectrumGold" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#facc15" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="spectrumGreen" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.68" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.28" />
          </linearGradient>
          <linearGradient id="spectrumCyan" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.32" />
          </linearGradient>
          <linearGradient id="spectrumViolet" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.68" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.34" />
          </linearGradient>
          <filter id="rayBlur">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        <path className="landing-white-ray" d="M -6 48 L 49.5 43.8 L 49.5 56.5 L -6 53 Z" fill="url(#incomingWhite)" />
        <path className="landing-spectrum-ray" d="M 50 48 L 106 22 L 106 28 L 51 51 Z" fill="url(#spectrumRed)" />
        <path className="landing-spectrum-ray landing-spectrum-delay-1" d="M 50 49 L 106 35 L 106 41 L 51 51.8 Z" fill="url(#spectrumGold)" />
        <path className="landing-spectrum-ray landing-spectrum-delay-2" d="M 50 50 L 106 48 L 106 54 L 51 52.5 Z" fill="url(#spectrumGreen)" />
        <path className="landing-spectrum-ray landing-spectrum-delay-3" d="M 50 51 L 106 61 L 106 67 L 51 53 Z" fill="url(#spectrumCyan)" />
        <path className="landing-spectrum-ray landing-spectrum-delay-4" d="M 50 52 L 106 75 L 106 81 L 51 53.6 Z" fill="url(#spectrumViolet)" />
        <g className="landing-spectrum-strokes" filter="url(#rayBlur)">
          <path d="M 51 48.2 L 106 24.5" stroke="#fb7185" strokeWidth="0.62" />
          <path d="M 51 49.4 L 106 38" stroke="#facc15" strokeWidth="0.56" />
          <path d="M 51 50.7 L 106 51.5" stroke="#34d399" strokeWidth="0.54" />
          <path d="M 51 52 L 106 65" stroke="#38bdf8" strokeWidth="0.58" />
          <path d="M 51 53.2 L 106 78.5" stroke="#a78bfa" strokeWidth="0.62" />
        </g>
        <g filter="url(#rayBlur)" opacity="0.42">
          <path d="M 49 46 L 106 21 L 106 82 L 49 55 Z" fill="#ffffff" opacity="0.12" />
        </g>
      </svg>

      <div className="landing-prism-vignette absolute inset-0" />
    </div>
  )
}
