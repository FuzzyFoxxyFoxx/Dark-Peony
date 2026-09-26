// ==========================================
// DARK PEONY — «КОМПЬЮТЕРНОЕ ЗРЕНИЕ» (HUD поверх любой фигуры)
// ==========================================
// Эстетика отладочного вывода трекинга объектов (blob tracking): время от времени короткий «сеанс» —
// рамки цепляются за детали фигуры (кончики, края, тела), у каждой свой номер (номера растут, как у трекера),
// у части — координаты точки в 3D; рамки соединены тонкими линиями; некоторые залиты инверсией картинки под ними.
// Модуль отдельный: фигуры не трогает. Точки берёт из раскладки фигуры (те же, что у морфинга, в покое);
// если фигура умеет — берёт и текущие положения движущихся тел (instance.visionAnchors()).
// Во время морфинга не работает. Выключить: DP.config.vision.enabled = 0, ползунок на панели или ?vision=0.
(function (DP) {
    'use strict';
    if (!DP.stage) return;

    const C = DP.config.vision = Object.assign({
        enabled: DP.params.get('vision') === '0' ? 0 : 1,
        gapMin: 10, gapMax: 20,     // пауза между сеансами, с
        durMin: 2, durMax: 4,       // длительность сеанса, с
        boxes: 6,                   // рамок за сеанс (до)
        invert: 0.3,                // доля рамок с инверсией
        alpha: 0.8                  // видимость всего слоя
    }, DP.config.vision || {});

    // Два слоя: обычный (рамки, линии, текст) и слой инверсии (белые плашки в режиме «разница»).
    const mk = (id, blend) => {
        const c = document.createElement('canvas');
        c.id = id;
        c.style.pointerEvents = 'none';
        c.style.zIndex = blend ? '7' : '6';
        if (blend) c.style.mixBlendMode = 'difference';
        document.body.appendChild(c);
        return c;
    };
    const cv = mk('visionCanvas', false), ci = mk('visionInvert', true);
    const g = cv.getContext('2d'), gi = ci.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth; H = window.innerHeight;
        [cv, ci].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
        [g, gi].forEach(x => x.setTransform(dpr, 0, 0, dpr, 0, 0));
    }
    window.addEventListener('resize', resize);
    resize();

    const v3 = new THREE.Vector3();
    let rnd = Math.random;
    const lerp = (a, b, t) => a + (b - a) * t;
    let nextId = 3900 + Math.floor(rnd() * 80);
    let next = 4 + rnd() * 4;           // первый сеанс — вскоре после загрузки
    let session = null;
    let lastFigure = null;

    // Экранная позиция точки фигуры (раскладка — в пространстве сцены фигуры).
    function project(x, y, z, out) {
        v3.set(x, y, z).applyMatrix4(DP.stage.figureStage.matrixWorld);
        const w = v3.clone();
        v3.project(DP.stage.camera);
        out.x = (v3.x + 1) / 2 * W; out.y = (1 - v3.y) / 2 * H; out.z = v3.z;
        out.wx = w.x; out.wy = w.y; out.wz = w.z;
        return out;
    }

    // Выбор «интересных» точек: много случайных кандидатов → дальше от центра фигуры (кончики, края) и
    // по возможности подальше друг от друга на экране.
    function pickAnchors(inst, n) {
        const L = inst.layout, parts = L && L.parts;
        if (!parts || !parts.length) return [];
        const cand = [];
        const tmp = {};
        const skip = inst.visionSkip;
        for (let k = 0; k < 160; k++) {
            const pi = Math.floor(rnd() * parts.length), p = parts[pi];
            if (!p.count || (skip && skip.has(pi))) continue;
            const i = Math.floor(rnd() * p.count);
            const x = p.rest[i * 3], y = p.rest[i * 3 + 1], z = p.rest[i * 3 + 2];
            project(x, y, z, tmp);
            if (tmp.z > 1 || tmp.x < 40 || tmp.x > W - 40 || tmp.y < 70 || tmp.y > H * 0.86) continue;   // не у краёв и не под подписью внизу
            cand.push({ kind: 'rest', x, y, z, sx: tmp.x, sy: tmp.y, r: Math.hypot(x, y * 0.6, z) });
        }
        // движущиеся тела (планеты, астероиды) — если фигура их отдаёт
        const moving = inst.visionAnchors ? inst.visionAnchors() : [];
        const out = [];
        const far = (a) => out.reduce((m, b) => Math.min(m, Math.hypot(a.sx - b.sx, a.sy - b.sy)), 1e9);
        moving.sort(() => rnd() - 0.5).slice(0, Math.ceil(n / 2)).forEach(m => {
            const s = project(m.x, m.y, m.z, {});
            if (s.z < 1 && s.x > 20 && s.x < W - 20 && s.y > 50 && s.y < H - 50) out.push({ kind: 'body', get: m.get, size: m.size, sx: s.x, sy: s.y });
        });
        cand.sort((a, b) => b.r - a.r);
        const pool = cand.slice(0, Math.max(n * 10, 40));
        while (out.length < n && pool.length) {
            let bi = 0, bs = -1;
            pool.forEach((c, i) => { const s = Math.min(far(c), 320) * 1.5 + c.r * 12 + rnd() * 80; if (s > bs) { bs = s; bi = i; } });   // разнести по фигуре
            out.push(pool.splice(bi, 1)[0]);
        }
        return out;
    }

    function startSession(inst, T) {
        const n = Math.max(2, Math.round(lerp(C.boxes * 0.5, C.boxes, rnd())));
        const anchors = pickAnchors(inst, n);
        if (!anchors.length) return null;
        const dur = lerp(C.durMin, C.durMax, rnd());
        const boxes = anchors.map((a, i) => ({
            a, id: nextId += 1 + Math.floor(rnd() * 3),
            t0: T + rnd() * dur * 0.45, life: lerp(0.7, 2.2, rnd()) * Math.max(0.6, dur / 3),
            base: a.kind === 'body' ? 0 : lerp(16, 72, Math.pow(rnd(), 1.3)), aspect: lerp(0.6, 1.6, rnd()),
            ph: rnd() * 6.28, inv: rnd() < C.invert, coords: rnd() < 0.55, jx: 0, jy: 0, jt: 0
        }));
        // связи: у каждой рамки 1–2 ближайших соседа + изредка дальняя
        const links = [];
        boxes.forEach((b, i) => {
            const d = boxes.map((c, j) => [j, Math.hypot(b.a.sx - c.a.sx, b.a.sy - c.a.sy)]).filter(e => e[0] !== i).sort((x, y) => x[1] - y[1]);
            const k = 1 + (rnd() < 0.5 ? 1 : 0);
            d.slice(0, k).forEach(e => { if (!links.some(l => (l[0] === e[0] && l[1] === i))) links.push([i, e[0]]); });
            if (rnd() < 0.2 && d.length > 2) links.push([i, d[d.length - 1][0]]);
        });
        return { T0: T, dur, boxes, links };
    }

    // Видимость рамки: вход миганием (как у трекера, пара «кадров»), плато, выход тоже миганием.
    function vis(b, T) {
        const t = T - b.t0;
        if (t < 0 || t > b.life) return 0;
        if (t < 0.12) return Math.floor(t * 40) % 2 ? 1 : 0.25;
        if (t > b.life - 0.1) return Math.floor(t * 40) % 2 ? 0.8 : 0;
        return 1;
    }

    const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(6);

    function draw(T, dt) {
        g.clearRect(0, 0, W, H); gi.clearRect(0, 0, W, H);
        if (!session) return;
        const S = session, a = C.alpha;
        const tmp = {};
        // положение и размер каждой рамки в этом кадре
        S.boxes.forEach(b => {
            b.v = vis(b, T);
            if (!b.v) return;
            let wx, wy, wz, size;
            if (b.a.kind === 'body') {
                const m = b.a.get();
                project(m.x, m.y, m.z, tmp); wx = tmp.wx; wy = tmp.wy; wz = tmp.wz;
                // размер тела на экране: радиус, поделённый на глубину
                const dist = DP.stage.camera.position.distanceTo(new THREE.Vector3(wx, wy, wz));
                size = Math.max(10, b.a.size / dist * H * 1.6);
            } else {
                project(b.a.x, b.a.y, b.a.z, tmp); wx = tmp.wx; wy = tmp.wy; wz = tmp.wz;
                size = b.base * (0.85 + 0.25 * Math.sin(T * 2.3 + b.ph));          // рамка «дышит», как пятно трекера
            }
            // трекер подрагивает: рамка чуть перескакивает раз в несколько кадров
            if (T - b.jt > 0.18) { b.jt = T; b.jx = (rnd() - 0.5) * size * 0.12; b.jy = (rnd() - 0.5) * size * 0.12; }
            b.x = tmp.x + b.jx; b.y = tmp.y + b.jy; b.w = size * b.aspect; b.h = size; b.wp = [wx, wy, wz];
        });
        g.lineWidth = 1;
        g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        // связи
        S.links.forEach(([i, j]) => {
            const p = S.boxes[i], q = S.boxes[j];
            if (!p.v || !q.v) return;
            g.strokeStyle = `rgba(210, 232, 255, ${0.45 * a * Math.min(p.v, q.v)})`;
            g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
        });
        // рамки, номера, координаты; инверсия — на своём слое
        S.boxes.forEach(b => {
            if (!b.v) return;
            const x0 = Math.round(b.x - b.w / 2) + 0.5, y0 = Math.round(b.y - b.h / 2) + 0.5;
            if (b.inv) { gi.fillStyle = `rgba(255,255,255,${b.v})`; gi.fillRect(x0, y0, b.w, b.h); }
            g.strokeStyle = `rgba(220, 238, 255, ${0.8 * a * b.v})`;
            g.strokeRect(x0, y0, b.w, b.h);
            g.fillStyle = `rgba(225, 240, 255, ${0.9 * a * b.v})`;
            g.fillText(String(b.id), x0 + b.w + 3, y0 + 8);
            if (b.coords) {
                g.fillStyle = `rgba(200, 225, 255, ${0.6 * a * b.v})`;
                g.fillText('x' + fmt(b.wp[0]), x0, y0 + b.h + 11);
                g.fillText('y' + fmt(b.wp[1]), x0, y0 + b.h + 22);
                g.fillText('z' + fmt(b.wp[2]), x0, y0 + b.h + 33);
            }
        });
    }

    DP.vision = {
        // Вызывается из цикла кадров (main.js) после отрисовки сцены.
        update(T, dt) {
            const orch = DP.orchestrator;
            const inst = orch.currentInstance;
            if (!C.enabled || orch.isMorphing || !inst) {
                session = null;
                if (orch.isMorphing) next = Math.max(next, T + lerp(C.gapMin, C.gapMax, rnd()) * 0.5);   // после морфинга — не сразу
                draw(T, dt);
                return;
            }
            if (orch.current !== lastFigure) { lastFigure = orch.current; session = null; }
            if (session && T > session.T0 + session.dur + 2.5) session = null;
            if (!session && T >= next) {
                session = startSession(inst, T);
                next = T + (session ? session.dur : 0) + lerp(C.gapMin, C.gapMax, rnd());
            }
            draw(T, dt);
        },
        // Для настройки: сеанс прямо сейчас.
        now() { next = 0; },
        get session() { return session; }
    };
})(window.DP);
