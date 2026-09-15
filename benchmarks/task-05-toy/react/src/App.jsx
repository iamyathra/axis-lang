import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";

const BOUND = 2.5;
const DAMPING = 0.997;
const COLORS = ["#4a90e2", "#e05252", "#4caf50"];

function Ball({ color, onCycle, onBounce }) {
  const meshRef = useRef(null);
  const velocity = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "ArrowLeft") velocity.current.x -= 1.5;
      if (e.key === "ArrowRight") velocity.current.x += 1.5;
      if (e.key === "ArrowUp") velocity.current.y += 1.5;
      if (e.key === "ArrowDown") velocity.current.y -= 1.5;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    let { x: vx, y: vy } = velocity.current;

    if (mesh.position.x > BOUND || mesh.position.x < -BOUND) {
      vx = -vx;
      onBounce();
    }
    if (mesh.position.y > BOUND || mesh.position.y < -BOUND) {
      vy = -vy;
      onBounce();
    }

    vx *= DAMPING;
    vy *= DAMPING;
    velocity.current = { x: vx, y: vy };

    mesh.position.x += vx * dt;
    mesh.position.y += vy * dt;
  });

  return (
    <mesh ref={meshRef} onClick={onCycle}>
      <sphereGeometry args={[0.4, 24, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

export function App() {
  const [bounces, setBounces] = useState(0);
  const [colorIndex, setColorIndex] = useState(0);

  const cycleColor = useCallback(() => setColorIndex((i) => (i + 1) % COLORS.length), []);
  const registerBounce = useCallback(() => setBounces((b) => b + 1), []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: 32,
        background: "#0b0b12",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ color: "white", fontSize: 28, fontWeight: "bold", margin: 0 }}>Zero-Gravity Playground</h1>
      <p style={{ color: "#a3a3c2", fontSize: 14, margin: 0 }}>Arrow keys to nudge. Click the ball to change its color.</p>

      <div style={{ width: 560, height: 420, borderRadius: 16, overflow: "hidden" }}>
        <Canvas camera={{ position: [0, 5, 9], fov: 60 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[-1, 1, 0.4]} intensity={0.9} />
          <Ball color={COLORS[colorIndex]} onCycle={cycleColor} onBounce={registerBounce} />
        </Canvas>
      </div>

      <p style={{ color: "#9c9cb8", fontSize: 16, margin: 0 }}>Bounces: {bounces}</p>
    </div>
  );
}
