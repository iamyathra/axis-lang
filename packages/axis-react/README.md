# axis-react

React adapter for [AXIS](https://github.com/iamyathra/axis-lang) - mounts a
`.ax` scene/page as a React component. A thin lifecycle wrapper around
`axis-lang`'s `mount()`; `axis-lang` itself never imports React, and this is
the only file in the embedding story that does.

## Install

```bash
npm install axis-lang axis-react react
```

## Usage

```jsx
import { Axis } from "axis-react";

<Axis source={heroSource} title="Hello" intensity={0.8} onNotify={handleNotify} />
```

- `source` is raw `.ax` source text (a bundler's raw-text import, e.g.
  Vite's `?raw`, or a plain `fetch()`). Mounts once per distinct `source`
  identity - not on every render.
- Any prop named `onXxx` (a function) subscribes to the AXIS output event
  `xxx` (lowercase-first): `onNotify` -> `emit("notify", ...)`.
- Every other prop is a host input - it must match a top-level `state`/`let`
  declared in the `.ax` source. Changed values flow in via `update()`, not a
  remount.
- Unmounting the `<Axis/>` element calls `destroy()`.

Full contract: [docs/architecture/embedding.md](https://github.com/iamyathra/axis-lang/blob/main/docs/architecture/embedding.md).
Language reference: [docs/language.md](https://github.com/iamyathra/axis-lang/blob/main/docs/language.md).

## License

MIT
