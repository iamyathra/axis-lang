import { useCallback, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";

const PLANETS = [
  { name: "Mercury", color: "#8c8c8c", distance: 3, orbitSeconds: 3, fact: "The smallest planet, and the closest to the Sun." },
  { name: "Venus", color: "#e0c16c", distance: 4.5, orbitSeconds: 5, fact: "The hottest planet - a runaway greenhouse effect traps the heat in." },
  { name: "Earth", color: "#4a90e2", distance: 6, orbitSeconds: 7, fact: "The only known planet with liquid water oceans and life." },
  { name: "Mars", color: "#c1440e", distance: 7.5, orbitSeconds: 9, fact: "Home to Olympus Mons, the tallest volcano in the solar system." },
];

function Planet({ planet, selected, onSelect }) {
  const groupRef = useRef(null);
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += (delta * Math.PI * 2) / planet.orbitSeconds;
  });
  const isSelected = selected === planet.name;
  return (
    <group ref={groupRef}>
      <mesh position={[planet.distance, 0, 0]} onClick={() => onSelect(planet.name)}>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshStandardMaterial color={isSelected ? "#ffffff" : planet.color} />
      </mesh>
    </group>
  );
}

export function App() {
  const [selected, setSelected] = useState("");
  const select = useCallback((name) => setSelected(name), []);
  const selectedPlanet = PLANETS.find((p) => p.name === selected);

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 24, padding: 32, background: "#0b0b12", minHeight: "100vh", fontFamily: "system-ui, sans-serif", color: "white" }}>
      <div style={{ width: 500, height: 420, borderRadius: 12, overflow: "hidden" }}>
        <Canvas camera={{ position: [0, 10, 16], fov: 60 }}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[-1, 1, 0.3]} intensity={0.9} />
          <mesh>
            <sphereGeometry args={[1.4, 32, 32]} />
            <meshStandardMaterial color="yellow" />
          </mesh>
          {PLANETS.map((planet) => (
            <Planet key={planet.name} planet={planet} selected={selected} onSelect={select} />
          ))}
        </Canvas>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}>
        <h2 style={{ margin: 0 }}>The Solar System</h2>
        <p style={{ color: "#a3a3c2", fontSize: 14, margin: 0 }}>Click a planet, in 3D or in the list, to learn about it.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PLANETS.map((planet) => (
            <button
              key={planet.name}
              onClick={() => select(planet.name)}
              style={{
                background: selected === planet.name ? "#4a90e2" : "#1c1c28",
                color: "white",
                border: "none",
                borderRadius: 4,
                padding: "6px 10px",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              {planet.name}
            </button>
          ))}
        </div>

        <div style={{ background: "#15151f", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: "bold" }}>{selectedPlanet ? selectedPlanet.name : "Select a planet"}</p>
          <p style={{ margin: 0, color: "#a3a3c2", fontSize: 14 }}>{selectedPlanet ? selectedPlanet.fact : "No planet selected yet."}</p>
          {selectedPlanet && <p style={{ margin: 0, color: "#6b8fd6", fontSize: 13 }}>Orbit distance: {selectedPlanet.distance} AU (scene units)</p>}
        </div>
      </div>
    </div>
  );
}
