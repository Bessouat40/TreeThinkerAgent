const cssVar = (name, fallback) =>
  parseInt(getComputedStyle(document.documentElement).getPropertyValue(name)) ||
  fallback;

export const NODE_W = cssVar('--node-w', 220);
export const NODE_H = cssVar('--node-h', 64);
export const COL_GAP = cssVar('--col-gap', 120);
export const ROW_GAP = cssVar('--row-gap', 22);
