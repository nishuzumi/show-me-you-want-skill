// Shared Node utilities for smyw CLI scripts (build.mjs & apply-feedback.mjs).
export function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0).toString(36);
}

export function specHash(specObj) {
  return hashStr(JSON.stringify(specObj));
}
