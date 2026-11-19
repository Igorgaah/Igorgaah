// Asteroids contribution graph generator (no dependencies, Node 18+)
// Usage: GITHUB_TOKEN=xxx node scripts/asteroids.mjs <username> [outDir]
//        node scripts/asteroids.mjs --demo [outDir]
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const demo = args.includes("--demo");
const rest = args.filter((a) => a !== "--demo");
const user = demo ? "demo" : rest[0];
const outDir = (demo ? rest[0] : rest[1]) || "dist";

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

// ---------- seeded random ----------
let seed = 1337;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ---------- data ----------
async function fetchWeeks(login) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{weekday contributionLevel}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) =>
    w.contributionDays.map((d) => ({ y: d.weekday, level: LEVELS[d.contributionLevel] ?? 0 }))
  );
  return { weeks, total: cal.totalContributions };
}

function demoWeeks() {
  const weeks = [];
  for (let x = 0; x < 53; x++) {
    const days = [];
    for (let y = 0; y < 7; y++) {
      const r = rnd();
      days.push({ y, level: r < 0.55 ? 0 : r < 0.75 ? 1 : r < 0.87 ? 2 : r < 0.95 ? 3 : 4 });
    }
    weeks.push(days);
  }
  return { weeks, total: 1234 };
}

// ---------- themes ----------
const THEMES = {
  dark: {
    bg: "#0a0a0f",
    empty: "#16161f",
    levels: ["", "#3b1f6e", "#5b2bb5", "#7c3aed", "#a259ff"],
    ship: "#c084fc",
    bullet: "#f0e6ff",
    star: "#c4b5fd",
    hud: "#8b5cf6",
  },
  light: {
    bg: "#ffffff",
    empty: "#ebedf0",
    levels: ["", "#e9d5ff", "#c084fc", "#a259ff", "#7c3aed"],
    ship: "#5b21b6",
    bullet: "#7c3aed",
    star: "#c4b5fd",
    hud: "#7c3aed",
  },
};

// ---------- geometry ----------
const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const MX = 24;
const TOP = 24;

const ROCKS = [
  [[0.5, 0], [0.85, 0.12], [1, 0.45], [0.88, 0.85], [0.5, 1], [0.15, 0.88], [0, 0.5], [0.12, 0.15]],
  [[0.35, 0], [0.8, 0.05], [1, 0.4], [0.9, 0.75], [0.6, 1], [0.2, 0.95], [0, 0.6], [0.1, 0.2]],
  [[0.55, 0], [0.95, 0.25], [0.9, 0.6], [1, 0.8], [0.55, 1], [0.1, 0.85], [0, 0.4], [0.25, 0.1]],
];

const f = (n) => Math.round(n * 100) / 100;
const pct = (t, D) => `${Math.min(100, Math.max(0, (t / D) * 100)).toFixed(3)}%`;

function build({ weeks, total }, theme) {
  const T = THEMES[theme];
  const cols = weeks.length;
  const W = MX * 2 + cols * PITCH - GAP;
  const gridBottom = TOP + 7 * PITCH - GAP;
  const shipX = W / 2;
  const shipY = gridBottom + 78;
  const H = shipY + 46;

  // cells
  const cells = [];
  weeks.forEach((days, x) =>
    days.forEach((d) => {
      const px = MX + x * PITCH;
      const py = TOP + d.y * PITCH;
      cells.push({ x, y: d.y, level: d.level, px, py, cx: px + CELL / 2, cy: py + CELL / 2 });
    })
  );

  // targets sorted as a left-to-right radar sweep
  const targets = cells
    .filter((c) => c.level > 0)
    .map((c) => ({ ...c, angle: (Math.atan2(c.cy - shipY, c.cx - shipX) * 180) / Math.PI }))
    .sort((a, b) => a.angle - b.angle || Math.hypot(a.cx - shipX, a.cy - shipY) - Math.hypot(b.cx - shipX, b.cy - shipY));

  // timeline
  const INTRO = 1.2;
  const TURN_SPEED = 260; // deg/s
  const MIN_GAP = 0.11;
  const BULLET_SPEED = 620; // px/s
  const NOSE = 17;
  let t = INTRO;
  let angle = -90;
  const shipKeys = [[0, -90], [INTRO, -90]];
  const shots = [];
  for (const c of targets) {
    const hits = c.level >= 3 ? 2 : 1;
    c.hits = [];
    for (let h = 0; h < hits; h++) {
      const turn = Math.abs(c.angle - angle) / TURN_SPEED;
      t += Math.max(MIN_GAP, turn);
      angle = c.angle;
      shipKeys.push([t, angle]);
      const sx = shipX + Math.cos((angle * Math.PI) / 180) * NOSE;
      const sy = shipY + Math.sin((angle * Math.PI) / 180) * NOSE;
      const dist = Math.hypot(c.cx - sx, c.cy - sy);
      const travel = dist / BULLET_SPEED;
      shots.push({ t, sx, sy, tx: c.cx, ty: c.cy, travel });
      c.hits.push(t + travel);
    }
  }
  const lastImpact = shots.length ? Math.max(...shots.map((s) => s.t + s.travel)) : INTRO;
  const backTurn = Math.abs(angle + 90) / TURN_SPEED;
  shipKeys.push([lastImpact + 0.6, angle], [lastImpact + 0.6 + backTurn, -90]);
  const D = f(lastImpact + 0.6 + backTurn + 1.6);

  const css = [];
  const svg = [];

  css.push(
    `.c{animation:none}.s{animation:tw 3s ease-in-out infinite}@keyframes tw{0%,100%{opacity:.15}50%{opacity:.8}}`,
    `.fl{animation:fl .12s steps(2) infinite}@keyframes fl{0%{opacity:1}100%{opacity:.25}}`,
    `.r{opacity:0}`
  );

  // background + stars
  svg.push(`<rect width="${W}" height="${H}" rx="8" fill="${T.bg}"/>`);
  for (let i = 0; i < 46; i++) {
    const sx = f(rnd() * W);
    const sy = f(rnd() * H);
    svg.push(`<circle class="s" cx="${sx}" cy="${sy}" r="${f(0.4 + rnd() * 0.7)}" fill="${T.star}" style="animation-delay:${f(rnd() * 3)}s"/>`);
  }

  // empty cells
  for (const c of cells) {
    svg.push(`<rect x="${c.px}" y="${c.py}" width="${CELL}" height="${CELL}" rx="2" fill="${T.empty}"/>`);
  }

  // rocks
  let fragId = 0;
  const frags = [];
  targets.forEach((c, i) => {
    const shape = ROCKS[Math.floor(rnd() * ROCKS.length)];
    const rot = Math.floor(rnd() * 4) * 90;
    const pts = shape.map(([u, v]) => `${f(c.px + u * CELL)},${f(c.py + v * CELL)}`).join(" ");
    const col = T.levels[c.level];
    const k = [];
    k.push(`0%{opacity:0;fill:${col}}${pct(INTRO * 0.8, D)}{opacity:1;fill:${col}}`);
    if (c.hits.length === 2) {
      const h1 = c.hits[0];
      const weaker = T.levels[c.level - 2];
      k.push(`${pct(h1, D)}{fill:${col};opacity:1}${pct(h1 + 0.01, D)}{fill:${weaker};opacity:1}`);
    }
    const last = c.hits[c.hits.length - 1];
    const lastCol = c.hits.length === 2 ? T.levels[c.level - 2] : col;
    k.push(`${pct(last, D)}{opacity:1;fill:${lastCol}}${pct(last + 0.01, D)}{opacity:0;fill:${lastCol}}100%{opacity:0}`);
    css.push(`@keyframes r${i}{${k.join("")}}`);
    svg.push(
      `<polygon class="r" points="${pts}" transform="rotate(${rot} ${c.cx} ${c.cy})" stroke="${T.bg}" stroke-width=".6" style="animation:r${i} ${D}s linear infinite"/>`
    );
    // explosion fragments
    const n = 3;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + rnd() * 1.2;
      const r = 9 + rnd() * 9;
      frags.push({ id: fragId++, x: c.cx, y: c.cy, dx: f(Math.cos(a) * r), dy: f(Math.sin(a) * r), t: last, col: lastCol });
    }
  });

  // fragments: shared timing via delay
  const FRAG = 0.55;
  frags.forEach((p) => {
    css.push(
      `@keyframes p${p.id}{0%{transform:translate(0,0);opacity:1}${pct(FRAG, D)}{transform:translate(${p.dx}px,${p.dy}px);opacity:0}100%{opacity:0}}`
    );
    svg.push(
      `<rect x="${f(p.x - 1.2)}" y="${f(p.y - 1.2)}" width="2.4" height="2.4" fill="${p.col}" opacity="0" style="animation:p${p.id} ${D}s linear ${f(p.t)}s infinite"/>`
    );
  });

  // bullets
  shots.forEach((s, i) => {
    const dx = f(s.tx - s.sx);
    const dy = f(s.ty - s.sy);
    css.push(
      `@keyframes b${i}{0%{transform:translate(0,0);opacity:1}${pct(s.travel, D)}{transform:translate(${dx}px,${dy}px);opacity:1}${pct(s.travel + 0.005, D)}{opacity:0}100%{opacity:0}}`
    );
    svg.push(
      `<circle cx="${f(s.sx)}" cy="${f(s.sy)}" r="1.9" fill="${T.bullet}" opacity="0" style="animation:b${i} ${D}s linear ${f(s.t)}s infinite"/>`
    );
  });

  // ship rotation
  const sk = shipKeys.map(([tt, a]) => `${pct(tt, D)}{transform:rotate(${f(a)}deg)}`).join("");
  css.push(`@keyframes ship{${sk}100%{transform:rotate(-90deg)}}`);
  css.push(`.ship{transform-box:view-box;transform-origin:${f(shipX)}px ${f(shipY)}px;animation:ship ${D}s linear infinite}`);
  svg.push(
    `<g class="ship"><polygon points="${f(shipX + 17)},${shipY} ${f(shipX - 10)},${f(shipY - 9)} ${f(shipX - 6)},${shipY} ${f(shipX - 10)},${f(shipY + 9)}" fill="none" stroke="${T.ship}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<polyline class="fl" points="${f(shipX - 7)},${f(shipY - 4)} ${f(shipX - 15)},${shipY} ${f(shipX - 7)},${f(shipY + 4)}" fill="none" stroke="${T.ship}" stroke-width="1.2"/></g>`
  );

  // HUD
  const font = `font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="11" letter-spacing="1.5"`;
  svg.push(`<text x="${MX}" y="${H - 16}" fill="${T.hud}" ${font}>SCORE ${String(total).padStart(5, "0")}</text>`);
  for (let i = 0; i < 3; i++) {
    const lx = W - MX - 6 - i * 18;
    const ly = H - 20;
    svg.push(
      `<polygon points="${lx},${ly - 8} ${lx - 5},${ly + 5} ${lx},${ly + 2} ${lx + 5},${ly + 5}" fill="none" stroke="${T.hud}" stroke-width="1.2" stroke-linejoin="round"/>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><title>Asteroids contribution graph</title><style>${css.join("")}</style>${svg.join("")}</svg>`;
}

const data = demo ? demoWeeks() : await fetchWeeks(user);
mkdirSync(outDir, { recursive: true });
for (const theme of ["light", "dark"]) {
  seed = 1337;
  const name = theme === "dark" ? "asteroids-dark.svg" : "asteroids.svg";
  writeFileSync(`${outDir}/${name}`, build(data, theme));
  console.log(`wrote ${outDir}/${name}`);
}
