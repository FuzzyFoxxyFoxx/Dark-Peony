// ==========================================
// DARK PEONY — РЕЕСТР ФИГУР И ОРКЕСТРАТОР
// ==========================================
//
// Фигура регистрируется так (см. js/figures/peony.js):
//
//   DP.figures.register({
//       name: 'peony',
//       createInstance(ctx) { ... return instance; }
//   });
//
// ctx = { quality, qualityTier, uniforms }
//   uniforms — uniform'ы экземпляра для морфинга: разложить во все материалы через
//              DP.morph.uniformsFor(ctx.uniforms).
//
// instance = {
//   root:       THREE.Object3D — добавляется в DP.stage.figureStage;
//   pointsRoot: THREE.Object3D — всё, что рисуется точками (видно в POINTS MODE и во время морфинга);
//   meshRoot:   THREE.Object3D — поверхности (MESH MODE), может быть пустой группой;
//   layout:     результат DP.morph.createLayout(...) — общий для всех экземпляров фигуры;
//   update(time, dt) — необязательно;
//   dispose()   — освободить материалы (геометрию фигура может кэшировать).
// }
//
// Экземпляров одной фигуры может быть два сразу (морфинг пиона в пион):
// геометрия общая, у каждого экземпляра свои материалы и свои uniform'ы.
(function (DP) {
    'use strict';

    const registry = {};
    DP.figures = {
        register(def) {
            if (!def || !def.name || typeof def.createInstance !== 'function') throw new Error('DP.figures.register: нужны name и createInstance');
            registry[def.name] = def;
        },
        get(name) { return registry[name]; },
        list() { return Object.keys(registry); }
    };

    const events = DP.createEmitter();
    let current = null;     // { name, instance, uniforms }
    let morph = null;       // { from, to, time, duration, resolve }
    let queued = null;      // { name, resolve }
    let pointsMode = true;

    function instantiate(name) {
        const def = registry[name];
        if (!def) throw new Error(`DP: фигура «${name}» не зарегистрирована`);
        const uniforms = DP.morph.createInstanceUniforms();
        const instance = def.createInstance({
            quality: DP.quality,
            qualityTier: DP.QUALITY_TIERS[DP.quality],
            uniforms
        });
        instance.root.traverse(o => { o.frustumCulled = false; }); // вихрь выходит за исходные границы
        DP.stage.figureStage.add(instance.root);
        return { name, instance, uniforms, tilt: def.stageTilt || 0 };
    }

    // Наклон сцены под фигуру (stageTilt, рад): вращение вокруг оси X поверх вращения вокруг Y.
    // Вихрь морфинга живёт в пространстве сцены, поэтому наклон можно плавно менять во время морфинга.
    function setTilt(a) { DP.stage.figureStage.rotation.x = a; }

    function release(entry) {
        DP.stage.figureStage.remove(entry.instance.root);
        if (entry.instance.dispose) entry.instance.dispose();
    }

    function applyVisibility() {
        const list = morph ? [morph.from, morph.to] : (current ? [current] : []);
        list.forEach(e => {
            e.instance.pointsRoot.visible = pointsMode || !!morph;
            e.instance.meshRoot.visible = !pointsMode;
        });
        DP.morph.shared.uMeshMode.value = pointsMode ? 0 : 1;
    }

    function startMorph(name, resolve) {
        const from = current;
        const to = instantiate(name);
        const duration = DP.morph.plan(from.instance.layout, to.instance.layout);

        from.uniforms.uMorphActive.value = 1; from.uniforms.uMorphRole.value = 0; from.uniforms.uMorphTime.value = 0;
        to.uniforms.uMorphActive.value = 1;   to.uniforms.uMorphRole.value = 1;   to.uniforms.uMorphTime.value = 0;

        morph = { from, to, time: 0, duration, resolve };
        morph.tilt0 = DP.stage.figureStage.rotation.x;
        applyVisibility();
        events.emit('morphstart', { from: from.name, to: name, duration });
    }

    function finishMorph() {
        const m = morph;
        morph = null;
        if (DP.flowSim) DP.flowSim.stop();
        release(m.from);
        setTilt(m.to.tilt);
        m.to.uniforms.uMorphActive.value = 0;
        current = m.to;
        applyVisibility();
        events.emit('morphend', { figure: current.name });
        m.resolve && m.resolve(current.name);
        if (queued) {
            const q = queued; queued = null;
            if (q.name) startMorph(q.name, q.resolve);
        }
    }

    DP.orchestrator = {
        on: events.on.bind(events),
        off: events.off.bind(events),

        // Мгновенно показать фигуру (без морфинга).
        show(name) {
            if (morph) finishMorph();
            if (current) release(current);
            current = instantiate(name);
            setTilt(current.tilt);
            applyVisibility();
            events.emit('show', { figure: name });
        },

        // Морфинг в фигуру. Если морфинг уже идёт — запрос встаёт в очередь (последний побеждает).
        morphTo(name) {
            return new Promise((resolve) => {
                if (!current) { this.show(name); resolve(name); return; }
                if (morph) {
                    if (queued && queued.resolve) queued.resolve(null);
                    queued = { name, resolve };
                    return;
                }
                startMorph(name, resolve);
            });
        },

        update(time, dt) {
            if (morph) {
                morph.time += dt;
                morph.from.uniforms.uMorphTime.value = morph.time;
                morph.to.uniforms.uMorphTime.value = morph.time;
                if (DP.flowSim) DP.flowSim.step(morph.time);
                const k = DP.util.smoothstep(0.15, 0.75, morph.time / morph.duration);
                setTilt(morph.tilt0 + (morph.to.tilt - morph.tilt0) * k);
                events.emit('morphprogress', { time: morph.time, duration: morph.duration });
                if (morph.time >= morph.duration) finishMorph();
            }
            const list = morph ? [morph.from, morph.to] : (current ? [current] : []);
            list.forEach(e => e.instance.update && e.instance.update(time, dt));
        },

        setPointsMode(v) { pointsMode = !!v; applyVisibility(); events.emit('mode', { points: pointsMode }); },
        get pointsMode() { return pointsMode; },
        get current() { return current ? current.name : null; },
        get isMorphing() { return !!morph; }
    };

    // Короткий алиас для консоли и будущих нод/меню.
    DP.morphTo = (name) => DP.orchestrator.morphTo(name);
})(window.DP);
