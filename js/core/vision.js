// ==========================================
// DARK PEONY — «КОМПЬЮТЕРНОЕ ЗРЕНИЕ» (HUD поверх любой фигуры)
// ==========================================
// Эстетика отладочного вывода трекинга объектов (blob tracking, видео автора IMG_0008–0011).
// Модуль отдельный: фигуры не трогает.
//  • Зрение: несколько раз в секунду готовый кадр уменьшается (≈190×110), в нём ищутся яркие и контрастные
//    места (локальные максимумы) — это «находки». Находки сопоставляются с дорожками (tracks) прошлых кадров:
//    рамки ездят за видимыми деталями и перескакивают, как у трекера. Нет доступа к кадру (или track = 0) —
//    находки берутся из точек фигуры (раскладка морфинга) и движущихся тел (instance.visionAnchors()).
//  • Сеансы разной силы: лёгкий (3–6 рамок), средний (10–20), всплеск (30–50, коротко); паузы случайные.
//  • Рой: у сеанса есть место интереса — большинство рамок там, часть бродит по кадру.
//  • Быстрая смена: рамка живёт 0.1–1 с, номера растут, как у трекера.
//  • Сеть: у каждой рамки 2–4 соседа + несколько длинных линий; голые метки «_номер» без рамки.
//  • Размеры по уровням: много крошечных, немного средних (по размеру пятна), редкие крупные.
//  • Заливки: контур; полупрозрачная заливка цветом пятна; инверсия (свой слой, difference);
//    «кусок картинки со сдвигом» (глитч). Координаты x/y/z — только у редких рамок, одной строкой.
// Во время морфинга не работает. Выключить: ?vision=0 или ползунок «включено».
(function (DP) {
    'use strict';
    if (!DP.stage) return;

    const C = DP.config.vision = Object.assign({
        enabled: DP.params.get('vision') === '0' ? 0 : 1,
        track: 1,                   // 1 — рамки по самой картинке (чтение уменьшенного кадра), 0 — по точкам фигуры
        gapMin: 6, gapMax: 22,      // пауза между сеансами, с (случайно, чаще короткие; иногда повтор сразу)
        durMin: 1.5, durMax: 5,     // длительность сеанса, с (всплеск — короче)
        density: 1,                 // множитель числа рамок
        medium: 0.35, burst: 0.15,  // вероятность среднего сеанса и всплеска (остальное — лёгкий)
        cluster: 0.7,               // доля рамок в рое у места интереса
        links: 3,                   // соседей у рамки (в среднем)
        invert: 0.2, tint: 0.2, glitch: 0.1,   // доли рамок с инверсией / заливкой цветом / куском картинки
        bare: 0.3,                  // доля голых меток без рамки
        coords: 0.1,                // доля рамок с координатами
        alpha: 0.8                  // видимость всего слоя
    }, DP.config.vision || {});

    const glCanvas = DP.stage.renderer.domElement;
    const mk = (id, blend, z) => {
        const c = document.createElement('canvas');
        c.id = id; c.style.pointerEvents = 'none'; c.style.zIndex = z;
        if (blend) c.style.mixBlendMode = 'difference';
        document.body.appendChild(c);
        return c;
    };
    const cv = mk('visionCanvas', false, '6'), ci = mk('visionInvert', true, '7');
    const g = cv.getContext('2d'), gi = ci.getContext('2d');
    // уменьшенный кадр для зрения
    const sc = document.createElement('canvas'), sg = sc.getContext('2d', { willReadFrequently: true });
    let W = 0, H = 0, dpr = 1, SW = 192, SH = 108;
    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth; H = window.innerHeight;
        [cv, ci].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
        [g, gi].forEach(x => x.setTransform(dpr, 0, 0, dpr, 0, 0));
        SW = 192; SH = Math.max(40, Math.round(SW * H / Math.max(1, W)));
        sc.width = SW; sc.height = SH;
    }
    window.addEventListener('resize', resize);
    resize();

    const rnd = Math.random;
    const lerp = (a, b, t) => a + (b - a) * t;
    let nextId = 3900 + Math.floor(rnd() * 80);
    let next = 4 + rnd() * 4;
    let session = null, lastFigure = null, wasMorphing = false, trackOk = true, forceKind = null;
    const v3 = new THREE.Vector3();

    // ---------- находки ----------
    let lum = new Float32Array(0), tmp = new Float32Array(0), bl = new Float32Array(0);
    const score = (i) => lum[i] * 0.6 + Math.max(0, lum[i] - bl[i]) * 2.2;
    function detectImage() {
        try {
            sg.drawImage(glCanvas, 0, 0, SW, SH);
            const d = sg.getImageData(0, 0, SW, SH).data, n = SW * SH;
            if (lum.length !== n) { lum = new Float32Array(n); tmp = new Float32Array(n); bl = new Float32Array(n); }
            for (let i = 0; i < n; i++) lum[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.55 + d[i * 4 + 2] * 0.15) / 255;
            // размытие 5×5 (разделимое) — фон для контраста
            for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
                let s = 0, c = 0;
                for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < SW) { s += lum[y * SW + xx]; c++; } }
                tmp[y * SW + x] = s / c;
            }
            for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
                let s = 0, c = 0;
                for (let k = -2; k <= 2; k++) { const yy = y + k; if (yy >= 0 && yy < SH) { s += tmp[yy * SW + x]; c++; } }
                bl[y * SW + x] = s / c;
            }
            const out = [];
            const m = 4, bottom = SH * 0.9;
            for (let y = m; y < bottom - m; y++) for (let x = m; x < SW - m; x++) {
                const i = y * SW + x, s0 = score(i);
                if (s0 < 0.12) continue;
                let ok = true;                                               // локальный максимум в окне 5×5
                for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) {
                    if ((dx || dy) && score(i + dy * SW + dx) > s0) { ok = false; break; }
                }
                if (!ok) continue;
                const L = lum[i];
                let r = 1;                                                   // размер пятна: где яркость падает вдвое
                while (r < 14 && x - r > 0 && x + r < SW - 1 && y - r > 0 && y + r < SH - 1 &&
                       (lum[i - r] + lum[i + r] + lum[i - r * SW] + lum[i + r * SW]) * 0.25 > L * 0.5) r++;
                out.push({ x: (x + 0.5) / SW * W, y: (y + 0.5) / SH * H, size: r * 2 * W / SW, score: s0,
                           col: [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]] });
            }
            out.sort((a, b) => b.score - a.score);
            return out.slice(0, 160);
        } catch (e) { trackOk = false; return null; }   // кадр недоступен — работаем по точкам фигуры
    }
    // Находки по точкам фигуры (запасной путь).
    function detectPoints(inst) {
        const L = inst.layout, parts = L && L.parts, out = [];
        if (!parts || !parts.length) return out;
        const skip = inst.visionSkip, fm = DP.stage.figureStage.matrixWorld, cam = DP.stage.camera;
        const push = (x, y, z, size, s) => {
            v3.set(x, y, z).applyMatrix4(fm).project(cam);
            const sx = (v3.x + 1) / 2 * W, sy = (1 - v3.y) / 2 * H;
            if (v3.z < 1 && sx > 20 && sx < W - 20 && sy > 50 && sy < H * 0.9) out.push({ x: sx, y: sy, size, score: s, col: [200, 225, 255] });
        };
        for (let k = 0; k < 90; k++) {
            const pi = Math.floor(rnd() * parts.length), p = parts[pi];
            if (!p.count || (skip && skip.has(pi))) continue;
            const i = Math.floor(rnd() * p.count);
            const x = p.rest[i * 3], y = p.rest[i * 3 + 1], z = p.rest[i * 3 + 2];
            push(x, y, z, lerp(6, 40, rnd()), 0.3 + Math.hypot(x, y * 0.6, z) * 0.2);
        }
        (inst.visionAnchors ? inst.visionAnchors() : []).forEach(a => push(a.x, a.y, a.z, 30, 1));
        return out.sort((a, b) => b.score - a.score);
    }

    // ---------- сеанс ----------
    function newSession(T) {
        const u = rnd();
        const kind = forceKind || (u < C.burst ? 'burst' : u < C.burst + C.medium ? 'medium' : 'light');
        forceKind = null;
        const range = kind === 'burst' ? [30, 50] : kind === 'medium' ? [10, 20] : [3, 6];
        const dur = kind === 'burst' ? lerp(1, 2, rnd()) : lerp(C.durMin, C.durMax, rnd());
        return { kind, T0: T, dur, target: Math.max(1, Math.round(lerp(range[0], range[1], rnd()) * C.density)),
                 focus: null, tracks: [], links: [], nextDetect: 0 };
    }
    function spawn(S, det, T) {
        const t = rnd();
        const tier = t < 0.6 ? 'tiny' : t < 0.92 ? 'mid' : 'big';
        const size = tier === 'tiny' ? lerp(5, 13, rnd()) : tier === 'mid' ? Math.min(60, Math.max(16, det.size * lerp(1, 1.8, rnd()))) : lerp(55, 115, rnd());
        const f = rnd();
        const fill = tier === 'tiny' ? 'none' : f < C.invert ? 'invert' : f < C.invert + C.tint ? 'tint' : f < C.invert + C.tint + C.glitch ? 'glitch' : 'none';
        S.tracks.push({
            id: nextId += 1 + Math.floor(rnd() * 2), x: det.x, y: det.y, size, aspect: lerp(0.65, 1.5, rnd()),
            born: T, life: lerp(0.1, 1.0, Math.pow(rnd(), 0.8)) * (S.kind === 'burst' ? 0.7 : 1), seen: T,
            bare: tier === 'tiny' && rnd() < C.bare / 0.6, fill, col: det.col,
            coords: rnd() < C.coords, gx: (rnd() - 0.5) * 80, gy: (rnd() - 0.5) * 80, jx: 0, jy: 0, jt: 0
        });
    }
    function step(S, T, inst) {
        if (T >= S.nextDetect) {                                            // находки — ~12 раз в секунду
            S.nextDetect = T + 0.08;
            let dets = (C.track && trackOk) ? detectImage() : null;
            if (!dets || !dets.length) dets = detectPoints(inst);
            if (!S.focus && dets.length) { const f = dets[Math.floor(rnd() * Math.min(8, dets.length))]; S.focus = { x: f.x, y: f.y }; }
            // сопоставление: каждая дорожка берёт ближайшую свободную находку
            const used = new Set(), R = Math.max(W, H) * 0.05;
            S.tracks.forEach(tr => {
                let bi = -1, bd = R;
                dets.forEach((d, i) => { if (used.has(i)) return; const dd = Math.hypot(d.x - tr.x, d.y - tr.y); if (dd < bd) { bd = dd; bi = i; } });
                if (bi >= 0) { used.add(bi); const d = dets[bi]; tr.x = lerp(tr.x, d.x, 0.7); tr.y = lerp(tr.y, d.y, 0.7); tr.seen = T; tr.col = d.col; }
            });
            if (T <= S.T0 + S.dur) {                                        // сеанс идёт — пополняем
                const sig = Math.min(W, H) * 0.16;
                const want = S.target - S.tracks.length;
                for (let k = 0; k < want && dets.length; k++) {
                    const inCluster = rnd() < C.cluster && S.focus;
                    let pick = -1;
                    for (let tries = 0; tries < 12 && pick < 0; tries++) {
                        const di = Math.floor(Math.pow(rnd(), 2) * dets.length), d = dets[di];
                        if (used.has(di)) continue;
                        if (inCluster) { const dd = Math.hypot(d.x - S.focus.x, d.y - S.focus.y); if (rnd() > Math.exp(-dd * dd / (2 * sig * sig))) continue; }
                        pick = di;
                    }
                    if (pick >= 0) { used.add(pick); spawn(S, dets[pick], T); }
                }
                if (S.focus && dets.length) { const d = dets[0]; S.focus.x = lerp(S.focus.x, d.x, 0.02); S.focus.y = lerp(S.focus.y, d.y, 0.02); }
            }
            S.tracks = S.tracks.filter(tr => T - tr.born < tr.life && T - tr.seen < 0.3);
            // связи: 2–4 ближайших + несколько длинных
            const tr = S.tracks;
            S.links = [];
            tr.forEach((a, i) => {
                const k = Math.max(1, Math.round(C.links + (rnd() - 0.5) * 2));
                tr.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2]).filter(e => e[0] !== i).sort((p, q) => p[1] - q[1])
                  .slice(0, k).forEach(e => { if (e[0] > i || rnd() < 0.3) S.links.push([tr[i], tr[e[0]]]); });
            });
            const nLong = Math.round(tr.length * 0.12);
            for (let k = 0; k < nLong && tr.length > 3; k++) S.links.push([tr[Math.floor(rnd() * tr.length)], tr[Math.floor(rnd() * tr.length)]]);
        } else {
            S.tracks = S.tracks.filter(tr => T - tr.born < tr.life);
        }
    }

    // ---------- рисование ----------
    const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(6);
    function vis(tr, T) {
        const t = T - tr.born;
        if (t < 0 || t > tr.life) return 0;
        if (t < 0.05) return Math.floor(t * 60) % 2 ? 1 : 0.3;                // вход миганием
        if (t > tr.life - 0.05) return Math.floor(t * 60) % 2 ? 0.7 : 0;      // выход миганием
        return 1;
    }
    function draw(T) {
        g.clearRect(0, 0, W, H); gi.clearRect(0, 0, W, H);
        const S = session;
        if (!S || !S.tracks.length) return;
        const a = C.alpha;
        S.tracks.forEach(tr => {
            tr.v = vis(tr, T);
            if (T - tr.jt > 0.12) { tr.jt = T; tr.jx = (rnd() - 0.5) * tr.size * 0.15; tr.jy = (rnd() - 0.5) * tr.size * 0.15; }
            tr.dx = tr.x + tr.jx; tr.dy = tr.y + tr.jy;
        });
        g.lineWidth = 1;
        S.links.forEach(([p, q]) => {
            if (p === q || !p.v || !q.v || p.dx == null || q.dx == null) return;
            g.strokeStyle = `rgba(215, 232, 255, ${0.38 * a * Math.min(p.v, q.v)})`;
            g.beginPath(); g.moveTo(p.dx, p.dy); g.lineTo(q.dx, q.dy); g.stroke();
        });
        g.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
        S.tracks.forEach(tr => {
            if (!tr.v) return;
            const w = tr.size * tr.aspect, h = tr.size;
            const x0 = Math.round(tr.dx - w / 2) + 0.5, y0 = Math.round(tr.dy - h / 2) + 0.5;
            if (tr.bare) {                                                   // голая метка: чёрточка и номер
                g.strokeStyle = `rgba(220, 238, 255, ${0.7 * a * tr.v})`;
                g.beginPath(); g.moveTo(tr.dx - 3, tr.dy + 0.5); g.lineTo(tr.dx + 3, tr.dy + 0.5); g.stroke();
                g.fillStyle = `rgba(225, 240, 255, ${0.85 * a * tr.v})`;
                g.fillText('_' + tr.id, tr.dx + 3, tr.dy - 1);
                return;
            }
            if (tr.fill === 'invert') { gi.fillStyle = `rgba(255,255,255,${tr.v})`; gi.fillRect(x0, y0, w, h); }
            else if (tr.fill === 'tint') { g.fillStyle = `rgba(${tr.col[0]},${tr.col[1]},${tr.col[2]},${0.35 * a * tr.v})`; g.fillRect(x0, y0, w, h); }
            else if (tr.fill === 'glitch') {
                try {                                                        // кусок картинки из соседнего места
                    const k = glCanvas.width / W;
                    g.globalAlpha = 0.85 * a * tr.v;
                    g.drawImage(glCanvas, (x0 + tr.gx) * k, (y0 + tr.gy) * k, w * k, h * k, x0, y0, w, h);
                } catch (e) { /* кадр недоступен */ }
                g.globalAlpha = 1;
            }
            g.strokeStyle = `rgba(222, 238, 255, ${0.8 * a * tr.v})`;
            g.strokeRect(x0, y0, w, h);
            g.fillStyle = `rgba(225, 240, 255, ${0.85 * a * tr.v})`;
            g.fillText(String(tr.id), x0 + w + 2, y0 + 7);
            if (tr.coords) {
                // координаты точки в 3D: экранная точка на глубине центра фигуры
                const cam = DP.stage.camera;
                const c = new THREE.Vector3(0, 0, 0).applyMatrix4(DP.stage.figureStage.matrixWorld).project(cam);
                v3.set(tr.dx / W * 2 - 1, 1 - tr.dy / H * 2, c.z).unproject(cam);
                g.fillStyle = `rgba(200, 225, 255, ${0.6 * a * tr.v})`;
                g.fillText(fmt(v3.x) + '  ' + fmt(v3.y) + '  ' + fmt(v3.z), x0, y0 + h + 10);
            }
        });
    }

    DP.vision = {
        // Вызывается из цикла кадров (main.js) сразу после отрисовки сцены (кадр ещё доступен для чтения).
        update(T, dt) {
            const orch = DP.orchestrator, inst = orch.currentInstance;
            if (!C.enabled || orch.isMorphing || !inst) {
                session = null;
                if (orch.isMorphing) wasMorphing = true;
                draw(T);
                return;
            }
            if (wasMorphing) { wasMorphing = false; next = T + lerp(1.5, 3, rnd()); }   // фигура собралась — вскоре сеанс
            if (orch.current !== lastFigure) { lastFigure = orch.current; session = null; }
            if (session) {
                step(session, T, inst);
                if (T > session.T0 + session.dur && !session.tracks.length) {
                    session = null;
                    next = rnd() < 0.2 ? T + lerp(0.8, 3, rnd())                              // иногда — сразу ещё один
                                       : T + lerp(C.gapMin, C.gapMax, Math.pow(rnd(), 1.4));  // чаще короткие паузы
                }
            } else if (T >= next) {
                session = newSession(T);
                step(session, T, inst);
            }
            draw(T);
        },
        now(kind) { next = 0; session = null; forceKind = kind || null; },   // для настройки: сеанс сразу ('light' | 'medium' | 'burst')
        get session() { return session; },
        get tracking() { return !!(C.track && trackOk); }
    };
})(window.DP);
