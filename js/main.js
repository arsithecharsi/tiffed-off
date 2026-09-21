/* Slice & Spite — app flow: screens, lobby, rounds, HUD, saboteur deck. */
(function () {
  const $ = (id) => document.getElementById(id);
  const { Arena, ROUND_MS } = Game;

  /* ---------- saboteur economy ---------- */
  const WEAPONS = [
    { id: "bomb",    e: "💣", n: "Bomb",    cost: 30, cd: 2000,  aim: true },
    { id: "cluster", e: "🎆", n: "Cluster", cost: 75, cd: 10000, aim: true },
    { id: "trap",    e: "🍉", n: "Trap",    cost: 45, cd: 5000,  aim: true },
    { id: "flood",   e: "🍒", n: "Flood",   cost: 25, cd: 6000,  aim: false },
    { id: "smoke",   e: "🌫️", n: "Smoke",  cost: 35, cd: 9000,  aim: false },
    { id: "eco",     e: "📈", n: "Eco",     cost: 60, cd: 8000,  aim: false, max: 3 },
  ];
  const ECO_BASE = 8, ECO_STEP = 4, START_COINS = 40, HEART_BOUNTY = 15;

  /* ---------- state ---------- */
  const S = {
    mode: null,            // 'online' | 'couch'
    isHost: false,
    myName: "", theirName: "", p2Name: "",
    round: 0,              // 1 | 2
    firstSlicer: null,     // online: 'host'|'guest' — couch: 'a'|'b'
    roundScores: [],       // [{name, score, reason}]
    arena: null,
    deck: null,
    iAmSlicer: false,
    myReady: false, theirReady: false,
    inGame: false,
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

  /* ---------- names ---------- */
  $("my-name").value = Store.get("ss_name") || "";
  $("p2-name").value = Store.get("ss_p2name") || "";
  function myName() { return ($("my-name").value.trim() || "Player 1").slice(0, 12); }
  function p2Name() { return ($("p2-name").value.trim() || "Player 2").slice(0, 12); }

  /* ---------- home ---------- */
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
  $("btn-online-back").onclick = () => { Net.close(); show("screen-home"); };
  $("btn-couch-back").onclick = () => show("screen-home");

  /* ---------- online setup ---------- */
  function wireNetFlow() {
    Net.handlers = {};
    Net.on("hi", (m) => {
      S.theirName = (m.name || "Partner").slice(0, 12);
      if (S.isHost) enterLobby();
    });
    Net.on("lobbyok", () => { if (!S.isHost) enterLobby(); });
    Net.on("start", (m) => beginRound(m.round, m.slicer, m.first));
    Net.on("ready", () => { S.theirReady = true; maybeAdvance(); });
    Net.on("send", (m) => { if (S.arena && S.iAmSlicer) S.arena.handleSend(m.w, m.aimX); });
    Net.on("end", (m) => onRoundEnd(m.score, m.reason, false));
    ["sp", "sl", "bh", "tr", "ms", "cb", "fx", "st"].forEach((t) =>
      Net.on(t, (m) => { if (S.arena && !S.iAmSlicer) S.arena.applyNet(m); })
    );
    Net.on("bh", (m) => {
      if (!S.iAmSlicer && S.deck) {
        S.deck.coins += HEART_BOUNTY;
        toast("💥 Direct hit! +$" + HEART_BOUNTY + " bounty");
      }
    });
    Net.on("tr", () => { if (!S.iAmSlicer) toast("😈 Trap landed!"); });
    Net.onClose = (why) => {
      if (S.inGame || document.querySelector(".screen.active").id !== "screen-home") {
        cleanupGame();
        show("screen-home");
        toast("📵 Connection lost");
      }
    };
  }

  const OFFLINE_HINT = "Can't reach the matchmaking server from here. If you're on the claude.ai link, online mode isn't available — play One Device instead!";

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

  /* ---------- couch setup ---------- */
  $("btn-couch-start").onclick = () => {
    S.mode = "couch"; S.isHost = true;
    S.myName = myName(); S.p2Name = p2Name();
    Store.set("ss_p2name", S.p2Name);
    enterLobby();
  };

  /* ---------- lobby ---------- */
  function enterLobby() {
    S.round = 0; S.roundScores = [];
    const a = S.myName, b = S.mode === "couch" ? S.p2Name : S.theirName;
    $("lobby-players").innerHTML =
      '<div class="pl">🍓 ' + esc(a) + "</div>" + '<div class="pl">🫐 ' + esc(b) + "</div>";
    if (S.isHost) {
      $("lobby-pick").classList.remove("hidden");
      $("pick-a").textContent = "🔪 " + a;
      $("pick-b").textContent = "🔪 " + b;
      $("lobby-status").textContent = "Loser of the coin toss throws bombs first 😉";
      $("pick-a").onclick = () => hostStart(S.mode === "couch" ? "a" : "host");
      $("pick-b").onclick = () => hostStart(S.mode === "couch" ? "b" : "guest");
    } else {
      $("lobby-pick").classList.add("hidden");
      $("lobby-status").textContent = "Waiting for " + esc(b) + " to pick who slices first…";
    }
    if (S.isHost && S.mode === "online") Net.send({ t: "lobbyok" });
    show("screen-lobby");
  }
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function hostStart(firstSlicer) {
    S.firstSlicer = firstSlicer;
    if (S.mode === "online") Net.send({ t: "start", round: 1, slicer: firstSlicer, first: firstSlicer });
    beginRound(1, firstSlicer, firstSlicer);
  }

  /* ---------- rounds ---------- */
  function slicerNameFor(slicerKey) {
    if (S.mode === "couch") return slicerKey === "a" ? S.myName : S.p2Name;
    return (slicerKey === "host") === S.isHost ? S.myName : S.theirName;
  }

  function beginRound(round, slicerKey, firstSlicer) {
    S.round = round; S.firstSlicer = firstSlicer || S.firstSlicer;
    S.myReady = S.theirReady = false;
    S.inGame = true;
    S.currentSlicerKey = slicerKey;
    S.iAmSlicer = S.mode === "couch" ? true : (slicerKey === "host") === S.isHost;

    cleanupArena();
    show("screen-game");

    const canvas = $("arena");
    const isAuthority = S.mode === "couch" || S.iAmSlicer;
    S.arena = new Arena(canvas, {
      mode: isAuthority ? "authority" : "mirror",
      slicing: isAuthority,
      onEvent: (m) => {
        if (S.mode === "online") Net.send(m);
        if (m.t === "end") onRoundEnd(m.score, m.reason, true);
        if (S.mode === "couch" && S.deck) {
          if (m.t === "bh") { S.deck.coins += HEART_BOUNTY; toast("💥 +$" + HEART_BOUNTY + " bounty for " + esc(bomberName())); }
        }
      },
      onState: updateHud,
      onEnd: () => {},
    });

    // saboteur deck
    const deckEl = $("bomber-deck");
    const needDeck = S.mode === "couch" || !S.iAmSlicer;
    deckEl.classList.toggle("hidden", !needDeck);
    if (needDeck) {
      S.deck = new Deck({
        couch: S.mode === "couch",
        onSend: (w, aimX) => {
          if (S.mode === "couch") S.arena.handleSend(w, aimX);
          else { Net.send({ t: "send", w, aimX: Math.round(aimX) }); S.arena.markAim(aimX); }
        },
      });
    } else S.deck = null;

    // online bomber: tap arena to throw the selected aimed weapon
    if (S.mode === "online" && !S.iAmSlicer) {
      canvas.onpointerdown = (ev) => {
        const wpt = S.arena.clientToWorld(ev.clientX, ev.clientY);
        if (S.deck) S.deck.fireAt(wpt.x);
      };
    } else canvas.onpointerdown = null;

    // countdown then go
    const slicerN = slicerNameFor(slicerKey);
    const banner = S.mode === "couch"
      ? "🔪 " + esc(slicerN) + " slices — 😈 " + esc(bomberName()) + " sabotages!"
      : S.iAmSlicer ? "🔪 You slice! Avoid the bombs!" : "😈 You sabotage! Ruin their run!";
    $("role-banner").innerHTML = banner;
    $("role-banner").classList.remove("hidden");
    runCountdown(3, () => {
      $("role-banner").classList.add("hidden");
      if (S.arena) S.arena.startRound(ROUND_MS);
      if (S.deck) S.deck.start();
    });
  }

  function bomberName() {
    if (S.mode === "couch") return S.currentSlicerKey === "a" ? S.p2Name : S.myName;
    return S.iAmSlicer ? S.theirName : S.myName;
  }

  function runCountdown(n, done) {
    const el = $("countdown");
    el.classList.remove("hidden");
    const step = (k) => {
      if (!S.inGame) { el.classList.add("hidden"); return; }
      if (k === 0) {
        el.textContent = "SLICE!";
        SFX.combo(4);
        setTimeout(() => { el.classList.add("hidden"); }, 500);
        done();
        return;
      }
      el.textContent = k; SFX.tick();
      setTimeout(() => step(k - 1), 800);
    };
    step(n);
  }

  /* ---------- HUD ---------- */
  let lastTickSec = 99;
  function updateHud(st) {
    const secs = Math.ceil(st.left / 1000);
    $("timer-fill").style.width = (st.left / st.dur * 100).toFixed(1) + "%";
    if (st.running && secs <= 5 && secs < lastTickSec) { SFX.tick(); }
    lastTickSec = secs;
    const hearts = "❤️".repeat(Math.max(0, st.hearts)) + "🖤".repeat(Math.max(0, Game.HEARTS - st.hearts));
    if (S.mode === "couch") {
      $("hud-left").innerHTML = '<span class="hearts">' + hearts + "</span>";
      $("hud-mid").innerHTML = '<span class="score">' + st.score + "</span>";
      $("hud-right").innerHTML = (S.deck ? '<span class="coins">$' + Math.floor(S.deck.coins) + "</span> " : "") + '<span class="sub">' + secs + "s</span>";
    } else if (S.iAmSlicer) {
      $("hud-left").innerHTML = '<span class="hearts">' + hearts + "</span>";
      $("hud-mid").innerHTML = '<span class="score">' + st.score + "</span>";
      $("hud-right").innerHTML = secs + "s";
    } else {
      $("hud-left").innerHTML = S.deck ? '<span class="coins">$' + Math.floor(S.deck.coins) + '</span> <span class="rate">+' + S.deck.rate() + "/s</span>" : "";
      $("hud-mid").innerHTML = '<span class="sub">' + esc(S.theirName) + "</span> <span class=\"score\">" + st.score + "</span> <span class=\"hearts\">" + hearts + "</span>";
      $("hud-right").innerHTML = secs + "s";
    }
  }

  /* ---------- round end / intermission / results ---------- */
  function onRoundEnd(score, reason, iWasAuthority) {
    if (!S.inGame) return;
    S.inGame = false;
    const slicerN = slicerNameFor(S.currentSlicerKey);
    S.roundScores[S.round - 1] = { name: slicerN, score, reason };
    if (S.deck) S.deck.stop();
    cleanupArena();

    if (S.round === 1) {
      $("inter-title").textContent = reason === "kaboom" ? "💥 KABOOM!" : "⏱ Time!";
      $("inter-lines").innerHTML =
        "🔪 " + esc(slicerN) + " scored <b>" + score + "</b>" +
        (reason === "kaboom" ? "<br><span class='hint'>…and exploded early 💀</span>" : "");
      const next = S.mode === "couch" ? (S.currentSlicerKey === "a" ? S.p2Name : S.myName) : (S.iAmSlicer ? S.theirName : S.myName);
      $("inter-next").innerHTML = "Now <b>" + esc(next) + "</b> takes the blade!";
      $("btn-ready").disabled = false;
      $("inter-status").textContent = "";
      show("screen-inter");
    } else {
      showResults();
    }
  }

  $("btn-ready").onclick = () => {
    S.myReady = true;
    $("btn-ready").disabled = true;
    if (S.mode === "online") {
      Net.send({ t: "ready" });
      $("inter-status").textContent = S.theirReady ? "" : "Waiting for partner…";
    }
    maybeAdvance();
  };

  function maybeAdvance() {
    if (!S.myReady) return;
    if (S.mode === "online" && !S.theirReady) return;
    if (document.querySelector(".screen.active").id === "screen-inter") {
      // round 2, roles swapped — host coordinates online
      const second = S.mode === "couch"
        ? (S.firstSlicer === "a" ? "b" : "a")
        : (S.firstSlicer === "host" ? "guest" : "host");
      if (S.mode === "couch") beginRound(2, second);
      else if (S.isHost) { Net.send({ t: "start", round: 2, slicer: second, first: S.firstSlicer }); beginRound(2, second); }
      // guest: waits for host 'start'
    } else if (document.querySelector(".screen.active").id === "screen-results") {
      const swapped = S.mode === "couch"
        ? (S.firstSlicer === "a" ? "b" : "a")
        : (S.firstSlicer === "host" ? "guest" : "host");
      if (S.mode === "couch") { S.roundScores = []; hostStart(swapped); }
      else if (S.isHost) { S.roundScores = []; S.firstSlicer = swapped; Net.send({ t: "start", round: 1, slicer: swapped, first: swapped }); beginRound(1, swapped, swapped); }
    }
  }

  function showResults() {
    const [r1, r2] = S.roundScores;
    let title, lines;
    lines =
      "🔪 " + esc(r1.name) + ": <b>" + r1.score + "</b>" + (r1.reason === "kaboom" ? " 💥" : "") + "<br>" +
      "🔪 " + esc(r2.name) + ": <b>" + r2.score + "</b>" + (r2.reason === "kaboom" ? " 💥" : "");
    if (r1.score === r2.score) { title = "🤝 It's a tie!"; SFX.fanfare(); }
    else {
      const winner = r1.score > r2.score ? r1 : r2;
      title = "🏆 " + esc(winner.name) + " wins!";
      const iWon = winner.name === S.myName;
      if (S.mode === "couch" || iWon) SFX.fanfare(); else SFX.sad();
      lines = lines.replace(esc(winner.name), "<span class='crown'>👑</span> " + esc(winner.name));
    }
    $("results-title").innerHTML = title;
    $("results-lines").innerHTML = lines;
    $("btn-rematch").disabled = false;
    $("results-status").textContent = "";
    S.myReady = S.theirReady = false;
    show("screen-results");
  }

  $("btn-rematch").onclick = () => {
    S.myReady = true;
    $("btn-rematch").disabled = true;
    if (S.mode === "online") {
      Net.send({ t: "ready" });
      $("results-status").textContent = S.theirReady ? "" : "Waiting for partner…";
    }
    maybeAdvance();
  };
  $("btn-home").onclick = () => { cleanupGame(); Net.close(); show("screen-home"); };

  function cleanupArena() {
    if (S.arena) { S.arena.destroy(); S.arena = null; }
  }
  function cleanupGame() {
    S.inGame = false;
    cleanupArena();
    if (S.deck) { S.deck.stop(); S.deck = null; }
    $("bomber-deck").classList.add("hidden");
  }

  /* ---------- saboteur deck ---------- */
  class Deck {
    constructor(opts) {
      this.couch = opts.couch;
      this.onSend = opts.onSend;
      this.coins = START_COINS;
      this.eco = 0;
      this.cds = {};       // id -> ready-at timestamp
      this.selected = "bomb";
      this.aimX = Game.W / 2;
      this.running = false;
      this.buildUI();
    }
    rate() { return ECO_BASE + this.eco * ECO_STEP; }
    start() { this.running = true; this.lastT = performance.now(); }
    stop() { this.running = false; clearInterval(this._iv); }

    buildUI() {
      const row = $("weapon-row");
      row.innerHTML = "";
      this.btns = {};
      WEAPONS.forEach((w) => {
        const b = document.createElement("button");
        b.className = "wpn";
        b.innerHTML = '<span class="we">' + w.e + '</span><span class="wn">' + w.n + '</span><span class="wc">$' + w.cost + '</span><div class="cdover" style="height:0"></div>';
        b.onpointerdown = (ev) => { ev.preventDefault(); this.tap(w); };
        row.appendChild(b);
        this.btns[w.id] = b;
      });
      const strip = $("aim-strip");
      strip.classList.toggle("hidden", !this.couch);
      if (this.couch) {
        const setAim = (ev) => {
          const r = strip.getBoundingClientRect();
          this.aimX = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * Game.W;
          $("aim-cursor").style.left = (this.aimX / Game.W * 100).toFixed(1) + "%";
        };
        strip.onpointerdown = (ev) => { strip.setPointerCapture(ev.pointerId); setAim(ev); };
        strip.onpointermove = (ev) => { if (ev.buttons) setAim(ev); };
      }
      this._iv = setInterval(() => this.tickUI(), 100);
      this.refresh();
    }

    tap(w) {
      if (!this.running) return;
      if (w.aim && !this.couch) {
        // online: select, then tap the arena to throw
        this.selected = w.id; this.refresh(); return;
      }
      this.tryFire(w, this.couch ? this.aimX : undefined);
    }

    fireAt(worldX) {
      // online bomber tapped the arena
      const w = WEAPONS.find((x) => x.id === this.selected);
      if (w && w.aim) this.tryFire(w, worldX);
    }

    tryFire(w, aimX) {
      const now = performance.now();
      if (!this.running) return;
      if ((this.cds[w.id] || 0) > now) { SFX.deny(); return; }
      if (w.id === "eco" && this.eco >= w.max) { SFX.deny(); toast("Eco is maxed out!"); return; }
      if (this.coins < w.cost) { SFX.deny(); toast("Not enough coins!"); return; }
      this.coins -= w.cost;
      this.cds[w.id] = now + w.cd;
      if (w.id === "eco") {
        this.eco++;
        SFX.coin();
        toast("📈 Eco " + this.eco + "/3 — income $" + this.rate() + "/s");
      } else {
        SFX.send();
        this.onSend(w.id, aimX);
      }
      this.refresh();
    }

    tickUI() {
      if (this.running) {
        const now = performance.now();
        this.coins += this.rate() * (now - this.lastT) / 1000;
        this.lastT = now;
      }
      this.refresh();
    }

    refresh() {
      const now = performance.now();
      WEAPONS.forEach((w) => {
        const b = this.btns[w.id];
        if (!b) return;
        const cdLeft = Math.max(0, (this.cds[w.id] || 0) - now);
        const maxed = w.id === "eco" && this.eco >= w.max;
        b.classList.toggle("cant", maxed || this.coins < w.cost || cdLeft > 0);
        b.classList.toggle("selected", !this.couch && w.aim && this.selected === w.id);
        b.querySelector(".cdover").style.height = cdLeft > 0 ? (cdLeft / w.cd * 100).toFixed(0) + "%" : "0";
        if (w.id === "eco") b.querySelector(".wn").textContent = "Eco " + this.eco + "/3";
      });
    }
  }

  /* ---------- global iOS niceties ---------- */
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("pointerdown", function unlock() {
    SFX.unlock();
  }, { once: false });

  const muteBtn = $("mute-btn");
  muteBtn.textContent = SFX.muted ? "🔇" : "🔊";
  muteBtn.onclick = () => { muteBtn.textContent = SFX.toggleMute() ? "🔇" : "🔊"; };

  $("join-code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });

  window.__SS = S; // debug handle
})();
