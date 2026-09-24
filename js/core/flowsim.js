// ==========================================
// DARK PEONY — СИМУЛЯЦИЯ СРЕДЫ НА ВИДЕОКАРТЕ (GPGPU)
// ==========================================
//
// Каждая пара частиц морфинга — один пиксель текстуры. В пикселе хранится отклонение частицы
// от её траектории вокруг оси Y (xyz). Каждый кадр видеокарта делает шаг физики:
//   • среда (поле водоворотов, вращается вместе с вихрем) несёт частицу — отклонение копится,
//     поэтому у движения есть история: частицы расходятся, сгущаются, тянутся рядами;
//   • мягкая пружина держит частицу около траектории, а к посадке становится жёсткой —
//     частица садится точно на своё место.
// Вершинный шейдер фигуры читает свой пиксель и прибавляет отклонение (js/core/morph.js).
//
// Если устройство не умеет рисовать в текстуры с плавающей точкой или читать текстуры
// в вершинном шейдере — симуляция выключается, морфинг идёт без турбулентности.
(function (DP) {
    'use strict';

    const shared = DP.morph.shared;
    let support = null;          // null — ещё не проверяли; false — нельзя; { type } — можно
    let side = 0;
    let pairsTex = null;
    let jitTex = null;
    let targets = null;          // [WebGLRenderTarget, WebGLRenderTarget]
    let cur = 0;
    let scene = null, camera = null, material = null;
    let needReset = true;
    let lastTime = 0;

    const simFragment = `
        precision highp float;
        uniform sampler2D uState;
        uniform sampler2D uPairs;
        uniform sampler2D uJit;
        uniform float uSide;
        uniform float uTime;
        uniform float uDt;
        uniform float uReset;
        uniform vec4 uSpring;      // базовая пружина, пружина посадки, зона посадки, задержка поля
        ${DP.morph.glsl.simplexNoise}
        ${DP.morph.glsl.flowGlsl}
        void main() {
            vec2 uv = gl_FragCoord.xy / uSide;
            vec4 pd = texture2D(uPairs, uv);
            float L = floor(pd.x / 2048.0) * 0.01;
            float D = max(mod(pd.x, 2048.0) * 0.01, 0.05);
            float u = (uTime - L) / D;
            if (uReset > 0.5 || pd.x <= 0.0 || u <= 0.0 || u >= 1.0) { gl_FragColor = vec4(0.0); return; }

            vec4 jit = texture2D(uJit, uv);
            float s = dpPathS(uTime, L, D, jit.x, jit.y, uSimJitInfo.x);
            float g = s * s * (3.0 - 2.0 * s);
            float gp = 2.0 * min(g, 1.0 - g);                 // 0 — на месте, 1 — середина вихря

            float th = pd.z + pd.y * g;                       // угол на траектории
            float yMid = floor(pd.w / 1024.0) / 256.0 - 2.0;
            float rMid = mod(pd.w, 1024.0) / 256.0;
            vec3 d = texture2D(uState, uv).xyz;
            vec3 x = vec3(sin(th) * rMid, yMid, cos(th) * rMid) + d;

            // Среда толкает частицу; сила растёт вместе с поворотом (сначала — плавный уход по кругу).
            vec3 v = dpFlowVel(x, uTime) * uFlowA.x * smoothstep(uSpring.w, 1.0, gp);
            // Пружина к траектории: мягкая в вихре, жёсткая на посадке.
            float k = uSpring.x + uSpring.y * (1.0 - smoothstep(0.0, uSpring.z, gp));
            d = (d + v * uDt) / (1.0 + k * uDt);              // полунеявный шаг — устойчив при любом dt
            gl_FragColor = vec4(d, 1.0);
        }
    `;

    function checkSupport(renderer) {
        const caps = renderer.capabilities;
        const ext = renderer.extensions;
        if (!caps.floatVertexTextures) return false;
        let type = null;
        if (caps.isWebGL2) {
            if (ext.has('EXT_color_buffer_float')) type = THREE.FloatType;
            else if (ext.has('EXT_color_buffer_half_float')) type = THREE.HalfFloatType;
        } else {
            if (ext.has('WEBGL_color_buffer_float')) type = THREE.FloatType;
            else if (ext.has('OES_texture_half_float') && ext.has('EXT_color_buffer_half_float')) type = THREE.HalfFloatType;
        }
        if (!type) return false;
        // Проверка, что в такую текстуру действительно можно рисовать.
        const rt = new THREE.WebGLRenderTarget(4, 4, { type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt);
        const gl = renderer.getContext();
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        renderer.setRenderTarget(prev);
        rt.dispose();
        return ok ? { type } : false;
    }

    function makeTarget(n, type) {
        return new THREE.WebGLRenderTarget(n, n, {
            type, format: THREE.RGBAFormat,
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false, stencilBuffer: false, generateMipmaps: false
        });
    }

    function disposeTextures() {
        if (pairsTex) pairsTex.dispose();
        if (jitTex) jitTex.dispose();
        if (targets) targets.forEach(t => t.dispose());
        pairsTex = null; jitTex = null; targets = null; side = 0;
    }

    DP.flowSim = {
        get enabled() { return !!support && DP.config.morph.simEnabled; },

        // Вызывается планировщиком морфинга: n — сторона текстуры, data — RGBA на пару.
        prepare(n, data, jit) {
            shared.uSimInfo.value.set(0, 1, 0, 0);
            if (!DP.config.morph.simEnabled || !DP.stage) return;
            const renderer = DP.stage.renderer;
            if (support === null) {
                try { support = checkSupport(renderer); } catch (e) { console.warn('DP.flowSim:', e); support = false; }
                if (!support) console.info('DP.flowSim: устройство не поддерживает симуляцию — морфинг без турбулентности');
            }
            if (!support) return;

            if (n !== side) {
                disposeTextures();
                side = n;
                targets = [makeTarget(n, support.type), makeTarget(n, support.type)];
            }
            if (pairsTex) pairsTex.dispose();
            pairsTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
            pairsTex.minFilter = pairsTex.magFilter = THREE.NearestFilter;
            pairsTex.needsUpdate = true;
            if (jitTex) jitTex.dispose();
            jitTex = new THREE.DataTexture(jit, n, n, THREE.RGBAFormat, THREE.FloatType);
            jitTex.minFilter = jitTex.magFilter = THREE.NearestFilter;
            jitTex.needsUpdate = true;

            if (!material) {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uState: { value: null }, uPairs: { value: null }, uSide: { value: 1 },
                        uTime: { value: 0 }, uDt: { value: 0 }, uReset: { value: 1 },
                        uSpring: { value: new THREE.Vector4() },
                        uJit: { value: null },
                        uWarp: shared.uWarp, uFlowA: shared.uFlowA, uFlowC: shared.uFlowC, uSimJitInfo: shared.uSimJitInfo
                    },
                    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
                    fragmentShader: simFragment,
                    depthTest: false, depthWrite: false
                });
                scene = new THREE.Scene();
                const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
                quad.frustumCulled = false;
                scene.add(quad);
                camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            }
            material.uniforms.uPairs.value = pairsTex;
            material.uniforms.uJit.value = jitTex;
            shared.uSimJit.value = jitTex;
            material.uniforms.uSide.value = n;
            needReset = true;
            lastTime = 0;
            shared.uSimInfo.value.set(1, n, 0, 0);
            shared.uSimTex.value = targets[cur].texture;
        },

        // Шаг симуляции до момента морфинга time (сек). Большие шаги дробятся — физика устойчива.
        step(time) {
            if (!targets || !material || shared.uSimInfo.value.x < 0.5) return;
            const c = DP.config.morph;
            const renderer = DP.stage.renderer;
            const u = material.uniforms;
            u.uSpring.value.set(c.simSpring, c.simLandSpring, c.simLandZone, c.fieldDelay);
            const total = Math.max(0, time - lastTime);
            const n = needReset ? 1 : Math.min(8, Math.max(1, Math.ceil(total / (1 / 30))));
            const prevTarget = renderer.getRenderTarget();
            const prevAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            for (let i = 0; i < n; i++) {
                const t = lastTime + total * (i + 1) / n;
                u.uState.value = targets[cur].texture;
                u.uTime.value = t;
                u.uDt.value = total / n;
                u.uReset.value = needReset ? 1 : 0;
                renderer.setRenderTarget(targets[1 - cur]);
                renderer.render(scene, camera);
                cur = 1 - cur;
                needReset = false;
            }
            renderer.setRenderTarget(prevTarget);
            renderer.autoClear = prevAutoClear;
            lastTime = time;
            shared.uSimTex.value = targets[cur].texture;
        },

        stop() { shared.uSimInfo.value.x = 0; },

        // Для отладки: средняя и максимальная длина отклонения по выборке пикселей (только FloatType).
        stats(samples = 64) {
            if (!targets || support.type !== THREE.FloatType) return null;
            const buf = new Float32Array(4);
            let sum = 0, max = 0, cnt = 0;
            for (let i = 0; i < samples; i++) for (let j = 0; j < samples; j++) {
                const x = Math.floor((i + 0.5) * side / samples), y = Math.floor((j + 0.5) * side / samples);
                DP.stage.renderer.readRenderTargetPixels(targets[cur], x, y, 1, 1, buf);
                const l = Math.hypot(buf[0], buf[1], buf[2]);
                if (l > 0) { sum += l; cnt++; if (l > max) max = l; }
            }
            return { moving: cnt, mean: cnt ? sum / cnt : 0, max };
        }
    };
})(window.DP);
