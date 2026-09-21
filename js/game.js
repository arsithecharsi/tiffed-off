/* Slice & Spite — arena engine.
   One Arena runs per game screen, in one of two modes:
     'authority' — the Slicer's device: real simulation, input, scoring. Emits events.
     'mirror'    — the Saboteur's device: replays events; physics are deterministic
                   (pure ballistics, closed-form positions) so no position streaming is needed.
   World space is a fixed 1000x1600 portrait board, contain-fitted to the canvas. */
(function () {
  const W = 1000, H = 1600, G = 1450;           // world units, gravity px/s^2
  const ROUND_MS = 90000;
  const HEARTS = 3;
  const SLICE_SPEED = 0.55;                      // min world px/ms to cut
  const MISS_PENALTY = 5, TRAP_PENALTY = 50;
  const BOMB_BLAST = 260;

  const FRUITS = [
    { k: "apple",  e: "🍎", juice: "#e0322f", r: 66, pts: 10 },
    { k: "orange", e: "🍊", juice: "#ff9d2e", r: 66, pts: 10 },
    { k: "banana", e: "🍌", juice: "#ffe14d", r: 70, pts: 10 },
    { k: "melon",  e: "🍉", juice: "#ff4f6d", r: 78, pts: 15 },
    { k: "straw",  e: "🍓", juice: "#ff3355", r: 58, pts: 10 },
    { k: "pine",   e: "🍍", juice: "#ffd94d", r: 72, pts: 15 },
    { k: "kiwi",   e: "🥝", juice: "#9ccb3b", r: 58, pts: 10 },
  ];
  const KINDS = {};
  FRUITS.forEach((f) => (KINDS[f.k] = f));
  KINDS.bomb = { k: "bomb", e: "💣", juice: "#555", r: 66, pts: 0 };
  KINDS.trap = { k: "trap", e: "🍉", juice: "#a04fd0", r: 78, pts: 0 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- emoji pre-rendering ---------- */
  const glyphCache = {};
  function glyph(e) {
    if (glyphCache[e]) return glyphCache[e];
    const c = document.createElement("canvas");
    c.width = c.height = 144;
    const g = c.getContext("2d");
    g.font = '120px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(e, 72, 80);
    const halves = [0, 1].map((i) => {
      const h = document.createElement("canvas");
      h.width = h.height = 144;
      const hg = h.getContext("2d");
      hg.save();
      hg.beginPath();
      hg.rect(i === 0 ? 0 : 72, 0, 72, 144);
      hg.clip();
      hg.drawImage(c, 0, 0);
      hg.restore();
      return h;
    });
    return (glyphCache[e] = { full: c, halves });
  }

  /* ---------- Arena ---------- */
  class Arena {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.mode = opts.mode;                  // 'authority' | 'mirror'
      this.onEvent = opts.onEvent || (() => {});
      this.onState = opts.onState || (() => {});
      this.onEnd = opts.onEnd || (() => {});
      this.slicingEnabled = opts.slicing !== false && this.mode === "authority";

      this.entities = [];  // {id,kind,x0,y0,vx,vy,r0,vr,t0,alive}
      this.pieces = [];    // local eye candy
      this.particles = [];
      this.popups = [];
      this.smokes = [];
      this.trails = new Map(); // pointerId -> {pts:[], count, lastSlice}
      this.score = 0; this.hearts = HEARTS;
      this.running = false;
      this.roundStart = 0; this.roundDur = ROUND_MS;
      this.nextNatural = 0; this.nextBurst = 0;
      this.nextId = 1;
      this.shakeUntil = 0; this.flashUntil = 0;
      this.lastStatus = 0; this.lastState = 0;
      this.aimMarks = [];
      this._raf = 0;
      this._resize = this.resize.bind(this);
      window.addEventListener("resize", this._resize);
      this.resize();
      if (this.slicingEnabled) this.bindInput();
      this._loop = this.loop.bind(this);
      this._raf = requestAnimationFrame(this._loop);
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener("resize", this._resize);
      if (this._unbind) this._unbind();
    }

    resize() {
      const box = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = box.width * dpr;
      this.canvas.height = box.height * dpr;
      this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
      this.ox = (this.canvas.width - W * this.scale) / 2;
      this.oy = (this.canvas.height - H * this.scale) / 2;
      this.boxW = box.width; this.boxH = box.height; this.dpr = dpr;
    }

    clientToWorld(cx, cy) {
      const r = this.canvas.getBoundingClientRect();
      const px = (cx - r.left) * this.dpr, py = (cy - r.top) * this.dpr;
      return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
    }

    now() { return performance.now(); }
    simT() { return this.now() - this.roundStart; }

    /* ---------- round control ---------- */
    startRound(dur) {
      this.entities = []; this.pieces = []; this.particles = [];
      this.popups = []; this.smokes = []; this.aimMarks = [];
      this.score = 0; this.hearts = HEARTS;
      this.roundDur = dur || ROUND_MS;
      this.roundStart = this.now();
      this.nextNatural = 700;
      this.nextBurst = rand(7000, 10000);
      this.running = true;
    }

    stopRound() { this.running = false; this.entities = []; this.trails.clear(); }

    endRound(reason) {
      if (!this.running) return;
      this.running = false;
      const msg = { t: "end", score: this.score, reason };
      this.onEvent(msg);
      this.onEnd(reason, this.score);
    }

    /* ---------- spawning (authority) ---------- */
    spawn(kind, x0, vx, apexY, delayMs) {
      const def = KINDS[kind];
      const y0 = H + 70;
      const vy = -Math.sqrt(2 * G * (y0 - apexY));
      const e = {
        id: this.nextId++, kind,
        x0: clamp(x0, 60, W - 60), y0,
        vx, vy,
        r0: rand(-0.6, 0.6), vr: rand(-2.2, 2.2),
        t0: this.simT() + (delayMs || 0),
        alive: true,
      };
      this.entities.push(e);
      this.onEvent({ t: "sp", id: e.id, k: kind, x: Math.round(e.x0), vx: Math.round(vx), vy: Math.round(vy), r0: +e.r0.toFixed(2), vr: +e.vr.toFixed(2), ts: Math.round(e.t0) });
      return e;
    }

    spawnNaturalFruit() {
      const f = FRUITS[(Math.random() * FRUITS.length) | 0];
      const x0 = rand(120, W - 120);
      const vx = (W / 2 - x0) * rand(0.08, 0.22) + rand(-60, 60);
      this.spawn(f.k, x0, vx, rand(180, 560));
    }

    handleSend(w, aimX) {
      // A weapon arrives from the Saboteur (via net or the couch deck).
      if (!this.running) return;
      const ax = clamp(aimX || rand(150, W - 150), 80, W - 80);
      if (w === "bomb") {
        this.spawn("bomb", ax + rand(-40, 40), rand(-50, 50), rand(200, 420));
      } else if (w === "trap") {
        this.spawn("trap", ax + rand(-30, 30), rand(-40, 40), rand(200, 500));
      } else if (w === "cluster") {
        for (let i = 0; i < 3; i++) this.spawn("bomb", ax + rand(-150, 150), rand(-70, 70), rand(200, 450), i * 160);
        for (let i = 0; i < 3; i++) {
          const f = FRUITS[(Math.random() * FRUITS.length) | 0];
          this.spawn(f.k, ax + rand(-170, 170), rand(-70, 70), rand(200, 480), 80 + i * 160);
        }
      } else if (w === "flood") {
        for (let i = 0; i < 6; i++) {
          const f = FRUITS[(Math.random() * FRUITS.length) | 0];
          this.spawn(f.k, rand(100, W - 100), rand(-90, 90), rand(160, 560), i * 130);
        }
      } else if (w === "smoke") {
        this.applySmoke();
        this.onEvent({ t: "fx", k: "smoke", ts: Math.round(this.simT()) });
        SFX.smoke();
      }
    }

    applySmoke() {
      const cx = rand(250, W - 250);
      for (let i = 0; i < 9; i++) {
        this.smokes.push({
          x: cx + rand(-280, 280), y: rand(250, 1000), r: rand(170, 270),
          vx: rand(-14, 14), vy: rand(-8, 8), born: this.now(), dur: 4200,
        });
      }
    }

    /* ---------- mirror: apply remote events ---------- */
    applyNet(m) {
      if (m.t === "sp") {
        this.entities.push({
          id: m.id, kind: m.k, x0: m.x, y0: H + 70, vx: m.vx, vy: m.vy,
          r0: m.r0, vr: m.vr, t0: m.ts, alive: true,
        });
      } else if (m.t === "sl") {
        m.ids.forEach((id) => this.killVisual(id, "slice"));
        this.score = m.score;
      } else if (m.t === "bh") {
        this.killVisual(m.id, "boom");
        (m.killed || []).forEach((id) => this.killVisual(id, "poof"));
        this.hearts = m.hearts; this.score = m.score;
        this.shakeUntil = this.now() + 450; this.flashUntil = this.now() + 180;
        SFX.boom();
      } else if (m.t === "tr") {
        this.killVisual(m.id, "trapboom");
        this.score = m.score;
        SFX.trap();
      } else if (m.t === "ms") {
        this.score = m.score;
      } else if (m.t === "cb") {
        this.score = m.score;
      } else if (m.t === "fx" && m.k === "smoke") {
        this.applySmoke();
      } else if (m.t === "st") {
        this.score = m.score; this.hearts = m.hearts;
      }
    }

    killVisual(id, style) {
      const e = this.entities.find((x) => x.id === id && x.alive);
      if (!e) return;
      e.alive = false;
      const p = this.posOf(e, this.simT());
      if (!p) return;
      const def = KINDS[e.kind] || KINDS.apple;
      if (style === "slice") this.burstSlice(e, p, def, rand(0, Math.PI));
      else if (style === "boom") this.burstBoom(p);
      else if (style === "trapboom") this.burstTrap(p);
      else this.burstPoof(p);
    }

    /* ---------- physics ---------- */
    posOf(e, simT) {
      const dt = (simT - e.t0) / 1000;
      if (dt < 0) return null; // not launched yet (staggered spawns)
      return {
        x: e.x0 + e.vx * dt,
        y: e.y0 + e.vy * dt + 0.5 * G * dt * dt,
        rot: e.r0 + e.vr * dt,
        falling: e.vy + G * dt > 0,
      };
    }

    /* ---------- input (authority slicing) ---------- */
    bindInput() {
      const down = (ev) => {
        this.canvas.setPointerCapture && this.canvas.setPointerCapture(ev.pointerId);
        this.trails.set(ev.pointerId, { pts: [], count: 0, lastSlice: 0, swished: 0 });
        this.addTrailPoint(ev);
      };
      const move = (ev) => { if (this.trails.has(ev.pointerId)) this.addTrailPoint(ev); };
      const up = (ev) => {
        const tr = this.trails.get(ev.pointerId);
        if (tr) this.finalizeCombo(tr);
        this.trails.delete(ev.pointerId);
      };
      this.canvas.addEventListener("pointerdown", down);
      this.canvas.addEventListener("pointermove", move);
      this.canvas.addEventListener("pointerup", up);
      this.canvas.addEventListener("pointercancel", up);
      this._unbind = () => {
        this.canvas.removeEventListener("pointerdown", down);
        this.canvas.removeEventListener("pointermove", move);
        this.canvas.removeEventListener("pointerup", up);
        this.canvas.removeEventListener("pointercancel", up);
      };
    }

    addTrailPoint(ev) {
      const tr = this.trails.get(ev.pointerId);
      const p = this.clientToWorld(ev.clientX, ev.clientY);
      const t = this.now();
      const prev = tr.pts[tr.pts.length - 1];
      tr.pts.push({ x: p.x, y: p.y, t });
      if (tr.pts.length > 14) tr.pts.shift();
      if (!prev || !this.running) return;
      const dt = t - prev.t;
      if (dt <= 0) return;
      const dx = p.x - prev.x, dy = p.y - prev.y;
      const speed = Math.hypot(dx, dy) / dt;
      if (speed < SLICE_SPEED) return;
      if (t - tr.swished > 160 && speed > 1.1) { SFX.swish(); tr.swished = t; }
      this.sliceSegment(prev, p, Math.atan2(dy, dx), tr);
    }

    sliceSegment(a, b, angle, tr) {
      const simT = this.simT();
      const sliced = [];
      for (const e of this.entities) {
        if (!e.alive) continue;
        const p = this.posOf(e, simT);
        if (!p || p.y < -80) continue;
        const def = KINDS[e.kind];
        if (this.segCircle(a, b, p.x, p.y, def.r + 14)) {
          e.alive = false;
          if (e.kind === "bomb") { this.hitBomb(e, p, simT); return; }
          if (e.kind === "trap") { this.hitTrap(e, p); continue; }
          this.burstSlice(e, p, def, angle);
          this.score += def.pts;
          this.popups.push({ x: p.x, y: p.y, text: "+" + def.pts, color: "#fff", size: 40, born: this.now(), dur: 700 });
          sliced.push(e.id);
          tr.count++; tr.lastSlice = this.now();
          SFX.splat();
        }
      }
      if (sliced.length) this.onEvent({ t: "sl", ids: sliced, score: this.score });
    }

    segCircle(a, b, cx, cy, r) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((cx - a.x) * dx + (cy - a.y) * dy) / len2 : 0;
      t = clamp(t, 0, 1);
      const px = a.x + t * dx, py = a.y + t * dy;
      return (cx - px) ** 2 + (cy - py) ** 2 <= r * r;
    }

    hitBomb(e, p, simT) {
      this.hearts--;
      const killed = [];
      for (const o of this.entities) {
        if (!o.alive || o === e) continue;
        const op = this.posOf(o, simT);
        if (op && Math.hypot(op.x - p.x, op.y - p.y) < BOMB_BLAST) {
          o.alive = false; killed.push(o.id); this.burstPoof(op);
        }
      }
      this.burstBoom(p);
      this.shakeUntil = this.now() + 500;
      this.flashUntil = this.now() + 200;
      this.trails.forEach((tr) => { tr.count = 0; });
      this.popups.push({ x: p.x, y: p.y, text: "-1 ❤", color: "#ff5e8a", size: 52, born: this.now(), dur: 1000 });
      SFX.boom(); SFX.heart();
      this.onEvent({ t: "bh", id: e.id, killed, hearts: this.hearts, score: this.score });
      if (this.hearts <= 0) this.endRound("kaboom");
    }

    hitTrap(e, p) {
      this.score = Math.max(0, this.score - TRAP_PENALTY);
      this.burstTrap(p);
      this.popups.push({ x: p.x, y: p.y, text: "TRAP! -" + TRAP_PENALTY, color: "#c47bff", size: 44, born: this.now(), dur: 1100 });
      SFX.trap();
      this.onEvent({ t: "tr", id: e.id, score: this.score });
    }

    finalizeCombo(tr) {
      if (tr.count >= 2) {
        const bonus = (tr.count - 1) * 15;
        this.score += bonus;
        this.popups.push({ x: W / 2, y: 500, text: "COMBO ×" + tr.count + "  +" + bonus, color: "#ffd94d", size: 50, born: this.now(), dur: 1100 });
        SFX.combo(tr.count);
        this.onEvent({ t: "cb", n: tr.count, score: this.score });
      }
      tr.count = 0;
    }

    /* ---------- effects ---------- */
    burstSlice(e, p, def, angle) {
      const gl = glyph(def.e);
      const nx = Math.sin(angle), ny = -Math.cos(angle);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        this.pieces.push({
          img: gl.halves[i], x: p.x, y: p.y,
          vx: e.vx * 0.5 + nx * s * 220 + rand(-40, 40),
          vy: -150 + ny * s * 220,
          rot: p.rot + (angle - Math.PI / 2), vr: s * rand(2, 5),
          size: def.r * 2.3, born: this.now(),
        });
      }
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(60, 420);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: rand(5, 14), color: def.juice, born: this.now(), dur: rand(500, 900) });
      }
    }
    burstBoom(p) {
      for (let i = 0; i < 26; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(100, 700);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(6, 18), color: i % 3 ? "#ff9d2e" : "#555", born: this.now(), dur: rand(400, 800) });
      }
      this.particles.push({ ring: true, x: p.x, y: p.y, r: 30, color: "#fff", born: this.now(), dur: 450 });
    }
    burstTrap(p) {
      for (let i = 0; i < 18; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(80, 450);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, r: rand(5, 13), color: "#c47bff", born: this.now(), dur: rand(450, 850) });
      }
    }
    burstPoof(p) {
      for (let i = 0; i < 8; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(40, 200);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(6, 14), color: "#999", born: this.now(), dur: 500 });
      }
    }
    markAim(x) { this.aimMarks.push({ x, born: this.now() }); }

    /* ---------- main loop ---------- */
    loop() {
      this._raf = requestAnimationFrame(this._loop);
      const nowT = this.now();
      const simT = this.simT();

      if (this.running && this.mode === "authority") {
        // natural fruit
        if (simT >= this.nextNatural) {
          this.spawnNaturalFruit();
          if (Math.random() < 0.18) this.spawnNaturalFruit();
          this.nextNatural = simT + rand(900, 1500);
        }
        if (simT >= this.nextBurst) {
          for (let i = 0; i < 3; i++) setTimeout(() => this.running && this.spawnNaturalFruit(), i * 150);
          this.nextBurst = simT + rand(8000, 12000);
        }
        // combo timeout
        this.trails.forEach((tr) => {
          if (tr.count >= 2 && nowT - tr.lastSlice > 350) this.finalizeCombo(tr);
        });
        // misses / cleanup
        for (const e of this.entities) {
          if (!e.alive) continue;
          const p = this.posOf(e, simT);
          if (p && p.falling && p.y > H + 130) {
            e.alive = false;
            if (e.kind !== "bomb" && e.kind !== "trap") {
              this.score = Math.max(0, this.score - MISS_PENALTY);
              this.popups.push({ x: clamp(p.x, 80, W - 80), y: H - 120, text: "miss -" + MISS_PENALTY, color: "#8899aa", size: 30, born: nowT, dur: 700 });
              SFX.miss();
              this.onEvent({ t: "ms", id: e.id, score: this.score });
            }
          }
        }
        // status + timer
        if (nowT - this.lastStatus > 1000) {
          this.lastStatus = nowT;
          this.onEvent({ t: "st", score: this.score, hearts: this.hearts, left: Math.max(0, this.roundDur - simT) });
        }
        if (simT >= this.roundDur) this.endRound("time");
      }

      if (this.running && this.mode === "mirror") {
        // deterministic local cleanup of fallen entities
        for (const e of this.entities) {
          if (!e.alive) continue;
          const p = this.posOf(e, simT);
          if (p && p.falling && p.y > H + 130) e.alive = false;
        }
      }

      if (this.entities.length > 90) this.entities = this.entities.filter((e) => e.alive || nowT - e.t0 < 30000);

      this.draw(nowT, simT);

      if (nowT - this.lastState > 150) {
        this.lastState = nowT;
        this.onState({ score: this.score, hearts: this.hearts, left: Math.max(0, this.roundDur - simT), dur: this.roundDur, running: this.running });
      }
    }

    /* ---------- drawing ---------- */
    draw(nowT, simT) {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // letterbox background
      ctx.fillStyle = "#0a0514";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      let sx = 0, sy = 0;
      if (nowT < this.shakeUntil) {
        const k = ((this.shakeUntil - nowT) / 500) * 18;
        sx = rand(-k, k); sy = rand(-k, k);
      }
      ctx.setTransform(this.scale, 0, 0, this.scale, this.ox + sx * this.scale, this.oy + sy * this.scale);

      // board background
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#241040");
      grad.addColorStop(0.6, "#170a2b");
      grad.addColorStop(1, "#0e0620");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      if (this.mode === "mirror") {
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(0, 0, W, H);
      }

      // aim marks (mirror)
      for (const m of this.aimMarks) {
        const a = 1 - (nowT - m.born) / 600;
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = "#ffd94d";
        ctx.font = "60px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("⌖", m.x, H - 60);
        ctx.globalAlpha = 1;
      }
      this.aimMarks = this.aimMarks.filter((m) => nowT - m.born < 600);

      // entities
      for (const e of this.entities) {
        if (!e.alive) continue;
        const p = this.posOf(e, simT);
        if (!p || p.y > H + 140 || p.y < -160) continue;
        const def = KINDS[e.kind];
        const gl = glyph(def.e);
        const size = def.r * 2.3;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * 0.6);
        if (e.kind === "trap") {
          // the tell: soft purple pulse + sparkles
          const pulse = 0.18 + 0.14 * Math.sin(nowT / 160);
          ctx.shadowColor = "rgba(170,80,255," + pulse.toFixed(2) + ")";
          ctx.shadowBlur = 30;
          if (Math.random() < 0.06) this.particles.push({ x: p.x + rand(-40, 40), y: p.y + rand(-40, 40), vx: rand(-30, 30), vy: rand(-60, 0), r: 5, color: "#d9a6ff", born: nowT, dur: 400 });
        }
        if (e.kind === "bomb" && Math.random() < 0.25) {
          this.particles.push({ x: p.x + 30, y: p.y - 44, vx: rand(-40, 40), vy: rand(-80, -10), r: 4, color: "#ffd94d", born: nowT, dur: 300 });
        }
        ctx.drawImage(gl.full, -size / 2, -size / 2, size, size);
        ctx.restore();
      }

      // pieces (dt-integrated eye candy)
      for (const pc of this.pieces) {
        const age = (nowT - pc.born) / 1000;
        const x = pc.x + pc.vx * age, y = pc.y + pc.vy * age + 0.5 * G * age * age;
        if (y > H + 200) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(pc.rot + pc.vr * age);
        ctx.drawImage(pc.img, -pc.size / 2, -pc.size / 2, pc.size, pc.size);
        ctx.restore();
      }
      this.pieces = this.pieces.filter((pc) => nowT - pc.born < 2600);

      // particles
      for (const pt of this.particles) {
        const age = (nowT - pt.born) / 1000;
        const life = 1 - (nowT - pt.born) / pt.dur;
        if (life <= 0) continue;
        ctx.globalAlpha = life;
        if (pt.ring) {
          ctx.strokeStyle = pt.color; ctx.lineWidth = 10 * life;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r + age * 1400, 0, Math.PI * 2); ctx.stroke();
        } else {
          const x = pt.x + pt.vx * age, y = pt.y + pt.vy * age + 0.5 * 900 * age * age;
          ctx.fillStyle = pt.color;
          ctx.beginPath(); ctx.arc(x, y, pt.r * life, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      this.particles = this.particles.filter((pt) => nowT - pt.born < pt.dur);

      // blade trails
      this.trails.forEach((tr) => {
        const pts = tr.pts.filter((p) => nowT - p.t < 130);
        if (pts.length < 2) return;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (let i = 1; i < pts.length; i++) {
          const a = i / pts.length;
          ctx.strokeStyle = "rgba(255,255,255," + (a * 0.9).toFixed(2) + ")";
          ctx.lineWidth = 3 + a * 15;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
      });

      // popups
      for (const pp of this.popups) {
        const k = (nowT - pp.born) / pp.dur;
        if (k >= 1) continue;
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = pp.color;
        ctx.font = "900 " + pp.size + 'px -apple-system,"Segoe UI",sans-serif';
        ctx.textAlign = "center";
        ctx.fillText(pp.text, pp.x, pp.y - k * 80);
        ctx.globalAlpha = 1;
      }
      this.popups = this.popups.filter((pp) => nowT - pp.born < pp.dur);

      // smoke
      for (const s of this.smokes) {
        const age = nowT - s.born;
        if (age > s.dur) continue;
        let a;
        if (age < 400) a = age / 400;
        else if (age > s.dur - 900) a = (s.dur - age) / 900;
        else a = 1;
        const x = s.x + s.vx * (age / 1000), y = s.y + s.vy * (age / 1000);
        const rg = ctx.createRadialGradient(x, y, 10, x, y, s.r);
        rg.addColorStop(0, "rgba(200,198,210," + (0.96 * a).toFixed(2) + ")");
        rg.addColorStop(1, "rgba(200,198,210,0)");
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      this.smokes = this.smokes.filter((s) => nowT - s.born < s.dur);

      // bomb flash
      if (nowT < this.flashUntil) {
        ctx.fillStyle = "rgba(255,255,255," + ((this.flashUntil - nowT) / 200 * 0.75).toFixed(2) + ")";
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  window.Game = { Arena, W, H, ROUND_MS, HEARTS, FRUITS, KINDS };
})();
