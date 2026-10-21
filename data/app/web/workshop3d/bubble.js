// V-056: the speech bubble over a working helper, drawn on a 2D canvas (inn.js puts it on a sprite): up to two lines of text, a tail pointing
// down at the head, and three typing dots (dots = how many are lit). No three.js here, so it can be looked at on its own.
export function wrapLines(g, text, width, max) {
  const words = text.split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (g.measureText(next).width <= width) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === max) break;
  }
  if (lines.length < max && cur) lines.push(cur);
  if (lines.length === max && words.join(' ').length > lines.join(' ').length) {        // too long: cut the last line with an ellipsis
    let l = lines[max - 1];
    while (l.length > 1 && g.measureText(l + '…').width > width) l = l.slice(0, -1);
    lines[max - 1] = l.replace(/\s+$/, '') + '…';
  }
  return lines.slice(0, max);
}
export function drawBubble(b, text, dots) {
  const cv = b.cv, g = b.g, W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.font = '700 30px Nunito, Arial, sans-serif';
  const lines = wrapLines(g, text, W - 70, 2);
  const lh = 36, boxH = 26 + lines.length * lh + 34, top = H - 30 - boxH;
  const boxW = Math.min(W - 8, Math.max(160, ...lines.map((l) => g.measureText(l).width + 56))), left = (W - boxW) / 2;
  const r = 22, right = left + boxW, bottom = top + boxH, cx = W / 2;
  g.beginPath();                                   // one outline: the rounded box with the tail in its bottom edge, pointing at the head
  g.moveTo(left + r, top); g.lineTo(right - r, top); g.arcTo(right, top, right, top + r, r);
  g.lineTo(right, bottom - r); g.arcTo(right, bottom, right - r, bottom, r);
  g.lineTo(cx + 16, bottom); g.lineTo(cx, H - 6); g.lineTo(cx - 16, bottom);
  g.lineTo(left + r, bottom); g.arcTo(left, bottom, left, bottom - r, r);
  g.lineTo(left, top + r); g.arcTo(left, top, left + r, top, r); g.closePath();
  g.fillStyle = 'rgba(16, 12, 6, 0.86)'; g.fill();
  g.strokeStyle = '#c9a24a'; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#f3e7c4';
  lines.forEach((l, i) => g.fillText(l, W / 2, top + 16 + i * lh));
  for (let i = 0; i < 3; i++) {                 // the typing dots: 1, 2, 3 lit, then again
    g.fillStyle = i < dots ? '#ffd100' : 'rgba(255, 209, 0, 0.22)';
    g.beginPath(); g.arc(W / 2 - 22 + i * 22, top + boxH - 18, 6, 0, Math.PI * 2); g.fill();
  }
  if (b.tx) b.tx.needsUpdate = true;
}
