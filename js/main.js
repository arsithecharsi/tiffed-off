/* TIFFED OFF! — app flow: poster, lobby, simultaneous PvP match, decks & fuse lanes. */
(function () {
  const $ = (id) => document.getElementById(id);
  const { Arena, ROUND_MS, HEARTS } = Game;

  /* ---------- weapons ---------- */
  // every weapon is offensive now — defense is dodging skill, not a purchase.
  // bomb is deliberately cheap/fast/silent: it should feel like ambient Fruit Ninja
  // danger, not a menu-driven event you can plan around.
  const WEAPONS = [
    { id: "bomb",  icon: "bomb", n: "BOMB", cost: 20, cd: 3000,  aim: true },
    { id: "trap",  icon: "fake", n: "FAKE", cost: 45, cd: 7000,  aim: true },
    { id: "flood", icon: "rush", n: "RUSH", cost: 50, cd: 9000,  aim: false },
    { id: "gust",  icon: "gust", n: "GUST", cost: 55, cd: 14000, aim: false },
  ];
  const START_COINS = 40, HEART_BOUNTY = 15;
  const FUSE_MIN = 500, FUSE_MAX = 2000;
  const BOMB_FUSE_MIN = 250, BOMB_FUSE_MAX = 650;   // short and quiet — no time to consciously plan around it

  const ANNOUNCE = {
    trap:  (n) => n + " SENT A GIFT…",
    flood: (n) => n + " HIT RUSH",
    gust:  (n) => n + " KICKED UP A GUST — 10s OF STUFF FLYING IN FROM EVERY SIDE",
  };
  const SILENT_ATTACKS = { bomb: true };  // no banner — should feel like ordinary bad luck, not a telegraphed event
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
     BoardUI — DOM for one player's board (HUD, arena, fuse lane, deck)
     ================================================================ */
  class BoardUI {
    constructor(opts) {  // {rot, solo, noDeck, onEndRun}
      this.rot = !!opts.rot;
      const root = document.createElement("div");
      root.className = "board" + (this.rot ? " rot" : "") + (opts.solo ? " solo" : "");
      const deckHtml = opts.noDeck ? "" :
        '<div class="deck">' +
          '<div class="lane"><span class="spark">' + Assets.icon("spark", 22) + '</span><span class="lane-label">INCOMING</span><span class="coinchip">$0</span></div>' +
          '<div class="weapon-row"></div>' +
        '</div>';
      root.innerHTML =
        '<div class="bhud"><span class="me"></span><span class="tick">90s</span><span class="them"></span></div>' +
        '<div class="timerbar"><div class="timerbar-fill"></div></div>' +
        '<div class="arena-wrap"><canvas></canvas><div class="board-announce hidden"></div><div class="countdown hidden"></div></div>' +
        deckHtml;
      $("boards").appendChild(root);
      this.root = root;
      this.hudMe = root.querySelector(".me");
      this.hudThem = root.querySelector(".them");
      this.hudTick = root.querySelector(".tick");
      this.timerFill = root.querySelector(".timerbar-fill");
      this.canvas = root.querySelector("canvas");
      this.announceEl = root.querySelector(".board-announce");
      this.countdownEl = root.querySelector(".countdown");
      this.lane = root.querySelector(".lane");
      this.coinchip = root.querySelector(".coinchip");
      this.laneLabel = root.querySelector(".lane-label");
      this.weaponRow = root.querySelector(".weapon-row");
      this._announceT = 0; this._burstT = 0;
      if (opts.onEndRun) {
        this.hudThem.innerHTML = '<button class="endrun-btn">END RUN</button>';
        this.hudThem.querySelector(".endrun-btn").onclick = opts.onEndRun;
      }
    }
    setElapsed(ms) {
      this.hudTick.textContent = Math.floor(ms / 1000) + "s";
      this.timerFill.style.width = Math.min(100, ms / 900).toFixed(1) + "%";
    }
    showBurst(mult, ms) {
      this.coinchip.classList.add("burst");
      this.coinchip.dataset.burst = "×" + (Math.round(mult * 10) / 10);
      clearTimeout(this._burstT);
      this._burstT = setTimeout(() => this.coinchip.classList.remove("burst"), ms);
    }
    setMe(name, h, score) { this.hudMe.innerHTML = esc(name) + " " + heartsHtml(h) + ' <span class="sc">' + score + "</span>"; }
    setThem(name, h, score) { this.hudThem.innerHTML = '<span class="sc">' + score + "</span> " + heartsHtml(h) + " " + esc(name); }
    setTimer(left, dur) {
      this.hudTick.textContent = Math.ceil(left / 1000) + "s";
      this.timerFill.style.width = (left / dur * 100).toFixed(1) + "%";
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
    addFuseItem(q) {  // q: {w, at, total}
      const el = document.createElement("span");
      el.className = "qitem";
      el.innerHTML = q.w === "trap"
        ? '<span style="font-family:\'Luckiest Guy\',sans-serif;font-size:20px;color:#8c46c8">?</span>'
        : Assets.icon(WEAPONS.find((x) => x.id === q.w).icon, 22);
      this.lane.appendChild(el);
      q.el = el;
      this.moveFuseItem(q);
    }
    moveFuseItem(q) {
      const remain = Math.max(0, q.at - performance.now());
      q.el.style.left = (12 + (remain / q.total) * 68) + "%";   // slides toward the spark
    }
    removeFuseItem(q) { if (q.el) q.el.remove(); }
    setLaneHot(hot) { this.laneLabel.classList.toggle("hot", hot); }
    destroy() { this.root.remove(); }
  }

  /* ================================================================
     Deck — one player's weapon economy
     ================================================================ */
  class Deck {
    constructor(ui, opts) {  // {onLaunch(w, dxClient|null), onRich()}
      this.ui = ui;
      this.onLaunch = opts.onLaunch;
      this.onRich = opts.onRich || (() => {});
      this.coins = START_COINS;
      this.comeback = false;
      this.burstMult = 1; this.burstUntil = 0;   // temporary income boost from landing combos
      this.cds = {};
      this.running = false;
      this.attacksSent = 0;
      this.richSent = false;
      this.btns = {};
      WEAPONS.forEach((w) => {
        const b = document.createElement("button");
        b.className = "wpn";
        b.innerHTML = Assets.icon(w.icon, 26) + '<span class="wn">' + w.n + '</span><span class="wc">$' + w.cost + '</span><div class="cdover" style="height:0"></div>';
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
        const flicked = w.aim && Math.hypot(dx, dy) > 26;
        this.tryFire(w, flicked ? dx : null);
      };
      b.addEventListener("pointerup", end);
      b.addEventListener("pointercancel", () => { start = null; b.classList.remove("aiming"); });
    }

    start() { this.running = true; this._lastT = performance.now(); }
    stop() { this.running = false; clearInterval(this._iv); }
    addCoins(n) { this.coins += n; }

    tryFire(w, dxClient) {
      if (!this.running) return;
      const now = performance.now();
      if ((this.cds[w.id] || 0) > now) { SFX.deny(); return; }
      if (this.coins < w.cost) { SFX.deny(); this.ui.announce('<span class="warn">NOT ENOUGH CASH</span>', 900); return; }
      this.coins -= w.cost;
      this.cds[w.id] = now + w.cd;
      this.attacksSent++;
      SFX.send();
      this.onLaunch(w.id, dxClient);
      this.refresh();
    }

    tick() {
      const now = performance.now();
      if (this.running) {
        this.coins += this.rate() * (now - this._lastT) / 1000;
        if (!this.richSent && this.coins >= 100) { this.richSent = true; this.onRich(); }
      }
      this._lastT = now;
      this.ui.coinchip.textContent = "$" + Math.floor(this.coins);
      this.refresh();
    }

    refresh() {
      const now = performance.now();
      WEAPONS.forEach((w) => {
        const b = this.btns[w.id];
        const cdLeft = Math.max(0, (this.cds[w.id] || 0) - now);
        b.classList.toggle("cant", this.coins < w.cost || cdLeft > 0);
        b.querySelector(".cdover").style.height = cdLeft > 0 ? (cdLeft / w.cd * 100).toFixed(0) + "%" : "0";
      });
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
      this.themState = { score: 0, hearts: HEARTS };
      $("boards").innerHTML = "";
      show("screen-game");

      if (mode === "couch") {
        this.boards.push(this.makeBoard({ name: S.p2Name, rot: true }));
        this.boards.push(this.makeBoard({ name: S.myName, rot: false }));
      } else if (mode === "solo") {
        this.boards.push(this.makeBoard({
          name: S.myName, solo: true, noDeck: true, endless: true,
          onEndRun: () => { const b = this.boards[0]; if (!this.over && b.arena.running) b.arena.endRound("stopped"); },
        }));
      } else {
        this.boards.push(this.makeBoard({ name: S.myName, solo: true }));
      }
      // the first board is measured before the second reflows the column — re-measure both
      requestAnimationFrame(() => this.boards.forEach((b) => b.arena.resize()));
      if (mode !== "solo") this._qiv = setInterval(() => this.tickQueues(), 100);
      if (mode === "online") {
        this._stiv = setInterval(() => {
          const b = this.boards[0];
          Net.send({ t: "st", score: b.arena.score, hearts: b.arena.hearts });
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
      const board = { ui, name: opts.name, queue: [], timeouts: new Set() };
      board.arena = new Arena(ui.canvas, {
        rotated: opts.rot,
        endless: opts.endless,
        onCoin: (n) => { if (board.deck) board.deck.addCoins(n); },
        onBurst: (n) => { if (board.deck) board.deck.triggerBurst(n); },
        onEvent: (m) => this.onArenaEvent(board, m),
        onState: (st) => this.onArenaState(board, st),
      });
      if (!opts.noDeck) {
        board.deck = new Deck(ui, {
          onLaunch: (w, dxClient) => this.launch(board, w, dxClient),
          onRich: () => {
            if (this.mode === "couch") this.otherBoard(board).ui.announce(esc(board.name) + " IS SITTING ON $100+", 1800);
            else Net.send({ t: "rich" });
          },
        });
      }
      return board;
    }

    otherBoard(board) { return this.boards.find((b) => b !== board); }

    /* ----- attacks ----- */
    aimFrom(board, dxClient) {
      if (dxClient === null || dxClient === undefined) return Math.round(rand(150, 850));
      const perceived = board.ui.rot ? -dxClient : dxClient;
      const dir = this.mode === "couch" ? -1 : 1;   // couch boards face each other
      return Math.round(Math.max(80, Math.min(920, 500 + dir * perceived * 4)));
    }

    launch(board, w, dxClient) {
      const aimX = this.aimFrom(board, dxClient);
      const [fMin, fMax] = w === "bomb" ? [BOMB_FUSE_MIN, BOMB_FUSE_MAX] : [FUSE_MIN, FUSE_MAX];
      const delay = Math.round(rand(fMin, fMax));
      if (this.mode === "couch") this.deliver(this.otherBoard(board), board.name, w, aimX, delay);
      else Net.send({ t: "atk", w, aimX, delay });
    }

    deliver(victim, fromName, w, aimX, delay) {
      if (this.over) return;
      if (!SILENT_ATTACKS[w]) {
        victim.ui.announce('<span class="warn">INCOMING!</span> ' + ANNOUNCE[w](esc(fromName)));
      }
      const q = { w, at: performance.now() + delay, total: delay };
      victim.queue.push(q);
      victim.ui.addFuseItem(q);
      SFX.tick();
      const to = setTimeout(() => {
        victim.timeouts.delete(to);
        victim.queue = victim.queue.filter((x) => x !== q);
        victim.ui.removeFuseItem(q);
        if (!this.over) victim.arena.handleSend(w, aimX);
      }, delay);
      victim.timeouts.add(to);
    }

    tickQueues() {
      this.boards.forEach((b) => {
        b.queue.forEach((q) => b.ui.moveFuseItem(q));
        b.ui.setLaneHot(b.queue.length > 0);
      });
    }

    /* ----- arena events ----- */
    onArenaEvent(board, m) {
      if (this.mode === "solo") {
        if (m.t === "end") this.finishSolo(board, m.score, m.reason);
        return;   // no opponent to notify of hurts/traps/combos in free play
      }
      if (m.t === "hurt") {
        if (this.mode === "couch") {
          const other = this.otherBoard(board);
          other.deck.addCoins(HEART_BOUNTY);
          other.ui.announce("DIRECT HIT! +$" + HEART_BOUNTY, 1600);
        } else Net.send({ t: "hurt", hearts: m.hearts });
      } else if (m.t === "trap") {
        if (this.mode === "couch") this.otherBoard(board).ui.announce(esc(board.name) + " FELL FOR THE FAKE", 1800);
        else Net.send({ t: "trapped" });
      } else if (m.t === "combo") {
        if (m.n >= 5) {
          if (this.mode === "couch") this.otherBoard(board).ui.announce(esc(board.name) + " ×" + m.n + " COMBO?!", 1600);
          else Net.send({ t: "combo", n: m.n });
        }
      } else if (m.t === "end") {
        const stats = Object.assign({}, board.arena.stats, { attacks: board.deck.attacksSent });
        this.results[board.name] = { score: m.score, reason: m.reason, stats };
        if (this.mode === "online") Net.send({ t: "end", score: m.score, reason: m.reason, stats });
        this.checkOver(board, m.reason);
      }
    }

    onArenaState(board, st) {
      board.ui.setMe(board.name, st.hearts, st.score);
      if (this.mode === "solo") { board.ui.setElapsed(st.elapsed); return; }
      board.ui.setTimer(st.left, st.dur);
      if (this.mode === "couch") {
        const other = this.otherBoard(board);
        board.ui.setThem(other.name, other.arena.hearts, other.arena.score);
      } else {
        board.ui.setThem(S.theirName, this.themState.hearts, this.themState.score);
      }
    }

    /* ----- remote messages ----- */
    onNet(m) {
      const me = this.boards[0];
      if (m.t === "atk") this.deliver(me, S.theirName, m.w, m.aimX, m.delay);
      else if (m.t === "hurt") {
        this.themState.hearts = m.hearts;
        me.deck.addCoins(HEART_BOUNTY);
        me.ui.announce("DIRECT HIT! +$" + HEART_BOUNTY, 1600);
      }
      else if (m.t === "trapped") me.ui.announce(esc(S.theirName) + " FELL FOR THE FAKE", 1800);
      else if (m.t === "combo") me.ui.announce(esc(S.theirName) + " ×" + m.n + " COMBO?!", 1600);
      else if (m.t === "rich") me.ui.announce(esc(S.theirName) + " IS SITTING ON $100+", 1800);
      else if (m.t === "st") { this.themState.score = m.score; this.themState.hearts = m.hearts; }
      else if (m.t === "end") {
        this.results[S.theirName] = { score: m.score, reason: m.reason, stats: m.stats };
        this.checkOver(null, m.reason);
      }
    }

    /* ----- start & finish ----- */
    countdownThenStart() {
      if (this.mode === "solo") this.boards[0].ui.announce("FREE PLAY — GO!", 1800);
      else {
        const vs = this.mode === "couch" ? [S.myName, S.p2Name] : [S.myName, S.theirName];
        this.boards.forEach((b) => b.ui.announce(esc(vs[0].toUpperCase()) + " ⚔ " + esc(vs[1].toUpperCase()), 2600));
      }
      const step = (k) => {
        if (this.over) return;
        if (k === 0) {
          this.boards.forEach((b) => b.ui.countdown("SLICE!"));
          SFX.combo(4);
          setTimeout(() => this.boards.forEach((b) => b.ui.countdown(null)), 500);
          this.boards.forEach((b) => { b.arena.resize(); b.arena.startRound(ROUND_MS); if (b.deck) b.deck.start(); });
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
            stats: wb ? Object.assign({}, wb.arena.stats, { attacks: wb.deck.attacksSent }) : null,
          };
        }
        this.finish({ winner, loser, ko: true });
        return;
      }
      if (names.every((n) => this.results[n])) {
        const [a, b] = names;
        const sa = this.results[a].score, sb = this.results[b].score;
        this.finish(sa === sb ? { tie: true } : { winner: sa > sb ? a : b, loser: sa > sb ? b : a, ko: false });
      } else if (this.mode === "online") {
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
        return esc(n) + " — " + st.fruit + " fruit · " + (st.perfects || 0) + " perfect · best ×" + (st.bestCombo || 0) + " · dodged " + st.bombsDodged + " · sent " + (st.attacks || 0);
      }).filter(Boolean).join("<br>");
      $("results-h2h").textContent = outcome.tie ? "" : this.recordWin(outcome.winner, outcome.loser);
      $("btn-rematch").disabled = false;
      $("results-status").textContent = "";
      S.myReady = S.theirReady = false;
      const iWon = outcome.winner === S.myName;
      if (this.mode === "couch" || iWon) SFX.fanfare(); else if (!outcome.tie) SFX.sad();
      show("screen-results");
    }

    finishSolo(board, score, reason) {
      this.over = true;
      this.stop();
      const prevBest = parseInt(Store.get("ss_solo_best") || "0", 10);
      const isBest = score > prevBest;
      if (isBest) Store.set("ss_solo_best", String(score));
      $("results-title").textContent = reason === "ko" ? "KO'D!" : "RUN OVER";
      $("results-lines").innerHTML = "Score: <b>" + score + "</b>" + (isBest ? " — NEW BEST! 🎉" : " · best " + Math.max(prevBest, score));
      const st = board.arena.stats;
      $("results-stats").innerHTML = st.fruit + " fruit · " + st.perfects + " perfect · best ×" + st.bestCombo + " · " + st.bombsDodged + " bombs dodged";
      $("results-h2h").textContent = "";
      $("btn-rematch").disabled = false;
      $("results-status").textContent = "";
      if (isBest) SFX.fanfare(); else SFX.tick();
      show("screen-results");
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
      clearInterval(this._qiv); clearInterval(this._stiv);
      this.boards.forEach((b) => {
        b.arena.stopRound(); b.arena.destroy();
        if (b.deck) b.deck.stop();
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
    S.mode = "solo"; S.isHost = true; S.myName = myName();
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
    ["atk", "hurt", "trapped", "combo", "rich", "st", "end"].forEach((t) =>
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

  window.__SS = S; // debug handle
})();
