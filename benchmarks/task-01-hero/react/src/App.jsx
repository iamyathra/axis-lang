import { useCallback, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";

const BASE_COLOR = "#4a90e2";
const HOVER_COLOR = "#facc15";

function Gem({ onGemClick }) {
  const meshRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  // R3F's Canvas already tracks normalized (-1..1) pointer coordinates over
  // the canvas via state.pointer - no manual delta-accumulation needed the
  // way AXIS's mousemove-deltas-only primitive requires.
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * (Math.PI * 2) / 12; // full turn every 12s, matching the AXIS side

    const targetX = state.pointer.x * 2.5;
    const targetY = 1.5 + state.pointer.y * 1.2;
    state.camera.position.x += (targetX - state.camera.position.x) * 0.1;
    state.camera.position.y += (targetY - state.camera.position.y) * 0.1;
    state.camera.lookAt(0, 0, 0);
  });

  return (
    <mesh
      ref={meshRef}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onClick={onGemClick}
    >
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial color={hovered ? HOVER_COLOR : BASE_COLOR} />
    </mesh>
  );
}

function Scene({ onGemClick }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[-1, 1, 0.5]} intensity={0.8} />
      <Gem onGemClick={onGemClick} />
    </>
  );
}

export function App() {
  const [clicks, setClicks] = useState(0);
  const [ctaLabel, setCtaLabel] = useState("Get started");

  const handleGemClick = useCallback(() => setClicks((c) => c + 1), []);
  const handleCtaClick = useCallback(() => setCtaLabel("Thanks!"), []);

  return (
    <div
      style={{
        background: "#0b0b12",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: 64,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ color: "white", fontSize: 44, fontWeight: "bold", textAlign: "center", margin: 0 }}>
        Orbit Studio
      </h1>
      <p style={{ color: "#a3a3c2", fontSize: 18, textAlign: "center", margin: 0 }}>
        A hero section where the 3D object actually reacts to you.
      </p>

      <div style={{ width: 640, height: 420, borderRadius: 16, overflow: "hidden" }}>
        <Canvas camera={{ position: [0, 1.5, 6], fov: 60 }}>
          <Scene onGemClick={handleGemClick} />
        </Canvas>
      </div>

      <p style={{ color: "#e5e5f5", fontSize: 16, margin: 0 }}>Interactions: {clicks}</p>

      <button
        onClick={handleCtaClick}
        style={{
          background: "#4a90e2",
          color: "white",
          border: "none",
          borderRadius: 6,
          padding: "10px 20px",
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
