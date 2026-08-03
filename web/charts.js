/* ============================================================
   Charts — hand-rolled SVG, no dependencies.

   Palette decisions (validated with the dataviz validator):
   · Every chart here is SINGLE-SERIES, so it uses one hue. Bar length
     already carries magnitude; an 8-step ordinal blue ramp was tried for
     the milestone funnel and FAILED the adjacent-ΔL check (steps 0.047
     apart, too close to read as ordered), so one hue it is.
   · The episode grid is the only two-category figure. status-good vs
     status-critical FAILS CVD separation (ΔE 4.1, deutan), so it uses
     series-blue vs critical-red (ΔE 25.7 dark / 23.8 light, all checks
     PASS) with fill-vs-hollow as secondary encoding plus a legend.
   ============================================================ */

import { MILESTONES, DISTRIBUTION, BASELINES, EPISODE_GRID, RESULTS } from "./data.js";

const NS = "http://www.w3.org/2000/svg";
const el = (n, a = {}) => {
  const e = document.createElementNS(NS, n);
  for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, v);
  return e;
};
const fmt = (n) => n.toLocaleString("en-US");

/* Bar with a 4px rounded data-end, square at the baseline. */
function barPath(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, dir === "right" ? w : h));
  if (w <= 0 || h <= 0) return "";
  if (dir === "right") {
    return `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z`;
  }
  return `M${x},${y + h} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h} Z`;
}

/* ------------------------------------------------ tooltip (one, global) */
let tip;
function ensureTip() {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("role", "status");
    document.body.appendChild(tip);
  }
  return tip;
}
function bindTip(node, html) {
  const t = ensureTip();
  const show = (e) => {
    t.innerHTML = html;
    t.classList.add("on");
    move(e);
  };
  const move = (e) => {
    const r = t.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - r.height - 12;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y < 8) y = e.clientY + 18;
    t.style.left = x + "px";
    t.style.top = y + "px";
  };
  node.addEventListener("pointerenter", show);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerleave", () => t.classList.remove("on"));
  node.addEventListener("focus", () => {
    const b = node.getBoundingClientRect();
    show({ clientX: b.left + b.width / 2, clientY: b.top });
  });
  node.addEventListener("blur", () => t.classList.remove("on"));
}

/* ------------------------------------------------ table view (a11y fallback) */
function addTable(host, headers, rows) {
  const btn = document.createElement("button");
  btn.className = "table-toggle";
  btn.type = "button";
  btn.textContent = "Show data table";
  const tbl = document.createElement("table");
  tbl.className = "data";
  tbl.hidden = true;
  tbl.innerHTML =
    `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
  btn.addEventListener("click", () => {
    tbl.hidden = !tbl.hidden;
    btn.textContent = tbl.hidden ? "Show data table" : "Hide data table";
  });
  host.after(btn, tbl);
}

/* Charts are drawn at their container's real pixel width rather than a fixed
   viewBox scaled by CSS — otherwise the same 12px axis label renders at 18px in
   a full-width panel and 7px in a half-width one. Redraws on resize. */
const redraws = new WeakMap();
const lastWidth = new WeakMap();
const tracked = new Set();
let resizeTimer;

/* Only width matters. Redrawing changes the host's height, so reacting to
   height would make the observer re-trigger its own cause. */
const ro = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const host of tracked) {
      const w = Math.max(300, Math.round(host.clientWidth));
      if (w !== lastWidth.get(host)) redraws.get(host)?.(w);
    }
  }, 120);
});

function responsive(host, draw) {
  redraws.set(host, (w) => { lastWidth.set(host, w); draw(w); });
  if (!tracked.has(host)) { tracked.add(host); ro.observe(host); }
  redraws.get(host)(Math.max(300, Math.round(host.clientWidth)));
}

/* ============================================================
   Horizontal bars — one series, labels at the tip.
   ============================================================ */
function hbar(host, opts) {
  responsive(host, (W) => drawHbar(host, W, opts));
}

function drawHbar(host, W, { rows, unit = "", maxOverride, tipFor, labelFor }) {
  host.innerHTML = "";
  const PADL = Math.min(150, Math.max(72, W * 0.26));
  const PADR = Math.min(70, Math.max(44, W * 0.09));
  const PADT = 8, PADB = 30;
  const BAR = 22, GAP = 16; // GAP >> 2px surface gap, so neighbours read distinct
  const H = PADT + rows.length * (BAR + GAP) - GAP + PADB;
  const max = maxOverride ?? Math.max(...rows.map((r) => r.value));
  const plotW = W - PADL - PADR;
  const x = (v) => (v / max) * plotW;

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`, role: "img",
    preserveAspectRatio: "xMidYMid meet",   // CSS gives it width:100%
  });

  // gridlines — hairline, solid, recessive
  const ticks = niceTicks(max, 4);
  const g = el("g");
  for (const t of ticks) {
    g.appendChild(el("line", {
      x1: PADL + x(t), x2: PADL + x(t), y1: PADT, y2: H - PADB,
      stroke: "var(--gridline)", "stroke-width": 1,
    }));
    const lb = el("text", {
      x: PADL + x(t), y: H - PADB + 18, "text-anchor": "middle",
      "font-size": 11, fill: "var(--text-muted)", "font-family": "var(--sans)",
      style: "font-variant-numeric:tabular-nums",
    });
    lb.textContent = fmt(t);
    g.appendChild(lb);
  }
  svg.appendChild(g);

  svg.appendChild(el("line", {
    x1: PADL, x2: PADL, y1: PADT, y2: H - PADB, stroke: "var(--baseline)", "stroke-width": 1,
  }));

  rows.forEach((r, i) => {
    const y = PADT + i * (BAR + GAP);
    const w = x(r.value);

    // Fall back to the short label when the gutter can't hold the full one —
    // a clipped category name is worse than an abbreviated one.
    const cat = el("text", {
      x: PADL - 12, y: y + BAR / 2 + 4, "text-anchor": "end",
      "font-size": 12.5, fill: "var(--text-secondary)", "font-family": "var(--sans)",
    });
    cat.textContent = (PADL < 122 && r.short) ? r.short : r.label;
    svg.appendChild(cat);

    // A true zero gets no mark at all — a minimum-width stub would read as
    // a small nonzero value. The tip label still states 0.
    if (r.value > 0) {
      svg.appendChild(el("path", {
        d: barPath(PADL, y, Math.max(w, 3), BAR, 4, "right"),
        fill: "var(--series-1)",
      }));
    }

    // value at the tip, outside the bar so it can never be clipped
    const val = el("text", {
      x: PADL + w + 9, y: y + BAR / 2 + 4, "text-anchor": "start",
      "font-size": 12, fill: "var(--text-primary)", "font-family": "var(--sans)",
      style: "font-variant-numeric:tabular-nums", "font-weight": 600,
    });
    val.textContent = (labelFor ? labelFor(r) : fmt(r.value)) + unit;
    svg.appendChild(val);

    const hit = el("rect", {
      x: PADL, y: y - GAP / 2, width: plotW, height: BAR + GAP,
      fill: "transparent", tabindex: 0, role: "img",
      "aria-label": `${r.label}: ${fmt(r.value)}${unit}`,
    });
    bindTip(hit, tipFor ? tipFor(r) : `<b>${r.label}</b><span class="t-v">${fmt(r.value)}${unit}</span>`);
    svg.appendChild(hit);
  });

  host.appendChild(svg);
}

function niceTicks(max, count) {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/* ============================================================
   Columns — one series, value on the cap.
   ============================================================ */
function columns(host, opts) {
  responsive(host, (W) => drawColumns(host, W, opts));
}

function drawColumns(host, W, { rows, unit = "" }) {
  host.innerHTML = "";
  const PADL = 46, PADR = 16, PADT = 26, PADB = 54;
  const H = 300;
  const max = Math.max(...rows.map((r) => r.value));
  const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
  const band = plotW / rows.length;
  const BAR = Math.min(24, band * 0.42);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", preserveAspectRatio: "xMidYMid meet" });

  for (const t of niceTicks(max, 4)) {
    const y = PADT + plotH - (t / max) * plotH;
    svg.appendChild(el("line", { x1: PADL, x2: W - PADR, y1: y, y2: y, stroke: "var(--gridline)", "stroke-width": 1 }));
    const lb = el("text", {
      x: PADL - 10, y: y + 4, "text-anchor": "end", "font-size": 11,
      fill: "var(--text-muted)", "font-family": "var(--sans)", style: "font-variant-numeric:tabular-nums",
    });
    lb.textContent = fmt(t);
    svg.appendChild(lb);
  }
  svg.appendChild(el("line", { x1: PADL, x2: W - PADR, y1: PADT + plotH, y2: PADT + plotH, stroke: "var(--baseline)", "stroke-width": 1 }));

  rows.forEach((r, i) => {
    const cx = PADL + band * i + band / 2;
    const h = (r.value / max) * plotH;
    const y = PADT + plotH - h;

    if (r.value > 0) {
      svg.appendChild(el("path", { d: barPath(cx - BAR / 2, y, BAR, Math.max(h, 3), 4, "up"), fill: "var(--series-1)" }));
    }

    const val = el("text", {
      x: cx, y: y - 9, "text-anchor": "middle", "font-size": 13, "font-weight": 600,
      fill: "var(--text-primary)", "font-family": "var(--sans)", style: "font-variant-numeric:tabular-nums",
    });
    val.textContent = fmt(r.value) + unit;
    svg.appendChild(val);

    // Narrow bands get the compact label so neighbours never collide.
    const compact = band < 110;
    const l1 = el("text", { x: cx, y: PADT + plotH + 20, "text-anchor": "middle", "font-size": 12, fill: "var(--text-secondary)", "font-family": "var(--sans)" });
    l1.textContent = (compact && r.short) ? r.short : r.label;
    svg.appendChild(l1);
    if (r.sub && !compact) {
      const l2 = el("text", { x: cx, y: PADT + plotH + 35, "text-anchor": "middle", "font-size": 11, fill: "var(--text-muted)", "font-family": "var(--sans)" });
      l2.textContent = r.sub;
      svg.appendChild(l2);
    }

    const hit = el("rect", {
      x: PADL + band * i, y: PADT, width: band, height: plotH, fill: "transparent",
      tabindex: 0, role: "img", "aria-label": `${r.label} ${r.sub || ""}: ${r.value} episodes`,
    });
    bindTip(hit, `<b>${r.label} ${r.sub || ""}</b><span class="t-v">${r.value} episodes · ${Math.round((r.value / RESULTS.successes) * 100)}% of successes</span>`);
    svg.appendChild(hit);
  });

  host.appendChild(svg);
}

/* ============================================================
   Episode grid — the only two-category figure on the page.
   Fill vs hollow ring is the secondary encoding; legend is mandatory.
   ============================================================ */
function episodeGrid(host, cells) {
  host.innerHTML = "";

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML =
    `<span class="legend-item"><span class="legend-swatch" style="background:var(--series-1)"></span>Reached iron ingot (43)</span>` +
    `<span class="legend-item"><span class="legend-swatch hollow"></span>Stalled at smelting (2)</span>`;
  host.appendChild(legend);

  const COLS = 9, R = 13, GAP = 9;
  const rowsN = Math.ceil(cells.length / COLS);
  const W = COLS * (R * 2 + GAP) - GAP;
  const H = rowsN * (R * 2 + GAP) - GAP;
  // Dots keep their natural size rather than stretching to the panel width.
  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`, role: "img", style: `max-width:${W}px`,
    "aria-label": `${cells.length} episodes: ${cells.filter(Boolean).length} reached the iron ingot, ${cells.filter((c) => !c).length} stalled`,
  });

  cells.forEach((ok, i) => {
    const cx = (i % COLS) * (R * 2 + GAP) + R;
    const cy = Math.floor(i / COLS) * (R * 2 + GAP) + R;
    const c = el("circle", {
      cx, cy, r: R - 1,
      fill: ok ? "var(--series-1)" : "transparent",
      stroke: ok ? "none" : "var(--fail)",
      "stroke-width": ok ? 0 : 2.5,
      tabindex: 0, role: "img",
      "aria-label": `Episode ${i + 1}: ${ok ? "reached iron ingot" : "stalled at smelting"}`,
    });
    if (!ok) {
      const x = el("path", {
        d: `M${cx - 4.5},${cy - 4.5} L${cx + 4.5},${cy + 4.5} M${cx + 4.5},${cy - 4.5} L${cx - 4.5},${cy + 4.5}`,
        stroke: "var(--fail)", "stroke-width": 2, "stroke-linecap": "round", "pointer-events": "none",
      });
      svg.appendChild(c);
      svg.appendChild(x);
    } else {
      svg.appendChild(c);
    }
    bindTip(c, `<b>Episode ${i + 1}</b><span class="t-v">${ok ? "Reached iron ingot" : "Had iron ore, failed to smelt"}</span>`);
  });

  host.appendChild(svg);
}

/* ============================================================ mount */
export function renderCharts() {
  // 1 — gap between consecutive milestones (the "where time goes" chart)
  const gaps = MILESTONES.map((m, i) => ({
    label: m.label,
    short: m.short,
    value: m.steps - (i === 0 ? 0 : MILESTONES[i - 1].steps),
    at: m.steps,
  }));
  const gapHost = document.getElementById("chart-gaps");
  if (gapHost) {
    hbar(gapHost, {
      rows: gaps,
      tipFor: (r) => `<b>${r.label}</b><span class="t-v">${fmt(r.value)} steps in this leg<br>reached at step ${fmt(r.at)}</span>`,
    });
    addTable(gapHost, ["Milestone", "Steps in leg", "Cumulative"],
      gaps.map((r) => [r.label, fmt(r.value), fmt(r.at)]));
  }

  // 2 — milestone progression (cumulative)
  const msHost = document.getElementById("chart-milestones");
  if (msHost) {
    hbar(msHost, {
      rows: MILESTONES.map((m) => ({ label: m.label, short: m.short, value: m.steps, reward: m.reward })),
      tipFor: (r) => `<b>${r.label}</b><span class="t-v">avg. step ${fmt(r.value)}<br>reward bit ${r.reward}</span>`,
    });
    addTable(msHost, ["Milestone", "Reward", "Avg. step"],
      MILESTONES.map((m) => [m.label, m.reward, fmt(m.steps)]));
  }

  // 3 — success rate vs baselines
  const blHost = document.getElementById("chart-baselines");
  if (blHost) {
    hbar(blHost, {
      rows: BASELINES.map((b) => ({ label: b.short, value: b.rate, note: b.note, full: b.label })),
      unit: "%",
      maxOverride: 100,
      labelFor: (r) => r.value.toFixed(1),
      tipFor: (r) => `<b>${r.full}</b><span class="t-v">${r.value.toFixed(1)}% — ${r.note}</span>`,
    });
    addTable(blHost, ["Agent", "Success rate", "Furthest reached"],
      BASELINES.map((b) => [b.label, b.rate.toFixed(1) + "%", b.note]));
  }

  // 4 — steps-to-ingot distribution
  const dHost = document.getElementById("chart-distribution");
  if (dHost) {
    columns(dHost, { rows: DISTRIBUTION.map((d) => ({ label: d.label, short: d.short, sub: d.sub, value: d.count })) });
    addTable(dHost, ["Steps to ingot", "Episodes", "Share"],
      DISTRIBUTION.map((d) => [d.label, d.count, Math.round((d.count / RESULTS.successes) * 100) + "%"]));
  }

  // 5 — per-episode outcome grid
  const gHost = document.getElementById("chart-grid");
  if (gHost) episodeGrid(gHost, EPISODE_GRID);
}
