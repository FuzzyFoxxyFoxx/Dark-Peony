// ==========================================
// DARK PEONY — МОРФИНГ (общий для всех фигур)
// ==========================================
//
// Принцип:
//  1. Каждая фигура сообщает для каждой своей точки «порядок распада» aOrder ∈ [0..1]
//     (0 — отрывается первой: края/кончики; 1 — последней: низ/центр).
//  2. Планировщик (plan) выстраивает пары: k-я по порядку уходящая точка фигуры A
//     становится k-й по порядку прилетающей точкой фигуры B (по умолчанию B собирается
//     изнутри наружу). Разное число точек — не проблема: лишние гаснут/рождаются в вихре.
//  3. Путь точки: отрыв → вихрь вокруг оси Y (в среднем 360°) → посадка.
//     На середине пути (s = 0.5) точка A незаметно «передаёт эстафету» точке B:
//     в этот момент положение и цвет зависят только от общих для пары данных.
//     Поэтому A и B рисуются своими шейдерами и могут выглядеть как угодно.
//
// Для фигуры это означает: в вершинный шейдер точек подключить DP.morph.glsl.pointsVertex,
// вызвать dpMorph(restLocal, animLocal) и dpMorphFinish(), а во фрагментном — dpMorphColor().
// Для поверхностей (MESH) — DP.morph.glsl.meshVertex / meshFragment и dpMeshGlow().
(function (DP) {
    'use strict';

    const U = DP.util;
    const TWO_PI = Math.PI * 2;

    // ------------------------------------------
    // ОБЩИЕ UNIFORM'Ы МОРФИНГА
    // ------------------------------------------
    const shared = {
        uStageMatrix: { value: new THREE.Matrix4() },
        uStageMatrixInv: { value: new THREE.Matrix4() },
        uMeshMode: { value: 0 },
        uMorphSched: { value: new THREE.Vector4() },  // leaveStart, leaveSpread, arriveStart, arriveSpread
        uMorphSched2: { value: new THREE.Vector4() }, // assembleInvert, meshRevealLag, meshFade, -
        uFlowA: { value: new THREE.Vector4() },       // flowAmp, flowFreq, -, flowSpeed
        uFlowB: { value: new THREE.Vector4() },       // -, jitter, precession, shiver
        uClumpA: { value: new THREE.Vector4() },      // strength, freq, filaments, maxDist
        uClumpB: { value: new THREE.Vector4() },      // fraction, speed, spin (рад/с), shear
        uClumpC: { value: new THREE.Vector4() },      // levels, fibers, dustAlpha, ramp
        uSwirlA: { value: new THREE.Vector4() },      // size, sizeMin, alpha, visibleFraction
        uSwirlColor: { value: new THREE.Vector3() }
    };

    function syncConfig() {
        const c = DP.config.morph;
        shared.uMorphSched.value.set(c.leaveStart, c.leaveSpread, c.arriveStart, c.arriveSpread);
        shared.uMorphSched2.value.set(c.assemble === 'outside-in' ? 0 : 1, c.meshRevealLag, c.meshFade, 0);
        shared.uFlowA.value.set(c.flowAmp, c.flowFreq, 0, c.flowSpeed);
        shared.uFlowB.value.set(0, c.jitter, c.precession, c.shiver);
        shared.uClumpA.value.set(c.clumpStrength, c.clumpFreq, c.clumpFilaments, c.clumpMaxDist);
        // Поля вращаются вместе с вихрем: fieldSpin — доля пиковой угловой скорости частиц.
        const meanTravel = 0.5 * (c.minTravel + c.maxTravel);
        const spin = c.fieldSpin * 1.5 * TWO_PI * c.turns / meanTravel;
        shared.uClumpB.value.set(c.clumpFraction, c.clumpSpeed, spin, c.fieldShear);
        shared.uClumpC.value.set(c.clumpLevels, c.clumpFibers, c.dustAlpha, c.clumpRamp);
        shared.uSwirlA.value.set(c.swirlSize, c.swirlSizeMin, c.swirlAlpha, c.swirlVisible);
        shared.uSwirlColor.value.fromArray(c.swirlColor);
    }
    syncConfig();

    // Uniform'ы конкретного экземпляра фигуры + общие. Передавать в каждый материал фигуры.
    function createInstanceUniforms() {
        return {
            uMorphActive: { value: 0 },
            uMorphRole: { value: 0 },   // 0 — уходящая фигура, 1 — прилетающая
            uMorphTime: { value: 0 }
        };
    }

    function uniformsFor(instanceUniforms) {
        return Object.assign({}, shared, instanceUniforms);
    }

    // ------------------------------------------
    // GLSL
    // ------------------------------------------
    const commonPars = `
        uniform float uMorphActive;
        uniform float uMorphRole;
        uniform float uMorphTime;
        uniform float uMeshMode;
        uniform vec4 uMorphSched;
        uniform vec4 uMorphSched2;
    `;

    // 3D simplex noise — Ashima Arts / Stefan Gustavson (MIT), совместим с WebGL1.
    const simplexNoise = `
        vec3 dpMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 dpMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 dpPermute(vec4 x) { return dpMod289(((x * 34.0) + 1.0) * x); }
        vec4 dpTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        float dpSnoise(vec3 v) {
            const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            i = dpMod289(i);
            vec4 p = dpPermute(dpPermute(dpPermute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
                i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
                i.x + vec4(0.0, i1.x, i2.x, 1.0));
            float n_ = 0.142857142857;
            vec3 ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);
            vec4 x = x_ * ns.x + ns.yyyy;
            vec4 y = y_ * ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            vec4 s0 = floor(b0) * 2.0 + 1.0;
            vec4 s1 = floor(b1) * 2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            vec4 norm = dpTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
            p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
        }
        // Та же сетка, но возвращает градиент (xyz) и значение (w) — для стягивания к поверхностям.
        vec4 dpSnoiseGrad(vec3 v) {
            const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            i = dpMod289(i);
            vec4 p = dpPermute(dpPermute(dpPermute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
                i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
                i.x + vec4(0.0, i1.x, i2.x, 1.0));
            float n_ = 0.142857142857;
            vec3 ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);
            vec4 x = x_ * ns.x + ns.yyyy;
            vec4 y = y_ * ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            vec4 s0 = floor(b0) * 2.0 + 1.0;
            vec4 s1 = floor(b1) * 2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            vec4 norm = dpTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
            p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
            vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
            vec4 m2 = m * m;
            vec4 m4 = m2 * m2;
            vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
            vec4 temp = m2 * m * pdotx;
            vec3 grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
            grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
            return vec4(grad * 105.0, 105.0 * dot(m4, pdotx));
        }
        vec3 dpNoise3(vec3 q) {
            return vec3(dpSnoise(q), dpSnoise(q + vec3(31.4, 7.1, 5.3)), dpSnoise(q + vec3(-11.7, 23.9, -3.1)));
        }
    `;

    const pointsVertex = `
        ${commonPars}
        uniform mat4 uStageMatrix;
        uniform mat4 uStageMatrixInv;
        uniform vec4 uFlowA;
        uniform vec4 uFlowB;
        uniform vec4 uClumpA;
        uniform vec4 uClumpB;
        uniform vec4 uClumpC;
        uniform vec4 uSwirlA;
        uniform vec3 uSwirlColor;
        attribute vec4 aMorphOut;
        attribute vec4 aMorphIn;
        varying float vDpW;
        varying float vDpGlow;
        varying float vDpFade;
        varying vec3 vDpSwirlColor;
        varying float vDpSwirlAlpha;
        float dpHidden;
        float dpSizeMul;

        ${simplexNoise}

        float dpHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
        float dpAzimuth(vec3 p) { return (abs(p.x) + abs(p.z) < 1e-5) ? 0.0 : atan(p.x, p.z); }

        // restLocal — точка в покое (без анимации), animLocal — текущая анимированная позиция.
        // Обе в локальных координатах объекта. Возвращает мировую позицию.
        vec4 dpMorph(vec3 restLocal, vec3 animLocal) {
            dpHidden = 0.0; dpSizeMul = 1.0;
            vDpW = 0.0; vDpGlow = 0.0; vDpFade = 1.0;
            vDpSwirlColor = uSwirlColor; vDpSwirlAlpha = 0.0;

            vec4 world = modelMatrix * vec4(animLocal, 1.0);
            if (uMorphActive < 0.5) return world;

            bool outRole = uMorphRole < 0.5;
            vec4 m = outRole ? aMorphOut : aMorphIn;
            float L = floor(m.x / 2048.0) * 0.01;
            float D = max(mod(m.x, 2048.0) * 0.01, 0.05);
            float arrive = L + D;
            float t = uMorphTime;
            float s = clamp((t - L) / D, 0.0, 1.0);

            // Видимость: уходящая точка живёт до середины пути, прилетающая — после.
            if (outRole) {
                if (s >= 0.5) dpHidden = 1.0;
                if (uMeshMode > 0.5 && t < L) dpHidden = 1.0;       // в MESH до отрыва видна поверхность
                vDpGlow = smoothstep(L - 0.9, L, t) * (1.0 - smoothstep(0.0, 0.25, s));
            } else {
                if (s < 0.5) dpHidden = 1.0;
                if (uMeshMode > 0.5) vDpFade = 1.0 - smoothstep(uMorphSched2.y, uMorphSched2.y + uMorphSched2.z, t - arrive);
                vDpGlow = smoothstep(0.8, 1.0, s) * (1.0 - smoothstep(0.0, 0.7, t - arrive));
            }
            if (dpHidden > 0.5) return world;

            float seed = fract(m.z);
            float extra = step(1.5, m.z);  // точка без пары: гаснет / рождается в вихре
            float delta = m.y;             // полный угол поворота пары вокруг оси
            float yMid = floor(m.w / 1024.0) / 256.0 - 2.0;  // высота пары в середине пути
            float rMid = mod(m.w, 1024.0) / 256.0;            // радиус пары в середине пути

            vec3 cur = (uStageMatrixInv * world).xyz;
            vec3 rest = (uStageMatrixInv * modelMatrix * vec4(restLocal, 1.0)).xyz;

            float w = sin(3.14159265 * s); w *= w;       // 0 → 1 (середина) → 0
            float g = s * s * (3.0 - 2.0 * s);            // плавный разгон и торможение по углу

            float thRest = dpAzimuth(rest);
            float dTh = dpAzimuth(cur) - thRest;
            dTh -= 6.2831853 * floor((dTh + 3.14159265) / 6.2831853);
            float thPath = outRole ? thRest + delta * g : thRest - delta * (1.0 - g);
            float th = thPath + dTh * (1.0 - w);

            float r = mix(length(cur.xz), rMid, w);
            float y = mix(cur.y, yMid, w);
            vec3 p = vec3(sin(th) * r, y, cos(th) * r);

            float h1 = dpHash(seed * 91.7);
            float h2 = dpHash(seed * 53.3 + 1.7);
            float h3 = dpHash(seed * 17.9 + 4.1);
            float ph = seed * 6.2831853;

            // Дрожь перед отрывом — «песок» начинает шевелиться.
            float shiver = outRole ? smoothstep(L - 0.9, L, t) * (1.0 - w) : 0.0;
            p += vec3(sin(t * 37.0 + ph * 11.0), sin(t * 41.0 + ph * 7.0), cos(t * 33.0 + ph * 13.0)) * uFlowB.w * shiver;

            float clumped = step(h3, uClumpB.x);  // остальные — свободная пыль вокруг
            if (w > 0.0005) {
                // Поля считаются в РЕАЛЬНОЙ позиции частицы: тогда стянутые частицы действительно
                // лежат на одних и тех же поверхностях в пространстве и жгуты получаются резкими.
                // В середине пути (s = 0.5) позиция зависит только от данных пары — эстафета сохраняется.

                // 0) Поля живут в потоке: считаем их во вращающейся системе координат.
                //    У оси она крутится быстрее, снаружи медленнее — сдвиг наматывает
                //    структуры в спиральные ленты вдоль кольца.
                float phi = t * (uClumpB.z + uClumpB.w * log(1.4 / max(length(p.xz), 0.3)));
                float cphi = cos(phi), sphi = sin(phi);
                vec3 fp = vec3(p.x * cphi - p.z * sphi, p.y, p.z * cphi + p.x * sphi);

                // 1) Поле течения — крупные изгибы вихря.
                vec3 q = fp * uFlowA.y + vec3(0.0, -t * uFlowA.w, t * uFlowA.w * 0.37);
                fp += dpNoise3(q) * uFlowA.x * w;

                // 2) Стягивание (частицы светятся за счёт скучивания в режиме Add):
                //    а) к поверхности первого поля: часть частиц — на нулевую (яркие перепонки),
                //       часть — на ближайший из параллельных уровней (тонкие волокна);
                //    б) вдоль этой поверхности — к линии пересечения со вторым полем (жгуты).
                //    Поля дрейфуют в разные стороны — жгуты ползут, рвутся и пересоединяются.
                float wc = smoothstep(0.0, uClumpC.w, w) * uClumpA.x * clumped;
                vec3 qc = fp * uClumpA.y;
                vec3 o1 = vec3(0.3, -1.0, 0.2) * (t * uClumpB.y);
                vec3 o2 = vec3(19.1, -7.3, 4.7) + vec3(-0.6, 0.5, 0.7) * (t * uClumpB.y);
                float fiber = step(h1, uClumpC.y) * step(0.001, uClumpC.x);
                vec3 d = vec3(0.0);
                // Два шага: один шаг Ньютона сажает частицу на поверхность лишь примерно —
                // второй делает жгуты тонкими и резкими.
                for (int it = 0; it < 2; it++) {
                    vec4 n1 = dpSnoiseGrad(qc + d + o1);
                    float level = fiber * floor(n1.w / max(uClumpC.x, 0.001) + 0.5) * uClumpC.x;
                    float g1 = dot(n1.xyz, n1.xyz) + 1e-3;
                    vec3 d1 = -(n1.w - level) * n1.xyz / g1;
                    vec4 n2 = dpSnoiseGrad(qc + d + d1 + o2);
                    vec3 d2 = -n2.w * n2.xyz / (dot(n2.xyz, n2.xyz) + 1e-3);
                    d2 -= n1.xyz * dot(d2, n1.xyz) / g1;   // двигаться вдоль первой поверхности
                    d += d1 + d2 * uClumpA.z * (1.0 - 0.7 * fiber); // волокна остаются в основном плёнками
                }
                float ld = length(d);
                if (ld > uClumpA.w) d *= uClumpA.w / ld;

                fp += d / uClumpA.y * wc;

                // Обратно из вращающейся системы в систему сцены.
                p = vec3(fp.x * cphi + fp.z * sphi, fp.y, fp.z * cphi - fp.x * sphi);

                vec3 grain = vec3(sin(t * 1.7 + ph * 3.0), sin(t * 1.3 + ph * 5.0), cos(t * 1.9 + ph * 4.0));
                p += grain * uFlowB.y * w;
                p.xz += vec2(sin(t * 0.63), cos(t * 0.47)) * uFlowB.z * w;
            }

            // Вид в полёте: большинство частиц мельче и тусклее, часть — яркие искры.
            float spark = h2 * h2 * h2;
            float visible = step(h3, uSwirlA.w);
            vDpW = w;
            vDpSwirlColor = mix(uSwirlColor * (0.7 + 0.5 * h1), vec3(0.9, 0.97, 1.0), spark * 0.7);
            vDpSwirlAlpha = uSwirlA.z * (0.6 + 1.8 * spark) * mix(0.25, 1.0, visible) * mix(uClumpC.z, 1.0, clumped);
            dpSizeMul = mix(1.0, uSwirlA.x * mix(uSwirlA.y, 1.0, h1 * h1), w);
            if (extra > 0.5) vDpFade *= outRole ? 1.0 - smoothstep(0.3, 0.5, s) : smoothstep(0.5, 0.7, s);

            return uStageMatrix * vec4(p, 1.0);
        }

        // Вызывать в самом конце main(), после записи gl_Position и gl_PointSize.
        void dpMorphFinish() {
            gl_PointSize *= dpSizeMul;
            if (dpHidden > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
        }
    `;

    const pointsFragment = `
        varying float vDpW;
        varying float vDpGlow;
        varying float vDpFade;
        varying vec3 vDpSwirlColor;
        varying float vDpSwirlAlpha;

        // color/alpha — «родной» цвет точки фигуры, texA — альфа текстуры частицы.
        vec4 dpMorphColor(vec3 color, float alpha, float texA) {
            vec3 c = mix(color, vDpSwirlColor, vDpW);
            float a = mix(alpha, texA * vDpSwirlAlpha, vDpW);
            c = mix(c, vec3(0.85, 0.95, 1.0), vDpGlow * 0.6);
            a *= (1.0 + vDpGlow * 1.8) * vDpFade;
            return vec4(c, a);
        }
    `;

    const meshVertex = `
        attribute float aOrder;
        varying float vDpOrder;
    `;

    const meshFragment = `
        ${commonPars}
        varying float vDpOrder;
        // Прогорание поверхности по фронту. Возвращает силу свечения кромки; невидимое — discard.
        float dpMeshGlow() {
            if (uMorphActive < 0.5) return 0.0;
            if (uMorphRole < 0.5) {
                float d = uMorphSched.x + uMorphSched.y * vDpOrder - uMorphTime;
                if (d < 0.0) discard;
                return 1.0 - smoothstep(0.0, 0.6, d);
            }
            float key = mix(vDpOrder, 1.0 - vDpOrder, uMorphSched2.x);
            float d = uMorphTime - (uMorphSched.z + uMorphSched.w * key + uMorphSched2.y);
            if (d < 0.0) discard;
            return 1.0 - smoothstep(0.0, 0.8, d);
        }
    `;

    // ------------------------------------------
    // LAYOUT: сведения о точках фигуры для планировщика
    // ------------------------------------------
    // parts: [{ geometry, rest: Float32Array (xyz в пространстве сцены, по одной на вершину) }]
    // У geometry должен быть атрибут aOrder. aMorphOut / aMorphIn создаются здесь.
    function createLayout(parts) {
        let total = 0;
        const out = parts.map(p => {
            const geo = p.geometry;
            const count = geo.attributes.position.count;
            if (!geo.attributes.aOrder) throw new Error('DP.morph: у геометрии нет атрибута aOrder');
            if (!geo.attributes.aMorphOut) {
                geo.setAttribute('aMorphOut', new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
                geo.setAttribute('aMorphIn', new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
            }
            const part = {
                start: total, count,
                rest: p.rest,
                order: geo.attributes.aOrder.array,
                outAttr: geo.attributes.aMorphOut,
                inAttr: geo.attributes.aMorphIn
            };
            total += count;
            return part;
        });

        const partOf = new Uint16Array(total);
        out.forEach((p, i) => partOf.fill(i, p.start, p.start + p.count));

        // Сортировка по порядку распада: ключ и индекс упакованы в одно число float64
        // (нативная сортировка Float64Array в разы быстрее сортировки с компаратором).
        const IDX = 4194304; // 2^22 — до ~4 млн точек на фигуру
        const keys = new Float64Array(total);
        out.forEach(p => {
            for (let i = 0; i < p.count; i++) {
                keys[p.start + i] = Math.floor(U.clamp(p.order[i], 0, 1) * 1048575) * IDX + (p.start + i);
            }
        });
        keys.sort();
        const sorted = new Uint32Array(total);
        for (let k = 0; k < total; k++) sorted[k] = keys[k] % IDX;

        return { parts: out, partOf, total, sorted };
    }

    // Случайная точка сечения кольца (равномерно по площади). Сечение — «крыло»:
    // толщина u^a (1-u)^b, максимум в ringPeak, в степени ringSharp — острые концы.
    function sampleRing(c, k) {
        const a = 2 * c.ringPeak, b = 2 * (1 - c.ringPeak);
        const fmax = Math.pow(c.ringPeak, a) * Math.pow(1 - c.ringPeak, b);
        let u = 0.5, v = 0;
        for (let i = 0; i < 24; i++) {
            u = U.seededRandom(k * 2.113 + 9.7 + i * 13.1);
            v = U.seededRandom(k * 0.917 + 2.9 + i * 7.3) * 2 - 1;
            const f = Math.pow(Math.pow(u, a) * Math.pow(1 - u, b) / fmax, c.ringSharp);
            if (Math.abs(v) <= f) break;
            v = 0;
        }
        return {
            r: c.ringInner + (c.ringOuter - c.ringInner) * u,
            y: c.ringY + v * c.ringThickness
        };
    }

    // ------------------------------------------
    // ПЛАНИРОВЩИК
    // ------------------------------------------
    // Записывает расписание в aMorphOut фигуры A и aMorphIn фигуры B.
    // Возвращает длительность морфинга (сек).
    function plan(A, B) {
        const c = DP.config.morph;
        syncConfig();
        const NA = A.total, NB = B.total, N = Math.max(NA, NB);
        const insideOut = c.assemble !== 'outside-in';
        const usedA = new Uint8Array(NA), usedB = new Uint8Array(NB);
        let end = 0;

        for (let k = 0; k < N; k++) {
            const ia = A.sorted[Math.floor(k * NA / N)];
            const kb = Math.floor(k * NB / N);
            const ib = B.sorted[insideOut ? NB - 1 - kb : kb];
            const firstA = !usedA[ia], firstB = !usedB[ib];
            if (!firstA && !firstB) continue;
            usedA[ia] = 1; usedB[ib] = 1;

            const pa = A.parts[A.partOf[ia]], la = ia - pa.start;
            const pb = B.parts[B.partOf[ib]], lb = ib - pb.start;
            const ax = pa.rest[la * 3], ay = pa.rest[la * 3 + 1], az = pa.rest[la * 3 + 2];
            const bx = pb.rest[lb * 3], by = pb.rest[lb * 3 + 1], bz = pb.rest[lb * 3 + 2];

            const seed = U.seededRandom(k * 0.618 + 0.37);
            const rnd = U.seededRandom(k * 1.319 + 5.1);

            const orderA = U.clamp(pa.order[la], 0, 1);
            const orderB = U.clamp(pb.order[lb], 0, 1);
            const keyB = insideOut ? 1 - orderB : orderB;
            const L = c.leaveStart + c.leaveSpread * orderA;
            const target = c.arriveStart + c.arriveSpread * keyB + (rnd - 0.5) * c.travelJitter;
            const D = U.clamp(target - L, c.minTravel, c.maxTravel);

            // Время упаковано в одно число: шаг 10 мс, до 20.47 с на каждое поле.
            const Lq = U.clamp(Math.round(L * 100), 0, 2047);
            const Dq = U.clamp(Math.round(D * 100), 5, 2047);
            const packed = Lq * 2048 + Dq;
            end = Math.max(end, (Lq + Dq) * 0.01);

            const delta = TWO_PI * c.turns + U.wrapPi(U.azimuth(bx, bz) - U.azimuth(ax, az));

            // Середина пути: не общий «бублик», а объём — смесь положений пары и случайной точки облака.
            const ring = sampleRing(c, k);
            const rPair = 0.5 * (Math.hypot(ax, az) + Math.hypot(bx, bz));
            const rMid = U.clamp(rPair + (ring.r - rPair) * c.cloudMix, 0, 3.99);
            const yCloud = ring.y;
            const yMid = U.clamp(0.5 * (ay + by) + (yCloud - 0.5 * (ay + by)) * c.cloudMix + c.lift * seed, -2, 5.99);
            // Высота и радиус упакованы в одно число: шаг 1/256.
            const midPacked = Math.round((yMid + 2) * 256) * 1024 + Math.round(rMid * 256);

            if (firstA) {
                const o = pa.outAttr.array, j = la * 4;
                o[j] = packed; o[j + 1] = delta; o[j + 2] = seed + (firstB ? 0 : 2); o[j + 3] = midPacked;
            }
            if (firstB) {
                const o = pb.inAttr.array, j = lb * 4;
                o[j] = packed; o[j + 1] = delta; o[j + 2] = seed + (firstA ? 0 : 2); o[j + 3] = midPacked;
            }
        }

        A.parts.forEach(p => { p.outAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; });

        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    DP.morph = {
        shared,
        syncConfig,
        createInstanceUniforms,
        uniformsFor,
        createLayout,
        plan,
        glsl: { pointsVertex, pointsFragment, meshVertex, meshFragment }
    };
})(window.DP);
