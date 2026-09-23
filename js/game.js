/* Slice & Spite — arena engine.
   Every board is its own authority: both players slice simultaneously on their
   own Arena; only attack messages and status cross the wire. Physics are pure
   ballistics, closed-form, so a hidden tab or slow frame never desyncs a board.
   World x is always 0..1000; world height adapts to the canvas (boards are
   independent, so aspect never needs to match the opponent's). */
(function () {
  const W = 1000, G = 1450;                      // world width units, gravity px/s^2
  const ROUND_MS = 90000;
  const HEARTS = 3;
  const SLICE_SPEED = 0.55;                      // min world px/ms to cut
  const FRUIT_SCORE = 5, FRUIT_COIN = 3;
  const CRIT_SCORE = 10, CRIT_COIN = 4, CRIT_CHANCE = 0.12;
  const COMBO_BONUS = { 3: 15, 4: 25 };          // 5+ => 40 (score)
  const COMBO_COIN = { 3: 5, 4: 8 };             // 5+ => 15 (coins — combos fund attacks)
  const MISS_PENALTY = 5, TRAP_PENALTY = 30;
  const BOMB_BLAST = 260;

  const FRUITS = [
    { k: "apple",  spr: "apple",  juice: "#e5254f", r: 66 },
    { k: "orange", spr: "orange", juice: "#f5920f", r: 66 },
    { k: "banana", spr: "banana", juice: "#f7c81e", r: 70 },
    { k: "melon",  spr: "melon",  juice: "#e5254f", r: 78 },
    { k: "straw",  spr: "straw",  juice: "#e5254f", r: 58 },
    { k: "pine",   spr: "pine",   juice: "#f7c81e", r: 72 },
    { k: "kiwi",   spr: "kiwi",   juice: "#9ccb3b", r: 58 },
  ];
  const KINDS = {};
  FRUITS.forEach((f) => (KINDS[f.k] = f));
  KINDS.bomb = { k: "bomb", spr: "bomb",  juice: "#5a5566", r: 66 };
  KINDS.trap = { k: "trap", spr: "straw", juice: "#8c46c8", r: 58 }; // the fake strawberry

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  let canVib = false;
  window.addEventListener("pointerdown", () => { canVib = true; }, { once: true });
  const vib = (p) => { if (!canVib) return; try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  /* ---------- paper speckle texture (shared) ---------- */
  let speckleTile = null;
  function speckles() {
    if (speckleTile) return speckleTile;
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    for (let i = 0; i < 42; i++) {
      g.fillStyle = "rgba(42,38,36," + rand(0.03, 0.07).toFixed(3) + ")";
      g.beginPath();
      g.arc(rand(0, 96), rand(0, 96), rand(0.7, 1.8), 0, Math.PI * 2);
      g.fill();
    }
    return (speckleTile = c);
  }

  /* ---------- Arena ---------- */
  class Arena {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.rotated = !!opts.rotated;          // couch: top board is CSS-rotated 180°
      this.onEvent = opts.onEvent || (() => {});   // {t:'hurt'|'trap'|'end', ...}
      this.onState = opts.onState || (() => {});
      this.onCoin = opts.onCoin || (() => {});     // coins earned by slicing

      this.entities = [];  // {id,kind,crit,x0,y0,vx,vy,r0,vr,t0,alive}
      this.pieces = [];
      this.particles = [];
      this.popups = [];
      this.smokes = [];
      this.trails = new Map(); // pointerId -> {pts:[], count, lastSlice, swished}
      this.score = 0; this.hearts = HEARTS;
      this.stats = { fruit: 0, bestCombo: 0, bombsDodged: 0 };
      this.running = false;
      this.roundStart = 0; this.roundDur = ROUND_MS;
      this.nextNatural = 0; this.nextBurst = 0;
      this.nextId = 1;
      this.shakeUntil = 0; this.flashUntil = 0; this.stampUntil = 0;
      this.lastState = 0;
      this._raf = 0;
      this._resize = this.resize.bind(this);
      window.addEventListener("resize", this._resize);
      if (window.ResizeObserver) {
        this._ro = new ResizeObserver(this._resize);
        this._ro.observe(canvas.parentElement);
      }
      this.resize();
      this.bindInput();
      this._loop = this.loop.bind(this);
      this._raf = requestAnimationFrame(this._loop);
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener("resize", this._resize);
      if (this._ro) this._ro.disconnect();
      if (this._unbind) this._unbind();
    }

    resize() {
      const box = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, box.width * dpr);
      this.canvas.height = Math.max(1, box.height * dpr);
      this.scale = this.canvas.width / W;          // width-fit; height adapts
      this.H = this.canvas.height / this.scale;    // world height for THIS board
      this.dpr = dpr;
    }

    clientToWorld(cx, cy) {
      const r = this.canvas.getBoundingClientRect();
      let px = cx - r.left, py = cy - r.top;
      if (this.rotated) { px = r.width - px; py = r.height - py; }
      return { x: px * this.dpr / this.scale, y: py * this.dpr / this.scale };
    }

    now() { return performance.now(); }
    simT() { return this.now() - this.roundStart; }

    /* ---------- round control ---------- */
    startRound(dur) {
      this.entities = []; this.pieces = []; this.particles = [];
      this.popups = []; this.smokes = [];
      this.score = 0; this.hearts = HEARTS;
      this.stats = { fruit: 0, bestCombo: 0, bombsDodged: 0 };
      this.roundDur = dur || ROUND_MS;
      this.roundStart = this.now();
      this.nextNatural = 600;
      this.nextBurst = rand(9000, 12000);
      this.running = true;
    }

    stopRound() { this.running = false; this.entities = []; this.trails.clear(); }

    endRound(reason) {
      if (!this.running) return;
      this.running = false;
      this.onEvent({ t: "end", score: this.score, reason });
    }

    /* ---------- spawning ---------- */
    spawn(kind, x0, vx, apexFrac, delayMs, crit) {
      const y0 = this.H + 70;
      const apexY = clamp(apexFrac, 0.06, 0.6) * this.H;
      const vy = -Math.sqrt(2 * G * (y0 - apexY));
      const e = {
        id: this.nextId++, kind, crit: !!crit,
        x0: clamp(x0, 60, W - 60), y0,
        vx, vy,
        r0: rand(-0.6, 0.6), vr: rand(-2.2, 2.2),
        t0: this.simT() + (delayMs || 0),
        alive: true,
      };
      this.entities.push(e);
      return e;
    }

    spawnNaturalFruit() {
      const f = FRUITS[(Math.random() * FRUITS.length) | 0];
      const x0 = rand(120, W - 120);
      const vx = (W / 2 - x0) * rand(0.08, 0.22) + rand(-60, 60);
      this.spawn(f.k, x0, vx, rand(0.1, 0.36), 0, Math.random() < CRIT_CHANCE);
    }

    handleSend(w, aimX) {
      // an attack lands on THIS board (already fused/delayed by the queue)
      if (!this.running) return;
      const ax = clamp(aimX || rand(150, W - 150), 80, W - 80);
      if (w === "bomb") {
        this.spawn("bomb", ax + rand(-40, 40), rand(-50, 50), rand(0.12, 0.3));
      } else if (w === "trap") {
        this.spawn("trap", ax + rand(-30, 30), rand(-40, 40), rand(0.12, 0.32));
      } else if (w === "cluster") {
        for (let i = 0; i < 3; i++) this.spawn("bomb", ax + rand(-150, 150), rand(-70, 70), rand(0.12, 0.3), i * 160);
        for (let i = 0; i < 3; i++) {
          const f = FRUITS[(Math.random() * FRUITS.length) | 0];
          this.spawn(f.k, ax + rand(-170, 170), rand(-70, 70), rand(0.12, 0.32), 80 + i * 160);
        }
      } else if (w === "flood") {
        for (let i = 0; i < 6; i++) {
          const f = FRUITS[(Math.random() * FRUITS.length) | 0];
          this.spawn(f.k, rand(100, W - 100), rand(-90, 90), rand(0.1, 0.36), i * 130); // flood fruit never crit
        }
      } else if (w === "smoke") {
        this.applySmoke();
        SFX.smoke();
      }
    }

    applySmoke() {
      // heavy but not blinding — silhouettes stay barely trackable through it
      const cx = rand(250, W - 250);
      for (let i = 0; i < 7; i++) {
        this.smokes.push({
          x: cx + rand(-280, 280), y: rand(0.12, 0.62) * this.H, r: rand(160, 240),
          vx: rand(-14, 14), vy: rand(-8, 8), born: this.now(), dur: 3800,
        });
      }
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

    /* ---------- input ---------- */
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
          const pts = e.crit ? CRIT_SCORE : FRUIT_SCORE;
          const coin = (e.crit ? CRIT_COIN : FRUIT_COIN) + (e.kind === "straw" ? 1 : 0); // her fruit pays extra
          this.score += pts;
          this.stats.fruit++;
          this.onCoin(coin);
          this.popups.push({
            x: p.x, y: p.y,
            text: (e.crit ? "CRIT +" : "+") + pts, color: e.crit ? "#f0a821" : "#2a2624",
            size: e.crit ? 48 : 38, born: this.now(), dur: 700,
          });
          tr.count++; tr.lastSlice = this.now();
          vib(8);
          if (e.kind === "straw") SFX.straw(); else SFX.splat();
          if (e.crit) SFX.coin();
        }
      }
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
      for (const o of this.entities) {
        if (!o.alive || o === e) continue;
        const op = this.posOf(o, simT);
        if (op && Math.hypot(op.x - p.x, op.y - p.y) < BOMB_BLAST) {
          o.alive = false; this.burstPoof(op);
        }
      }
      this.burstBoom(p);
      this.shakeUntil = this.now() + 500;
      this.flashUntil = this.now() + 200;
      this.trails.forEach((tr) => { tr.count = 0; });
      this.popups.push({ x: p.x, y: p.y, text: "-1 HEART", color: "#e5254f", size: 52, born: this.now(), dur: 1000 });
      this.stampUntil = this.now() + 1500;   // "TIFFED OFF!" rage stamp
      vib([40, 60, 40]);
      SFX.boom(); SFX.heart();
      this.onEvent({ t: "hurt", hearts: this.hearts });
      if (this.hearts <= 0) this.endRound("ko");
    }

    hitTrap(e, p) {
      this.score = Math.max(0, this.score - TRAP_PENALTY);
      this.burstTrap(p);
      this.popups.push({ x: p.x, y: p.y, text: "FAKE! -" + TRAP_PENALTY, color: "#8c46c8", size: 46, born: this.now(), dur: 1100 });
      vib(20);
      SFX.trap();
      this.onEvent({ t: "trap" });
    }

    finalizeCombo(tr) {
      if (tr.count >= 3) {
        const bonus = COMBO_BONUS[tr.count] || 40;
        const coins = COMBO_COIN[tr.count] || 15;   // combos bankroll your next attack
        this.score += bonus;
        this.onCoin(coins);
        this.stats.bestCombo = Math.max(this.stats.bestCombo, tr.count);
        this.popups.push({ x: W / 2, y: this.H * 0.3, text: "×" + tr.count + " COMBO  +" + bonus, color: "#e5254f", size: 52, born: this.now(), dur: 1100 });
        this.popups.push({ x: W / 2, y: this.H * 0.3 + 90, text: "+$" + coins, color: "#f0a821", size: 40, born: this.now(), dur: 1100 });
        SFX.combo(tr.count);
        this.onEvent({ t: "combo", n: tr.count });
      }
      tr.count = 0;
    }

    /* ---------- effects ---------- */
    burstSlice(e, p, def, angle) {
      const gl = Assets.get(def.spr);
      if (!gl) return;
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
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: rand(5, 14), color: e.crit ? "#ffd94d" : def.juice, born: this.now(), dur: rand(500, 900) });
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

    /* ---------- main loop ---------- */
    loop() {
      this._raf = requestAnimationFrame(this._loop);
      const nowT = this.now();
      const simT = this.simT();

      if (this.running) {
        // escalation arc: clean slicing early, chaos late
        const prog = clamp(simT / this.roundDur, 0, 1);
        if (simT >= this.nextNatural) {
          this.spawnNaturalFruit();
          if (Math.random() < lerp(0.05, 0.4, prog)) this.spawnNaturalFruit();
          this.nextNatural = simT + rand(1, 1.45) * lerp(1500, 750, prog);
        }
        if (simT >= this.nextBurst) {
          for (let i = 0; i < 3; i++) setTimeout(() => this.running && this.spawnNaturalFruit(), i * 150);
          this.nextBurst = simT + rand(1, 1.4) * lerp(11000, 5500, prog);
        }
        this.trails.forEach((tr) => {
          if (tr.count >= 3 && nowT - tr.lastSlice > 350) this.finalizeCombo(tr);
        });
        for (const e of this.entities) {
          if (!e.alive) continue;
          const p = this.posOf(e, simT);
          if (p && p.falling && p.y > this.H + 130) {
            e.alive = false;
            if (e.kind === "bomb") {
              this.stats.bombsDodged++;
            } else if (e.kind !== "trap") {
              this.score = Math.max(0, this.score - MISS_PENALTY);
              this.popups.push({ x: clamp(p.x, 80, W - 80), y: this.H - 120, text: "miss -" + MISS_PENALTY, color: "#9a938a", size: 30, born: nowT, dur: 700 });
              SFX.miss();
            }
          }
        }
        if (simT >= this.roundDur) this.endRound("time");
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
      const H = this.H;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      let sx = 0, sy = 0;
      if (nowT < this.shakeUntil) {
        const k = ((this.shakeUntil - nowT) / 500) * 18;
        sx = rand(-k, k); sy = rand(-k, k);
      }
      ctx.setTransform(this.scale, 0, 0, this.scale, sx * this.scale, sy * this.scale);

      // cream paper board
      ctx.fillStyle = "#f7efdf";
      ctx.fillRect(0, 0, W, H);
      if (!this._pat) this._pat = ctx.createPattern(speckles(), "repeat");
      ctx.fillStyle = this._pat;
      ctx.fillRect(0, 0, W, H);

      // entities
      for (const e of this.entities) {
        if (!e.alive) continue;
        const p = this.posOf(e, simT);
        if (!p || p.y > H + 140 || p.y < -160) continue;
        const def = KINDS[e.kind];
        const gl = Assets.get(def.spr);
        if (!gl) continue;
        const size = def.r * 2.3;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * 0.6);
        if (e.kind === "trap") {
          const pulse = 0.18 + 0.14 * Math.sin(nowT / 160);
          ctx.shadowColor = "rgba(170,80,255," + pulse.toFixed(2) + ")";
          ctx.shadowBlur = 30;
          if (Math.random() < 0.06) this.particles.push({ x: p.x + rand(-40, 40), y: p.y + rand(-40, 40), vx: rand(-30, 30), vy: rand(-60, 0), r: 5, color: "#d9a6ff", born: nowT, dur: 400 });
        }
        if (e.crit) {
          const pulse = 0.5 + 0.3 * Math.sin(nowT / 120);
          ctx.shadowColor = "rgba(240,168,33," + pulse.toFixed(2) + ")";
          ctx.shadowBlur = 38;
          if (Math.random() < 0.08) this.particles.push({ x: p.x + rand(-50, 50), y: p.y + rand(-50, 50), vx: rand(-20, 20), vy: rand(-70, -10), r: 4, color: "#f0a821", born: nowT, dur: 350 });
        }
        if (e.kind === "bomb" && Math.random() < 0.25) {
          this.particles.push({ x: p.x + 30, y: p.y - 44, vx: rand(-40, 40), vy: rand(-80, -10), r: 4, color: "#ffd94d", born: nowT, dur: 300 });
        }
        ctx.drawImage(gl.full, -size / 2, -size / 2, size, size);
        ctx.restore();
      }

      // pieces
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

      // blade trails: marker slash — wide red under, thin ink over
      this.trails.forEach((tr) => {
        const pts = tr.pts.filter((p) => nowT - p.t < 130);
        if (pts.length < 2) return;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 1; i < pts.length; i++) {
            const a = i / pts.length;
            if (pass === 0) {
              ctx.strokeStyle = "rgba(229,37,79," + (a * 0.8).toFixed(2) + ")";
              ctx.lineWidth = 6 + a * 18;
            } else {
              ctx.strokeStyle = "rgba(42,38,36," + (a * 0.85).toFixed(2) + ")";
              ctx.lineWidth = 2 + a * 5;
            }
            ctx.beginPath();
            ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
            ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        }
      });

      // popups: chunky, slightly crooked
      for (const pp of this.popups) {
        const k = (nowT - pp.born) / pp.dur;
        if (k >= 1) continue;
        if (pp.rot === undefined) pp.rot = rand(-0.09, 0.09);
        ctx.save();
        ctx.translate(pp.x, pp.y - k * 80);
        ctx.rotate(pp.rot);
        ctx.globalAlpha = 1 - k * k;
        ctx.font = pp.size + 'px "Luckiest Guy","Arial Black",sans-serif';
        ctx.textAlign = "center";
        ctx.lineWidth = Math.max(4, pp.size / 8);
        ctx.strokeStyle = "#f7efdf";
        ctx.strokeText(pp.text, 0, 0);
        ctx.fillStyle = pp.color;
        ctx.fillText(pp.text, 0, 0);
        ctx.restore();
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
        rg.addColorStop(0, "rgba(183,175,164," + (0.82 * a).toFixed(2) + ")");
        rg.addColorStop(1, "rgba(183,175,164,0)");
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      this.smokes = this.smokes.filter((s) => nowT - s.born < s.dur);

      // bomb flash
      if (nowT < this.flashUntil) {
        ctx.fillStyle = "rgba(255,255,255," + ((this.flashUntil - nowT) / 200 * 0.75).toFixed(2) + ")";
        ctx.fillRect(0, 0, W, H);
      }

      // rage stamp on heart loss
      if (this.stampUntil && nowT < this.stampUntil) {
        const left = this.stampUntil - nowT;
        const kIn = Math.min(1, (1500 - left) / 130);       // slams in
        const alpha = Math.min(1, left / 350);              // fades out
        ctx.save();
        ctx.translate(W / 2, H * 0.42);
        ctx.rotate(-0.1);
        const sc = 1.6 - 0.6 * kIn;
        ctx.scale(sc, sc);
        ctx.globalAlpha = alpha * kIn;
        ctx.font = '150px "Luckiest Guy","Arial Black",sans-serif';
        ctx.textAlign = "center";
        ctx.lineWidth = 18;
        ctx.strokeStyle = "#2a2624";
        ctx.strokeText("TIFFED", 0, -40);
        ctx.strokeText("OFF!", 0, 110);
        ctx.fillStyle = "#e5254f";
        ctx.fillText("TIFFED", 0, -40);
        ctx.fillText("OFF!", 0, 110);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  }

  window.Game = { Arena, W, ROUND_MS, HEARTS, FRUITS, KINDS };
})();
