// ==========================================
// DARK PEONY — ПАНЕЛЬ НАСТРОЙКИ МОРФИНГА (?tune)
// ==========================================
// Цикл морфинга (туда-обратно с паузой), замедление времени и ползунки параметров морфинга.
// Значения морфинга применяются со следующего перехода (планировщик читает DP.config.morph в начале).
// «Ссылка с настройками» кладёт изменённые значения в адрес: ?tune&m.fountain.travel=1.8 …
// Новые параметры добавляются в DP.tuneSpec: [путь в DP.config.morph, подпись, min, max, шаг].
(function (DP) {
    'use strict';
    if (!DP.stage) return;

    const M = DP.config.morph;
    const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), M);
    const set = (path, v) => {
        const ks = path.split('.'), last = ks.pop();
        const o = ks.reduce((a, k) => a[k], M);
        o[last] = v;
    };

    // Значения из адреса применяются всегда (даже без ?tune): ссылкой можно поделиться.
    DP.params.forEach((v, k) => {
        if (!k.startsWith('m.')) return;
        const path = k.slice(2), cur = get(path);
        if (typeof cur === 'number') set(path, parseFloat(v));
        else if (typeof cur === 'string') set(path, v);
    });

    DP.tuneSpec = DP.tuneSpec || [
        ['Дымная сфера'],
        ['sphere.leaveSpread', 'распад от краёв, с', 0.2, 5, 0.05],
        ['sphere.hold', 'шар целиком, с', 0, 4, 0.05],
        ['sphere.arriveSpread', 'сборка от краёв, с', 0.2, 5, 0.05],
        ['sphere.jitter', 'разброс частиц, с', 0, 0.6, 0.01],
        ['sphere.capture', 'подхват шаром, с', 0.1, 3, 0.05],
        ['sphere.land', 'посадка, с', 0.1, 3, 0.05],
        ['sphere.twist', 'закрутка до подхвата', 0, 8, 0.05],
        ['sphere.gravity', 'осыпание', 0, 5, 0.05],
        ['sphere.sphereR', 'радиус шара', 0.2, 2, 0.01],
        ['sphere.sphereY', 'высота шара', 0, 1, 0.01],
        ['sphere.roll', 'клубление', 0, 4, 0.05],
        ['sphere.rotate', 'вращение вокруг оси', 0, 6, 0.05],
        ['sphere.noiseK', 'разбросанность (водовороты ×)', 0, 6, 0.05],
        ['sphere.pull', 'возврат вылетевшего дыма', 0, 5, 0.05],
        ['Кольцо-кисть'],
        ['sweep.descent', 'спуск кольца, с', 0.5, 6, 0.05],
        ['sweep.ease', 'разгон/торможение', 0, 1, 0.01],
        ['sweep.lead', 'срыв заранее, с', 0, 1.5, 0.01],
        ['sweep.dwell', 'проявление новой, с', 0, 2, 0.01],
        ['sweep.dome', 'фронт куполом', -0.5, 0.8, 0.01],
        ['sweep.twist', 'закрутка до захвата', 0, 8, 0.05],
        ['sweep.capture', 'захват кольцом, с', 0.05, 2, 0.01],
        ['sweep.land', 'посадка, с', 0.1, 2, 0.01],
        ['sweep.gravity', 'осыпание', 0, 10, 0.1],
        ['sweep.pull', 'притяжение к сердцевине', 0, 8, 0.05],
        ['sweep.sphereR', 'радиус сферы (экватор)', 0.3, 2, 0.01],
        ['sweep.core', 'толщина кольца', 0.05, 1.2, 0.01],
        ['sweep.rotate', 'вращение кольца', 0, 8, 0.05],
        ['sweep.margin', 'выше/ниже фигур', 0, 0.5, 0.01],
        ['Дым: время (режим «дымное кольцо»)'],
        ['smoke.leaveSpread', 'обрушение сверху вниз, с', 0.1, 4, 0.05],
        ['smoke.hold', 'кольцо целиком, с', 0, 5, 0.05],
        ['smoke.arriveSpread', 'сборка сверху вниз, с', 0.1, 4, 0.05],
        ['smoke.jitter', 'разброс частиц, с', 0, 0.6, 0.01],
        ['smoke.capture', 'захват кольцом, с', 0.1, 3, 0.05],
        ['smoke.land', 'посадка, с', 0.2, 3, 0.05],
        ['smoke.gravity', 'ускорение осыпания', 0, 10, 0.1],
        ['smoke.pull', 'притяжение к сердцевине', 0, 5, 0.05],
        ['Дым: кольцо'],
        ['smoke.ringR', 'радиус (от размера фигур)', 0.2, 2, 0.01],
        ['smoke.ringY', 'высота (0 низ, 1 верх)', 0, 1, 0.01],
        ['smoke.tilt', 'наклон кольца', -1.6, 1.6, 0.01],
        ['smoke.core', 'толщина сердцевины', 0.05, 1, 0.01],
        ['smoke.speed', 'скорость частиц', 0, 4, 0.01],
        ['smoke.spin', 'кружение', 0, 5, 0.01],
        ['smoke.swirl', 'бег вдоль кольца', -1, 1, 0.01],
        ['Дым: водовороты'],
        ['smoke.noiseAmp', 'крупные: сила', 0, 1.5, 0.01],
        ['smoke.noiseScale', 'крупные: частота', 0.2, 4, 0.01],
        ['smoke.detailAmp', 'мелкие: сила', 0, 1, 0.01],
        ['smoke.detailScale', 'мелкие: частота', 1, 10, 0.05],
        ['smoke.noiseSpeed', 'изменчивость', 0, 1.5, 0.01],
        ['Дым: жизнь частицы'],
        ['smoke.lifeMin', 'жизнь от, с', 0.3, 10, 0.1],
        ['smoke.lifeMax', 'жизнь до, с', 0.3, 15, 0.1],
        ['smoke.fadeIn', 'появление (доля)', 0.01, 0.8, 0.01],
        ['smoke.fadeOut', 'угасание (доля)', 0.01, 0.95, 0.01],
        ['smoke.grow', 'рост к концу', 0.2, 5, 0.05],
        ['smoke.escape', 'доля улетающих', 0, 1, 0.01],
        ['smoke.lift', 'подъём улетающих', 0, 2, 0.01],
        ['Фонтан: время'],
        ['fountain.fallSpread', 'обрушение сверху вниз, с', 0.1, 4, 0.05],
        ['fountain.travel', 'полёт частицы, с', 0.3, 5, 0.05],
        ['fountain.jitter', 'разброс отрыва, с', 0, 0.6, 0.01],
        ['fountain.gravity', 'ускорение осыпания', 0, 10, 0.1],
        ['Фонтан: петли'],
        ['fountain.wallR', 'радиус стенки сферы', 0.4, 2, 0.01],
        ['fountain.heightK', 'высота петли', 0.3, 2, 0.01],
        ['fountain.innerR', 'радиус столба', 0, 0.8, 0.01],
        ['fountain.box', 'квадратность петли', 2, 8, 0.1],
        ['fountain.entry', 'вход в столб', 0, 1, 0.01],
        ['Фонтан: струи'],
        ['fountain.jets', 'струй по кругу', 2, 64, 1],
        ['fountain.jetWidth', 'ширина струи', 0, 1, 0.01],
        ['fountain.shellJitter', 'разброс петель', 0, 0.2, 0.005],
        ['fountain.sectors', 'секторов пар', 4, 64, 1],
        ['Частицы в полёте'],
        ['swirlLook', 'вид в полёте (0 — как на фигуре)', 0, 1, 0.01],
        ['swirlAlpha', 'яркость в полёте', 0, 1, 0.01],
        ['swirlSize', 'размер в полёте', 0.2, 3, 0.01]
    ];

    if (!DP.params.has('tune')) return;

    // ---------- панель ----------
    const css = document.createElement('style');
    css.textContent = `
        #dpTune { position: fixed; left: 10px; top: 40px; width: 250px; max-height: calc(100% - 60px); overflow: auto; z-index: 20;
            background: rgba(4,10,20,.8); border: 1px solid rgba(120,170,255,.25); border-radius: 8px; padding: 8px 10px;
            font: 12px/1.3 -apple-system, system-ui, sans-serif; color: #cfe3ff; }
        #dpTune.hidden .rows { display: none; }
        #dpTune h3 { margin: 0 0 6px; font-size: 12px; cursor: pointer; display: flex; justify-content: space-between; }
        #dpTune .row { margin: 5px 0; }
        #dpTune label { display: flex; justify-content: space-between; opacity: .85; gap: 6px; }
        #dpTune input[type=range] { width: 100%; margin: 2px 0 0; }
        #dpTune .sec { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(120,170,255,.15); font-weight: 600; opacity: .7; }
        #dpTune button, #dpTune select { background: #0b1a33; color: #cfe3ff; border: 1px solid rgba(120,170,255,.35); border-radius: 5px; padding: 3px 8px; margin: 4px 4px 0 0; cursor: pointer; }
        #dpTune .note { opacity: .55; font-size: 11px; margin-top: 4px; }`;
    document.head.appendChild(css);
    const panel = document.createElement('div');
    panel.id = 'dpTune';
    panel.innerHTML = '<h3><span>Настройка морфинга</span><span>▾</span></h3><div class="rows"></div>';
    document.body.appendChild(panel);
    panel.querySelector('h3').onclick = () => panel.classList.toggle('hidden');
    const rows = panel.querySelector('.rows');

    const addSec = (t) => { const d = document.createElement('div'); d.className = 'sec'; d.textContent = t; rows.appendChild(d); };
    const addSlider = (name, min, max, step, getv, setv, fmt) => {
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = `<label><span>${name}</span><b></b></label><input type="range" min="${min}" max="${max}" step="${step}">`;
        const inp = row.querySelector('input'), val = row.querySelector('b');
        inp.value = getv();
        const show = () => { val.textContent = fmt ? fmt(getv()) : (+getv()).toFixed(step >= 1 ? 0 : step < 0.01 ? 3 : 2); };
        inp.addEventListener('input', () => { setv(parseFloat(inp.value)); show(); });
        show(); rows.appendChild(row);
    };

    // --- цикл ---
    addSec('Цикл');
    const loop = { on: DP.params.get('loop') !== '0', pause: parseFloat(DP.params.get('pause') || '1.5') };
    const bar = document.createElement('div');
    bar.innerHTML = '<button data-a="loop"></button><button data-a="now">морфинг сейчас</button>' +
        '<select data-a="mode"><option value="sphere">дымная сфера</option><option value="sweep">кольцо-кисть</option><option value="smoke">дымное кольцо</option><option value="fountain">фонтан</option><option value="vortex">вихрь</option></select>';
    rows.appendChild(bar);
    const bLoop = bar.querySelector('[data-a=loop]'), sMode = bar.querySelector('[data-a=mode]');
    const showLoop = () => { bLoop.textContent = loop.on ? 'цикл: вкл' : 'цикл: выкл'; };
    bLoop.onclick = () => { loop.on = !loop.on; showLoop(); if (loop.on && !DP.orchestrator.isMorphing) schedule(); };
    bar.querySelector('[data-a=now]').onclick = () => DP.morphNext();
    sMode.value = M.mode; sMode.onchange = () => { M.mode = sMode.value; };
    showLoop();
    addSlider('пауза между морфингами, с', 0, 10, 0.1, () => loop.pause, v => { loop.pause = v; });
    DP.timeScale = parseFloat(DP.params.get('slow') || '1');
    addSlider('скорость времени (замедление)', 0.05, 2, 0.05, () => DP.timeScale, v => { DP.timeScale = v; });

    // --- параметры морфинга ---
    DP.tuneSpec.forEach(s => {
        if (s.length === 1) { addSec(s[0]); return; }
        const [path, name, min, max, step] = s;
        if (typeof get(path) !== 'number') return;
        addSlider(name, min, max, step, () => get(path), v => set(path, v));
    });

    const foot = document.createElement('div');
    foot.innerHTML = '<button data-a="link">ссылка с настройками</button><div class="note">Значения применяются со следующего морфинга.</div>';
    rows.appendChild(foot);
    foot.querySelector('[data-a=link]').onclick = () => {
        const qs = new URLSearchParams(location.search);
        [...qs.keys()].filter(k => k.startsWith('m.')).forEach(k => qs.delete(k));
        qs.set('tune', ''); qs.set('figure', DP.orchestrator.current || 'peony');
        qs.set('m.mode', M.mode);
        DP.tuneSpec.forEach(s => { if (s.length > 1 && typeof get(s[0]) === 'number') qs.set('m.' + s[0], +(+get(s[0])).toFixed(3)); });
        qs.set('pause', loop.pause); qs.set('slow', DP.timeScale);
        const url = location.origin + location.pathname + '?' + qs.toString().replace('tune=&', 'tune&');
        history.replaceState(null, '', url);
        if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    };

    // --- цикл морфинга: после окончания перехода — пауза и следующий ---
    let timer = null;
    function schedule() {
        clearTimeout(timer);
        if (!loop.on) return;
        timer = setTimeout(() => { if (loop.on && !DP.orchestrator.isMorphing) DP.morphNext(); },
            loop.pause * 1000 / Math.max(0.05, DP.timeScale));
    }
    DP.orchestrator.on('morphend', schedule);
    schedule();
})(window.DP);
