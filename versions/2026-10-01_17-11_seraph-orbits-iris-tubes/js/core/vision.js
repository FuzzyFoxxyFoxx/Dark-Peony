// ==========================================
// DARK PEONY — «КОМПЬЮТЕРНОЕ ЗРЕНИЕ» (HUD поверх любой фигуры)
// ==========================================
// Эстетика отладочного вывода трекинга объектов (blob tracking, видео автора IMG_0008–0011).
// Модуль отдельный: фигуры не трогает.
//  • Зрение: несколько раз в секунду готовый кадр уменьшается (≈190×110), в нём ищутся яркие и контрастные
//    места (локальные максимумы) — это «находки». Находки сопоставляются с дорожками (tracks) прошлых кадров:
//    рамки ездят за видимыми деталями и перескакивают, как у трекера. Нет доступа к кадру (или track = 0) —
//    находки берутся из точек фигуры (раскладка морфинга) и движущихся тел (instance.visionAnchors()).
//  • Ритм (автор): «зрение» на экране почти всегда — слабый фон (2–5 небольших рамок в разных частях фигуры);
//    каждые 5–9 с всплеск на 2–3 с (12–30 рамок роем, густая сеть, иногда до 40); изредка пропадает на 1–3 с.
//  • Рой: у всплеска есть место интереса — большинство рамок там, часть бродит по кадру.
//  • Рамки с символами (1–2 во всплеске): фрагмент кадра под рамкой символами — плотность символа = яркость
//    (шкала плотности считается при загрузке), символы всё время меняются на равные по плотности.
//  • Быстрая смена: рамка живёт 0.1–1 с, номера растут, как у трекера.
//  • Сеть: у каждой рамки 2–4 соседа + несколько длинных линий; голые метки «_номер» без рамки.
//  • Размеры по уровням: много крошечных, немного средних (по размеру пятна), редкие крупные.
//  • Рамка облегает пятно: от точки рамки заливкой собирается связная область ярче доли пика (у каждой
//    рамки свой порог) — рамка берёт её габариты 12 раз в секунду (скачками, как трекер). Цепкие рамки (60%)
//    без дрожи держатся за центр области, нервные — перескакивают.
//  • Заливки: контур; полупрозрачная заливка цветом пятна; инверсия (свой слой, difference);
//    «кусок картинки со сдвигом» (глитч). Координаты x/y/z — только у редких рамок, одной строкой.
// Во время морфинга не работает. Выключить: ?vision=0 или ползунок «включено».
(function (DP) {
    'use strict';
    if (!DP.stage) return;

    const C = DP.config.vision = Object.assign({
        enabled: DP.params.get('vision') === '0' ? 0 : 1,
        track: 1,                   // 1 — рамки по самой картинке (чтение уменьшенного кадра), 0 — по точкам фигуры
        baseMin: 2, baseMax: 5,     // слабый фон: рамок
        surgeMin: 12, surgeMax: 30, // всплеск: рамок
        surgeEvery: 7,              // всплеск примерно раз в столько секунд (±30%)
        surgeDur: 2.5,              // длительность всплеска, с (±20%)
        strong: 0.2,                // доля сильных всплесков (до 40 рамок)
        offEvery: 10, offDur: 2,    // изредка пропадает: примерно раз в … с на … с (случайно, 0.3–1.5×)
        density: 1,                 // множитель числа рамок
        ascii: 1.5,                 // рамок с символами во всплеске (в среднем; 0 — выкл.)
        asciiCell: 7,               // высота знакоместа, px
        asciiGain: 1.6,             // контраст символов: больше — полутона тоньше, плотные знаки только в самых ярких местах
        cluster: 0.7,               // доля рамок в рое у места интереса (во всплеске)
        links: 3,                   // соседей у рамки (в среднем)
        invert: 0.2, tint: 0.2, glitch: 0.1,   // доли рамок с инверсией / заливкой цветом / куском картинки
        bare: 0.3,                  // доля голых меток без рамки
        coords: 0.1,                // доля рамок с координатами
        locked: 0.6,                // доля «цепких» рамок: без дрожи, держатся за центр своего пятна
        fit: 1,                     // 1 — рамка облегает пятно (размер и пропорции по области яркости)
        lineStyle: 2,               // линии: 0 — прежние (1 px экрана, белые), 1 — волосок белый, 2 — волосок голубой
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

    // ---------- шкала плотности символов ----------
    // Латиница, цифры, знаки, кириллица и узкая катакана; плотность = доля закрашенных пикселей в знакоместе.
    const GLYPHS = ".,'`:;-_~^\"!|/\\()[]{}<>+=*?irlcvxzjtfnuoaeskyhpqbdgmwIJLTCZXYVUNSOQGDKRAEFHPBMW0123456789$&%#@" +
                   "абвгдежзийклмнопрстуфхцчшщъыьэюяБГДЖЗИЛПФЦЧШЩЪЫЭЮЯ" +
                   "ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
    const FONT = 'ui-monospace, SFMono-Regular, Menlo, "Hiragino Sans", monospace';
    const LEVELS = 14;
    const buckets = (function () {
        const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
        const cw = 12, ch = 20; c.width = cw; c.height = ch;
        x.font = `16px ${FONT}`; x.textBaseline = 'middle'; x.textAlign = 'center';
        const list = [...GLYPHS].map(chr => {
            x.clearRect(0, 0, cw, ch); x.fillStyle = '#fff'; x.fillText(chr, cw / 2, ch / 2);
            const d = x.getImageData(0, 0, cw, ch).data; let s = 0;
            for (let i = 3; i < d.length; i += 4) s += d[i];
            return { chr, cov: s / (255 * cw * ch) };
        }).filter(e => e.cov > 0.005).sort((a, b) => a.cov - b.cov);
        const maxCov = list[list.length - 1].cov, b = [];
        for (let l = 0; l < LEVELS; l++) b.push([]);
        list.forEach(e => b[Math.min(LEVELS - 1, Math.floor(e.cov / maxCov * LEVELS))].push(e.chr));
        for (let l = 0; l < LEVELS; l++) if (!b[l].length) b[l] = l ? b[l - 1] : ['.'];
        return b;
    })();
    const ac = document.createElement('canvas'), ag = ac.getContext('2d', { willReadFrequently: true });

    const rnd = Math.random;
    const lerp = (a, b, t) => a + (b - a) * t;
    let nextId = 3900 + Math.floor(rnd() * 80);
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
    // Область пятна вокруг точки (CSS px), по размытой яркости (соседние нити сливаются в деталь): пик в окне 5×5, затем заливка соседей ярче thr·пик (до 900 пикселей).
    // Возвращает центр (взвешенный по яркости) и габариты; null — если кадр не читался или пятна нет.
    let seen = new Int32Array(0), stamp = 1;
    const queue = new Int32Array(900);
    function region(cx, cy, thr) {
        if (!bl.length) return null;
        let x = Math.round(cx / W * SW - 0.5), y = Math.round(cy / H * SH - 0.5);
        if (x < 2 || y < 2 || x > SW - 3 || y > SH - 3) return null;
        let bi = y * SW + x;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * SW + x + dx; if (bl[j] > bl[bi]) bi = j; }
        const peak = bl[bi];
        if (peak < 0.04) return null;
        if (seen.length !== bl.length) seen = new Int32Array(bl.length);
        stamp++;
        const lim = peak * thr;
        let qh = 0, qt = 0, x0 = SW, x1 = 0, y0 = SH, y1 = 0, sw = 0, sx = 0, sy = 0;
        queue[qt++] = bi; seen[bi] = stamp;
        while (qh < qt) {
            const i = queue[qh++], px = i % SW, py = (i - px) / SW, L = bl[i];
            if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
            sw += L; sx += px * L; sy += py * L;
            if (qt >= queue.length - 4) continue;
            const nb = [i - 1, i + 1, i - SW, i + SW];
            for (let k = 0; k < 4; k++) {
                const j = nb[k];
                if (j < 0 || j >= bl.length || seen[j] === stamp) continue;
                if ((k < 2) && Math.abs((j % SW) - px) !== 1) continue;
                seen[j] = stamp;
                if (bl[j] > lim) queue[qt++] = j;
            }
        }
        const kx = W / SW, ky = H / SH;
        return { x: (sx / sw + 0.5) * kx, y: (sy / sw + 0.5) * ky, w: (x1 - x0 + 1) * kx, h: (y1 - y0 + 1) * ky };
    }
    // Рамка облегает пятно: габариты области с небольшим запасом, в пределах [min, max].
    function fitTrack(tr) {
        if (!C.fit || !(C.track && trackOk) || tr.tiny) return false;
        const r = region(tr.x, tr.y, tr.thr);
        if (!r) return false;
        const pad = 1.15;
        const nw = Math.min(tr.maxW, Math.max(tr.minW, r.w * pad)), nh = Math.min(tr.maxH, Math.max(tr.minH, r.h * pad));
        tr.w = lerp(tr.w, nw, 0.55); tr.h = lerp(tr.h, nh, 0.55);          // подстройка в такт находкам, без мигания между крайностями
        if (tr.locked) { tr.x = lerp(tr.x, r.x, 0.6); tr.y = lerp(tr.y, r.y, 0.6); }
        return true;
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

    // ---------- ритм: слабый фон, всплески, пропадания ----------
    function newSession(T) {
        return { T0: T, target: 3, surge: false, off: false, strongSurge: false, focus: null, tracks: [], links: [], nextDetect: 0,
                 nextSurge: T + lerp(1.5, 3, rnd()), surgeEnd: 0, nextOff: T + C.offEvery * lerp(0.6, 1.6, rnd()), offEnd: 0,
                 baseN: lerp(C.baseMin, C.baseMax, rnd()), asciiLeft: 0 };
    }
    function rhythm(S, T) {
        if (forceKind) { S.nextSurge = T; S.strongSurge = forceKind === 'burst'; S.forced = true; forceKind = null; }
        if (!S.surge && !S.off && T >= S.nextOff && C.offDur > 0) {       // пропадание: всё гаснет почти сразу
            S.off = true; S.offEnd = T + C.offDur * lerp(0.4, 1.5, rnd());
            S.tracks.forEach(tr => { tr.life = Math.min(tr.life, T - tr.born + lerp(0.05, 0.25, rnd())); });
        }
        if (S.off && T >= S.offEnd) { S.off = false; S.nextOff = T + C.offEvery * lerp(0.4, 1.8, rnd()); S.nextSurge = Math.max(S.nextSurge, T + 1); }
        if (!S.surge && !S.off && T >= S.nextSurge) {
            S.surge = true; S.surgeEnd = T + C.surgeDur * lerp(0.8, 1.2, rnd());
            if (!S.forced) S.strongSurge = rnd() < C.strong;
            S.forced = false; S.focus = null;
            const a = C.ascii; S.asciiLeft = Math.floor(a) + (rnd() < a - Math.floor(a) ? 1 : 0);
            S.surgeN = S.strongSurge ? lerp(32, 42, rnd()) : lerp(C.surgeMin, C.surgeMax, rnd());
        }
        if (S.surge && T >= S.surgeEnd) { S.surge = false; S.nextSurge = T + C.surgeEvery * lerp(0.7, 1.3, rnd()); S.baseN = lerp(C.baseMin, C.baseMax, rnd()); }
        S.kind = S.surge ? (S.strongSurge ? 'burst' : 'medium') : 'light';
        S.target = S.off ? 0 : Math.max(1, Math.round((S.surge ? S.surgeN : S.baseN) * C.density));
    }
    function spawn(S, det, T) {
        const farFromAscii = S.tracks.every(o => o.fill !== 'ascii' || Math.abs(o.x - det.x) > (o.w + 200) / 2 + 20);
        if (S.surge && S.asciiLeft > 0 && rnd() < 0.25 && farFromAscii) {   // рамка с символами — крупная, вертикальная, не налезает на другую
            S.asciiLeft--;
            const h = Math.min(H * 0.42, lerp(190, 320, rnd()));
            const w = h * lerp(0.5, 0.75, rnd());
            S.tracks.push({ id: nextId += 1 + Math.floor(rnd() * 2), x: det.x, y: det.y, w, h, size: h,
                minW: w, minH: h, maxW: Math.max(w, W * 0.3), maxH: Math.max(h, H * 0.55), thr: lerp(0.25, 0.4, rnd()), locked: true,
                born: T, life: lerp(1.6, 3, rnd()), seen: T, sticky: true, bare: false, fill: 'ascii', col: det.col,
                coords: rnd() < 0.5, gx: 0, gy: 0, jx: 0, jy: 0, jt: 0, cells: null });
            return;
        }
        const t = rnd();
        const tier = S.surge ? (t < 0.6 ? 'tiny' : t < 0.92 ? 'mid' : 'big') : (t < 0.55 ? 'tiny' : 'mid');   // в фоне — небольшие
        const size = tier === 'tiny' ? lerp(5, 13, rnd()) : tier === 'mid' ? Math.min(60, Math.max(16, det.size * lerp(1, 1.8, rnd()))) : lerp(55, 115, rnd());
        const f = rnd();
        const fill = tier === 'tiny' ? 'none' : f < C.invert ? 'invert' : f < C.invert + C.tint ? 'tint' : f < C.invert + C.tint + C.glitch ? 'glitch' : 'none';
        const aspect = lerp(0.65, 1.5, rnd());
        const minS = tier === 'mid' ? 16 : 34, maxS = tier === 'mid' ? 110 : 190;
        S.tracks.push({
            id: nextId += 1 + Math.floor(rnd() * 2), x: det.x, y: det.y, size, w: size * aspect, h: size, tiny: tier === 'tiny',
            minW: minS, minH: minS, maxW: maxS * 1.3, maxH: maxS, thr: tier === 'big' ? lerp(0.3, 0.5, rnd()) : lerp(0.5, 0.8, rnd()),
            locked: rnd() < C.locked,
            born: T, life: S.surge ? lerp(0.1, 1.0, Math.pow(rnd(), 0.8)) * (S.strongSurge ? 0.7 : 1) : lerp(0.8, 2.5, rnd()), seen: T,   // фон — спокойнее
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
                if (bi >= 0) {
                    used.add(bi); const d = dets[bi];
                    if (!tr.locked) { tr.x = lerp(tr.x, d.x, 0.7); tr.y = lerp(tr.y, d.y, 0.7); }   // нервная — прыгает к находке
                    tr.seen = T; tr.col = d.col;
                }
                if (fitTrack(tr)) tr.seen = T;                                   // облегает своё пятно (цепкая — и едет за ним)
            });
            {                                                               // пополнение до текущей цели
                const sig = Math.min(W, H) * 0.16;
                const want = S.target - S.tracks.length;
                for (let k = 0; k < want && dets.length; k++) {
                    const inCluster = S.surge && rnd() < C.cluster && S.focus;
                    let pick = -1;
                    for (let tries = 0; tries < 12 && pick < 0; tries++) {
                        const di = Math.floor(Math.pow(rnd(), 2) * dets.length), d = dets[di];
                        if (used.has(di)) continue;
                        if (S.tracks.some(o => !o.bare && Math.abs(o.x - d.x) < o.w * 0.4 && Math.abs(o.y - d.y) < o.h * 0.4)) continue;   // место занято
                        if (inCluster) { const dd = Math.hypot(d.x - S.focus.x, d.y - S.focus.y); if (rnd() > Math.exp(-dd * dd / (2 * sig * sig))) continue; }
                        pick = di;
                    }
                    if (pick >= 0) { used.add(pick); spawn(S, dets[pick], T); }
                }
                if (S.focus && dets.length) { const d = dets[0]; S.focus.x = lerp(S.focus.x, d.x, 0.02); S.focus.y = lerp(S.focus.y, d.y, 0.02); }
            }
            S.tracks = S.tracks.filter(tr => T - tr.born < tr.life && (tr.sticky || T - tr.seen < 0.3));
            // две рамки на одном месте (съехались на одно пятно) — остаётся старшая
            S.tracks = S.tracks.filter((tr, i) => tr.bare || tr.tiny || !S.tracks.some((o, j) => j < i && !o.bare && !o.tiny &&
                Math.abs(o.x - tr.x) < Math.max(o.w, tr.w) * 0.3 && Math.abs(o.y - tr.y) < Math.max(o.h, tr.h) * 0.3));
            if (S.tracks.length > S.target + 4) S.tracks.sort((p, q) => (p.sticky ? 1 : 0) - (q.sticky ? 1 : 0)).splice(0, S.tracks.length - S.target - 4);
            // связи: 2–4 ближайших + несколько длинных
            const tr = S.tracks;
            S.links = [];
            tr.forEach((a, i) => {
                const k = S.surge ? Math.max(1, Math.round(C.links + (rnd() - 0.5) * 2)) : (rnd() < 0.6 ? 1 : 0);   // в фоне связей мало
                tr.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2]).filter(e => e[0] !== i).sort((p, q) => p[1] - q[1])
                  .slice(0, k).forEach(e => { if (e[0] > i || rnd() < 0.3) S.links.push([tr[i], tr[e[0]]]); });
            });
            const nLong = S.surge ? Math.round(tr.length * 0.12) : 0;
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
    // Рамка с символами: фрагмент кадра под рамкой → сетка знакомест → символ по яркости; символы «кипят».
    function drawAscii(tr, x0, y0, w, h, T) {
        const chH = C.asciiCell, chW = chH * 0.62;
        const cols = Math.max(4, Math.floor(w / chW)), rows = Math.max(4, Math.floor(h / chH));
        try {
            const k = glCanvas.width / W;
            if (ac.width !== cols || ac.height !== rows) { ac.width = cols; ac.height = rows; }
            ag.drawImage(glCanvas, x0 * k, y0 * k, w * k, h * k, 0, 0, cols, rows);
            const d = ag.getImageData(0, 0, cols, rows).data;
            if (!tr.cells || tr.cells.length !== cols * rows) tr.cells = new Array(cols * rows).fill(null).map(() => ({ l: -1, chr: ' ', t: 0 }));
            g.fillStyle = `rgba(0, 3, 9, ${0.93 * tr.v})`;
            g.fillRect(x0, y0, w, h);
            g.font = `${chH}px ${FONT}`; g.textBaseline = 'top';
            // яркость — относительно самого яркого места рамки (почти максимум), чтобы форма читалась
            const n = cols * rows, Ls = new Float32Array(n);
            for (let i = 0; i < n; i++) Ls[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.55 + d[i * 4 + 2] * 0.15) / 255;
            const sorted = Float32Array.from(Ls).sort(), top = Math.max(0.04, sorted[Math.floor(n * 0.97)]);
            tr.top = tr.top ? lerp(tr.top, top, 0.2) : top;                   // плавно, без мигания уровня
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                const i = r * cols + c, cell = tr.cells[i];
                const x = Math.min(1, Ls[i] / tr.top);
                const lv = Math.min(LEVELS - 1, Math.floor(Math.pow(x, C.asciiGain) * LEVELS));   // больше «усиление» — тоньше полутона
                if (lv < 2) { cell.l = 0; continue; }
                if (lv !== cell.l || T > cell.t) {                               // другой уровень или пора «перекипеть»
                    const b = buckets[lv];
                    cell.chr = b[Math.floor(rnd() * b.length)]; cell.l = lv; cell.t = T + lerp(0.08, 0.35, rnd());
                }
                g.fillStyle = `rgba(${Math.round(lerp(150, 235, lv / LEVELS))}, ${Math.round(lerp(195, 245, lv / LEVELS))}, 255, ${(0.55 + 0.45 * lv / LEVELS) * C.alpha * tr.v})`;
                g.fillText(cell.chr, x0 + c * chW, y0 + r * chH);
            }
        } catch (e) { /* кадр недоступен */ }
    }

    function draw(T) {
        g.clearRect(0, 0, W, H); gi.clearRect(0, 0, W, H);
        const S = session;
        if (!S || !S.tracks.length) return;
        const a = C.alpha;
        S.tracks.forEach(tr => {
            tr.v = vis(tr, T);
            if (tr.locked) { tr.jx = tr.jy = 0; }
            else if (T - tr.jt > 0.12) { tr.jt = T; tr.jx = (rnd() - 0.5) * tr.h * 0.15; tr.jy = (rnd() - 0.5) * tr.h * 0.15; }
            tr.dx = tr.x + tr.jx; tr.dy = tr.y + tr.jy;
        });
        const LS = C.lineStyle, hair = LS >= 1 ? 1 / dpr : 1;             // волосок — 1 физический пиксель
        const off = hair / 2;                                                // смещение, чтобы линия легла на пиксель
        const RGB = LS === 2 ? '165, 205, 255' : '222, 238, 255', LA = LS === 2 ? 0.95 : 0.8;
        const snap = (v) => Math.round(v * dpr) / dpr + off;
        g.lineWidth = hair;
        S.links.forEach(([p, q]) => {
            if (p === q || !p.v || !q.v || p.dx == null || q.dx == null) return;
            g.strokeStyle = `rgba(${RGB}, ${0.45 * a * Math.min(p.v, q.v)})`;
            g.beginPath(); g.moveTo(p.dx, p.dy); g.lineTo(q.dx, q.dy); g.stroke();
        });
        g.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
        S.tracks.forEach(tr => {
            if (!tr.v) return;
            const w = Math.round(tr.w), h = Math.round(tr.h);
            const x0 = snap(tr.dx - w / 2), y0 = snap(tr.dy - h / 2);
            if (tr.bare) {                                                   // голая метка: чёрточка и номер
                g.strokeStyle = `rgba(${RGB}, ${0.7 * a * tr.v})`;
                g.beginPath(); g.moveTo(tr.dx - 3, snap(tr.dy)); g.lineTo(tr.dx + 3, snap(tr.dy)); g.stroke();
                g.fillStyle = `rgba(225, 240, 255, ${0.85 * a * tr.v})`;
                g.fillText('_' + tr.id, tr.dx + 3, tr.dy - 1);
                return;
            }
            if (tr.fill === 'ascii') { drawAscii(tr, x0, y0, w, h, T); }
            else if (tr.fill === 'invert') { gi.fillStyle = `rgba(255,255,255,${tr.v})`; gi.fillRect(x0 + 1.5, y0 + 1.5, w - 3, h - 3); }   // на пиксель внутрь от контура
            else if (tr.fill === 'tint') { g.fillStyle = `rgba(${tr.col[0]},${tr.col[1]},${tr.col[2]},${0.35 * a * tr.v})`; g.fillRect(x0, y0, w, h); }
            else if (tr.fill === 'glitch') {
                try {                                                        // кусок картинки из соседнего места
                    const k = glCanvas.width / W;
                    g.globalAlpha = 0.85 * a * tr.v;
                    g.drawImage(glCanvas, (x0 + tr.gx) * k, (y0 + tr.gy) * k, w * k, h * k, x0, y0, w, h);
                } catch (e) { /* кадр недоступен */ }
                g.globalAlpha = 1;
            }
            g.strokeStyle = `rgba(${RGB}, ${LA * a * tr.v * (tr.tiny ? 0.7 : 1)})`;   // крошечные — чуть тусклее
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
            if (wasMorphing) { wasMorphing = false; session = null; }            // фигура собралась — «зрение» начинает заново
            if (orch.current !== lastFigure) { lastFigure = orch.current; session = null; }
            if (!session) session = newSession(T);
            rhythm(session, T);
            step(session, T, inst);
            draw(T);
        },
        now(kind) { forceKind = kind || 'medium'; },   // для настройки: всплеск сейчас ('medium' | 'burst')
        get session() { return session; },
        get tracking() { return !!(C.track && trackOk); }
    };
})(window.DP);
