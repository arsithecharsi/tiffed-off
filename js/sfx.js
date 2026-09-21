/* Slice & Spite — tiny WebAudio synth, no sound files. */
(function () {
  // storage that never throws (iOS private mode, sandboxed embeds)
  window.Store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  let ctx = null;
  let muted = Store.get("ss_muted") === "1";

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function env(gain, t0, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function tone(freq, dur, type, peak, slideTo) {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env(g, t0, 0.005, peak || 0.15, dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, peak, band, bandQ, slideTo) {
    const c = ensure(); if (!c || muted) return;
    const t0 = c.currentTime;
    const len = Math.max(1, (dur + 0.05) * c.sampleRate) | 0;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain();
    env(g, t0, 0.004, peak, dur);
    let node = src;
    if (band) {
      const f = c.createBiquadFilter();
      f.type = "bandpass"; f.frequency.setValueAtTime(band, t0); f.Q.value = bandQ || 1;
      if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      src.connect(f); node = f;
    }
    node.connect(g).connect(c.destination);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  const SFX = {
    unlock() { ensure(); },
    get muted() { return muted; },
    toggleMute() { muted = !muted; Store.set("ss_muted", muted ? "1" : "0"); return muted; },
    swish()  { noise(0.12, 0.08, 1800, 1.2, 4200); },
    splat()  { noise(0.10, 0.22, 500, 0.8); tone(160, 0.09, "sine", 0.18, 90); },
    combo(n) { const base = 500 + Math.min(n, 6) * 120; tone(base, 0.1, "square", 0.08); setTimeout(() => tone(base * 1.5, 0.12, "square", 0.08), 70); },
    boom()   { tone(120, 0.5, "sine", 0.4, 40); noise(0.45, 0.35, 300, 0.6, 80); },
    trap()   { tone(300, 0.25, "sawtooth", 0.15, 90); noise(0.2, 0.15, 900, 1); },
    miss()   { tone(220, 0.15, "triangle", 0.1, 150); },
    coin()   { tone(900, 0.07, "square", 0.07); setTimeout(() => tone(1350, 0.1, "square", 0.07), 60); },
    send()   { noise(0.15, 0.1, 700, 1.4, 2400); },
    smoke()  { noise(0.7, 0.12, 400, 0.5, 150); },
    deny()   { tone(140, 0.12, "square", 0.08); },
    tick()   { tone(1000, 0.05, "square", 0.05); },
    heart()  { tone(320, 0.3, "sawtooth", 0.15, 110); },
    fanfare() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, "triangle", 0.14), i * 130));
    },
    sad() { [400, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, "triangle", 0.12), i * 160)); },
  };

  window.SFX = SFX;
})();
