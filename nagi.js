/* Nagi: page-local choreography. The engine stays untouched; everything
   bespoke reads scroll position itself and writes custom properties. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------ the slip -- */
  const slip = document.getElementById("slip");
  const links = [...slip.querySelectorAll("ol a")];
  const courses = links.map((a) => document.querySelector(a.getAttribute("href")));
  const currentLabel = slip.querySelector("[data-current]");
  const toggle = slip.querySelector(".slip__toggle");
  toggle.addEventListener("click", () => {
    const open = slip.dataset.open !== "true";
    slip.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.forEach((a) => a.addEventListener("click", () => { slip.dataset.open = "false"; toggle.setAttribute("aria-expanded", "false"); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && slip.dataset.open === "true") { slip.dataset.open = "false"; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); } });
  let lastIdx = -1;
  function updateSlip() {
    const mid = innerHeight * 0.45;
    let idx = 0;
    courses.forEach((c, i) => { if (c.getBoundingClientRect().top <= mid) idx = i; });
    if (idx === lastIdx) return;
    lastIdx = idx;
    links.forEach((a, i) => {
      a.classList.toggle("is-served", i < idx);
      if (i === idx) a.setAttribute("aria-current", "step"); else a.removeAttribute("aria-current");
    });
    currentLabel.textContent = links[idx].textContent;
  }

  /* --------------------------------------------------------- the dishes -- */
  const plates = document.getElementById("plates");
  const dishes = [...plates.querySelectorAll(".dish")];
  function updateRail() {
    const vw = innerWidth;
    dishes.forEach((d) => {
      const r = d.getBoundingClientRect();
      // settles as it crosses from the right edge into the frame
      d.style.setProperty("--settle", smooth(vw * 1.02, vw * 0.62, r.left).toFixed(3));
    });
  }

  /* ---------------------------------------------- course 1: the first plate --
     Serve (light comes up), sear (the aburi torch), clear (the plate is taken). */
  const hero = document.getElementById("plate");
  const stage = hero.querySelector("[data-hero]");
  const plateEl = hero.querySelector("[data-plate]");
  const img = plateEl.querySelector("img:not(.topping)");
  const tops = [...plateEl.querySelectorAll("[data-topping]")];
  const sear = plateEl.querySelector("[data-sear]");
  const flame = hero.querySelector("[data-flame]");
  const hint = hero.querySelector("[data-hint]");
  const hintText = hero.querySelector("[data-hint-text]");
  if (!finePointer) hintText.textContent = "Drag across the fish to sear it";
  else hintText.textContent = "Move the torch across the fish";

  const S = { ready: false, W: 0, H: 0, coverage: 0, fishTotal: 1, lastAuto: -1, autoT: 0, user: false, pointer: null, lastPointerAt: 0, done: false };
  let fishW, baseCtx, searedCanvas, maskCanvas, maskCtx, tmpCanvas, tmpCtx, sctx, fctx;
  let fishBox = { x0: 0.2, x1: 0.8, y0: 0.45, y1: 0.62 };

  function valueNoise(w, h, cell, seed) {
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const g = new Float32Array(gw * gh).map(() => rnd());
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = x / cell, gy = y / cell, ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      out[y * w + x] = lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
    }
    return out;
  }

  function prepare() {
    const W = 900, H = Math.round(W * img.naturalHeight / img.naturalWidth);
    S.W = W; S.H = H;
    // the plate as it will look once every topping has landed, and where the fish is
    const base = document.createElement("canvas"); base.width = W; base.height = H;
    baseCtx = base.getContext("2d", { willReadFrequently: true });
    baseCtx.drawImage(img, 0, 0, W, H);
    const fishC = document.createElement("canvas"); fishC.width = W; fishC.height = H;
    const fishCtx = fishC.getContext("2d", { willReadFrequently: true });
    tops.forEach((t) => {
      const x = parseFloat(t.style.left) / 100 * W, y = parseFloat(t.style.top) / 100 * H;
      const w = parseFloat(t.style.width) / 100 * W, h = parseFloat(t.style.height) / 100 * H;
      baseCtx.drawImage(t, x, y, w, h); fishCtx.drawImage(t, x, y, w, h);
    });
    const fishA = fishCtx.getImageData(0, 0, W, H).data;
    const src = baseCtx.getImageData(0, 0, W, H);
    const out = baseCtx.createImageData(W, H);
    const n1 = valueNoise(W, H, 17, 7), n2 = valueNoise(W, H, 5, 11), n3 = valueNoise(W, H, 34, 5);
    fishW = new Float32Array(W * H);
    let tot = 0, bx0 = W, bx1 = 0, by0 = H, by1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4;
      const r = src.data[o], g = src.data[o + 1], b = src.data[o + 2];
      const w = fishA[o + 3] / 255;
      fishW[i] = w;
      if (w > 0.4) { tot += w; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
      // the seared colour: browned all over, blistered dark patches, a little gloss
      const field = n1[i] * 0.6 + n3[i] * 0.4;
      const brown = 0.72 + 0.28 * smooth(0.25, 0.7, field);          // how far toward caramel
      let sr = r * lerp(1, 0.9, brown) + 14 * brown;
      let sg = g * lerp(1, 0.56, brown) + 6 * brown;
      let sb = b * lerp(1, 0.4, brown);
      const blister = 0.72 * smooth(0.54, 0.8, n1[i] * 0.55 + n2[i] * 0.2 + n3[i] * 0.25);
      sr = lerp(sr, 58, blister * 0.82); sg = lerp(sg, 30, blister * 0.84); sb = lerp(sb, 18, blister * 0.86);
      const rim = smooth(0.74, 0.8, n1[i] * 0.55 + n2[i] * 0.2 + n3[i] * 0.25) - smooth(0.8, 0.86, n1[i] * 0.55 + n2[i] * 0.2 + n3[i] * 0.25);
      sr -= rim * 30; sg -= rim * 22; sb -= rim * 14;                   // darker blister edges
      const gloss = smooth(0.78, 0.92, n2[i]) * (1 - blister);
      sr += gloss * 46; sg += gloss * 34; sb += gloss * 22;            // rendered fat catching light
      out.data[o] = clamp(sr, 0, 255); out.data[o + 1] = clamp(sg, 0, 255); out.data[o + 2] = clamp(sb, 0, 255);
      out.data[o + 3] = Math.round(clamp(w) * 255);
    }
    S.fishTotal = tot || 1;
    if (bx1 > bx0) fishBox = { x0: bx0 / W, x1: bx1 / W, y0: by0 / H, y1: by1 / H };
    searedCanvas = document.createElement("canvas"); searedCanvas.width = W; searedCanvas.height = H;
    searedCanvas.getContext("2d").putImageData(out, 0, 0);
    maskCanvas = document.createElement("canvas"); maskCanvas.width = W; maskCanvas.height = H;
    maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    tmpCanvas = document.createElement("canvas"); tmpCanvas.width = W; tmpCanvas.height = H;
    tmpCtx = tmpCanvas.getContext("2d");
    sear.width = W; sear.height = H;
    sctx = sear.getContext("2d");
    S.ready = true;
    sizeFlame();
  }

  function sizeFlame() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    flame.width = Math.round(flame.clientWidth * dpr);
    flame.height = Math.round(flame.clientHeight * dpr);
    fctx = flame.getContext("2d");
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintSear(nx, ny, strength) {
    const r = S.W * 0.06;
    const x = nx * S.W, y = ny * S.H;
    const g = maskCtx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    maskCtx.fillStyle = g;
    maskCtx.beginPath(); maskCtx.arc(x, y, r, 0, Math.PI * 2); maskCtx.fill();
  }

  function composeSear() {
    sctx.clearRect(0, 0, S.W, S.H);
    tmpCtx.globalCompositeOperation = "source-over";
    tmpCtx.clearRect(0, 0, S.W, S.H);
    tmpCtx.drawImage(searedCanvas, 0, 0);
    tmpCtx.globalCompositeOperation = "destination-in";
    tmpCtx.drawImage(maskCanvas, 0, 0);
    sctx.drawImage(tmpCanvas, 0, 0);
  }

  let coverageAt = 0;
  function measureCoverage() {
    // sampled, not every pixel: how much of the fish has been seared
    const d = maskCtx.getImageData(0, 0, S.W, S.H).data;
    let s = 0;
    for (let i = 0; i < fishW.length; i += 7) if (fishW[i] > 0.4) s += fishW[i] * (d[i * 4 + 3] / 255);
    S.coverage = clamp((s * 7) / S.fishTotal / 0.82);
  }

  // the automatic torch: a slow zigzag across the fish, tied to scroll, so
  // every visitor finishes the plate even without touching it
  function autoPath(t) {
    const passes = 3;
    const u = t * passes, k = Math.floor(Math.min(u, passes - 0.0001)), f = u - k;
    const dir = k % 2 === 0 ? f : 1 - f;
    const x = lerp(fishBox.x0 + 0.02, fishBox.x1 - 0.02, dir);
    const y = lerp(fishBox.y0 + 0.03, fishBox.y1 - 0.03, (k + 0.5) / passes) + Math.sin(f * Math.PI * 3) * 0.012;
    return [x, y];
  }

  const particles = [];
  function spawn(px, py, heat) {
    if (particles.length > 180) return;
    for (let i = 0; i < 3 * heat; i++) particles.push({ x: px + (Math.random() - 0.5) * 10, y: py, vx: (Math.random() - 0.3) * 0.6, vy: -0.6 - Math.random() * 1.2, life: 1, smoke: Math.random() < 0.45, r: 2 + Math.random() * 3 });
  }

  function drawFlame(px, py, intensity, t) {
    // a kitchen torch: nozzle up and to the right, blue core, orange tongue
    const ctx = fctx;
    const len = 150 + 18 * Math.sin(t * 0.031) + 10 * Math.sin(t * 0.077);
    const ang = Math.PI * 0.80 + 0.04 * Math.sin(t * 0.05);
    const nx = px - Math.cos(ang) * len, ny = py - Math.sin(ang) * len;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const blob = (x, y, r, h, s, l, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${h}, ${s}%, ${l}%, ${a})`);
      g.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    // heat bloom where the flame meets the fish
    blob(px, py, 110, 26, 100, 55, 0.5 * intensity);
    blob(px, py, 46, 38, 100, 70, 0.55 * intensity);
    // the flame: a stream of glowing blobs from the nozzle to the fish,
    // blue-white at the nozzle, yellow, then orange where it splashes
    const dx = px - nx, dy = py - ny, perpX = -dy / len, perpY = dx / len;
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const flick = Math.sin(t * 0.21 + i * 1.7) * (2 + 7 * u) + Math.sin(t * 0.47 + i) * 2 * u;
      const x = nx + dx * u + perpX * flick, y = ny + dy * u + perpY * flick;
      if (u < 0.3) {
        blob(x, y, 5 + 10 * u, 212, 100, 82, 0.55 * intensity);       // the blue cone
        blob(x, y, 3 + 4 * u, 200, 60, 96, 0.8 * intensity);
      } else {
        const h = lerp(48, 18, (u - 0.3) / 0.7);
        blob(x, y, 9 + 26 * u, h, 100, 58, 0.34 * intensity);
        blob(x, y, 4 + 10 * u, h + 8, 100, 80, 0.4 * intensity);
      }
    }
    // the splash: flame spreading flat across the surface
    for (let k = -2; k <= 2; k++) blob(px + k * 14 + Math.sin(t * 0.3 + k) * 4, py + Math.abs(k) * 3, 26 - Math.abs(k) * 4, 28, 100, 60, 0.35 * intensity);
    ctx.restore();
    // the nozzle itself
    ctx.save();
    ctx.translate(nx, ny); ctx.rotate(ang);
    const ng = ctx.createLinearGradient(-60, -6, -60, 6);
    ng.addColorStop(0, "#5b6670"); ng.addColorStop(0.5, "#c9d1d8"); ng.addColorStop(1, "#38424b");
    ctx.fillStyle = ng; ctx.fillRect(-64, -5, 62, 10);
    ctx.fillStyle = "#1b232b"; ctx.fillRect(-120, -11, 58, 22);
    ctx.restore();
  }

  function drawParticles() {
    const ctx = fctx;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.life -= p.smoke ? 0.008 : 0.03; p.vy *= 0.995;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.smoke) {
        p.r += 0.35;
        ctx.fillStyle = `hsla(210, 10%, 75%, ${0.06 * p.life})`;
      } else {
        ctx.fillStyle = `hsla(${30 + 20 * p.life}, 100%, 65%, ${0.9 * p.life})`;
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.smoke ? p.r : 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // pointer and touch: the torch follows where you are over the plate
  function toLocal(e) {
    const r = plateEl.getBoundingClientRect();
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  }
  function onMove(e) {
    if (!S.ready || hero.dataset.phase !== "torch") { S.pointer = null; return; }
    if (e.pointerType === "touch" && e.buttons === 0 && e.type === "pointermove") return;
    S.pointer = { ...toLocal(e), cx: e.clientX, cy: e.clientY };
    S.lastPointerAt = performance.now();
    S.user = true;
  }
  plateEl.addEventListener("pointermove", onMove);
  plateEl.addEventListener("pointerdown", onMove);
  plateEl.addEventListener("pointerleave", () => { S.pointer = null; });

  function heroProgress() {
    const r = hero.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - innerHeight));
  }

  let frame = 0;
  function heroFrame() {
    const p = heroProgress();
    const visible = hero.getBoundingClientRect().bottom > 0;
    if (!visible) { stage.dataset.scVerifyState = "off"; return; }
    frame++;

    // serve: the plate comes up into the light
    const serve = smooth(0.0, 0.12, p);
    // clear: gloved hands take the plate up and away
    const clear = smooth(0.76, 0.98, p);
    const torchWindow = p > 0.34 && p < 0.76;
    hero.dataset.phase = torchWindow ? "torch" : (p <= 0.34 ? "serve" : "clear");

    // the drop: back to front, each topping falls onto its rice and settles
    let landed = 0;
    tops.forEach((t, i) => {
      const a = 0.07 + i * 0.055, b = a + 0.1;
      const u = clamp((p - a) / (b - a));
      if (u >= 1) landed++;
      if (reduced) { t.style.opacity = u > 0 ? "1" : "0"; t.style.transform = "none"; return; }
      const fall = u < 0.82 ? Math.pow(u / 0.82, 2) : 1;                       // gravity
      const settle = u < 0.82 ? 0 : (u - 0.82) / 0.18;                          // the small give on impact
      const squash = settle > 0 ? Math.sin(settle * Math.PI) * 0.07 : 0;
      const dy = (1 - fall) * -innerHeight * 0.75;
      const rot = (1 - fall) * (i % 2 ? -9 : 7);
      t.style.opacity = u <= 0 ? "0" : String(clamp(u * 6));
      t.style.transform = "translate3d(0, " + dy.toFixed(1) + "px, 0) rotate(" + rot.toFixed(2) + "deg) scale(" + (1 + squash * 0.6).toFixed(3) + ", " + (1 - squash).toFixed(3) + ")";
    });

    const st = stage.style;
    st.setProperty("--plate-b", lerp(0.34, 1, serve).toFixed(3));
    st.setProperty("--plate-sat", lerp(0.75, 1.04, serve).toFixed(3));
    st.setProperty("--room-o", (lerp(0.12, 0.42, serve) * (1 - clear * 0.8)).toFixed(3));
    st.setProperty("--glow-a", (lerp(0.04, 0.16, serve) + (S.done ? 0.04 : 0)).toFixed(3));
    if (!reduced) {
      st.setProperty("--plate-s", lerp(0.94, 1, serve).toFixed(4));
      st.setProperty("--plate-y", `${(lerp(36, 0, serve) - clear * innerHeight * 1.15).toFixed(1)}px`);
      st.setProperty("--plate-x", `${(clear * innerWidth * 0.04).toFixed(1)}px`);
      st.setProperty("--plate-r", `${(-clear * 5).toFixed(2)}deg`);
      st.setProperty("--room-y", `${(-p * 60).toFixed(1)}px`);
      st.setProperty("--room-s", (1.12 + p * 0.06).toFixed(4));
    } else {
      plateEl.style.opacity = (1 - clear).toFixed(3);
    }

    if (!S.ready) return;

    // the seared layer sits at the toppings' resting places, so it may only show
    // once every topping has landed; scrolling back above the drop serves the plate raw again
    const allLanded = landed === tops.length;
    sear.style.opacity = allLanded ? "1" : "0";
    if (!allLanded && (S.coverage > 0 || S.lastAuto >= 0 || S.done)) {
      maskCtx.clearRect(0, 0, S.W, S.H);
      S.coverage = 0; S.done = false; S.user = false; S.lastAuto = -1; S.pointer = null;
      hintText.textContent = finePointer ? "Move the torch across the fish" : "Drag across the fish to sear it";
    }

    // the torch: the visitor's pointer first, the automatic pass otherwise
    const autoT = smooth(0.36, 0.7, p);
    let torch = null, intensity = 0;
    const userActive = S.pointer && performance.now() - S.lastPointerAt < 900 && torchWindow;
    if (userActive) {
      torch = S.pointer; intensity = 1;
      if (S.pointer.nx > 0 && S.pointer.nx < 1 && S.pointer.ny > 0 && S.pointer.ny < 1) paintSear(S.pointer.nx, S.pointer.ny, 0.09);
    } else if (torchWindow && autoT > 0 && autoT < 1 && S.coverage < 0.98) {
      // paint along the path between the last scroll position and this one
      const from = S.lastAuto < 0 ? autoT : S.lastAuto;
      if (Math.abs(autoT - from) > 0.0005) {
        const steps = Math.ceil(Math.abs(autoT - from) / 0.004);
        for (let i = 1; i <= steps; i++) { const [ax, ay] = autoPath(lerp(from, autoT, i / steps)); paintSear(ax, ay, reduced ? 0.5 : 0.22); }
      }
      const [ax, ay] = autoPath(autoT);
      torch = { nx: ax, ny: ay };
      intensity = Math.abs(autoT - (S.lastAuto < 0 ? autoT : S.lastAuto)) > 0.0003 ? 1 : 0.55;
    }
    // reduced motion, or a visitor who scrolled straight past: the sear follows scroll
    if (allLanded && p > 0.34 && (reduced || (!S.user && p > 0.7 && S.coverage < 0.9))) {
      maskCtx.globalAlpha = 0.25; maskCtx.fillStyle = "#000";
      maskCtx.fillRect(0, 0, S.W, S.H); maskCtx.globalAlpha = 1;
    }
    S.lastAuto = autoT;
    composeSear();
    if (frame - coverageAt > 12) { measureCoverage(); coverageAt = frame; }
    if (S.coverage > 0.86 && !S.done) { S.done = true; hintText.textContent = "Seared. Ready to serve"; }

    // hint visibility
    hint.style.setProperty("--hint-o", (smooth(0.33, 0.4, p) * (1 - smooth(0.68, 0.76, p))).toFixed(3));

    // flame + particles
    const fw = flame.clientWidth, fh = flame.clientHeight;
    fctx.clearRect(0, 0, fw, fh);
    if (!reduced) {
      const pr = plateEl.getBoundingClientRect(), sr = flame.getBoundingClientRect();
      if (torch && intensity > 0) {
        const px = pr.left - sr.left + torch.nx * pr.width;
        const py = pr.top - sr.top + torch.ny * pr.height;
        drawFlame(px, py, intensity, frame);
        if (frame % 2 === 0) spawn(px, py, intensity);
      }
      drawParticles();
    }

    stage.dataset.scVerifyState = [p.toFixed(2), landed, Math.round(S.coverage * 20), torch ? 1 : 0].join(":");
  }

  /* ------------------------------------------- course 3: flour in the air -- */
  const noodles = document.getElementById("noodles");
  const flourC = noodles.querySelector("[data-flour]");
  const flourCtx = flourC.getContext("2d");
  const motes = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, ph: Math.random() * 6.28 }));
  let lastY = scrollY, vel = 0;
  function flourFrame() {
    const r = noodles.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || reduced) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = flourC.clientWidth, h = flourC.clientHeight;
    if (flourC.width !== Math.round(w * dpr)) { flourC.width = Math.round(w * dpr); flourC.height = Math.round(h * dpr); }
    flourCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    flourCtx.clearRect(0, 0, w, h);
    // scroll speed stirs the flour; standing still lets it settle
    const stir = clamp(Math.abs(vel) / 30, 0, 1);
    motes.forEach((m) => {
      m.ph += 0.01 + stir * 0.05;
      m.y += (0.0006 + stir * 0.004 * Math.sign(vel || 1)) * m.z;
      m.x += Math.sin(m.ph) * 0.0006 * m.z;
      if (m.y > 1.05) m.y = -0.05; if (m.y < -0.05) m.y = 1.05;
      const a = (0.18 + 0.4 * stir) * m.z;
      flourCtx.fillStyle = `rgba(245, 238, 225, ${a})`;
      flourCtx.beginPath(); flourCtx.arc(m.x * w, m.y * h, 0.6 + m.z * 1.6, 0, 6.283); flourCtx.fill();
    });
  }

  /* ---------------------------------------------------------------- loop -- */
  function tick() {
    vel = lerp(vel, scrollY - lastY, 0.2); lastY = scrollY;
    updateSlip();
    updateRail();
    heroFrame();
    flourFrame();
    requestAnimationFrame(tick);
  }
  // every layer must be decoded before the sear map is built from them
  Promise.all([img, ...tops].map((el) => (el.decode ? el.decode().catch(() => {}) : Promise.resolve()))).then(prepare);
  addEventListener("resize", () => { if (S.ready) sizeFlame(); });
  requestAnimationFrame(tick);
})();
