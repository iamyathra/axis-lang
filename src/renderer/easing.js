// Shared easing curves for animation playback - used by both client.js
// (three.js meshes) and domClient.js (page elements) so the two renderers'
// `animate` blocks behave identically, not just look similar on paper.
//
// One coherent, small family set rather than a long list of named curves
// that mostly differ by how strong the same shape reads (the "richer
// easing" a v3.8-style pass would reach for) - three curve families, each
// with In/Out/InOut variants (bounce only has the one direction any real
// usage actually wants - see easeOutBounce, below), plus the original
// quadratic linear/easeIn/easeOut/easeInOut, unchanged and still the
// default: not renamed to "...Quad" (that would break every existing .ax
// file) even though that's genuinely what they are, underneath.
//
// Standard, well-known formulas (easings.net) - not hand-derived, so their
// shape is exactly what a developer coming from CSS/GSAP/Framer Motion
// already expects from the same names.
export const EASINGS = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  // Cubic - the same quad shape but stronger accel/decel; the first reach
  // for anyone whose quad-based motion feels "flat."
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  // Back - overshoots past the target then settles back, a small negative
  // dip/positive overshoot near 0/1. Popular for UI reveals (a card that
  // pops slightly past its resting scale before settling).
  easeInBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInOutBack: (t) => {
    const c1 = 1.70158, c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },

  // Bounce - only the "out" direction (settling into the end value like a
  // dropped ball) is a real-world motion anyone reaches for; easeInBounce/
  // easeInOutBounce exist in longer easing libraries but see near-zero
  // actual use, so they're deliberately left out (Part 4's "do not add an
  // enormous list merely for marketing").
  easeOutBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};
