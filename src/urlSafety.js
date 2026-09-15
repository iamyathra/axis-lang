// A tiny, pure allowlist check for a `link.href`/`image.src` value -
// shared by interpreter.js (reject a bad *literal* at build time, with a
// line number, right where the author wrote it) and domClient.js (a
// reactively-bound or handler-assigned value can't be rejected at build
// time - it's sanitized live instead, the same boundary `assetPath.js`'s
// `assetSrcError` already draws for a `model`'s `src`, just for a URL a
// browser might actually navigate to instead of a file this project
// serves itself).
//
// `href`/`src` are the one place user-influenced data (an `input.value`,
// piped through `state` into a link) can end up written straight into the
// DOM as something the browser will *navigate to* if clicked - unlike
// `.content` (always `textContent`, never HTML, never a URL scheme to
// worry about), an unvalidated `javascript:` URL there is a real, if
// narrow, XSS surface. This is a plain scheme allowlist, not a full URL
// parser - deliberately small.
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export function isSafeUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return true; // empty is harmless, just not useful
  // A URL scheme is `[a-zA-Z][a-zA-Z0-9+.-]*:` right at the start -
  // anything without one (a relative path, "#anchor", "/absolute/path",
  // ordinary text) has no scheme to be dangerous with at all, so it's
  // safe by construction; anything that does needs to be on the allowlist.
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!match) return true;
  return SAFE_SCHEMES.has(`${match[1].toLowerCase()}:`);
}
