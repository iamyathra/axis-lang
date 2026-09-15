import { useState } from "react";
import { Axis } from "axis-react";
import heroSource from "./hero.ax?raw";

// A real React application: ordinary React state, an ordinary React
// component tree, and one embedded AXIS component wired through normal
// React props/callbacks - no AXIS-specific machinery visible here beyond
// the <Axis /> element itself. Proves: changing React props flow into
// AXIS's own reactive state (the intensity slider), an AXIS output event
// reaches a normal React callback (the notify counter), and conditionally
// unmounting the <Axis /> element (the checkbox) tears it down cleanly via
// React's own unmount lifecycle - see packages/axis-react/src/Axis.js.
export function App() {
  const [title, setTitle] = useState("AXIS inside React");
  const [intensity, setIntensity] = useState(0.6);
  const [notifyCount, setNotifyCount] = useState(0);
  const [showAxis, setShowAxis] = useState(true);

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>This page is React</h1>
      <p>Everything except the boxed component below is a normal React component tree.</p>

      <label style={{ display: "block", marginBottom: 8 }}>
        Title: <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label style={{ display: "block", marginBottom: 16 }}>
        Intensity: <input type="range" min="0" max="1" step="0.05" value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
      </label>
      <label style={{ display: "block", marginBottom: 16 }}>
        <input type="checkbox" checked={showAxis} onChange={(e) => setShowAxis(e.target.checked)} /> mount the AXIS component
      </label>

      {showAxis && (
        <Axis
          source={heroSource}
          title={title}
          intensity={intensity}
          onNotify={(payload) => setNotifyCount((n) => n + 1)}
        />
      )}

      <p>notify events received by React: {notifyCount}</p>
    </main>
  );
}
