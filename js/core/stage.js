// ==========================================
// DARK PEONY — СЦЕНА: рендерер, камера, HUD, фон, ресайз, цикл
// ==========================================
(function (DP) {
    'use strict';

    const cfg = DP.config;
    const { seededRandom } = DP.util;

    // ------------------------------------------
    // РЕНДЕРЕР (с проверкой WebGL и опцией ?webgl1 для тестов)
    // ------------------------------------------
    function createRenderer() {
        const canvas = document.createElement('canvas');
        canvas.id = 'webglCanvas';
        const attrs = { antialias: true, alpha: false, powerPreference: 'high-performance' };
        const opts = Object.assign({ canvas }, attrs);
        if (DP.params.has('webgl1')) {
            const ctx = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
            if (!ctx) throw new Error('WebGL1 недоступен');
            opts.context = ctx;
        }
        return new THREE.WebGLRenderer(opts); // сам выберет WebGL2, иначе WebGL1
    }

    let renderer;
    try {
        renderer = createRenderer();
    } catch (e) {
        console.error(e);
        DP.showFatal && DP.showFatal('Ваш браузер или устройство не поддерживает WebGL.');
        DP.stage = null;
        return;
    }

    renderer.setClearColor(cfg.clearColor, 1.0);
    document.body.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 5.6, 5.4);
    camera.lookAt(0, -0.48, 0);

    // Группа, вокруг оси Y которой вращаются фигуры и вихрь морфинга.
    const figureStage = new THREE.Group();
    scene.add(figureStage);

    // ------------------------------------------
    // ТЕКСТУРА ЧАСТИЦЫ
    // ------------------------------------------
    function createParticleTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, 'rgba(255,255,255,1.0)');
        gradient.addColorStop(0.25, 'rgba(200,230,255,0.7)');
        gradient.addColorStop(0.5, 'rgba(100,170,255,0.2)');
        gradient.addColorStop(1, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(canvas);
    }
    DP.shared.uTexture.value = createParticleTexture();

    DP.pointsMaterialConfig = {
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        depthTest: true
    };

    // ------------------------------------------
    // ФОН: ГАЛАКТИКА (россыпь звёзд) + ДЫМКА
    // ------------------------------------------
    // Постоянная часть фона, не относится к фигурам: эллиптическая россыпь редких крупных звёзд за фигурой
    // (медленно мерцают, диск чуть вращается) и лёгкие облака дыма вокруг — как было на исходной «чёрной дыре».
    const bg = cfg.background;
    const galaxy = new THREE.Group();
    galaxy.position.set(0, -0.1, -1.5);
    scene.add(galaxy);
    (function createGalaxy() {
        const count = bg.stars;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const scales = new Float32Array(count), phases = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            if (seededRandom(i * 8.3 + 0.5) < bg.halo) {
                // россыпь по всему фону: и сверху, и снизу от приплюснутого диска
                positions[i * 3 + 0] = (seededRandom(i * 1.5) - 0.5) * 18;
                positions[i * 3 + 1] = (seededRandom(i * 3.7) - 0.5) * 10;
                positions[i * 3 + 2] = (seededRandom(i * 4.9) - 0.5) * 3;
            } else {
                const u = seededRandom(i * 1.5) * Math.PI * 2;
                const r = Math.pow(seededRandom(i * 2.3), 0.6) * 4.2;
                positions[i * 3 + 0] = Math.cos(u) * r * 2.4;
                positions[i * 3 + 1] = (seededRandom(i * 3.7) - 0.5) * bg.starSpreadY;
                positions[i * 3 + 2] = Math.sin(u) * r * 0.35 + (seededRandom(i * 4.9) - 0.5) * 0.5;
            }
            scales[i] = seededRandom(i * 4.1);
            phases[i] = seededRandom(i * 7.3) * 6.2831853;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aSizeScale', new THREE.BufferAttribute(scales, 1));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        const mat = new THREE.ShaderMaterial(Object.assign({}, DP.pointsMaterialConfig, {
            uniforms: {
                uTexture: DP.shared.uTexture,
                uViewportScale: DP.shared.uViewportScale,
                uSize: { value: bg.starSize },
                uAlpha: { value: bg.starAlpha },
                uTime: DP.shared.uTime
            },
            vertexShader: `
                uniform float uViewportScale, uSize, uTime;
                attribute float aSizeScale, aPhase;
                varying float vAlpha;
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    float dist = max(-mvPosition.z, 0.1);
                    // крупные звёзды редкие: размер растёт круто с aSizeScale
                    gl_PointSize = uSize * uViewportScale * (0.6 + 1.6 * aSizeScale * aSizeScale) / (0.4 + 0.08 * dist);
                    // медленное мерцание, у каждой звезды свой ритм
                    float tw = 0.55 + 0.45 * sin(uTime * (0.6 + 1.3 * fract(aPhase * 3.1)) + aPhase);
                    vAlpha = (0.35 + 0.65 * aSizeScale) * tw;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;
                uniform float uAlpha;
                varying float vAlpha;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    vec3 col = mix(vec3(0.25, 0.5, 0.85), vec3(0.85, 0.95, 1.0), tex.a);
                    gl_FragColor = vec4(col, tex.a * vAlpha * uAlpha);
                }
            `
        }));
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        galaxy.add(pts);
        galaxy.userData.starMat = mat;
    })();
    (function createHaze() {
        // Мягкая текстура облака: пятно с неровным краем (несколько смещённых градиентов).
        const size = 256, c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        for (let k = 0; k < 7; k++) {
            const x = size * (0.5 + (seededRandom(k * 3.1) - 0.5) * 0.35), y = size * (0.5 + (seededRandom(k * 5.7) - 0.5) * 0.35);
            const r = size * (0.22 + seededRandom(k * 2.3) * 0.22);
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, 'rgba(255,255,255,0.22)');
            gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(0, 0, size, size);
        }
        const tex = new THREE.CanvasTexture(c);
        const count = bg.clouds;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3), seed = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const u = seededRandom(i * 9.1 + 1) * Math.PI * 2, r = Math.pow(seededRandom(i * 6.7 + 2), 0.5) * 3.4;
            pos[i * 3] = Math.cos(u) * r * 2.2; pos[i * 3 + 1] = (seededRandom(i * 4.3 + 3) - 0.5) * 0.9; pos[i * 3 + 2] = Math.sin(u) * r * 0.3;
            seed[i] = seededRandom(i * 2.9 + 4);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: tex }, uTime: DP.shared.uTime, uViewportScale: DP.shared.uViewportScale,
                        uSize: { value: bg.cloudSize }, uAlpha: { value: bg.cloudAlpha } },
            vertexShader: `
                uniform float uTime, uViewportScale, uSize;
                attribute float aSeed;
                varying float vA; varying float vRot;
                void main() {
                    vec3 p = position;
                    p.x += sin(uTime * 0.05 + aSeed * 12.0) * 0.25;   // облака медленно плывут
                    p.y += cos(uTime * 0.04 + aSeed * 7.0) * 0.08;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = uSize * uViewportScale * (0.7 + 0.8 * aSeed) / (0.4 + 0.08 * max(-mv.z, 0.1));
                    vA = 0.5 + 0.5 * sin(uTime * (0.07 + 0.08 * aSeed) + aSeed * 20.0);   // медленно «дышат»
                    vRot = aSeed * 6.2831853 + uTime * 0.02 * (aSeed - 0.5);
                }
            `,
            fragmentShader: `
                uniform sampler2D uTex; uniform float uAlpha;
                varying float vA; varying float vRot;
                void main() {
                    vec2 q = gl_PointCoord - 0.5;
                    float c = cos(vRot), s = sin(vRot);
                    q = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + 0.5;
                    float a = texture2D(uTex, q).a;
                    gl_FragColor = vec4(vec3(0.45, 0.62, 0.9), a * vA * uAlpha);
                }
            `,
            transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        pts.renderOrder = -1;
        galaxy.add(pts);
        galaxy.userData.cloudMat = mat;
    })();
    DP.background = {
        galaxy,
        // Применить значения из DP.config.background / hud на ходу (панель ?tune).
        sync() {
            const b = cfg.background, s = galaxy.userData.starMat.uniforms, c = galaxy.userData.cloudMat.uniforms;
            s.uSize.value = b.starSize; s.uAlpha.value = b.starAlpha;
            c.uSize.value = b.cloudSize; c.uAlpha.value = b.cloudAlpha;
            drawHud(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
        }
    };

    // ------------------------------------------
    // 2D HUD: две «весики» — малая (с крестиками) и большая
    // ------------------------------------------
    // Малая: круг R в центре и два круга R с центрами сверху и снизу — проходят через центр; на пересечениях —
    // крестики. Большая — то же с радиусом R2 (выходит за экран), без знаков на пересечениях.
    // Все линии одной толщины; крестики масштабируются вместе с кругами (размер — доля R).
    const hudCanvas = document.getElementById('hudCanvas');
    const hudCtx = hudCanvas.getContext('2d');

    function drawHud(w, h) {
        const dpr = Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio);
        hudCanvas.width = Math.round(w * dpr);
        hudCanvas.height = Math.round(h * dpr);
        hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        hudCtx.clearRect(0, 0, w, h);
        const H = cfg.hud;

        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.475;
        const R2 = R * H.bigK;

        hudCtx.lineWidth = H.line;
        hudCtx.strokeStyle = H.color;
        const circle = (x, y, r) => { hudCtx.beginPath(); hudCtx.arc(x, y, r, 0, Math.PI * 2); hudCtx.stroke(); };
        [R, R2].forEach(r => { circle(cx, cy, r); circle(cx, cy - r, r); circle(cx, cy + r, r); });

        const hGrad = hudCtx.createLinearGradient(0, cy, w, cy);
        hGrad.addColorStop(0.0, 'rgba(100, 170, 240, 0.0)');
        hGrad.addColorStop(0.2, 'rgba(100, 170, 240, 0.15)');
        hGrad.addColorStop(0.8, 'rgba(100, 170, 240, 0.15)');
        hGrad.addColorStop(1.0, 'rgba(100, 170, 240, 0.0)');
        hudCtx.strokeStyle = hGrad;
        hudCtx.beginPath(); hudCtx.moveTo(0, cy); hudCtx.lineTo(w, cy); hudCtx.stroke();

        const vGrad = hudCtx.createLinearGradient(cx, 0, cx, h);
        vGrad.addColorStop(0.0, 'rgba(100, 170, 240, 0.0)');
        vGrad.addColorStop(0.15, 'rgba(100, 170, 240, 0.15)');
        vGrad.addColorStop(0.85, 'rgba(100, 170, 240, 0.15)');
        vGrad.addColorStop(1.0, 'rgba(100, 170, 240, 0.0)');
        hudCtx.strokeStyle = vGrad;
        hudCtx.beginPath(); hudCtx.moveTo(cx, 0); hudCtx.lineTo(cx, h); hudCtx.stroke();

        // Точки пересечения: круг r в центре с кругами сверху/снизу — под углом ±30° от горизонтали.
        const marks = (r) => { const ox = r * Math.sin(Math.PI / 3); return [[cx - ox, cy - r / 2], [cx + ox, cy - r / 2], [cx - ox, cy + r / 2], [cx + ox, cy + r / 2]]; };
        const crossSz = R * H.crossK, crossW = Math.max(1, R * H.crossLineK);
        hudCtx.strokeStyle = H.markColor; hudCtx.lineWidth = crossW;
        marks(R).forEach(([x, y]) => {
            hudCtx.beginPath();
            hudCtx.moveTo(x - crossSz, y); hudCtx.lineTo(x + crossSz, y);
            hudCtx.moveTo(x, y - crossSz); hudCtx.lineTo(x, y + crossSz);
            hudCtx.stroke();
        });
    }

    // ------------------------------------------
    // РЕСАЙЗ + ПЛОТНОСТЬ ПИКСЕЛЕЙ
    // ------------------------------------------
    let pixelRatioCap = cfg.maxPixelRatio; // понижается адаптивным качеством
    let currentPixelRatio = 1;
    let lastW = 0, lastH = 0;

    function applySize(force) {
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        const pr = Math.min(window.devicePixelRatio || 1, pixelRatioCap);
        if (!force && w === lastW && h === lastH && pr === currentPixelRatio) return;
        lastW = w; lastH = h; currentPixelRatio = pr;

        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(pr);
        renderer.setSize(w, h);
        DP.shared.uViewportScale.value = DP.computeViewportScale(w, h, pr);
        drawHud(w, h);
    }

    // Ресайз копим до ближайшего кадра (на мобильных resize сыплется пачками при скрытии панелей).
    let resizePending = false;
    function requestResize() { resizePending = true; }
    window.addEventListener('resize', requestResize);
    window.addEventListener('orientationchange', requestResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', requestResize);
    // Перенос окна на монитор с другим DPR не всегда вызывает resize — следим за DPR отдельно.
    (function watchDpr() {
        if (!window.matchMedia) return;
        const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        const onChange = () => {
            if (mq.removeEventListener) mq.removeEventListener('change', onChange); else mq.removeListener(onChange);
            requestResize(); watchDpr();
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange); // Safari < 14
    })();
    applySize(true);

    // ------------------------------------------
    // АДАПТИВНОЕ КАЧЕСТВО
    // ------------------------------------------
    const adaptive = { acc: 0, frames: 0, elapsed: 0 };
    function adaptQuality(dt) {
        const a = cfg.adaptive;
        if (!a.enabled) return;
        adaptive.elapsed += dt;
        if (adaptive.elapsed < a.warmupSeconds) return;
        adaptive.acc += dt; adaptive.frames++;
        if (adaptive.acc < a.sampleSeconds) return;
        const fps = adaptive.frames / adaptive.acc;
        adaptive.acc = 0; adaptive.frames = 0;
        if (fps < a.minFps && currentPixelRatio > a.minPixelRatio) {
            pixelRatioCap = Math.max(a.minPixelRatio, currentPixelRatio - a.step);
            console.info(`[DP] FPS ${fps.toFixed(1)} → pixelRatio ${pixelRatioCap}`);
            applySize(true);
        }
    }

    // ------------------------------------------
    // ПОТЕРЯ WebGL-КОНТЕКСТА (фоновые вкладки на мобильных, сбои драйвера)
    // ------------------------------------------
    let contextLost = false;
    renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; }, false);
    renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; applySize(true); }, false);

    // ------------------------------------------
    // КАДР
    // ------------------------------------------
    function render(dt) {
        if (resizePending) { resizePending = false; applySize(false); }
        adaptQuality(dt);
        galaxy.rotation.y = DP.shared.uTime.value * cfg.background.spin;   // диск галактики медленно вращается
        figureStage.updateMatrixWorld(true);
        DP.morph.shared.uStageMatrix.value.copy(figureStage.matrixWorld);
        DP.morph.shared.uStageMatrixInv.value.copy(figureStage.matrixWorld).invert();
        if (!contextLost && DP.smokeSim) DP.smokeSim.renderShadow();   // самозатенение дыма (перед кадром)
        if (!contextLost) renderer.render(scene, camera);
    }

    DP.stage = {
        renderer, scene, camera, figureStage,
        render,
        resize: () => applySize(true),
        get pixelRatio() { return currentPixelRatio; }
    };
})(window.DP);
