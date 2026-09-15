// Tiny edit-distance helper for "did you mean" hints in error messages.
// Not fancy - just enough that a typo like `boxx` points back at `box`.

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Returns " - did you mean 'x'?" (ready to append to a message), or "" if
// nothing in `candidates` is close enough to `name` to be worth suggesting.
export function suggest(name, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  const threshold = Math.max(1, Math.floor(name.length / 3));
  if (best !== null && bestDistance <= threshold) {
    return ` - did you mean '${best}'?`;
  }
  return "";
}
