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

    DP.morphNext = morph;

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

    // Вращение фигуры при морфинге (поверх обычного медленного вращения сцены): в начале фигура плавно
    // раскручивается в сторону вихря, в конце докручивается по инерции и плавно замирает.
    // Сторона та же, что у вихря и у обычного вращения (угол вокруг Y растёт).
    let spinT = -1, spinD = 0, spinAngle = 0;
    orchestrator.on('morphstart', (e) => { spinT = 0; spinD = e.duration; });
    function spinStep(dt) {
        if (spinT < 0) return;
        const c = cfg.morph.figureSpin, U = DP.util;
        spinT += dt;
        const w = c.max * U.smoothstep(0, c.rise, spinT) * (1 - U.smoothstep(c.fallStart * spinD, spinD + c.fallEnd, spinT));
        spinAngle += w * dt;
        if (spinT > spinD + c.fallEnd) spinT = -1;
    }
    let last = null;
    const manual = DP.params.has('manual'); // для автотестов: время двигает DP.debug.step()

    // Угол сцены вокруг Y копится по шагам: обычное медленное вращение + раскрутка морфинга. Фигура с faceViewer
    // (серафим) не вращается: пока она на экране и морфинга нет, сцена плавно доворачивается лицом к зрителю.
    let stageAngle = 0, prevSpin = 0;
    function tick(dt, draw = true) {
        time += dt;
        DP.shared.uTime.value = time;
        spinStep(dt);
        const def = DP.figures.get(orchestrator.current);
        const face = def && def.faceViewer && !orchestrator.isMorphing;
        stageAngle += spinAngle - prevSpin; prevSpin = spinAngle;
        if (face) {
            const target = Math.round(stageAngle / (Math.PI * 2)) * Math.PI * 2;
            stageAngle += (target - stageAngle) * Math.min(1, dt * 1.6);
        } else stageAngle += dt * cfg.stageRotationSpeed;
        DP.stage.figureStage.rotation.y = stageAngle;
        orchestrator.update(time, dt);
        if (draw) DP.stage.render(dt);
        if (DP.vision && draw) DP.vision.update(time, dt);   // «компьютерное зрение» поверх сцены (отдельный модуль)
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (manual) return;
        const dt = last === null ? 1 / 60 : Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
        last = now;
        tick(dt * (DP.timeScale == null ? 1 : DP.timeScale));   // timeScale — замедление для настройки (?tune)
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
