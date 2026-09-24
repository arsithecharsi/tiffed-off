/* TIFFED OFF! — app flow: poster, lobby, simultaneous PvP match, decks. */
(function () {
  const $ = (id) => document.getElementById(id);
  const { Arena, ROUND_MS, HEARTS, HEART_PENALTY, tierOf, TIER_VENT, TIER_NAMES } = Game;

  /* ---------- weapons ---------- */
  // every weapon is offensive now — defense is dodging skill, not a purchase.
  // bomb is deliberately cheap/fast/silent: it should feel like ambient Fruit Ninja
  // danger, not a menu-driven event you can plan around.
  const WEAPONS = [
    { id: "bomb",  icon: "bomb", n: "BOMB", cost: 20, cd: 1800,  aim: true },
    { id: "trap",  icon: "fake", n: "FAKE", cost: 45, cd: 4500,  aim: true },
    { id: "flood", icon: "rush", n: "RUSH", cost: 50, cd: 9000,  aim: false },
    { id: "gust",  icon: "gust", n: "GUST", cost: 55, cd: 14000, aim: false },
  ];
  const START_COINS = 40, HEART_BOUNTY = 15, TRAP_STEAL_PCT = 0.20;
  const FUSE_MIN = 500, FUSE_MAX = 2000;
  const BOMB_FUSE_MIN = 250, BOMB_FUSE_MAX = 650;   // short and quiet — no time to consciously plan around it
  const WEAPON_AIM_DRAG_THRESHOLD = 26;             // a drag this far on a weapon button is an aim flick, not a press
  // repeat fatigue (Bomb only for this playtest): back-to-back bombs inside the window
  // get pricier; a short break or firing any other weapon resets it
  const BOMB_FATIGUE_PRICES = [20, 25, 32], BOMB_FATIGUE_MS = 6000;
  const PLAYTEST_LOG_MAX = 60;

  // incoming-attack banner: just the attack's name — a glance, not a read.
  // Fakes don't name what they are ("GIFT…") — that's the whole trick.
  const SIGNATURES = { bomb: "BOMB CROWN!", trap: "STRAWBERRY PATCH!", flood: "GAUNTLET!", gust: "CATEGORY 5!" };
  const BASE_NAMES = { bomb: "BOMB!", trap: "GIFT…", flood: "RUSH!", gust: "GUST!" };
  const attackName = (w, t) => (t === 3 ? SIGNATURES[w] : (t ? TIER_NAMES[t] + " " : "") + BASE_NAMES[w]);
  // no banner for ordinary bombs — they should feel like bad luck, not a telegraphed
  // event. The 100% signature bomb is the exception: that one you're meant to see coming.
  const isSilent = (w, tier) => w === "bomb" && tier < 3;
  const KO_LINES = [
    (w, l) => l + " GOT COOKED BY " + w,
    (w, l) => w + " BLEW " + l + " SKY HIGH",
    (w, l) => l + " SLICED ONE BOMB TOO MANY",
  ];

  /* ---------- state ---------- */
  const S = {
    mode: null, isHost: false,
    myName: "", theirName: "", p2Name: "",
    match: null,
    myReady: false, theirReady: false,
    reconnecting: false,
  };

  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(id).classList.add("active");
  }
  function toast(text, ms) {
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = text;
    $("toasts").appendChild(el);
    setTimeout(() => el.remove(), ms || 2200);
  }
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  const heartsHtml = (n) => {
    let h = "";
    for (let i = 0; i < HEARTS; i++) h += Assets.icon("heart", 14, i < n ? "#e5254f" : "#d9cfc0");
    return h;
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  /* ---------- names & poster ---------- */
  $("my-name").value = Store.get("ss_name") || "";
  $("p2-name").value = Store.get("ss_p2name") || "";
  function myName() { return ($("my-name").value.trim() || "Player 1").slice(0, 12); }
  function p2Name() { return ($("p2-name").value.trim() || "Player 2").slice(0, 12); }

  function paintPoster() {
    const a = Store.get("ss_name"), b = Store.get("ss_p2name") || Store.get("ss_lastopp");
    $("poster-vs").innerHTML = a && b
      ? esc(a.toUpperCase()) + " <span>vs</span> " + esc(b.toUpperCase())
      : "YOU <span>vs</span> YOUR FAVE";
  }
  Assets.ready.then(() => {
    $("poster-art").innerHTML =
      '<span class="half-l">' + Assets.icon("strawhalf", 110) + "</span>" +
      '<span class="half-r">' + Assets.icon("strawhalf2", 110) + "</span>" +
      '<span class="pbomb">' + Assets.icon("bombicon", 74) + "</span>" +
      '<span class="psplat">' + Assets.icon("splat", 90) + "</span>";
    document.querySelectorAll(".ic").forEach((el) => { el.innerHTML = Assets.icon(el.dataset.icon, 18); });
  });
  paintPoster();

  /* ================================================================
     BoardUI — DOM for one player's board (HUD, meter, arena, deck)
     ================================================================ */
  class BoardUI {
    constructor(opts) {  // {rot, solo, testBar}
      this.rot = !!opts.rot;
      const root = document.createElement("div");
      root.className = "board" + (this.rot ? " rot" : "") + (opts.solo ? " solo" : "");
      const deckHtml = '<div class="deck"><span class="coinchip">$0</span><div class="weapon-row"></div></div>';
      // the old unlabeled timer bar is gone — that strip is now the TIFFED OFF meter
      root.innerHTML =
        '<div class="bhud"><span class="me"></span><span class="tick">1:30</span><span class="them"></span></div>' +
        '<div class="meter" data-tier="0" data-streak="0"><div class="meter-fill"></div>' +
          '<i class="mk" style="left:40%"></i><i class="mk" style="left:70%"></i>' +
          '<span class="meter-label">TIFFED OFF</span><span class="meter-pct">0%</span></div>' +
        (opts.testBar ? '<div class="testbar"><button data-k="lock"></button><button data-k="free">FREE $ + NO CD</button><button data-k="mirror">HIT ME</button><button data-k="bot"></button></div>' : "") +
        '<div class="arena-wrap"><canvas></canvas><div class="board-announce hidden"></div><div class="countdown hidden"></div></div>' +
        deckHtml;
      $("boards").appendChild(root);
      this.root = root;
      this.hudMe = root.querySelector(".me");
      this.hudThem = root.querySelector(".them");
      this.hudTick = root.querySelector(".tick");
      this.meterEl = root.querySelector(".meter");
      this.meterFill = root.querySelector(".meter-fill");
      this.meterLabel = root.querySelector(".meter-label");
      this.meterPct = root.querySelector(".meter-pct");
      this.canvas = root.querySelector("canvas");
      this.announceEl = root.querySelector(".board-announce");
      this.countdownEl = root.querySelector(".countdown");
      this.coinchip = root.querySelector(".coinchip");
      this.weaponRow = root.querySelector(".weapon-row");
      this._announceT = 0; this._burstT = 0;
      if (opts.testBar) {
        this.testBar = {};
        root.querySelectorAll(".testbar button").forEach((b) => { this.testBar[b.dataset.k] = b; });
      }
    }
    setMeter(m, tier, streak) {
      this.meterFill.style.width = m.toFixed(1) + "%";
      if (this.meterEl.dataset.tier !== String(tier)) {
        this.meterEl.dataset.tier = tier;
        this.meterLabel.textContent = tier === 3 ? "TIFFED OFF!" : tier ? TIER_NAMES[tier] : "TIFFED OFF";
      }
      this.meterEl.dataset.streak = streak;
      this.meterPct.textContent = Math.floor(m) + "%";
    }
    showBurst(mult, ms) {
      this.coinchip.classList.add("burst");
      this.coinchip.dataset.burst = "×" + (Math.round(mult * 10) / 10);
      clearTimeout(this._burstT);
      this._burstT = setTimeout(() => this.coinchip.classList.remove("burst"), ms);
    }
    // HUD hierarchy: big score first, then name + hearts. innerHTML only when it changes.
    setMe(name, h, score) {
      const html = '<span class="sc">' + score + '</span><span class="who">' + esc(name) + " " + heartsHtml(h) + "</span>";
      if (html !== this._meHtml) { this._meHtml = html; this.hudMe.innerHTML = html; }
    }
    setThem(name, h, score, tier) {
      // their heat is public: "she's FUMING" is a read you can play around
      const heat = tier ? '<span class="heat t' + tier + '">' + (tier === 3 ? "MAXED" : TIER_NAMES[tier]) + "</span>" : "";
      const html = '<span class="sc">' + score + '</span><span class="who">' + heat + heartsHtml(h) + " " + esc(name) + "</span>";
      if (html !== this._themHtml) { this._themHtml = html; this.hudThem.innerHTML = html; }
    }
    setTimer(left) {
      this.hudTick.textContent = clock(left + 999);
      this.hudTick.classList.toggle("urgent", left <= 10000);
    }
    announce(html, ms) {
      this.announceEl.innerHTML = html;
      this.announceEl.classList.remove("hidden");
      clearTimeout(this._announceT);
      this._announceT = setTimeout(() => this.announceEl.classList.add("hidden"), ms || 2100);
    }
    countdown(text) {
      if (text === null) { this.countdownEl.classList.add("hidden"); return; }
      this.countdownEl.classList.remove("hidden");
      this.countdownEl.textContent = text;
    }
    destroy() { this.root.remove(); }
  }

  /* ================================================================
     Deck — one player's weapon economy
     ================================================================ */
  class Deck {
    constructor(ui, opts) {  // {onLaunch(w, dxClient|null, tier), meter(), vent(tier)}
      this.ui = ui;
      this.onLaunch = opts.onLaunch;
      this.meter = opts.meter;   // coins buy the attack; the board's TIFFED OFF meter powers it
      this.vent = opts.vent;
      this.coins = START_COINS;
      this.comeback = false;
      this.burstMult = 1; this.burstUntil = 0;   // temporary income boost from landing combos
      this.cds = {};
      this.running = false;
      this.bombRun = 0; this.bombRunUntil = 0;   // repeat fatigue
      this.lastW = null;
      this.pt = { attacks: 0, repeats: 0, tiers: [0, 0, 0, 0] };   // playtest counters
      this.btns = {};
      WEAPONS.forEach((w) => {
        const b = document.createElement("button");
        b.className = "wpn";
        b.innerHTML = '<span class="wt"></span>' + Assets.icon(w.icon, 26) + '<span class="wn">' + w.n + '</span><span class="wc">$' + w.cost + '</span><div class="cdover" style="height:0"></div>';
        ui.weaponRow.appendChild(b);
        this.btns[w.id] = b;
        this.bindButton(b, w);
      });
      this._iv = setInterval(() => this.tick(), 100);
      this._lastT = performance.now();
      this.refresh();
    }

    rate() {
      const base = 1.5 + (this.comeback ? 2 : 0);
      return base * (performance.now() < this.burstUntil ? this.burstMult : 1);
    }

    // a landed combo (3+) buys a temporary income multiplier instead of a permanent
    // purchased upgrade — good slicing directly fuels your next attack
    triggerBurst(n) {
      const mult = Math.min(3, 1 + (n - 2) * 0.5);
      const dur = Math.min(5000, 2200 + (n - 3) * 500);
      const now = performance.now();
      this.burstMult = Math.max(this.burstUntil > now ? this.burstMult : 1, mult);
      this.burstUntil = Math.max(this.burstUntil, now + dur);
      this.ui.showBurst(this.burstMult, this.burstUntil - now);
    }

    bindButton(b, w) {
      let start = null;
      b.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        b.setPointerCapture && b.setPointerCapture(ev.pointerId);
        start = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      });
      b.addEventListener("pointermove", (ev) => {
        if (!start || ev.pointerId !== start.id || !w.aim) return;
        b.classList.toggle("aiming", Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 18);
      });
      const end = (ev) => {
        if (!start || ev.pointerId !== start.id) return;
        b.classList.remove("aiming");
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        start = null;
        const flicked = w.aim && Math.hypot(dx, dy) > WEAPON_AIM_DRAG_THRESHOLD;
        this.tryFire(w, flicked ? dx : null);
      };
      b.addEventListener("pointerup", end);
      b.addEventListener("pointercancel", () => { start = null; b.classList.remove("aiming"); });
    }

    start() { this.running = true; this._lastT = performance.now(); }
    stop() { this.running = false; clearInterval(this._iv); }
    addCoins(n) { this.coins += n; }

    priceOf(w) {
      if (w.id !== "bomb" || performance.now() > this.bombRunUntil) return w.cost;
      return BOMB_FATIGUE_PRICES[Math.min(this.bombRun, BOMB_FATIGUE_PRICES.length - 1)];
    }

    tryFire(w, dxClient) {
      if (!this.running) return;
      const now = performance.now();
      const price = this.priceOf(w);
      if ((this.cds[w.id] || 0) > now) { SFX.deny(); return; }
      if (this.coins < price) { SFX.deny(); return; }
      this.coins -= price;
      this.cds[w.id] = now + w.cd;
      // the attack is as strong as your current heat, and firing it vents that heat
      const tier = tierOf(this.meter());
      this.vent(tier);
      if (w.id === "bomb") {
        this.bombRun = now > this.bombRunUntil ? 1 : this.bombRun + 1;
        this.bombRunUntil = now + BOMB_FATIGUE_MS;
      } else this.bombRun = 0;
      this.pt.attacks++;
      if (this.lastW === w.id) this.pt.repeats++;
      this.pt.tiers[tier]++;
      this.lastW = w.id;
      SFX.send();
      this.onLaunch(w.id, dxClient, tier);
      this.refresh();
    }

    tick() {
      const now = performance.now();
      if (this.running) this.coins += this.rate() * (now - this._lastT) / 1000;
      this._lastT = now;
      this.ui.coinchip.textContent = "$" + Math.floor(this.coins);
      this.refresh();
    }

    refresh() {
      const now = performance.now();
      const tier = tierOf(this.meter());
      WEAPONS.forEach((w) => {
        const b = this.btns[w.id];
        const cdLeft = Math.max(0, (this.cds[w.id] || 0) - now);
        const price = this.priceOf(w);
        b.classList.toggle("cant", this.coins < price || cdLeft > 0);
        b.querySelector(".cdover").style.height = cdLeft > 0 ? (cdLeft / w.cd * 100).toFixed(0) + "%" : "0";
        if (b._price !== price) {
          b._price = price;
          b.querySelector(".wc").textContent = "$" + price;
          b.classList.toggle("tired", price > w.cost);
        }
        if (b._tier !== tier) {
          b._tier = tier;
          b.dataset.tier = tier;
          b.querySelector(".wt").textContent = tier === 3 ? "TIFFED!" : TIER_NAMES[tier];
        }
      });
    }
  }

  // everything a finished board reports: arena skill stats + deck economy + playtest counters
  function boardStats(board) {
    const a = board.arena.stats, d = board.deck;
    const s = Object.assign({}, a, {
      meterAvg: a.meterTime ? Math.round(a.meterIntegral / a.meterTime) : 0,
      meterPeak: Math.round(a.meterPeak),
    });
    delete s.meterIntegral; delete s.meterTime;
    if (d) Object.assign(s, { attacks: d.pt.attacks, repeats: d.pt.repeats, tiers: d.pt.tiers.slice(), endCoins: Math.floor(d.coins) });
    return s;
  }

  // one line per player on the results card for the TIFFED OFF playtest questions
  function playtestLine(st) {
    if (!st || st.meterPeak === undefined) return "";
    const t = st.tiers || [0, 0, 0, 0];
    return "TIFFED OFF avg " + st.meterAvg + "% · peak " + st.meterPeak + "% · maxed " + (st.maxed || 0) + "× · " +
      (st.cleanCombos || 0) + " clean · sent " + t[0] + "/" + t[1] + "/" + t[2] + "/" + t[3] + " (norm/heat/fume/max) · ended $" + (st.endCoins || 0);
  }

  function logPlaytest(entry) {
    try {
      const log = JSON.parse(Store.get("ss_playtest") || "[]");
      log.push(entry);
      while (log.length > PLAYTEST_LOG_MAX) log.shift();
      Store.set("ss_playtest", JSON.stringify(log));
    } catch (e) {}
  }

  /* ================================================================
     Bot — the GOD BOT opponent for practice/test mode. It speaks the same
     messages a remote phone does (atk / st / hurt / trapped / end), so
     solo runs the real PvP code path — just with no network and no bot board.
     ================================================================ */
  const BOT_NAME = "GOD BOT";
  // chance an attack you send actually gets the bot, per tier — it's god-tier, but a
  // maxed signature should still land sometimes
  const BOT_FAIL = {
    bomb: [0.05, 0.1, 0.15, 0.3], trap: [0.1, 0.15, 0.2, 0.35],
    flood: [0.08, 0.12, 0.2, 0.35], gust: [0.08, 0.12, 0.18, 0.3],
  };
  const BOT_TIER_ODDS = [0.25, 0.3, 0.25, 0.2];   // so every tier of every weapon shows up on your board
  const BOT_RESOLVE_MS = 1800;                     // how long after landing the bot "deals with" your attack

  class Bot {
    constructor(match) {
      this.match = match;
      this.score = 0; this.hearts = HEARTS; this.meter = 0; this.coins = START_COINS;
      this.attacking = true;
      this.plan = null; this.nextAtk = 0; this.lastSt = 0;
      this.running = false; this.ended = false;
      this.pt = { attacks: 0, tiers: [0, 0, 0, 0], combos: 0 };
      this.timeouts = new Set();
    }
    start() {
      this.running = true;
      this.t0 = this._last = performance.now();
      this.nextAtk = this.t0 + rand(3000, 5000);
      this._iv = setInterval(() => this.tick(), 100);
    }
    stop() { this.running = false; clearInterval(this._iv); this.timeouts.forEach(clearTimeout); }
    later(fn, ms) {
      const to = setTimeout(() => { this.timeouts.delete(to); if (this.running) fn(); }, ms);
      this.timeouts.add(to);
    }
    // bot → you: delivered async, like the network, so message ordering matches online play
    send(m) { setTimeout(() => this.match.onNet(m), 0); }

    tick() {
      const now = performance.now(), dt = (now - this._last) / 1000;
      this._last = now;
      const prog = Math.min(1, (now - this.t0) / ROUND_MS);
      // god-tier slicing: PERFECT-heavy scoring that speeds up with the match, plus big combos
      // (~500 over a full match — a very good human lands around 300-400)
      this.score += (2.5 + 2 * prog) * dt;
      if (Math.random() < dt * 0.08) { this.score += 25; this.pt.combos++; }
      this.meter = Math.min(100, this.meter + (7 + 3 * prog) * dt);
      this.coins += (7 + 3 * prog) * dt;   // richer than a human, so you see plenty of attacks
      if (this.attacking && now >= this.nextAtk) {
        if (!this.plan) {
          const r = Math.random();
          let tier = 0, acc = 0;
          BOT_TIER_ODDS.forEach((p, i) => { acc += p; if (r >= acc) tier = i + 1; });
          this.plan = { w: WEAPONS[(Math.random() * WEAPONS.length) | 0], tier: Math.min(3, tier) };
        }
        const { w, tier } = this.plan;
        if (tierOf(this.meter) >= tier && this.coins >= w.cost) this.fire(w, tier, prog);
      }
      if (now - this.lastSt > 500) {
        this.lastSt = now;
        this.send({ t: "st", score: Math.floor(this.score), hearts: this.hearts, tier: tierOf(this.meter) });
      }
    }

    fire(w, tier, prog) {
      this.coins -= w.cost;
      this.meter = Math.max(0, this.meter - TIER_VENT[tier]);
      this.pt.attacks++; this.pt.tiers[tier]++;
      const [fMin, fMax] = w.id === "bomb" && tier < 3 ? [BOMB_FUSE_MIN, BOMB_FUSE_MAX] : [FUSE_MIN, FUSE_MAX];
      this.send({ t: "atk", w: w.id, aimX: Math.round(rand(150, 850)), delay: Math.round(rand(fMin, fMax)), tier });
      this.plan = null;
      this.nextAtk = performance.now() + rand(2500, 5000) * (1 - 0.4 * prog);
    }

    // you → bot
    receive(m) {
      if (m.t === "atk") this.later(() => this.resolveAttack(m.w, m.tier | 0), m.delay + BOT_RESOLVE_MS);
      else if (m.t === "hurt") this.coins += HEART_BOUNTY;
      else if (m.t === "trapped") this.coins += m.stolen;
      else if (m.t === "end") this.end("time");
    }

    resolveAttack(w, tier) {
      if (Math.random() >= BOT_FAIL[w][tier]) {
        this.meter = Math.min(100, this.meter + (w === "bomb" && tier < 2 ? 4 : tier >= 2 ? 12 : 8));
        return;
      }
      this.meter = Math.max(0, this.meter - (w === "trap" ? 12 : 20));
      if (w === "trap") {
        const stolen = Math.round(this.coins * TRAP_STEAL_PCT);
        this.coins -= stolen;
        this.score = Math.max(0, this.score - 30);
        this.send({ t: "trapped", stolen });
        return;
      }
      this.hearts--;
      this.score = Math.max(0, this.score - HEART_PENALTY[HEARTS - this.hearts - 1]);
      this.send({ t: "hurt", hearts: this.hearts });
      if (this.hearts <= 0) this.end("ko");
    }

    end(reason) {
      if (this.ended) return;
      this.ended = true;
      const score = Math.floor(this.score), fruit = Math.round(score / 7);
      this.send({
        t: "end", score, reason,
        stats: { fruit, perfects: Math.round(fruit * 0.8), bestCombo: this.pt.combos ? 5 : 0, bombsDodged: 0, dudsDefused: 0, attacks: this.pt.attacks },
      });
      this.stop();
    }
  }

  /* ================================================================
     Match — one simultaneous 90s bout
     ================================================================ */
  class Match {
    constructor(mode) {
      this.mode = mode;
      this.over = false;
      this.boards = [];
      this.results = {};                 // name -> {score, reason, stats}
      this.themState = { score: 0, hearts: HEARTS, tier: 0 };
      $("boards").innerHTML = "";
      show("screen-game");

      // solo = practice/test mode vs the GOD BOT, which stands in for a remote phone
      this.bot = mode === "solo" ? new Bot(this) : null;
      this.test = { lock: -1, free: false, mirror: false };
      if (mode === "couch") {
        this.boards.push(this.makeBoard({ name: S.p2Name, rot: true }));
        this.boards.push(this.makeBoard({ name: S.myName, rot: false }));
      } else {
        this.boards.push(this.makeBoard({ name: S.myName, solo: true, testBar: !!this.bot }));
      }
      // the first board is measured before the second reflows the column — re-measure both
      requestAnimationFrame(() => this.boards.forEach((b) => b.arena.resize()));
      if (this.bot) {
        this.wireTestBar(this.boards[0]);
        this._tiv = setInterval(() => this.applyTest(this.boards[0]), 100);
      }
      if (mode !== "couch") {
        this._stiv = setInterval(() => {
          const b = this.boards[0];
          this.send({ t: "st", score: b.arena.score, hearts: b.arena.hearts, tier: b.arena.tier() });
          // comeback aid when clearly behind
          b.deck.comeback = this.themState.score - b.arena.score > 120 || this.themState.hearts - b.arena.hearts >= 2;
        }, 500);
      } else if (mode === "couch") {
        this._stiv = setInterval(() => {
          const [a, b] = this.boards;
          a.deck.comeback = b.arena.score - a.arena.score > 120 || b.arena.hearts - a.arena.hearts >= 2;
          b.deck.comeback = a.arena.score - b.arena.score > 120 || a.arena.hearts - b.arena.hearts >= 2;
        }, 500);
      }
      this.countdownThenStart();
    }

    makeBoard(opts) {
      const ui = new BoardUI(opts);
      const board = { ui, name: opts.name, timeouts: new Set() };
      board.arena = new Arena(ui.canvas, {
        rotated: opts.rot,
        onCoin: (n) => board.deck.addCoins(n),
        onBurst: (n) => board.deck.triggerBurst(n),
        onEvent: (m) => this.onArenaEvent(board, m),
        onState: (st) => this.onArenaState(board, st),
      });
      board.deck = new Deck(ui, {
        meter: () => board.arena.meter,
        vent: (tier) => { board.arena.vent(tier); this.applyTest(board); },   // a meter lock survives rapid fire
        onLaunch: (w, dxClient, tier) => this.launch(board, w, dxClient, tier),
      });
      return board;
    }

    otherBoard(board) { return this.boards.find((b) => b !== board); }

    // to the other player: over the network, or straight to the bot in practice
    send(m) { if (this.bot) this.bot.receive(m); else Net.send(m); }

    /* ----- practice/test controls ----- */
    wireTestBar(board) {
      const bar = board.ui.testBar;
      const LOCKS = [-1, 0, 40, 70, 100], LOCK_NAMES = ["LIVE", "NORMAL", "HEATED", "FUMING", "MAX"];
      const paint = () => {
        bar.lock.textContent = "METER: " + LOCK_NAMES[LOCKS.indexOf(this.test.lock)];
        bar.lock.classList.toggle("on", this.test.lock >= 0);
        bar.free.classList.toggle("on", this.test.free);
        bar.mirror.classList.toggle("on", this.test.mirror);
        bar.bot.classList.toggle("on", this.bot.attacking);
        bar.bot.textContent = "BOT ATK: " + (this.bot.attacking ? "ON" : "OFF");
      };
      bar.lock.onclick = () => { this.test.lock = LOCKS[(LOCKS.indexOf(this.test.lock) + 1) % LOCKS.length]; paint(); };
      bar.free.onclick = () => { this.test.free = !this.test.free; paint(); };
      bar.mirror.onclick = () => { this.test.mirror = !this.test.mirror; paint(); };
      bar.bot.onclick = () => { this.bot.attacking = !this.bot.attacking; paint(); };
      paint();
    }
    // re-pinned every 100ms, so the vent after firing refills right away and you can
    // fire the same tier over and over
    applyTest(board) {
      if (!board.arena.running) return;
      if (this.test.lock >= 0) { board.arena.meter = this.test.lock; board.arena.lastSkillT = performance.now(); }
      if (this.test.free) { board.deck.coins = Math.max(board.deck.coins, 999); board.deck.cds = {}; board.deck.bombRun = 0; }
    }

    /* ----- attacks ----- */
    aimFrom(board, dxClient) {
      if (dxClient === null || dxClient === undefined) return Math.round(rand(150, 850));
      const perceived = board.ui.rot ? -dxClient : dxClient;
      const dir = this.mode === "couch" ? -1 : 1;   // couch boards face each other
      return Math.round(Math.max(80, Math.min(920, 500 + dir * perceived * 4)));
    }

    launch(board, w, dxClient, tier) {
      const aimX = this.aimFrom(board, dxClient);
      const [fMin, fMax] = w === "bomb" && tier < 3 ? [BOMB_FUSE_MIN, BOMB_FUSE_MAX] : [FUSE_MIN, FUSE_MAX];
      const delay = Math.round(rand(fMin, fMax));
      if (this.test.mirror) this.deliver(board, w, aimX, delay, tier);   // HIT ME: preview it on yourself
      else if (this.mode === "couch") this.deliver(this.otherBoard(board), w, aimX, delay, tier);
      else this.send({ t: "atk", w, aimX, delay, tier });
    }

    // the attack still lands after a short randomized fuse; the banner is the only warning
    deliver(victim, w, aimX, delay, tier) {
      if (this.over) return;
      tier = tier | 0;
      if (!isSilent(w, tier)) { victim.ui.announce('<span class="warn">' + attackName(w, tier) + "</span>", 1100); SFX.tick(); }
      const to = setTimeout(() => {
        victim.timeouts.delete(to);
        if (!this.over) victim.arena.handleSend(w, aimX, tier);
      }, delay);
      victim.timeouts.add(to);
    }

    /* ----- arena events ----- */
    onArenaEvent(board, m) {
      if (m.t === "hurt") {
        if (this.mode === "couch") {
          const other = this.otherBoard(board);
          other.deck.addCoins(HEART_BOUNTY);
          other.ui.announce("HIT! +$" + HEART_BOUNTY, 1000);
        } else this.send({ t: "hurt", hearts: m.hearts });
      } else if (m.t === "trap") {
        // the steal itself happens here (main.js owns the Deck) — Arena only told us
        // it happened and where, so the popup lands at the right spot on the victim's board
        const stolen = Math.round(board.deck.coins * TRAP_STEAL_PCT);
        board.deck.coins = Math.max(0, board.deck.coins - stolen);
        SFX.steal();
        if (this.mode === "couch") {
          const other = this.otherBoard(board);
          other.deck.addCoins(stolen);
          other.ui.announce("STOLE $" + stolen, 1000);
        } else {
          this.send({ t: "trapped", stolen });
        }
      } else if (m.t === "phase") {
        board.ui.announce('<span class="warn">' + m.name + "!</span>", 1000);
        if (board === this.boards[this.boards.length - 1]) SFX.phase();
      } else if (m.t === "end") {
        const stats = boardStats(board);
        this.results[board.name] = { score: m.score, reason: m.reason, stats };
        if (this.mode !== "couch") this.send({ t: "end", score: m.score, reason: m.reason, stats });
        this.checkOver(board, m.reason);
      }
    }

    onArenaState(board, st) {
      board.ui.setMe(board.name, st.hearts, st.score);
      board.ui.setMeter(st.meter, st.tier, st.streak);
      board.ui.setTimer(st.left);
      if (this.mode === "couch") {
        const other = this.otherBoard(board);
        board.ui.setThem(other.name, other.arena.hearts, other.arena.score, other.arena.tier());
      } else {
        board.ui.setThem(S.theirName, this.themState.hearts, this.themState.score, this.themState.tier);
      }
    }

    /* ----- remote messages ----- */
    onNet(m) {
      const me = this.boards[0];
      if (m.t === "atk") this.deliver(me, m.w, m.aimX, m.delay, m.tier);
      else if (m.t === "hurt") {
        this.themState.hearts = m.hearts;
        me.deck.addCoins(HEART_BOUNTY);
        me.ui.announce("HIT! +$" + HEART_BOUNTY, 1000);
      }
      else if (m.t === "trapped") {
        me.deck.addCoins(m.stolen);
        me.ui.announce("STOLE $" + m.stolen, 1000);
      }
      else if (m.t === "st") { this.themState.score = m.score; this.themState.hearts = m.hearts; this.themState.tier = m.tier | 0; }
      else if (m.t === "end") {
        this.results[S.theirName] = { score: m.score, reason: m.reason, stats: m.stats };
        this.checkOver(null, m.reason);
      }
    }

    /* ----- start & finish ----- */
    countdownThenStart() {
      const vs = this.mode === "couch" ? [S.myName, S.p2Name] : [S.myName, S.theirName];
      this.boards.forEach((b) => b.ui.announce(esc(vs[0].toUpperCase()) + " ⚔ " + esc(vs[1].toUpperCase()), 2600));
      const step = (k) => {
        if (this.over) return;
        if (k === 0) {
          this.boards.forEach((b) => b.ui.countdown("SLICE!"));
          SFX.combo(4);
          setTimeout(() => this.boards.forEach((b) => b.ui.countdown(null)), 500);
          this.boards.forEach((b) => { b.arena.resize(); b.arena.startRound(ROUND_MS); b.deck.start(); });
          if (this.bot) this.bot.start();
          return;
        }
        this.boards.forEach((b) => b.ui.countdown(k));
        SFX.tick();
        setTimeout(() => step(k - 1), 800);
      };
      step(3);
    }

    names() { return this.mode === "couch" ? [this.boards[1].name, this.boards[0].name] : [S.myName, S.theirName]; }

    checkOver(koBoard, reason) {
      if (this.over) return;
      const names = this.names();
      if (reason === "ko") {
        const loser = koBoard ? koBoard.name : S.theirName;
        const winner = names.find((n) => n !== loser);
        if (!this.results[winner]) {
          const wb = this.boards.find((b) => b.name === winner);
          this.results[winner] = {
            score: wb ? wb.arena.score : this.themState.score,
            reason: "alive",
            stats: wb ? boardStats(wb) : null,
          };
        }
        this.finish({ winner, loser, ko: true });
        return;
      }
      if (names.every((n) => this.results[n])) {
        const [a, b] = names;
        const sa = this.results[a].score, sb = this.results[b].score;
        this.finish(sa === sb ? { tie: true } : { winner: sa > sb ? a : b, loser: sa > sb ? b : a, ko: false });
      } else if (this.mode !== "couch") {
        setTimeout(() => {
          if (this.over) return;
          if (!this.results[S.theirName]) this.results[S.theirName] = { score: this.themState.score, reason: "time" };
          this.checkOver(null, "time");
        }, 4000);
      }
    }

    finish(outcome) {
      this.over = true;
      this.stop();
      const names = this.names();
      $("results-title").textContent = outcome.tie ? "DEAD EVEN?!"
        : outcome.ko ? KO_LINES[(Math.random() * KO_LINES.length) | 0](outcome.winner.toUpperCase(), outcome.loser.toUpperCase())
        : outcome.winner.toUpperCase() + " WINS!";
      $("results-lines").innerHTML = names.map((n) => {
        const r = this.results[n] || { score: 0 };
        return (outcome.winner === n ? "👑 " : "") + esc(n) + ": <b>" + r.score + "</b>" + (r.reason === "ko" ? " (KO'd)" : "");
      }).join("<br>");
      $("results-stats").innerHTML = names.map((n) => {
        const st = (this.results[n] || {}).stats;
        if (!st) return "";
        const pl = playtestLine(st);
        return "<b>" + esc(n) + "</b> — " + st.fruit + " fruit · " + (st.perfects || 0) + " perfect · best ×" + (st.bestCombo || 0) + " · dodged " + st.bombsDodged + " · " + (st.dudsDefused || 0) + " defused · sent " + (st.attacks || 0) +
          (pl ? '<br><span class="pt">' + pl + "</span>" : "");
      }).filter(Boolean).join("<br>");
      if (!this.bot) this.logResult(outcome, names);
      $("results-h2h").textContent = outcome.tie || this.bot ? "" : this.recordWin(outcome.winner, outcome.loser);
      $("btn-rematch").disabled = false;
      $("results-status").textContent = "";
      S.myReady = S.theirReady = false;
      const iWon = outcome.winner === S.myName;
      if (this.mode === "couch" || iWon) SFX.fanfare(); else if (!outcome.tie) SFX.sad();
      show("screen-results");
    }

    // bot practice is never logged — it would skew the playtest data and the head-to-head
    logResult(outcome, names) {
      const players = {};
      names.forEach((n) => { const r = this.results[n]; if (r) players[n] = Object.assign({ score: r.score }, r.stats || {}); });
      const ra = this.results[outcome.winner], rb = this.results[outcome.loser];
      logPlaytest({
        at: new Date().toISOString(), mode: this.mode, winner: outcome.winner || null, ko: !!outcome.ko,
        margin: outcome.tie ? 0 : ra && rb ? ra.score - rb.score : null, players,
      });
    }

    recordWin(winner, loser) {
      try {
        const all = JSON.parse(Store.get("ss_h2h") || "{}");
        const key = [winner, loser].sort().join("|");
        const rec = all[key] || {};
        rec[winner] = (rec[winner] || 0) + 1;
        all[key] = rec;
        Store.set("ss_h2h", JSON.stringify(all));
        const [a, b] = key.split("|");
        return a.toUpperCase() + " " + (rec[a] || 0) + " – " + (rec[b] || 0) + " " + b.toUpperCase();
      } catch (e) { return ""; }
    }

    stop() {
      clearInterval(this._stiv); clearInterval(this._tiv);
      if (this.bot) this.bot.stop();
      this.boards.forEach((b) => {
        b.arena.stopRound(); b.arena.destroy();
        b.deck.stop();
        b.timeouts.forEach(clearTimeout);
      });
    }
    abort() { if (!this.over) { this.over = true; this.stop(); } }
  }

  /* ================================================================
     screens & networking
     ================================================================ */
  $("btn-play").onclick = () => show("screen-mode");
  $("btn-mode-back").onclick = () => { paintPoster(); show("screen-home"); };
  $("btn-howto").onclick = () => show("screen-howto");
  $("btn-howto-back").onclick = () => show("screen-home");
  $("btn-online").onclick = () => {
    Store.set("ss_name", myName());
    $("online-hosting").classList.add("hidden");
    $("online-choice").classList.remove("hidden");
    $("online-status").textContent = "";
    show("screen-online");
  };
  $("btn-couch").onclick = () => { Store.set("ss_name", myName()); show("screen-couch"); };
  $("btn-solo").onclick = () => {
    S.mode = "solo"; S.isHost = true; S.myName = myName(); S.theirName = BOT_NAME;
    Store.set("ss_name", S.myName);
    startMatch();
  };
  $("btn-online-back").onclick = () => { Net.close(); show("screen-mode"); };
  $("btn-couch-back").onclick = () => show("screen-mode");

  function wireNetFlow() {
    Net.handlers = {};
    Net.on("hi", (m) => {
      S.theirName = (m.name || "Partner").slice(0, 12);
      if (S.theirName === S.myName) S.theirName += " 2";
      Store.set("ss_lastopp", S.theirName);
      if (S.reconnecting) { S.reconnecting = false; toast("Reconnected!"); return; }
      if (S.match && !S.match.over) return;
      if (S.isHost) enterLobby();
    });
    Net.on("lobbyok", () => { if (!S.isHost && !(S.match && !S.match.over)) enterLobby(); });
    Net.on("start", () => startMatch());
    Net.on("ready", () => { S.theirReady = true; maybeRematch(); });
    ["atk", "hurt", "trapped", "st", "end"].forEach((t) =>
      Net.on(t, (m) => { if (S.match) S.match.onNet(m); })
    );
    Net.onClose = () => {
      if (S.match && !S.match.over) {
        // grace window: try to get the same room back before giving up
        S.reconnecting = true;
        toast("Reconnecting…", 4000);
        let tries = 0;
        const iv = setInterval(() => {
          if (!S.reconnecting || (S.match && S.match.over)) { clearInterval(iv); return; }
          tries++;
          if (tries > 5) {
            clearInterval(iv);
            S.reconnecting = false;
            if (S.match) S.match.abort();
            show("screen-home");
            toast("Connection lost");
            return;
          }
          if (!S.isHost) Net.rejoin();
        }, 2500);
      } else if (document.querySelector(".screen.active").id !== "screen-home") {
        show("screen-home");
        toast("Connection lost");
      }
    };
  }

  const OFFLINE_HINT = "Can't reach matchmaking from here. On the claude.ai link, online mode isn't available — play One Device instead!";

  $("btn-host").onclick = () => {
    S.mode = "online"; S.isHost = true; S.myName = myName();
    $("online-choice").classList.add("hidden");
    $("online-hosting").classList.remove("hidden");
    $("host-status").textContent = "Contacting matchmaking…";
    let opened = false;
    Net.onOpen = (code) => {
      opened = true;
      $("room-code").textContent = code;
      $("host-status").textContent = "Waiting for your partner…";
    };
    Net.onConnect = () => { Net.send({ t: "hi", name: S.myName }); };
    wireNetFlow();
    Net.host((err) => { $("host-status").textContent = "Network error — try again (" + err.type + ")"; });
    setTimeout(() => { if (!opened) $("host-status").textContent = OFFLINE_HINT; }, 9000);
  };

  $("btn-join").onclick = () => {
    const code = $("join-code").value.trim().toUpperCase();
    if (code.length !== 4) { toast("Enter the 4-letter code"); return; }
    S.mode = "online"; S.isHost = false; S.myName = myName();
    $("online-status").textContent = "Connecting…";
    let joined = false;
    Net.onConnect = () => { joined = true; Net.send({ t: "hi", name: S.myName }); $("online-status").textContent = "Connected!"; };
    wireNetFlow();
    Net.join(code, (err) => {
      $("online-status").textContent =
        err.type === "peer-unavailable" ? "No game with that code — double-check it!" : "Network error (" + err.type + ")";
    });
    setTimeout(() => { if (!joined && $("online-status").textContent === "Connecting…") $("online-status").textContent = OFFLINE_HINT; }, 9000);
  };

  $("btn-couch-start").onclick = () => {
    S.mode = "couch"; S.isHost = true;
    S.myName = myName(); S.p2Name = p2Name();
    if (S.p2Name === S.myName) S.p2Name += " 2";
    Store.set("ss_p2name", S.p2Name);
    startMatch();
  };

  function enterLobby() {
    $("lobby-players").innerHTML =
      '<div class="pl">' + esc(S.myName) + "</div>" + '<div class="pl">' + esc(S.theirName) + "</div>";
    $("btn-start").classList.toggle("hidden", !S.isHost);
    $("lobby-status").textContent = S.isHost ? "" : "Waiting for " + S.theirName + " to start…";
    if (S.isHost && S.mode === "online") Net.send({ t: "lobbyok" });
    show("screen-lobby");
  }

  $("btn-start").onclick = () => {
    if (S.mode === "online") Net.send({ t: "start" });
    startMatch();
  };

  function startMatch() {
    if (S.match) S.match.abort();
    S.myReady = S.theirReady = false;
    S.match = new Match(S.mode);
  }

  $("btn-rematch").onclick = () => {
    S.myReady = true;
    $("btn-rematch").disabled = true;
    if (S.mode === "couch" || S.mode === "solo") { startMatch(); return; }
    Net.send({ t: "ready" });
    $("results-status").textContent = S.theirReady ? "" : "Waiting for partner…";
    maybeRematch();
  };
  function maybeRematch() {
    if (S.mode !== "online" || !S.myReady || !S.theirReady) return;
    if (S.isHost) { Net.send({ t: "start" }); startMatch(); }
  }
  $("btn-home").onclick = () => {
    if (S.match) { S.match.abort(); S.match = null; }
    Net.close();
    paintPoster();
    show("screen-home");
  };

  /* ---------- global iOS niceties ---------- */
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("pointerdown", () => { SFX.unlock(); });

  const muteBtn = $("mute-btn");
  muteBtn.classList.toggle("off", SFX.muted);
  muteBtn.onclick = () => { muteBtn.classList.toggle("off", SFX.toggleMute()); };

  $("join-code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });

  // playtest log: every PvP match appends a record (see logPlaytest) — copy it out to share
  function playtestLog() { try { return JSON.parse(Store.get("ss_playtest") || "[]"); } catch (e) { return []; } }
  $("btn-copylog").onclick = () => {
    const text = JSON.stringify(playtestLog(), null, 1);
    const done = () => toast("Playtest log copied (" + playtestLog().length + " matches)");
    try { navigator.clipboard.writeText(text).then(done, () => { console.log(text); toast("Couldn’t copy — log printed to console"); }); }
    catch (e) { console.log(text); toast("Couldn’t copy — log printed to console"); }
  };

  window.__SS = S; // debug handle
  S.playtestLog = playtestLog;
})();
