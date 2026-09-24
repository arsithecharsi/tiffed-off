# TIFFED OFF!

*Slice. Sabotage. Survive.*

A two-player couples game — **Fruit Ninja × Bloons TD Battles**. You BOTH play
Fruit Ninja at the same time, each on your own board, while spending your
earnings to ruin each other's run.

## The loop

**Coins buy the attack. Skill powers the attack.**

- **Slice** fruit: +5 score / +$4 coins. Golden crit fruit: +10 / +$7.
  Real strawberries — **TIFF BERRIES** — pay +$8 (+$12 on a PERFECT), which
  is exactly what makes a fake one tempting.
- **Timing matters more than speed.** Slice near the top of the arc (low
  vertical speed) for a big score bonus — PERFECT (×1.8) or GREAT (×1.3).
- **TIFFED OFF meter** (0–100, the strip under the HUD). Only *quality* play
  fills it: GREAT +2, PERFECT +5, PERFECT berry +8, CLEAN ×3/×4/×5+ combos
  (every cut GREAT or better) +4/+7/+10, dud defuse +8, and surviving a sent
  attack without getting hit +4 (bomb) / +8 / +12 (FUMING+). Plain slices,
  passive income, being behind and getting hit give nothing. A hidden streak
  multiplier (×1.25 / ×1.5 / ×1.75 after 3 / 7 / 12 skill events in a row)
  fills it faster — you feel it as a hotter meter glow and louder PERFECTs.
  Misses −4, bombs −20, fakes −12, dud swipes −6 (all break the streak);
  after 2.5s with no skill event it decays 2.5%/s.
- **Tiers:** 40% HEATED, 70% FUMING, 100% TIFFED OFF. Every weapon fires at
  your current tier, and firing **vents** the meter (−20 / −33 / all of it).
  Spam is still possible; max-power spam isn't.
- **Combos** still pay bonus score, cash and a temporary income burst; CLEAN
  combos pay an extra $5.
- Bombs fall on their own too, escalating over the match. About 1 in 5 is a
  **dud** — green fuse sparks and a rippling dashed green ring. **Tap** it to
  defuse for +10 / +$15; swipe it and it fizzles for −10.
- Most random bursts are now **authored patterns**: Bomb Sandwich
  (fruit/bomb/fruit), Timing (three offset apexes), Crossing, High/Low Split.
- Losing a heart costs score too, and it gets worse each time: **−30 / −50 /
  −70** for your 1st/2nd/3rd heart. A close match can flip entirely on
  whoever's down to their last heart.
- **Spend** coins on attacks. They physically launch onto the other board on a
  randomized fuse, shown in the victim's **INCOMING lane** (items accelerate
  into the impact spark, shake in the hatched last-quarter danger zone, and
  are ringed by tier):
  - `BOMB $20`, 1.8s cooldown — cheap, fast, and silent (no banner) below
    100%. Flick the button to bias where it lands. **Repeat fatigue:** a 2nd
    bomb within 6s costs $25, a 3rd+ $32; a break or any other weapon resets
    it. HEATED: 3 bombs, tighter aim. FUMING: a staggered wall with a bait
    fruit in a gap. TIFFED OFF: the **Bomb Crown** — a V of bombs around a
    golden fruit plus a late riser underneath (announced).
  - `FAKE $45`, 4.5s cooldown — a bomb disguised as *any* fruit, with a faint
    purple shimmer. Slicing it costs 30 points *and* steals 20% of the
    victim's coins. HEATED/FUMING add 1/2 real fruit of the same kind beside
    it. TIFFED OFF: **Strawberry Patch** — five strawberries, one is fake.
  - `RUSH $50`, 9s cooldown — a chaos burst of fruit with real bombs hidden
    in it (6 objects; HEATED 8; FUMING 9 alternating sides with a dud mixed
    in). TIFFED OFF: **the Gauntlet** — 10 objects, fruit riding high and
    bombs peaking lower between them; one clean cut along the top clears it.
  - `GUST $55`, 14s cooldown — an immediate WHOOSH shoves everything airborne
    sideways, then for ~10s things can enter from any edge. Higher tiers
    shove harder and spawn denser; TIFFED OFF is a short 8s Category 5.
- Every attack is attributed: "TIFF GOT YOU!", "DODGED TIFF'S BOMB!", and the
  sender hears "TIFF SURVIVED YOUR FUMING RUSH". Your opponent's current heat
  (HEATED / FUMING / MAXED) is shown next to their name.
- Matches have chapters: SLICE → **SABOTAGE** (60s left) → **SURVIVE** (30s
  left), with a giant countdown behind the play for the last 10 seconds.
- **Win by KO** (all 3 of their hearts) **or top score** at 90 seconds.
- Post-match: stats, trash-talk headlines, and an all-time head-to-head tally.

Comeback aid: when you're 2 hearts or 120+ points behind, your income doubles.
Defense is dodging skill, not a purchase — every attack has real counterplay
built into reading it, not a button that blocks it for you.

## Play modes

- **Two Phones** — real-time online over WebRTC (PeerJS public cloud for
  matchmaking, then peer-to-peer). Host shares a 4-letter code. Brief Wi-Fi
  drops get a reconnect grace window.
- **One Device** — the screen splits in two; the top board is rotated 180° so
  you sit facing each other. Best on an iPad laid flat between you.
- **Practice vs GOD BOT** (test mode) — a full 90s match against a simulated
  god-tier opponent. The bot stands in for a remote phone (same messages as
  Two Phones), so it's the real PvP code path: it scores fast, heats up fast,
  and fires every weapon at every tier at you; your attacks land on it only
  5–35% of the time (more at higher tiers). A test strip under the meter:
  - **METER** — cycle LIVE / NORMAL / HEATED / FUMING / MAX to pin your meter
    at a tier (it re-pins right after each vent, so you can fire it again).
  - **FREE $ + NO CD** — unlimited cash, no cooldowns, no bomb fatigue.
  - **HIT ME** — your own attacks land on *your* board, to see how each tier
    looks and plays from the receiving end.
  - **BOT ATK** — switch the bot's attacks on/off.
  Bot matches never count toward the head-to-head or the playtest log.

Works in iOS Safari — use **Share → Add to Home Screen** for fullscreen and the
app icon.

## Run locally

```bash
node tools/serve.mjs
```

then open http://localhost:8123. Plain static files — no build step, no
dependencies (PeerJS from cdnjs, fonts from Google Fonts). All art is authored
SVG in `js/assets.js`; the icons are generated by `tools/make-icons.mjs`
(hand-encoded PNG, zero deps).

## Deploy (GitHub Pages)

Already live: **https://arsithecharsi.github.io/tiffed-off/**. To redeploy
after local changes:

```bash
git push origin main
```

GitHub Pages rebuilds automatically from the `main` branch root (usually
30–60s). For a fresh clone, the standard flow is `gh repo create` (or the web
UI) followed by **Settings → Pages → Deploy from a branch → main / (root)**.
Any static host works; there is no server code.

## Tech notes

- Each player's device is the authority for their own board, so slicing is
  always local and instant — only attacks, status, and results cross the wire.
- All physics are closed-form ballistics: positions are derived from spawn
  conditions, so a slow frame or backgrounded tab never desyncs a board.
- `window.__SS` is a debug handle to app state in the console.
- **Playtest log:** every finished PvP match appends a record to
  localStorage (`ss_playtest`, last 60): attacks sent, same-weapon repeats,
  attacks per tier, ending coins, average/peak meter, times maxed, PERFECTs,
  CLEAN combos, bomb/fake hits, winner, margin, KO. "copy playtest log" on
  the results card copies it as JSON (`__SS.playtestLog()` in the console).
- Deliberately deferred until the TIFFED OFF playtest answers its question
  (per the design notes' "first playtest build"): contextual onboarding,
  personal records, the rivalry tracker and "RUN IT BACK" results screen,
  the smooth comeback ramp, starting-economy changes, repeat fatigue on
  weapons other than Bomb, richer custom sound design.
