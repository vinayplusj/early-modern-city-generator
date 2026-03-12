export function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  let t = a % twoPi;
  if (t < 0) t += twoPi;
  return t;
}

export function circularDistance(a, b) {
  const twoPi = Math.PI * 2;
  let d = Math.abs(wrapAngle(a) - wrapAngle(b));
  if (d > Math.PI) d = twoPi - d;
  return d;
}
