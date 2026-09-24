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
  const FRUIT_SCORE = 5, FRUIT_COIN = 4;
  const CRIT_SCORE = 10, CRIT_COIN = 7, CRIT_CHANCE = 0.12;
  const APEX_PERFECT_VY = 150, APEX_PERFECT_MULT = 1.8;   // timing near the top of the arc, not spam, scores big
  const APEX_GREAT_VY = 380, APEX_GREAT_MULT = 1.3;
  const COMBO_BONUS = { 3: 15, 4: 25 };          // 5+ => 40 (score)
  // tuned so a combo pays for the weapon it should feel like it "buys": a bare ×3
  // (3 fruit @ 4 coin + this bonus) lands near $20, exactly the cheapest attack
  const COMBO_COIN = { 3: 8, 4: 14 };            // 5+ => 25 (coins — combos fund attacks)
  const MISS_PENALTY = 5, TRAP_PENALTY = 30;
  const HEART_PENALTY = [30, 50, 70];             // score cost of the 1st/2nd/3rd heart lost — gets worse as you get low
  const BOMB_BLAST = 260;
  const NATURAL_BOMB_CHANCE = [0.02, 0.16];      // [early, late] — ambient Fruit-Ninja-style risk, independent of attacks
  const DUD_CHANCE = 0.2;                         // ~1 in 5 ambient bombs is a dud — tap (don't swipe) to defuse for a bonus
  const DUD_SCORE = 10, DUD_COIN = 15, DUD_FIZZLE_PENALTY = 10;   // swiping a dud now costs you — tap it instead
  const TAP_MAX_MS = 220;
  const DUD_TAP_MOVE_TOLERANCE = 26;              // a touch this short/still is a tap, not a swipe (tuned separately from weapon aim)
  const BERRY_COIN = 8, BERRY_PERFECT_COIN = 12;  // the TIFF BERRY: a real strawberry is a high-value target… if it's real
  const GUST_CHAOS_MS = [10000, 10000, 11000, 8000];   // per tier — the signature is shorter but far denser
  const GUST_SHOVE = [140, 180, 220, 260];        // immediate sideways WHOOSH on everything already airborne
  const GUST_BOOST = [0, 0.15, 0.3, 0.6];         // extra spawn chance per tick while the gust blows

  /* ---------- TIFFED OFF: the one skill meter ----------
     Coins buy the attack; skill powers it. Only quality play builds the meter
     (GREAT/PERFECT, CLEAN combos, duds, clean defense); mistakes vent it and break
     the hidden streak; idling decays it. Attacking vents it by tier.
     All values are playtest placeholders. */
  const METER = {
    great: 2, perfect: 5, perfectBerry: 8,
    clean: { 3: 4, 4: 7 }, cleanMax: 10,          // CLEAN ×5+ => cleanMax
    dud: 8,
    dodgeBomb: 4, dodgeMajor: 8, dodgeFuming: 12, // surviving a sent attack without getting hit
    miss: 4, bomb: 20, fake: 12, fizzle: 6,       // losses (each also breaks the streak)
  };
  const METER_GRACE_MS = 2500, METER_DECAY_PER_S = 2.5;
  const STREAK_STEPS = [3, 7, 12];                // consecutive skill events => hidden gain multiplier
  const STREAK_MULT = [1, 1.25, 1.5, 1.75];
  const TIER_AT = [0, 40, 70, 100];
  const TIER_VENT = [0, 20, 33, 100];             // the 100% signature consumes the whole meter
  const TIER_NAMES = ["", "HEATED", "FUMING", "TIFFED OFF"];
  const tierOf = (m) => (m >= TIER_AT[3] ? 3 : m >= TIER_AT[2] ? 2 : m >= TIER_AT[1] ? 1 : 0);
  const PHASES = [{ at: 30000, name: "SABOTAGE" }, { at: 60000, name: "SURVIVE" }];

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
  KINDS.trap = { k: "trap", spr: "straw", juice: "#8c46c8", r: 58 }; // a fake — each one is disguised as some fruit (disguise)
  KINDS.dud  = { k: "dud",  spr: "bomb",  juice: "#5a5566", r: 66 }; // bomb-shaped, but a green fuse + tap ripple — TAP it

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
      this.onBurst = opts.onBurst || (() => {});   // combo landed — economy burst

      this.entities = [];  // {id,kind,crit,x0,y0,vx,vy,r0,vr,t0,alive}
      this.pieces = [];
      this.particles = [];
      this.popups = [];
      this.trails = new Map(); // pointerId -> {pts:[], count, lastSlice, swished}
      this.score = 0; this.hearts = HEARTS;
      this.resetStats();
      this.resetMeter();
      this.running = false;
      this.roundStart = 0; this.roundDur = ROUND_MS;
      this.nextNatural = 0; this.nextBurst = 0;
      this.nextId = 1;
      this.shakeUntil = 0; this.flashUntil = 0; this.stamp = null; this.windUntil = 0; this.windBoost = 0;
      this.freezeUntil = 0; this.freezeSimT = 0; this.slashFlashUntil = 0;
      this.phaseIdx = 0; this._lastLoopT = 0;
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

    resetStats() {
      this.stats = {
        fruit: 0, bestCombo: 0, bombsDodged: 0, perfects: 0, dudsDefused: 0,
        cleanCombos: 0, bombHits: 0, fakeHits: 0, dudFizzles: 0, attacksDodged: 0,
        meterPeak: 0, maxed: 0, bestStreak: 0, meterIntegral: 0, meterTime: 0,
      };
    }

    /* ---------- TIFFED OFF meter ---------- */
    resetMeter() {
      this.meter = 0; this.streak = 0; this.lastSkillT = 0;
      this.groups = new Map(); this.nextGroup = 1; this.gustGroup = null;
    }
    tier() { return tierOf(this.meter); }
    streakLevel() { let l = 0; STREAK_STEPS.forEach((n) => { if (this.streak >= n) l++; }); return l; }

    // a skill event: bumps the hidden streak, which scales how fast the meter fills
    gainMeter(base) {
      if (!this.running) return;
      this.streak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
      const before = this.meter;
      this.meter = Math.min(100, this.meter + base * STREAK_MULT[this.streakLevel()]);
      this.lastSkillT = this.now();
      this.meterMoved(before);
    }
    // a mistake vents meter and breaks the streak
    loseMeter(n) {
      this.streak = 0;
      this.meter = Math.max(0, this.meter - n);
    }
    // attacking vents by tier — the streak survives, you earned that
    vent(tier) {
      this.meter = tier >= 3 ? 0 : Math.max(0, this.meter - TIER_VENT[tier]);
    }
    meterMoved(before) {
      this.stats.meterPeak = Math.max(this.stats.meterPeak, this.meter);
      const t0 = tierOf(before), t1 = tierOf(this.meter);
      if (t1 <= t0) return;
      if (t1 === 3) {
        this.stats.maxed++;
        this.stamp = { lines: ["TIFFED", "OFF!"], fill: "#e5254f", until: this.now() + 900, dur: 900 };
        vib([20, 40, 20, 40, 30]);
        SFX.maxed();
      } else SFX.tierUp(t1);
    }

    /* ---------- round control ---------- */
    startRound(dur) {
      this.entities = []; this.pieces = []; this.particles = [];
      this.popups = [];
      this.score = 0; this.hearts = HEARTS;
      this.resetStats();
      this.resetMeter();
      this.windUntil = 0; this.windBoost = 0; this.stamp = null;
      this.phaseIdx = 0; this._lastLoopT = 0;
      this.seenKinds = new Set();
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
    // sprite + hit radius live on the entity, so a fake can wear any fruit's skin
    decorate(e, disguise) {
      const look = KINDS[disguise || e.kind];
      e.spr = look.spr; e.r = look.r;
      return e;
    }

    spawn(kind, x0, vx, apexFrac, delayMs, crit, disguise) {
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
      this.decorate(e, disguise);
      this.entities.push(e);
      return e;
    }

    randomFruit() { return FRUITS[(Math.random() * FRUITS.length) | 0].k; }
    ambientBomb() { return Math.random() < DUD_CHANCE ? "dud" : "bomb"; }

    spawnNatural(prog) {
      // ambient Fruit-Ninja-style risk: a fraction of "normal" spawns are just bombs,
      // independent of anything either player bought — rate climbs with the match arc.
      // A slice of those bombs are secretly duds (safe — tap to defuse for a bonus).
      const isBomb = Math.random() < lerp(NATURAL_BOMB_CHANCE[0], NATURAL_BOMB_CHANCE[1], prog);
      const kind = isBomb ? this.ambientBomb() : this.randomFruit();
      const crit = !isBomb && Math.random() < CRIT_CHANCE;
      if (this.windUntil && this.simT() < this.windUntil) { this.spawnChaos(kind, crit); return; }
      const x0 = rand(120, W - 120);
      const vx = (W / 2 - x0) * rand(0.08, 0.22) + rand(-60, 60);
      this.spawn(kind, x0, vx, rand(0.1, 0.36), 0, crit);
    }

    // authored skill patterns: small readable set pieces that reward precision and
    // timing reads over raw swipe speed (they replace some of the random bursts)
    spawnPattern(prog) {
      const pick = ["sandwich", "timing", "crossing", "split"][(Math.random() * 4) | 0];
      if (pick === "sandwich") {
        // fruit / bomb / fruit, tight together — cut around the middle
        const x = rand(260, 740), vx = rand(-40, 40), apex = rand(0.16, 0.3);
        this.spawn(this.randomFruit(), x - 150, vx, apex, 0);
        this.spawn(this.ambientBomb(), x, vx, apex, 0);
        this.spawn(this.randomFruit(), x + 150, vx, apex, 0);
      } else if (pick === "timing") {
        // three fruit with offset apexes — PERFECT all three with three deliberate cuts
        const dir = Math.random() < 0.5 ? 1 : -1;
        [0, 1, 2].forEach((i) => this.spawn(this.randomFruit(), 500 + dir * (i - 1) * 260, 0, 0.2, i * 380));
      } else if (pick === "crossing") {
        // two fruit crossing paths — read the trajectory, don't scribble
        const apex = rand(0.18, 0.28);
        this.spawn(this.randomFruit(), 170, 310, apex, 0);
        this.spawn(this.randomFruit(), 830, -310, apex, 0);
        if (prog > 0.35) this.spawn("bomb", 500, rand(-30, 30), apex + 0.1, 260);
      } else {
        // high / low split — two separate timed gestures
        const left = Math.random() < 0.5;
        this.spawn(this.randomFruit(), left ? 280 : 720, 0, 0.12, 0);
        this.spawn(this.randomFruit(), left ? 720 : 280, 0, 0.48, 0);
      }
    }

    // during a gust window, entries come from any of the 4 edges instead of always
    // rising from the bottom — some (top-drops) have no apex to time at all, others
    // (side-arcs) have one but it reads nothing like the familiar bottom-up parabola
    spawnChaos(kind, crit) {
      const edge = (Math.random() * 4) | 0;
      if (edge === 0) {
        const x0 = rand(120, W - 120);
        const vx = (W / 2 - x0) * rand(0.08, 0.22) + rand(-60, 60);
        this.spawn(kind, x0, vx, rand(0.1, 0.36), 0, crit);
        return;
      }
      const e = {
        id: this.nextId++, kind, crit: !!crit,
        r0: rand(-0.6, 0.6), vr: rand(-2.2, 2.2), t0: this.simT(), alive: true,
      };
      if (edge === 1) {              // top: already falling on entry — pure reflex, no apex to chase
        e.x0 = rand(140, W - 140); e.y0 = -70;
        e.vx = rand(-90, 90); e.vy = rand(260, 520);
      } else if (edge === 2) {       // left: fast sideways arc
        e.x0 = -70; e.y0 = rand(0.15, 0.75) * this.H;
        e.vx = rand(520, 780); e.vy = -rand(260, 520);
      } else {                       // right: fast sideways arc
        e.x0 = W + 70; e.y0 = rand(0.15, 0.75) * this.H;
        e.vx = -rand(520, 780); e.vy = -rand(260, 520);
      }
      this.decorate(e);
      this.entities.push(e);
    }

    // an attack lands on THIS board (after its short randomized fuse). Everything it
    // spawns is tagged with a group, so surviving it cleanly can be rewarded (onGroupDone).
    handleSend(w, aimX, tier) {
      if (!this.running) return;
      tier = tier | 0;
      const ax = clamp(aimX || rand(150, W - 150), 80, W - 80);
      const axc = clamp(ax, 290, W - 290);            // authored shapes need room either side
      const gid = this.nextGroup++;
      const g = { w, tier, left: 0, failed: false };
      const tag = (e) => { e.g = gid; g.left++; return e; };
      if (w === "bomb") {
        if (tier === 0) {
          // scattered and staggered, not one dramatic launch — reads like ambient bad luck
          const n = 2 + (Math.random() < 0.4 ? 1 : 0);
          for (let i = 0; i < n; i++) tag(this.spawn("bomb", ax + rand(-220, 220), rand(-60, 60), rand(0.1, 0.34), rand(0, 550)));
        } else if (tier === 1) {
          // one more bomb, tighter around the sender's aim
          for (let i = 0; i < 3; i++) tag(this.spawn("bomb", ax + rand(-150, 150), rand(-40, 40), rand(0.12, 0.32), rand(0, 450)));
        } else if (tier === 2) {
          // staggered wall with a bait fruit in a gap — authored pressure
          [-190, 0, 190].forEach((dx, i) => tag(this.spawn("bomb", axc + dx, rand(-20, 20), 0.24, i * 220)));
          tag(this.spawn(this.randomFruit(), axc + (Math.random() < 0.5 ? -95 : 95), 0, 0.17, 110));
        } else {
          // signature BOMB CROWN: a V of bombs around a golden fruit at the top, plus a
          // late riser under it — hard, but a precise cut through the gap is clean
          [[-240, 0.4], [-115, 0.27], [115, 0.27], [240, 0.4]].forEach(([dx, ap], i) =>
            tag(this.spawn("bomb", axc + dx, 0, ap, i * 60)));
          tag(this.spawn(this.randomFruit(), axc, 0, 0.12, 120, true));
          tag(this.spawn("bomb", axc, 0, 0.3, 650));
        }
      } else if (w === "trap") {
        if (tier === 3) {
          // signature STRAWBERRY PATCH: real TIFF BERRIES everywhere, one of them is fake.
          // The usual purple tell still exists — a calm player finds it.
          const n = 5, fakeSlot = (Math.random() * n) | 0;
          for (let i = 0; i < n; i++) {
            const x = 150 + i * 175 + rand(-30, 30), ap = rand(0.14, 0.32), d = rand(0, 600);
            tag(i === fakeSlot ? this.spawn("trap", x, rand(-30, 30), ap, d, false, "straw") : this.spawn("straw", x, rand(-30, 30), ap, d));
          }
        } else {
          // a fake can wear any fruit; higher tiers surround it with real ones of the same kind
          const look = this.randomFruit();
          const ap = rand(0.14, 0.3), x = axc + rand(-30, 30);
          tag(this.spawn("trap", x, rand(-40, 40), ap, 0, false, look));
          const decoys = tier === 2 ? [-140, 140] : tier === 1 ? [Math.random() < 0.5 ? -140 : 140] : [];
          decoys.forEach((dx) => tag(this.spawn(look, x + dx, rand(-40, 40), ap + rand(-0.05, 0.05), rand(0, 180))));
        }
      } else if (w === "flood") {
        if (tier === 3) {
          // signature GAUNTLET: a sweep of fruit riding high with bombs peaking lower
          // between them — the clean route is one confident cut along the top
          for (let i = 0; i < 10; i++) {
            const x = 120 + i * 84, bomb = i === 2 || i === 5 || i === 8;
            tag(this.spawn(bomb ? "bomb" : this.randomFruit(), x, 0, bomb ? 0.46 : 0.13, i * 110));
          }
        } else {
          // tempting, not a gift: real fruit AND real bombs hidden in the same burst.
          // HEATED is longer; FUMING alternates sides and slips a dud in to classify.
          const n = [6, 8, 9][tier], bombCount = tier === 0 ? 1 + (Math.random() < 0.5 ? 1 : 0) : 2;
          const slots = new Set();
          while (slots.size < bombCount + (tier === 2 ? 1 : 0)) slots.add((Math.random() * n) | 0);
          const special = [...slots];
          const cadence = [130, 120, 110][tier];
          for (let i = 0; i < n; i++) {
            const x0 = tier === 2 ? (i % 2 ? rand(560, 880) : rand(120, 440)) : rand(100, W - 100);
            const vx = rand(-90, 90), apexFrac = rand(0.1, 0.36), delay = i * cadence;
            const si = special.indexOf(i);
            const kind = si < 0 ? this.randomFruit() : si < bombCount ? "bomb" : "dud";
            tag(this.spawn(kind, x0, vx, apexFrac, delay));   // flood fruit never crit
          }
        }
      } else if (w === "gust") {
        // immediate WHOOSH: everything already airborne gets shoved sideways, then the
        // chaos window starts (x = x0 + vx·t stays closed-form: re-base x0 for the new vx)
        const simT = this.simT(), dv = GUST_SHOVE[tier] * (Math.random() < 0.5 ? -1 : 1);
        for (const e of this.entities) {
          if (!e.alive) continue;
          const dt = (simT - e.t0) / 1000;
          if (dt > 0) { e.x0 -= dv * dt; e.vx += dv; }
        }
        for (let i = 0; i < 16; i++) {
          const y = rand(0, this.H);
          this.particles.push({ streak: true, x: dv > 0 ? -20 : W + 20, y, dx: dv > 0 ? 1 : -1, dy: 0, speed: rand(900, 1300), len: rand(60, 120), color: "rgba(95,135,168,.55)", born: this.now(), dur: rand(500, 800) });
        }
        this.windUntil = simT + GUST_CHAOS_MS[tier];
        this.windBoost = GUST_BOOST[tier];
        this.gustGroup = g;
        if (tier === 3) for (let i = 0; i < 3; i++) this.spawnChaos(this.randomFruit(), false);
        vib([15, 40, 15, 40, 15]);
        SFX.gust();
        return;
      }
      this.groups.set(gid, g);
    }

    // an entity from a sent attack left play; when a whole attack resolves without
    // it ever hurting you, that composure earns meter and gets called out by name
    resolve(e, failed) {
      if (!e.g) return;
      const g = this.groups.get(e.g);
      if (!g) return;
      if (failed) g.failed = true;
      if (--g.left <= 0) { this.groups.delete(e.g); this.groupDone(g); }
    }
    groupDone(g) {
      if (g.failed || !this.running) return;
      const major = g.w !== "bomb";
      this.gainMeter(!major ? (g.tier >= 2 ? METER.dodgeFuming : METER.dodgeBomb) : (g.tier >= 2 ? METER.dodgeFuming : METER.dodgeMajor));
      this.stats.attacksDodged++;
      if (major || g.tier) {
        this.popups.push({ x: W / 2, y: this.H * 0.24, text: "DODGED!", color: "#3f9b4f", size: 40, born: this.now(), dur: 700 });
        SFX.dodge();
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
        try { this.canvas.setPointerCapture && this.canvas.setPointerCapture(ev.pointerId); } catch (err) {}
        this.trails.set(ev.pointerId, { pts: [], count: 0, clean: true, lastSlice: 0, swished: 0 });
        this.addTrailPoint(ev);
      };
      const move = (ev) => { if (this.trails.has(ev.pointerId)) this.addTrailPoint(ev); };
      const up = (ev) => {
        const tr = this.trails.get(ev.pointerId);
        if (tr) {
          // a touch this short and this still is a tap, not a swipe — try to defuse a dud there
          const first = tr.pts[0];
          if (first && this.running) {
            const rel = this.clientToWorld(ev.clientX, ev.clientY);
            const dt = this.now() - first.t;
            const dist = Math.hypot(rel.x - first.x, rel.y - first.y);
            if (dt < TAP_MAX_MS && dist < DUD_TAP_MOVE_TOLERANCE) this.tryDefuse(rel);
          }
          this.finalizeCombo(tr);
        }
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
        if (this.segCircle(a, b, p.x, p.y, e.r + 14)) {
          e.alive = false;
          if (e.kind === "bomb") { this.hitBomb(e, p, simT); return; }
          if (e.kind === "trap") { this.hitTrap(e, p); continue; }
          if (e.kind === "dud") { this.fizzleDud(e, p); continue; }
          this.resolve(e, false);
          // score rewards timing, not just contact: slice near the apex (low vertical speed)
          // for a big bonus, so nonstop spam-swiping stops being the optimal strategy
          const dt = (simT - e.t0) / 1000;
          const vyNow = Math.abs(e.vy + G * dt);
          let tier = null, mult = 1;
          if (vyNow < APEX_PERFECT_VY) { tier = "PERFECT"; mult = APEX_PERFECT_MULT; this.stats.perfects++; }
          else if (vyNow < APEX_GREAT_VY) { tier = "GREAT"; mult = APEX_GREAT_MULT; }
          const berry = e.kind === "straw";
          const base = e.crit ? CRIT_SCORE : FRUIT_SCORE;
          const pts = Math.round(base * mult);
          // the TIFF BERRY pays big — which is exactly what makes a fake one work
          const coin = berry ? (tier === "PERFECT" ? BERRY_PERFECT_COIN : BERRY_COIN) : (e.crit ? CRIT_COIN : FRUIT_COIN);
          this.score += pts;
          this.stats.fruit++;
          this.onCoin(coin);
          this.burstSlice(e, p, KINDS[e.kind], angle, tier === "PERFECT");
          // only quality cuts build TIFFED OFF; a plain slice keeps the streak alive but adds nothing
          if (tier === "PERFECT") this.gainMeter(berry ? METER.perfectBerry : METER.perfect);
          else if (tier === "GREAT") this.gainMeter(METER.great);
          else tr.clean = false;
          // text is a quick glance, not a read: only PERFECT gets a word (the streak shows as !s)
          const lvl = this.streakLevel();
          if (tier === "PERFECT") this.popups.push({ x: p.x, y: p.y, text: "PERFECT" + "!".repeat(1 + lvl), color: "#3f9b4f", size: 44 + lvl * 5, born: this.now(), dur: 550 });
          tr.count++; tr.lastSlice = this.now();
          if (berry) SFX.straw(); else SFX.splat();
          if (tier === "PERFECT") {
            // PERFECT should land like a headshot: micro hit-stop, bright slash, sting
            this.freezeSimT = simT; this.freezeUntil = this.now() + 45;
            this.slashFlashUntil = this.now() + 140;
            vib([18, 20, 12]);
            SFX.perfect(lvl);
          } else {
            vib(tier === "GREAT" ? 10 : 8);
            if (e.crit) SFX.coin();
          }
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

    // taps (not swipes) hunt for a dud at the touch point — see the `up` handler
    tryDefuse(pos) {
      const simT = this.simT();
      for (const e of this.entities) {
        if (!e.alive || e.kind !== "dud") continue;
        const p = this.posOf(e, simT);
        if (!p) continue;
        if (Math.hypot(pos.x - p.x, pos.y - p.y) <= KINDS.dud.r + 20) {
          e.alive = false;
          this.resolve(e, false);
          this.hitDud(p);
          return;
        }
      }
    }

    hitDud(p) {
      this.score += DUD_SCORE;
      this.stats.dudsDefused++;
      this.onCoin(DUD_COIN);
      this.gainMeter(METER.dud);
      for (let i = 0; i < 16; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(80, 380);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, r: rand(5, 12), color: "#6fcf7d", born: this.now(), dur: rand(450, 800) });
      }
      this.popups.push({ x: p.x, y: p.y, text: "DEFUSED!", color: "#3f9b4f", size: 40, born: this.now(), dur: 600 });
      vib([10, 30, 10]);
      SFX.defuse();
    }

    // swiping a dud is no longer free: it fizzles in your face — small score hit, vents
    // meter, breaks the streak. It's a TAP target, and it tells you so (green fuse + ripple).
    fizzleDud(e, p) {
      this.resolve(e, false);
      this.score = Math.max(0, this.score - DUD_FIZZLE_PENALTY);
      this.stats.dudFizzles++;
      this.loseMeter(METER.fizzle);
      this.burstPoof(p);
      this.popups.push({ x: p.x, y: p.y, text: "TAP IT!", color: "#9a938a", size: 30, born: this.now(), dur: 600 });
      vib(12);
      SFX.fizzle();
    }

    hitBomb(e, p, simT) {
      this.hearts--;
      const heartsLost = HEARTS - this.hearts;
      const penalty = HEART_PENALTY[heartsLost - 1] || HEART_PENALTY[HEART_PENALTY.length - 1];
      this.score = Math.max(0, this.score - penalty);
      this.stats.bombHits++;
      this.loseMeter(METER.bomb);
      this.resolve(e, true);
      if (this.gustGroup) this.gustGroup.failed = true;
      for (const o of this.entities) {
        if (!o.alive || o === e) continue;
        const op = this.posOf(o, simT);
        if (op && Math.hypot(op.x - p.x, op.y - p.y) < BOMB_BLAST) {
          o.alive = false; this.burstPoof(op); this.resolve(o, false);
        }
      }
      this.burstBoom(p);
      this.shakeUntil = this.now() + 500;
      this.flashUntil = this.now() + 200;
      this.trails.forEach((tr) => { tr.count = 0; tr.clean = true; });
      this.stamp = { lines: ["BOOM!"], fill: "#f5920f", until: this.now() + 800, dur: 800 };
      vib([40, 60, 40]);
      SFX.boom(); SFX.heart();
      this.onEvent({ t: "hurt", hearts: this.hearts });
      if (this.hearts <= 0) this.endRound("ko");
    }

    hitTrap(e, p) {
      this.score = Math.max(0, this.score - TRAP_PENALTY);
      this.stats.fakeHits++;
      this.loseMeter(METER.fake);
      this.resolve(e, true);
      this.burstTrap(p);
      // the fruit pops… a beat… then the purple GOTCHA
      this.freezeSimT = this.simT(); this.freezeUntil = this.now() + 110;
      this.popups.push({ x: p.x, y: p.y, text: "GOTCHA!", color: "#8c46c8", size: 50, born: this.now() + 90, dur: 700 });
      this.flashUntil = this.now() + 160; this.flashColor = "140,70,200";
      vib([20, 60, 30]);
      SFX.trap();
      // the coin steal itself happens in main.js (it needs the Deck, which Arena
      // doesn't know about) — this just hands over where to draw its popup
      this.onEvent({ t: "trap", x: p.x, y: p.y });
    }

    finalizeCombo(tr) {
      if (tr.count >= 3) {
        // CLEAN: every cut in the combo was GREAT or PERFECT — that's what builds the meter.
        // A dirty combo still pays its basic score/cash.
        const clean = tr.clean;
        const bonus = COMBO_BONUS[tr.count] || 40;
        const coins = (COMBO_COIN[tr.count] || 15) + (clean ? 5 : 0);   // combos bankroll your next attack
        this.score += bonus;
        this.onCoin(coins);
        this.onBurst(tr.count);
        this.stats.bestCombo = Math.max(this.stats.bestCombo, tr.count);
        if (clean) { this.stats.cleanCombos++; this.gainMeter(METER.clean[tr.count] || METER.cleanMax); }
        this.popups.push({ x: W / 2, y: this.H * 0.3, text: (clean ? "CLEAN ×" : "×") + tr.count, color: clean ? "#3f9b4f" : "#e5254f", size: 52, born: this.now(), dur: 700 });
        SFX.combo(tr.count);
      }
      tr.count = 0; tr.clean = true;
    }

    /* ---------- effects ---------- */
    burstSlice(e, p, def, angle, big) {
      const gl = Assets.get(e.spr);
      if (!gl) return;
      const nx = Math.sin(angle), ny = -Math.cos(angle);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        this.pieces.push({
          img: gl.halves[i], x: p.x, y: p.y,
          vx: e.vx * 0.5 + nx * s * 220 + rand(-40, 40),
          vy: -150 + ny * s * 220,
          rot: p.rot + (angle - Math.PI / 2), vr: s * rand(2, 5),
          size: e.r * 2.3, born: this.now(),
        });
      }
      for (let i = 0; i < (big ? 26 : 14); i++) {
        const a = rand(0, Math.PI * 2), sp = rand(60, big ? 620 : 420);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: rand(5, big ? 17 : 14), color: e.crit ? "#ffd94d" : def.juice, born: this.now(), dur: rand(500, 900) });
      }
      if (big) this.particles.push({ ring: true, x: p.x, y: p.y, r: 20, color: "#3f9b4f", born: this.now(), dur: 300 });
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
      const frameDt = this._lastLoopT ? Math.min(100, nowT - this._lastLoopT) : 0;
      this._lastLoopT = nowT;

      if (this.running) {
        // escalation arc: clean slicing early, chaos late
        const prog = clamp(simT / this.roundDur, 0, 1);
        const gusting = this.windUntil && simT < this.windUntil;
        if (simT >= this.nextNatural) {
          this.spawnNatural(prog);
          if (Math.random() < lerp(0.05, 0.4, prog) + (gusting ? this.windBoost : 0)) this.spawnNatural(prog);
          this.nextNatural = simT + rand(1, 1.45) * lerp(1500, 750, prog);
        }
        if (simT >= this.nextBurst) {
          // after the opening, most bursts are authored skill patterns instead of random triples
          if (simT > 8000 && !gusting && Math.random() < 0.7) this.spawnPattern(prog);
          else for (let i = 0; i < 3; i++) setTimeout(() => this.running && this.spawnNatural(prog), i * 150);
          this.nextBurst = simT + rand(1, 1.4) * lerp(9000, 4500, prog);
        }
        // a gust you got through without losing a heart counts as a clean defense
        if (this.gustGroup && !gusting) { const g = this.gustGroup; this.gustGroup = null; this.groupDone(g); }

        // TIFFED OFF decays after a short grace with no skill events, and the streak goes cold
        if (nowT - this.lastSkillT > METER_GRACE_MS) {
          this.streak = 0;
          this.meter = Math.max(0, this.meter - METER_DECAY_PER_S * frameDt / 1000);
        }
        this.stats.meterIntegral += this.meter * frameDt;
        this.stats.meterTime += frameDt;

        // SLICE → SABOTAGE → SURVIVE: surface the match arc
        if (this.phaseIdx < PHASES.length && simT >= PHASES[this.phaseIdx].at) {
          this.onEvent({ t: "phase", name: PHASES[this.phaseIdx].name, n: this.phaseIdx + 2 });
          this.phaseIdx++;
        }
        // gust window: a steady trickle of streaks entering from all 4 edges, so the
        // "stuff can come from anywhere right now" state reads clearly the whole time
        if (this.windUntil && simT < this.windUntil && Math.random() < 0.35) {
          const edge = (Math.random() * 4) | 0;
          let x, y, dx, dy;
          if (edge === 0) { x = rand(0, W); y = this.H + 20; dx = rand(-0.3, 0.3); dy = -1; }
          else if (edge === 1) { x = rand(0, W); y = -20; dx = rand(-0.3, 0.3); dy = 1; }
          else if (edge === 2) { x = -20; y = rand(0, this.H); dx = 1; dy = rand(-0.3, 0.3); }
          else { x = W + 20; y = rand(0, this.H); dx = -1; dy = rand(-0.3, 0.3); }
          this.particles.push({ streak: true, x, y, dx, dy, speed: rand(500, 850), len: rand(40, 90), color: "rgba(95,135,168,.5)", born: nowT, dur: rand(500, 900) });
        }
        this.trails.forEach((tr) => {
          if (tr.count >= 3 && nowT - tr.lastSlice > 350) this.finalizeCombo(tr);
        });
        for (const e of this.entities) {
          if (!e.alive) continue;
          const p = this.posOf(e, simT);
          // first bomb / dud / fake of the round to come into view — main.js hangs beginner tips on it
          if (p && !e.seen && p.y < this.H - 60 && p.x > 0 && p.x < W) {
            e.seen = true;
            if ((e.kind === "bomb" || e.kind === "dud" || e.kind === "trap") && !this.seenKinds.has(e.kind)) {
              this.seenKinds.add(e.kind);
              this.onEvent({ t: "seen", kind: e.kind });
            }
          }
          if (p && p.falling && p.y > this.H + 130) {
            e.alive = false;
            if (e.kind === "bomb") {
              this.stats.bombsDodged++;
            } else if (e.kind === "trap" || e.kind === "dud") {
              // falling past is free — a fake only hurts if you cut it, and a dud was never dangerous
            } else {
              this.score = Math.max(0, this.score - MISS_PENALTY);
              this.loseMeter(METER.miss);
              SFX.miss();
            }
            this.resolve(e, false);
          }
        }
        if (simT >= this.roundDur) this.endRound("time");
      }

      if (this.entities.length > 90) this.entities = this.entities.filter((e) => e.alive || nowT - e.t0 < 30000);

      // PERFECT / GOTCHA hit-stop: the picture holds for a beat (the sim clock keeps going,
      // so boards never drift — the world just catches up when the freeze lifts)
      this.draw(nowT, nowT < this.freezeUntil ? this.freezeSimT : simT);

      if (nowT - this.lastState > 100) {
        this.lastState = nowT;
        this.onState({
          score: this.score, hearts: this.hearts, left: Math.max(0, this.roundDur - simT), dur: this.roundDur, elapsed: simT, running: this.running,
          meter: this.meter, tier: this.tier(), streak: this.streakLevel(),
        });
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

      // final 10 seconds: a huge faint countdown behind the play
      const left = this.roundDur - this.simT();
      if (this.running && left <= 10000 && left > 0) {
        const n = Math.ceil(left / 1000), frac = (left % 1000) / 1000;
        ctx.save();
        ctx.translate(W / 2, H * 0.52);
        const sc = 1 + 0.15 * frac;
        ctx.scale(sc, sc);
        ctx.globalAlpha = 0.1 + 0.08 * frac;
        ctx.font = '460px "Luckiest Guy","Arial Black",sans-serif';
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#e5254f";
        ctx.fillText(String(n), 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // entities
      for (const e of this.entities) {
        if (!e.alive) continue;
        const p = this.posOf(e, simT);
        if (!p || p.y > H + 140 || p.y < -160) continue;
        const gl = Assets.get(e.spr);
        if (!gl) continue;
        const size = e.r * 2.3;
        if (e.kind === "dud") {
          // TAP cue: a dashed green ring that ripples outward like a finger-press
          const ph = (nowT % 900) / 900;
          ctx.save();
          ctx.strokeStyle = "rgba(63,155,79," + (0.85 * (1 - ph)).toFixed(2) + ")";
          ctx.lineWidth = 5;
          ctx.setLineDash([12, 10]);
          ctx.beginPath(); ctx.arc(p.x, p.y, e.r + 10 + ph * 34, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
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
        if (e.kind === "dud") {
          const pulse = 0.4 + 0.2 * Math.sin(nowT / 180);
          ctx.shadowColor = "rgba(63,155,79," + pulse.toFixed(2) + ")";
          ctx.shadowBlur = 30;
          if (Math.random() < 0.08) this.particles.push({ x: p.x + rand(-36, 36), y: p.y + rand(-36, 36), vx: rand(-25, 25), vy: rand(-55, -5), r: 4, color: "#6fcf7d", born: nowT, dur: 380 });
        }
        // fuse sparks: yellow on a live bomb, green on a dud
        if ((e.kind === "bomb" || e.kind === "dud") && Math.random() < 0.3) {
          this.particles.push({ x: p.x + 30, y: p.y - 44, vx: rand(-40, 40), vy: rand(-80, -10), r: e.kind === "dud" ? 5 : 4, color: e.kind === "dud" ? "#6fcf7d" : "#ffd94d", born: nowT, dur: 300 });
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
        } else if (pt.streak) {
          const x = pt.x + pt.dx * pt.speed * age, y = pt.y + pt.dy * pt.speed * age;
          ctx.strokeStyle = pt.color; ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - pt.dx * pt.len, y - pt.dy * pt.len);
          ctx.stroke();
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
        const hot = nowT < this.slashFlashUntil;   // a PERFECT brightens the blade
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 1; i < pts.length; i++) {
            const a = i / pts.length;
            if (pass === 0) {
              ctx.strokeStyle = (hot ? "rgba(240,168,33," : "rgba(229,37,79,") + (a * 0.8).toFixed(2) + ")";
              ctx.lineWidth = (hot ? 10 : 6) + a * (hot ? 26 : 18);
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
        if (k >= 1 || k < 0) continue;
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

      // gust window: a steady border frame for the whole duration, so "chaos entries are
      // active" stays legible at a glance without needing a running countdown readout
      if (this.windUntil && simT < this.windUntil) {
        const pulse = 0.4 + 0.15 * Math.sin(nowT / 220);
        ctx.strokeStyle = "rgba(95,135,168," + pulse.toFixed(2) + ")";
        ctx.lineWidth = 14;
        ctx.strokeRect(7, 7, W - 14, H - 14);
      }

      // bomb flash (white) / fake flash (purple)
      if (nowT < this.flashUntil) {
        ctx.fillStyle = "rgba(" + (this.flashColor || "255,255,255") + "," + ((this.flashUntil - nowT) / 200 * 0.75).toFixed(2) + ")";
        ctx.fillRect(0, 0, W, H);
      } else this.flashColor = null;

      // slam stamp: BOOM! on a heart loss, TIFFED OFF! when the meter maxes
      const st = this.stamp;
      if (st && nowT < st.until) {
        const left = st.until - nowT;
        const kIn = Math.min(1, (st.dur - left) / 130);     // slams in
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
        const y0 = st.lines.length > 1 ? -40 : 40;
        st.lines.forEach((ln, i) => ctx.strokeText(ln, 0, y0 + i * 150));
        ctx.fillStyle = st.fill;
        st.lines.forEach((ln, i) => ctx.fillText(ln, 0, y0 + i * 150));
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  }

  window.Game = { Arena, W, ROUND_MS, HEARTS, HEART_PENALTY, FRUITS, KINDS, tierOf, TIER_VENT, TIER_NAMES };
})();
