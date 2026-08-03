import { renderCharts } from "./charts.js";
import { initDemo } from "./demo.js";
import { MILESTONES } from "./data.js";

/* ------------------------------------------------ theme */
(function theme() {
  const KEY = "vpt-theme";
  const saved = localStorage.getItem(KEY);
  if (saved) document.documentElement.dataset.theme = saved;

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(KEY, next);
  });
})();

/* ------------------------------------------------ screenshot gallery
   Looks for assets/milestone-<key>.jpg|png per milestone. Anything missing
   renders as a labelled placeholder so the grid never collapses. */
function buildShots() {
  const host = document.getElementById("shots");
  if (!host) return;

  const PLACEHOLDER = `<div class="shot-ph">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.6"/>
        <path d="M3.5 16.5 8 12.5l3.5 3 3-2.5 6 5.5"/>
      </svg>
      <span>assets/</span>
    </div>`;

  for (const m of MILESTONES) {
    const fig = document.createElement("figure");
    fig.className = "shot";
    fig.innerHTML =
      `<div class="shot-img">${PLACEHOLDER}</div>` +
      `<figcaption><span class="shot-t">${m.label}</span>` +
      `<span class="shot-s">reward ${m.reward} · ~step ${m.steps.toLocaleString()}</span></figcaption>`;
    host.appendChild(fig);

    // Try jpg, then png; swap in whichever loads.
    const slot = fig.querySelector(".shot-img");
    (function tryLoad(exts) {
      if (!exts.length) {
        slot.querySelector("span").textContent = `assets/milestone-${m.key}.jpg`;
        return;
      }
      const src = `assets/milestone-${m.key}.${exts[0]}`;
      const img = new Image();
      img.onload = () => { slot.innerHTML = ""; img.alt = `Agent at the ${m.label} milestone`; slot.appendChild(img); };
      img.onerror = () => tryLoad(exts.slice(1));
      img.src = src;
    })(["jpg", "png", "webp"]);
  }
}

/* ------------------------------------------------ video presence */
function checkVideo() {
  const frame = document.getElementById("video-frame");
  const v = document.getElementById("demo-video");
  if (!frame || !v) return;

  let loaded = false;
  const fail = () => { if (!loaded) frame.classList.add("no-src"); };

  v.addEventListener("loadedmetadata", () => { loaded = true; frame.classList.remove("no-src"); });
  v.addEventListener("error", fail, true);
  v.querySelector("source")?.addEventListener("error", fail);

  /* When every <source> 404s the video fires no usable error of its own — the
     only dependable signal is NETWORK_NO_SOURCE once it has given up. */
  const settle = () => {
    if (loaded) return;
    if (v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE || v.readyState === 0) fail();
  };
  setTimeout(settle, 1500);
  addEventListener("load", () => setTimeout(settle, 500), { once: true });
}

/* ------------------------------------------------ nav scroll-spy */
function scrollSpy() {
  const links = [...document.querySelectorAll(".nav-links a")];
  const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.removeAttribute("aria-current"));
      map.get(e.target.id)?.setAttribute("aria-current", "true");
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  map.forEach((_, id) => { const s = document.getElementById(id); if (s) obs.observe(s); });
}

/* ------------------------------------------------ go */
renderCharts();
buildShots();
checkVideo();
scrollSpy();
initDemo();

// charts are sized off a fixed viewBox, but the tooltip needs a reflow guard
addEventListener("resize", () => document.querySelector(".chart-tip")?.classList.remove("on"));
