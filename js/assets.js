/* TIFFED OFF! — hand-drawn sprite & icon set. All art is authored SVG (lumpy
   paths, thick charcoal outlines, flat fills) rasterized once to canvases for
   the game loop. No emoji, no external images. */
(function () {
  const INK = "#2a2624";

  const wrap = (inner) =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<g stroke="' + INK + '" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">' +
    inner + "</g></svg>";

  const SPRITES = {
    apple: wrap(
      '<path d="M50 31 C29 25 15 43 20 63 C25 83 41 93 50 88 C59 93 75 83 80 63 C85 43 71 25 50 31 Z" fill="#e5254f"/>' +
      '<path d="M50 30 C49 21 52 14 59 10" fill="none"/>' +
      '<path d="M59 17 C70 9 79 15 77 23 C69 29 60 25 59 17 Z" fill="#3f9b4f"/>' +
      '<ellipse cx="35" cy="48" rx="6" ry="10" fill="#ff7f9c" stroke="none" transform="rotate(-18 35 48)"/>'
    ),
    orange: wrap(
      '<path d="M50 20 C72 18 86 36 84 56 C82 76 66 88 49 87 C31 86 16 74 16 54 C16 34 30 22 50 20 Z" fill="#f5920f"/>' +
      '<path d="M47 20 L53 14 L58 19" fill="#3f9b4f"/>' +
      '<circle cx="38" cy="50" r="2" fill="' + INK + '" stroke="none"/><circle cx="55" cy="63" r="2" fill="' + INK + '" stroke="none"/><circle cx="62" cy="42" r="2" fill="' + INK + '" stroke="none"/>' +
      '<ellipse cx="34" cy="38" rx="6" ry="9" fill="#ffc069" stroke="none" transform="rotate(-20 34 38)"/>'
    ),
    banana: wrap(
      '<path d="M22 24 C18 52 34 78 62 84 C74 87 84 84 88 78 C90 74 87 71 81 71 C57 70 38 52 34 28 C33 20 28 17 24 19 C22 20 22 21 22 24 Z" fill="#f7c81e"/>' +
      '<path d="M22 24 C21 20 23 18 26 18" fill="#7a5a2e"/>' +
      '<path d="M84 80 C86 79 88 78 88 77" fill="#7a5a2e"/>' +
      '<path d="M34 34 C38 54 52 68 68 74" fill="none" stroke-width="2.5" opacity="0.4"/>'
    ),
    melon: wrap(
      '<path d="M12 38 C14 74 40 92 50 92 C60 92 86 74 88 38 Z" fill="#3f9b4f"/>' +
      '<path d="M20 38 C22 66 43 83 50 83 C57 83 78 66 80 38 Z" fill="#f3ead8" stroke="none"/>' +
      '<path d="M26 38 C28 60 45 74 50 74 C55 74 72 60 74 38 Z" fill="#e5254f" stroke="none"/>' +
      '<ellipse cx="40" cy="50" rx="2.5" ry="4" fill="' + INK + '" stroke="none"/><ellipse cx="52" cy="60" rx="2.5" ry="4" fill="' + INK + '" stroke="none"/><ellipse cx="61" cy="48" rx="2.5" ry="4" fill="' + INK + '" stroke="none"/>'
    ),
    straw: wrap(
      '<path d="M50 92 C31 79 17 59 21 41 C24 27 39 22 50 28 C61 22 76 27 79 41 C83 59 69 79 50 92 Z" fill="#e5254f"/>' +
      '<path d="M31 33 L38 18 L46 30 L53 15 L61 30 L69 19 L73 33 C65 40 35 40 31 33 Z" fill="#3f9b4f"/>' +
      '<ellipse cx="38" cy="52" rx="2.5" ry="4" fill="#ffd9a8" stroke="none"/><ellipse cx="52" cy="62" rx="2.5" ry="4" fill="#ffd9a8" stroke="none"/><ellipse cx="62" cy="50" rx="2.5" ry="4" fill="#ffd9a8" stroke="none"/><ellipse cx="46" cy="74" rx="2.5" ry="4" fill="#ffd9a8" stroke="none"/>'
    ),
    pine: wrap(
      '<path d="M50 34 L42 16 L50 22 L50 12 L57 22 L64 15 L58 34 Z" fill="#3f9b4f"/>' +
      '<path d="M50 30 C67 30 76 44 75 61 C74 78 63 90 50 90 C37 90 26 78 25 61 C24 44 33 30 50 30 Z" fill="#f7c81e"/>' +
      '<path d="M30 44 L68 76 M28 58 L60 86 M40 34 L74 62" fill="none" stroke-width="2.5" opacity="0.45"/>' +
      '<path d="M70 44 L32 76 M72 58 L40 86 M60 34 L26 62" fill="none" stroke-width="2.5" opacity="0.45"/>'
    ),
    kiwi: wrap(
      '<circle cx="50" cy="54" r="36" fill="#8a6d4b"/>' +
      '<circle cx="50" cy="54" r="30" fill="#9ccb3b" stroke="none"/>' +
      '<circle cx="50" cy="54" r="12" fill="#eff3cd" stroke="none"/>' +
      '<g fill="' + INK + '" stroke="none"><ellipse cx="50" cy="35" rx="2" ry="4"/><ellipse cx="63" cy="42" rx="2" ry="4" transform="rotate(60 63 42)"/><ellipse cx="66" cy="58" rx="2" ry="4" transform="rotate(100 66 58)"/><ellipse cx="58" cy="70" rx="2" ry="4" transform="rotate(150 58 70)"/><ellipse cx="42" cy="70" rx="2" ry="4" transform="rotate(30 42 70)"/><ellipse cx="35" cy="58" rx="2" ry="4" transform="rotate(75 35 58)"/><ellipse cx="37" cy="43" rx="2" ry="4" transform="rotate(120 37 43)"/></g>'
    ),
    bomb: wrap(
      '<path d="M56 30 L64 22 C70 16 78 18 80 12" fill="none" stroke-width="6"/>' +
      '<path d="M80 12 L86 6 M86 14 L92 8 M78 4 L80 10" stroke="#f0a821" stroke-width="4" fill="none"/>' +
      '<rect x="48" y="26" width="18" height="12" rx="4" fill="#5a5566"/>' +
      '<circle cx="50" cy="62" r="30" fill="#35313c"/>' +
      '<ellipse cx="40" cy="52" rx="7" ry="10" fill="#5a5566" stroke="none" transform="rotate(-25 40 52)"/>'
    ),
  };

  /* small UI icons — same hand style, used inline in HTML */
  const ICONS = {
    heart: (fill) => wrap('<path d="M50 86 C20 62 11 40 24 28 C34 19 46 24 50 35 C54 24 66 19 76 28 C89 40 80 62 50 86 Z" fill="' + (fill || "#e5254f") + '"/>'),
    coin: () => wrap('<circle cx="50" cy="50" r="34" fill="#f0a821"/><circle cx="50" cy="50" r="24" fill="none" stroke-width="4"/><path d="M50 36 L50 64 M43 42 C43 38 57 38 57 44 C57 50 43 50 43 56 C43 62 57 62 57 58" fill="none" stroke-width="4"/>'),
    shield: () => wrap('<path d="M50 8 L83 21 C83 52 72 77 50 92 C28 77 17 52 17 21 Z" fill="#3f9b4f"/><path d="M50 20 L70 28 C70 50 63 66 50 77 Z" fill="#5cb96c" stroke="none"/>'),
    smoke: () => wrap('<circle cx="34" cy="62" r="18" fill="#b7afa4"/><circle cx="56" cy="48" r="22" fill="#c9c2b8"/><circle cx="72" cy="66" r="15" fill="#b7afa4"/>'),
    rush: () => wrap('<path d="M52 14 C60 26 70 32 78 34 M52 14 C46 26 40 34 30 40" fill="none"/><circle cx="30" cy="56" r="16" fill="#e5254f"/><circle cx="66" cy="62" r="18" fill="#c81e42"/>'),
    eco: () => wrap('<path d="M22 78 L42 54 L56 66 L80 32" fill="none" stroke-width="7"/><path d="M62 30 L82 28 L80 48" fill="none" stroke-width="7"/>'),
    fake: () => wrap('<path d="M50 92 C31 79 17 59 21 41 C24 27 39 22 50 28 C61 22 76 27 79 41 C83 59 69 79 50 92 Z" fill="#e5254f"/><path d="M31 33 L38 18 L46 30 L53 15 L61 30 L69 19 L73 33 C65 40 35 40 31 33 Z" fill="#3f9b4f"/><path d="M38 56 L62 72 M62 56 L38 72" stroke="#8c46c8" stroke-width="6" fill="none"/>'),
    spark: () => wrap('<path d="M50 10 L58 40 L88 50 L58 60 L50 90 L42 60 L12 50 L42 40 Z" fill="#f0a821"/><circle cx="50" cy="50" r="9" fill="#e5254f" stroke="none"/>'),
    skull: () => wrap('<path d="M50 14 C26 14 18 32 20 50 C21 60 26 64 30 68 L30 82 L40 78 L44 86 L56 86 L60 78 L70 82 L70 68 C74 64 79 60 80 50 C82 32 74 14 50 14 Z" fill="#f3ead8"/><circle cx="38" cy="46" r="7" fill="' + INK + '" stroke="none"/><circle cx="62" cy="46" r="7" fill="' + INK + '" stroke="none"/><path d="M50 56 L46 64 L54 64 Z" fill="' + INK + '" stroke="none"/>'),
    bombicon: () => SPRITES.bomb,
    bomb: () => SPRITES.bomb,
    strawhalf: () => wrap(
      '<path d="M50 27 C39 22 25 27 22 41 C18 59 32 79 50 92 Z" fill="#e5254f"/>' +
      '<path d="M50 33 C42 30 29 34 27 44 C24 58 36 74 50 86 Z" fill="#ff8fa8" stroke="none"/>' +
      '<path d="M50 42 C44 44 40 50 40 56 C40 66 45 74 50 80 Z" fill="#ffe3ea" stroke="none"/>' +
      '<path d="M50 30 L44 16 L36 30 L30 21 L27 35 C33 40 44 41 50 39 Z" fill="#3f9b4f"/>'
    ),
    strawhalf2: () => wrap(
      '<g transform="translate(100 0) scale(-1 1)">' +
      '<path d="M50 27 C39 22 25 27 22 41 C18 59 32 79 50 92 Z" fill="#e5254f"/>' +
      '<path d="M50 33 C42 30 29 34 27 44 C24 58 36 74 50 86 Z" fill="#ff8fa8" stroke="none"/>' +
      '<path d="M50 42 C44 44 40 50 40 56 C40 66 45 74 50 80 Z" fill="#ffe3ea" stroke="none"/>' +
      '<path d="M50 30 L44 16 L36 30 L30 21 L27 35 C33 40 44 41 50 39 Z" fill="#3f9b4f"/>' +
      "</g>"
    ),
    splat: () => wrap(
      '<path d="M50 48 C58 30 76 32 72 46 C88 44 90 60 76 62 C86 74 70 82 62 72 C58 88 42 86 42 74 C26 82 16 68 30 60 C16 56 22 40 36 44 C32 30 46 32 50 48 Z" fill="#e5254f" stroke-width="4"/>' +
      '<circle cx="84" cy="34" r="5" fill="#e5254f" stroke="none"/><circle cx="18" cy="42" r="4" fill="#e5254f" stroke="none"/><circle cx="66" cy="88" r="4" fill="#e5254f" stroke="none"/>'
    ),
  };

  const sprites = {};   // name -> {full, halves:[left, right]}

  function rasterize(name, svg) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 144;
        c.getContext("2d").drawImage(img, 4, 4, 136, 136);
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
        sprites[name] = { full: c, halves };
        resolve();
      };
      img.onerror = () => resolve(); // never block the game on one sprite
      img.src = "data:image/svg+xml;base64," + btoa(svg);
    });
  }

  window.Assets = {
    ready: Promise.all(Object.keys(SPRITES).map((k) => rasterize(k, SPRITES[k]))),
    get: (name) => sprites[name] || null,
    icon(name, size, arg) {
      const svg = ICONS[name](arg);
      return svg.replace("<svg ", '<svg width="' + size + '" height="' + size + '" style="vertical-align:-' + Math.round(size * 0.18) + 'px" ');
    },
  };
})();
