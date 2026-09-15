import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";

const COLORS = ["#4a90e2", "#e05252", "#4caf50"];
const CREW = [
  { name: "Ada Solberg", role: "Director" },
  { name: "Mateo Reyes", role: "Cinematographer" },
  { name: "Priya Nandan", role: "Sound Designer" },
];

function Visual({ color, progress, onCycle }) {
  const meshRef = useRef(null);
  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += (delta * Math.PI * 2) / 10;
  });
  const scale = 0.9 + progress * 0.6;
  return (
    <mesh ref={meshRef} scale={[scale, scale, scale]} onClick={onCycle}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

export function App() {
  const [colorIndex, setColorIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const heroRef = useRef(null);

  // Mirrors AXIS's scrollProgress semantics exactly for a fair comparison:
  // progress is measured against the hero container's OWN height, not the
  // whole document - not a React feature, hand-rolled here since
  // react-three-fiber/plain React has no scroll-linked-value primitive of
  // its own.
  useEffect(() => {
    function onScroll() {
      const height = heroRef.current?.offsetHeight ?? 1;
      setProgress(Math.min(1, Math.max(0, window.scrollY / height)));
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const cycleColor = useCallback(() => setColorIndex((i) => (i + 1) % COLORS.length), []);

  return (
    <div style={{ background: "#0b0b12", color: "white", fontFamily: "system-ui, sans-serif" }}>
      <div ref={heroRef} style={{ display: "flex", flexDirection: "column", gap: 12, padding: 48, minHeight: 900 }}>
        <p style={{ color: "#6b8fd6", fontSize: 13, fontWeight: "bold", margin: 0 }}>A SHORT FILM</p>
        <h1 style={{ fontSize: 42, fontWeight: "bold", margin: 0 }}>Nova Bloom</h1>
        <p style={{ color: "#a3a3c2", fontSize: 16, margin: 0 }}>A quiet town, a falling star, and the one night everything changed.</p>

        <div style={{ width: 640, height: 380, borderRadius: 16, overflow: "hidden" }}>
          <Canvas camera={{ position: [0, 2, 8], fov: 60 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[-1, 1, 0.4]} intensity={1} />
            <Visual color={COLORS[colorIndex]} progress={progress} onCycle={cycleColor} />
          </Canvas>
        </div>

        <p style={{ color: "#6b6b80", fontSize: 12, margin: 0 }}>Click the shape above. Scroll for more.</p>
      </div>

      <div style={{ background: "#1c1c28", height: 6 }}>
        <div style={{ background: "#4a90e2", height: 6, width: `${Math.round(progress * 100)}%` }} />
      </div>

      <div style={{ display: "flex", flexDirection: "row", gap: 48, padding: 48, background: "#111118" }}>
        <div>
          <p style={{ color: "#6b6b80", fontSize: 12, margin: 0 }}>ROLE</p>
          <p style={{ fontSize: 16, margin: 0 }}>Writer / Director</p>
        </div>
        <div>
          <p style={{ color: "#6b6b80", fontSize: 12, margin: 0 }}>YEAR</p>
          <p style={{ fontSize: 16, margin: 0 }}>2026</p>
        </div>
        <div>
          <p style={{ color: "#6b6b80", fontSize: 12, margin: 0 }}>TOOLS</p>
          <p style={{ fontSize: 16, margin: 0 }}>React, Three.js, Blender, Ableton</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 48, background: "#0b0b12" }}>
        <h2 style={{ fontSize: 24, margin: 0 }}>Cast &amp; Crew</h2>
        <div style={{ display: "flex", flexDirection: "row", gap: 16 }}>
          {CREW.map((c) => (
            <div key={c.name} style={{ background: "#15151f", borderRadius: 8, padding: 16, width: 180 }}>
              <p style={{ margin: 0, fontWeight: "bold", fontSize: 15 }}>{c.name}</p>
              <p style={{ margin: 0, color: "#9c9cb8", fontSize: 13 }}>{c.role}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: 48 }}>
        <p style={{ color: "#6b6b80", fontSize: 13, margin: 0 }}>Nova Bloom - now in post-production.</p>
      </div>
    </div>
  );
}
