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
    // ФОНОВЫЕ ЧАСТИЦЫ
    // ------------------------------------------
    (function createGalaxy() {
        const count = 900;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const scales = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const u = seededRandom(i * 1.5) * Math.PI * 2;
            const r = Math.pow(seededRandom(i * 2.3), 0.6) * 4.2;
            positions[i * 3 + 0] = Math.cos(u) * r * 2.4;
            positions[i * 3 + 1] = (seededRandom(i * 3.7) - 0.5) * 1.2 - 0.1;
            positions[i * 3 + 2] = (seededRandom(i * 4.9) - 0.5) * 0.8 - 1.5;
            scales[i] = seededRandom(i * 4.1);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aSizeScale', new THREE.BufferAttribute(scales, 1));
        const mat = new THREE.ShaderMaterial(Object.assign({}, DP.pointsMaterialConfig, {
            uniforms: {
                uTexture: DP.shared.uTexture,
                uViewportScale: DP.shared.uViewportScale,
                uSize: { value: 3.5 },
                uTime: DP.shared.uTime
            },
            vertexShader: `
                uniform float uViewportScale, uSize, uTime;
                attribute float aSizeScale;
                varying float vAlpha;
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    float dist = max(-mvPosition.z, 0.1);
                    gl_PointSize = uSize * uViewportScale * (0.8 + aSizeScale * 0.7) / (0.4 + 0.08 * dist);
                    vAlpha = 0.3 + 0.4 * aSizeScale;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;
                varying float vAlpha;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    vec3 col = mix(vec3(0.1, 0.35, 0.7), vec3(0.7, 0.9, 1.0), tex.a);
                    gl_FragColor = vec4(col, tex.a * vAlpha * 0.25);
                }
            `
        }));
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        scene.add(pts);
    })();

    // ------------------------------------------
    // 2D HUD
    // ------------------------------------------
    const hudCanvas = document.getElementById('hudCanvas');
    const hudCtx = hudCanvas.getContext('2d');

    function drawHud(w, h) {
        const dpr = Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio);
        hudCanvas.width = Math.round(w * dpr);
        hudCanvas.height = Math.round(h * dpr);
        hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        hudCtx.clearRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.38 * 1.25;

        hudCtx.lineWidth = 1.5;
        hudCtx.strokeStyle = 'rgba(100, 160, 220, 0.35)';
        hudCtx.beginPath(); hudCtx.arc(cx, cy, R, 0, Math.PI * 2); hudCtx.stroke();

        hudCtx.strokeStyle = 'rgba(80, 140, 200, 0.22)';
        hudCtx.beginPath(); hudCtx.arc(cx, cy - R, R, 0, Math.PI * 2); hudCtx.stroke();
        hudCtx.beginPath(); hudCtx.arc(cx, cy + R, R, 0, Math.PI * 2); hudCtx.stroke();

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

        const drawCross = (x, y, sz, col) => {
            hudCtx.strokeStyle = col;
            hudCtx.lineWidth = 2.5;
            hudCtx.beginPath();
            hudCtx.moveTo(x - sz, y); hudCtx.lineTo(x + sz, y);
            hudCtx.moveTo(x, y - sz); hudCtx.lineTo(x, y + sz);
            hudCtx.stroke();
        };
        const ox = R * Math.sin(Math.PI / 3);
        const crossCol = 'rgba(180, 220, 255, 0.85)';
        drawCross(cx - ox, cy - R * 0.5, 12, crossCol);
        drawCross(cx + ox, cy - R * 0.5, 12, crossCol);
        drawCross(cx - ox, cy + R * 0.5, 12, crossCol);
        drawCross(cx + ox, cy + R * 0.5, 12, crossCol);
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
