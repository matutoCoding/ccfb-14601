// 零依赖 Canvas 折线/柱状图 =================================================

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
  fillArea?: boolean;
}

export function lineChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  series: LineSeries[],
  opts: { yLabel?: string; fillArea?: boolean } = {},
): void {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const padL = 44;
  const padR = 12;
  const padT = 28;
  const padB = 34;
  const cw = w - padL - padR;
  const ch = h - padT - padB;

  const all = series.flatMap((s) => s.values);
  const yMax = Math.max(1, ...all) * 1.1;
  const xAt = (i: number) => padL + (labels.length <= 1 ? cw / 2 : (i / (labels.length - 1)) * cw);
  const yAt = (v: number) => padT + ch - (v / yMax) * ch;

  // 网格
  ctx.strokeStyle = 'rgba(140,120,90,0.18)';
  ctx.fillStyle = '#8a7a63';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const v = (yMax / 4) * g;
    const y = yAt(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(v < 10 ? 1 : 0), padL - 6, y + 4);
  }

  // X 轴标签（稀疏）
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.ceil(labels.length / 8));
  labels.forEach((lb, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    ctx.fillText(lb.slice(2), xAt(i), h - padB + 16);
  });

  // 系列
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = xAt(i);
      const y = yAt(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (opts.fillArea && !s.dashed) {
      ctx.lineTo(xAt(s.values.length - 1), padT + ch);
      ctx.lineTo(xAt(0), padT + ch);
      ctx.closePath();
      ctx.fillStyle = s.color + '22';
      ctx.fill();
    }
    ctx.setLineDash([]);
    // 点
    ctx.fillStyle = s.color;
    s.values.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(v), 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 图例
  ctx.textAlign = 'left';
  ctx.font = '12px system-ui';
  let lx = padL;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 8, 14, 3);
    ctx.fillStyle = '#cbbfa9';
    ctx.fillText(s.name, lx + 18, 12);
    lx += ctx.measureText(s.name).width + 40;
  }
}

export interface BarItem {
  label: string;
  value: number;
  color: string;
}

export function barChart(canvas: HTMLCanvasElement, items: BarItem[]): void {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const padL = 40;
  const padB = 40;
  const padT = 14;
  const cw = w - padL - 10;
  const ch = h - padT - padB;
  const yMax = Math.max(1, ...items.map((i) => i.value)) * 1.15;
  const bw = Math.min(46, (cw / items.length) * 0.62);
  const gap = cw / items.length;

  ctx.strokeStyle = 'rgba(140,120,90,0.18)';
  ctx.fillStyle = '#8a7a63';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const v = (yMax / 4) * g;
    const y = padT + ch - (v / yMax) * ch;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - 8, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(0), padL - 6, y + 4);
  }

  items.forEach((it, i) => {
    const x = padL + gap * i + (gap - bw) / 2;
    const bh = (it.value / yMax) * ch;
    const y = padT + ch - bh;
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = '#cbbfa9';
    ctx.textAlign = 'center';
    ctx.font = '11px system-ui';
    ctx.fillText(it.label, x + bw / 2, h - padB + 16);
    ctx.fillStyle = '#efe6d2';
    ctx.fillText(String(it.value), x + bw / 2, y - 5);
  });
}
