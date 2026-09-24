// ==========================================
// DARK PEONY — ЗАПУСК, ЦИКЛ, UI
// ==========================================
(function (DP) {
    'use strict';
    if (!DP.stage) return; // WebGL недоступен — сообщение уже показано

    const orchestrator = DP.orchestrator;
    const cfg = DP.config;

    orchestrator.show(DP.params.get('figure') || 'peony');

    // ------------------------------------------
    // UI
    // ------------------------------------------
    const btnToggle = document.getElementById('btnToggle');
    const btnMorph = document.getElementById('btnMorph');

    function updateModeButton() {
        const points = orchestrator.pointsMode;
        btnToggle.classList.toggle('active', points);
        btnToggle.textContent = points ? 'POINTS MODE (M)' : 'MESH MODE (M)';
    }
    function toggleMode() { orchestrator.setPointsMode(!orchestrator.pointsMode); updateModeButton(); }
    // MORPH — следующая фигура по кругу (пион → медуза → пион). Позже — выбор цели (ноды / меню).
    function morph() {
        const list = DP.figures.list();
        const i = list.indexOf(orchestrator.current);
        orchestrator.morphTo(list[(i + 1) % list.length]);
    }

    btnToggle.addEventListener('click', toggleMode);
    btnMorph.addEventListener('click', morph);
    orchestrator.on('morphstart', () => btnMorph.classList.add('active'));
    orchestrator.on('morphend', () => { if (!orchestrator.isMorphing) btnMorph.classList.remove('active'); });

    window.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        // e.code — физическая клавиша: работает в любой раскладке (M = Ь).
        if (e.code === 'KeyM') { toggleMode(); }
        else if (e.code === 'Space' || e.code === 'KeyN') {
            if (tag === 'BUTTON') return; // пробел на кнопке уже вызывает click
            e.preventDefault(); morph();
        }
    });
    updateModeButton();

    // ------------------------------------------
    // ЦИКЛ
    // ------------------------------------------
    // Своё время вместо THREE.Clock: шаг ограничен, поэтому после сворачивания вкладки
    // анимация и морфинг не «перепрыгивают» вперёд.
    const MAX_DT = 1 / 15;
    let time = 0;
    let last = null;
    const manual = DP.params.has('manual'); // для автотестов: время двигает DP.debug.step()

    function tick(dt, draw = true) {
        time += dt;
        DP.shared.uTime.value = time;
        DP.stage.figureStage.rotation.y = time * cfg.stageRotationSpeed;
        orchestrator.update(time, dt);
        if (draw) DP.stage.render(dt);
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (manual) return;
        const dt = last === null ? 1 / 60 : Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
        last = now;
        tick(dt);
    }
    document.addEventListener('visibilitychange', () => { last = null; });
    requestAnimationFrame(frame);

    // ------------------------------------------
    // ?debug — счётчик FPS и сведения о рендере
    // ------------------------------------------
    if (DP.params.has('debug')) {
        const hud = document.createElement('div');
        hud.id = 'debugHud';
        document.body.appendChild(hud);
        let frames = 0, acc = 0, lastT = performance.now();
        const points = () => {
            const info = DP.stage.renderer.info;
            return `${DP.quality} · pr ${DP.stage.pixelRatio} · ${info.render.points.toLocaleString('ru-RU')} pts · ${info.programs.length} prog`;
        };
        (function loop(now) {
            requestAnimationFrame(loop);
            frames++; acc += now - lastT; lastT = now;
            if (acc < 500) return;
            const fps = frames * 1000 / acc;
            frames = 0; acc = 0;
            const gl = DP.stage.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1';
            const morph = orchestrator.isMorphing ? ' · MORPH' : '';
            hud.textContent = `${fps.toFixed(0)} FPS · ${gl} · ${points()}${morph}`;
        })(performance.now());
    }

    DP.debug = {
        get time() { return time; },
        // Продвинуть время на seconds шагами по dt, отрисовать последний кадр (для тестов со ?manual).
        step(seconds, dt = 1 / 30) {
            const n = Math.max(1, Math.round(seconds / dt));
            for (let i = 0; i < n; i++) tick(seconds / n, i === n - 1);
        }
    };

    document.documentElement.classList.add('dp-ready');
})(window.DP);
