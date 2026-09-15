import { useCallback, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

const MIN_SCALE = 0.4;
const MAX_SCALE = 2;
const ACCESSORY_ON_SCALE = 0.4;
const ACCESSORY_OFF_SCALE = 0.001;

function Product({ color, scale, onProductClick }) {
  return (
    <mesh scale={[scale, scale, scale]} onClick={onProductClick}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

// AXIS gets a declarative `animate` block for this transition, driven by
// scene-side edge detection against the shared `accessoryOn` state (see
// ../axis/main.ax's comment on why it can't be triggered directly from the
// page handler). @react-three/fiber has no equivalent declarative
// "animate this property" primitive - the equivalent here is a plain
// per-frame lerp toward whichever target scale is currently wanted, which
// is the idiomatic way to do it without pulling in a tweening library
// (react-spring/@react-three/drei's animation helpers, etc.) neither the
// AXIS side nor Task 1's React side needed.
function Accessory({ on }) {
  const meshRef = useRef(null);
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const target = on ? ACCESSORY_ON_SCALE : ACCESSORY_OFF_SCALE;
    const current = meshRef.current.scale.x;
    const next = current + (target - current) * Math.min(1, delta * 10);
    meshRef.current.scale.setScalar(next);
  });
  return (
    <mesh ref={meshRef} position={[0, 0.9, 0]} scale={[ACCESSORY_OFF_SCALE, ACCESSORY_OFF_SCALE, ACCESSORY_OFF_SCALE]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#e5e5f5" />
    </mesh>
  );
}

export function App() {
  const [color, setColor] = useState("#4a90e2");
  const [scale, setScale] = useState(1);
  const [accessoryOn, setAccessoryOn] = useState(false);
  const [clicks, setClicks] = useState(0);

  const smaller = useCallback(() => setScale((s) => Math.max(MIN_SCALE, +(s - 0.2).toFixed(2))), []);
  const bigger = useCallback(() => setScale((s) => Math.min(MAX_SCALE, +(s + 0.2).toFixed(2))), []);
  const toggleAccessory = useCallback(() => setAccessoryOn((v) => !v), []);
  const onProductClick = useCallback(() => setClicks((c) => c + 1), []);

  const price = Math.round(49 * scale + (accessoryOn ? 10 : 0));

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 24, padding: 32, background: "#0b0b12", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: 480, height: 400, borderRadius: 12, overflow: "hidden" }}>
        <Canvas camera={{ position: [0, 1.5, 5], fov: 60 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[-1, 1, 0.4]} intensity={1} />
          <Product color={color} scale={scale} onProductClick={onProductClick} />
          <Accessory on={accessoryOn} />
          <OrbitControls enablePan={false} enableZoom={false} />
        </Canvas>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 260, color: "white" }}>
        <h2 style={{ margin: 0 }}>Configure your product</h2>
        <p style={{ color: "#a3a3c2", fontSize: 14, margin: 0 }}>
          Drag the preview to orbit. Click the product to interact with it.
        </p>
        <p style={{ color: "#9c9cb8", margin: 0 }}>Interactions: {clicks}</p>

        <p style={{ color: "#9c9cb8", margin: 0 }}>Color</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setColor("#e05252")} style={{ background: "#e05252", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer" }}>Red</button>
          <button onClick={() => setColor("#4a90e2")} style={{ background: "#4a90e2", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer" }}>Blue</button>
          <button onClick={() => setColor("#4caf50")} style={{ background: "#4caf50", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer" }}>Green</button>
        </div>

        <p style={{ color: "#9c9cb8", margin: 0 }}>Size: {scale.toFixed(1)}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={smaller} style={{ background: "#2a2a3a", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer" }}>-</button>
          <button onClick={bigger} style={{ background: "#2a2a3a", color: "white", border: "none", borderRadius: 4, padding: "6px 12px", cursor: "pointer" }}>+</button>
        </div>

        <button onClick={toggleAccessory} style={{ background: "#2a2a3a", color: "white", border: "none", borderRadius: 4, padding: "8px 12px", cursor: "pointer" }}>
          {accessoryOn ? "Remove accessory" : "Add accessory (+$10)"}
        </button>

        <p style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>Price: ${price}</p>
      </div>
    </div>
  );
}
