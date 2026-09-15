// The React adapter - the only file in this package that imports React,
// and the only place in the whole embedding story that knows React exists
// (see docs/architecture/embedding.md and Rule 2/3 of the milestone this
// shipped under: the AXIS core never imports React, and nothing
// React-specific lives inside axis-lang itself). Written with
// `React.createElement` rather than JSX so this package needs no build
// step of its own to run or verify - a consuming app's own JSX/bundler
// setup is unaffected either way.
//
// Usage:
//   import { Axis } from "axis-react";
//   <Axis source={heroSource} title="Hello" intensity={0.8} onNotify={cb} />
//
// `source` is raw .ax source text - the same contract mount() itself has
// (see src/mount.js's own note on why: no custom AXIS bundler plugin is
// required today; get the text however your bundler already imports raw
// text - Vite's `?raw`, webpack's `asset/source`, or a plain `fetch()`).
// Direct `import Hero from "./hero.ax"` is NOT implemented here - that
// would need a real bundler plugin, which is real, separate follow-up work
// (see the milestone's final report), not something to fake.
//
// Every other prop splits into one of two buckets, by a plain naming
// convention local to this adapter (never the AXIS language itself):
//   - `onXxx` (a function value) -> an AXIS output event named "xxx"
//     (lowercase-first) - `onComplete` listens for `emit("complete", ...)`.
//   - anything else -> a host input, i.e. a top-level `state`/`let` in the
//     .ax source named exactly that prop - see docs/architecture/
//     embedding.md's "inputs are state" design. An unknown input name
//     throws the same clear, allow-listed error mount()/update() already
//     give a plain HTML host.
import { createElement, useEffect, useRef } from "react";
import { mount } from "axis-lang";

function splitProps(props) {
  const inputs = {};
  const eventHandlers = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "source" || key === "className" || key === "style") continue;
    if (/^on[A-Z]/.test(key) && typeof value === "function") {
      eventHandlers[key[2].toLowerCase() + key.slice(3)] = value;
    } else {
      inputs[key] = value;
    }
  }
  return { inputs, eventHandlers };
}

function shallowDiff(prev, next) {
  const changed = {};
  for (const key of Object.keys(next)) {
    if (!prev || !Object.is(prev[key], next[key])) changed[key] = next[key];
  }
  return changed;
}

export function Axis({ source, className, style, ...rest }) {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);
  const propsRef = useRef(rest);
  propsRef.current = rest;
  const lastInputsRef = useRef(null);

  // Mount once per distinct `source` identity - not on every render, and
  // not on every input/handler change (Rule: "avoid unnecessary AXIS
  // remounting on ordinary prop updates," "avoid recreating the AXIS
  // instance on every React render"). A real, different `source` string
  // (the consumer swapping which component it renders) is the one thing
  // that legitimately warrants tearing down and rebuilding the real
  // DOM/animation/3D state underneath - see mount()/destroy()'s own
  // contract in pageRuntime.js.
  useEffect(() => {
    let cancelled = false;
    let localInstance = null;
    const { inputs: initialInputs, eventHandlers } = splitProps(propsRef.current);

    mount(containerRef.current, source, { inputs: initialInputs })
      .then((instance) => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        localInstance = instance;
        instanceRef.current = instance;
        lastInputsRef.current = initialInputs;
        // Wired once, per event name present at mount - each trampoline
        // reads the *current* handler off propsRef on every call, so a
        // changed handler *function identity* (a new inline arrow on every
        // render, say) is always honored without re-subscribing. A handler
        // prop that didn't exist at mount time being added later isn't
        // picked up - a documented v1 boundary, not silently broken (most
        // real usage keeps the same set of onXxx props across renders).
        for (const name of Object.keys(eventHandlers)) {
          instance.on(name, (payload) => {
            splitProps(propsRef.current).eventHandlers[name]?.(payload);
          });
        }
      })
      .catch((err) => console.error("[axis-react] mount() failed:", err));

    return () => {
      cancelled = true;
      localInstance?.destroy();
      instanceRef.current = null;
      lastInputsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Ordinary prop updates (React re-rendering with new input values) flow
  // into AXIS's own reactive `state` via update() - not a remount. Only the
  // inputs that actually changed (Object.is, same rule React's own
  // reconciler uses) are sent, so a render caused by an unrelated event
  // handler prop's identity changing doesn't trigger a pointless
  // reRenderAll() pass.
  useEffect(() => {
    if (!instanceRef.current) return;
    const { inputs } = splitProps(rest);
    const changed = shallowDiff(lastInputsRef.current, inputs);
    if (Object.keys(changed).length === 0) return;
    lastInputsRef.current = inputs;
    instanceRef.current.update(changed);
  });

  return createElement("div", { ref: containerRef, className, style });
}
