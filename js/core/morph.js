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
        uWarp: { value: new THREE.Vector4() },        // доля времени на уход, доля на уход+вихрь, доля пути ухода/посадки, -
        uFlowA: { value: new THREE.Vector4() },       // flowAmp, flowFreq, -, flowSpeed
        uFlowB: { value: new THREE.Vector4() },       // -, fieldDelay, poseBlend, precession
        uWave: { value: new THREE.Vector4() },        // waveAmp, waveCount, waveSpeed, waveRadial
        uFlowC: { value: new THREE.Vector4() },       // -, -, скорость вращения поля (рад/с), -
        uSimTex: { value: null },                     // отклонения частиц от траектории (flowsim.js)
        uSimInfo: { value: new THREE.Vector4() },     // включено (0/1), сторона текстуры, -, -
        uSimJit: { value: null },                     // свои сдвиги отрыва/посадки пар (flowsim.js)
        uSimJitInfo: { value: new THREE.Vector4() },  // сплочённость в вихре (simCohesion)
        uClumpA: { value: new THREE.Vector4() },      // strength, freq, filaments, maxDist
        uClumpB: { value: new THREE.Vector4() },      // fraction, speed, spin (рад/с), shear
        uClumpC: { value: new THREE.Vector4() },      // levels, fibers, dustAlpha, ramp
        uTrail: { value: new THREE.Vector4() },       // lag (с), длина хвоста - 1, затухание, ширина разгона w
        uSwirlA: { value: new THREE.Vector4() },      // size, sizeMin, alpha, visibleFraction
        uSwirlB: { value: new THREE.Vector4() },      // leaveGlow, swirlBlend, swirlTint, swirlLook
        uTwist: { value: new THREE.Vector4() },       // перекрутов за оборот, скорость проворота, центр сечения r, y
        uTwist2: { value: new THREE.Vector4() },      // сжатие по высоте, режим нитей (0/1), -, -
        uSwirlColor: { value: new THREE.Vector3() },
        // Режим «фонтан» (planFountain): включён, центр петли по радиусу, полуширина петли, центр по высоте;
        // полувысота петли, «квадратность», ускорение осыпания, вход в столб; вложенные петли (3 шт.) и их разброс.
        uFountA: { value: new THREE.Vector4() },
        uFountB: { value: new THREE.Vector4() },
        uFountC: { value: new THREE.Vector4() },
        // Режим «дым» (js/core/smokesim.js): положение каждой пары считает симуляция на видеокарте.
        uSmokeTex: { value: null },
        uSmokeA: { value: new THREE.Vector4() },      // включён, сторона текстуры, жизнь от, жизнь до
        uSmokeB: { value: new THREE.Vector4() },      // появление (доля), угасание (доля), рост к концу, захват кольцом (с)
        uSmokeC: { value: new THREE.Vector4() },      // посадка (с), -, -, -
        // Самозатенение дыма (js/core/smokesim.js): плотность дыма «со стороны света» по 4 слоям глубины.
        uShadowTex: { value: null },
        uShadowLight: { value: new THREE.Matrix4() },
        uShadowInfo: { value: new THREE.Vector4() }  // включено, сила, -, -
    };

    // Путь частицы (в «исходном» времени) делится на уход [0, a], вихрь [a, 1-a] и посадку [1-a, 1],
    // где a — участок до выхода на плато вихря. Каждый участок проходится со своей скоростью.
    // K — во сколько раз сокращается полёт; uIn, uMid — доли реального времени на уход и на вихрь.
    function warpOf(c) {
        const a = Math.min(0.45, Math.max(0.05, 0.5 - c.swirlHold));
        const tIn = a / c.speedIn, tMid = (1 - 2 * a) / c.speedMid, tOut = a / c.speedOut;
        const K = tIn + tMid + tOut;
        return { a, K, uIn: tIn / K, uMid: tMid / K };
    }

    function syncConfig() {
        const c = DP.config.morph;
        // Разные скорости участков пути: уход (speedIn), вихрь (speedMid), посадка (speedOut).
        const w = warpOf(c);
        shared.uWarp.value.set(w.uIn, w.uIn + w.uMid, w.a, 0);
        // Поверхности (MESH) прогорают и проявляются по тем же ускоренным срокам, что и частицы.
        shared.uMorphSched.value.set(c.leaveStart, c.leaveSpread / c.speedIn,
            c.leaveStart + w.K * (c.arriveStart - c.leaveStart),
            c.leaveSpread / c.speedIn + w.K * (c.arriveSpread - c.leaveSpread));
        shared.uMorphSched2.value.set(c.assemble === 'outside-in' ? 0 : 1, c.meshRevealLag, c.meshFade, 0);
        shared.uFlowA.value.set(c.flowAmp, c.flowFreq, 0, c.flowSpeed);
        shared.uFlowB.value.set(0, c.fieldDelay, c.poseBlend, c.precession);
        shared.uWave.value.set(c.waveAmp, c.waveCount, c.waveSpeed, c.waveRadial);
        const rc = c.ringInner + (c.ringOuter - c.ringInner) * c.ringPeak;
        shared.uTwist.value.set(c.twistPerTurn, c.twistSpeed, rc, c.ringY);
        shared.uTwist2.value.set(c.twistSquash, c.threadCell > 0 ? 1 : 0, 0, 0);
        shared.uSwirlB.value.set(c.leaveGlow, c.swirlBlend, c.swirlTint, c.swirlLook);
        shared.uClumpA.value.set(c.clumpStrength, c.clumpFreq, c.clumpFilaments, c.clumpMaxDist);
        // Поля вращаются вместе с вихрем: fieldSpin — доля пиковой угловой скорости частиц.
        const meanTravel = 0.5 * (c.minTravel + c.maxTravel);
        // fieldSpin = 1 — поле вращается со средней скоростью вихря (с учётом ускорения участков):
        // водовороты несутся вместе со средой, частица долго живёт в одном водовороте.
        const spin = c.fieldSpin * TWO_PI * c.turns / (meanTravel * warpOf(c).K);
        shared.uClumpB.value.set(c.clumpFraction, c.clumpSpeed, spin, c.fieldShear);
        shared.uFlowC.value.set(0, 0, spin, 0);
        shared.uSimJitInfo.value.set(c.simCohesion, 0, 0, 0);
        shared.uClumpC.value.set(c.clumpLevels, c.clumpFibers, c.dustAlpha, c.clumpRamp);
        shared.uTrail.value.set(c.trailLag, Math.max(1, Math.round(c.trailLength) - 1), c.trailFade, Math.max(0.05, 0.5 - c.swirlHold));
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


    // Общие для вершинного шейдера частиц и симуляции среды (js/core/flowsim.js):
    // ускорение участков пути и поле водоворотов.
    const flowGlsl = `
        uniform vec4 uWarp;
        uniform vec4 uFlowA;
        uniform vec4 uFlowC;
        uniform vec4 uSimJitInfo;   // сплочённость в вихре, -, -, -
        // Реальная доля времени полёта u → доля пути s. Три участка с разной скоростью,
        // сшитые кубическими кривыми Эрмита (скорость меняется плавно, без рывков на стыках).
        float dpHermite(float x, float x0, float x1, float y0, float y1, float m0, float m1) {
            float h = max(x1 - x0, 1e-4);
            float k = clamp((x - x0) / h, 0.0, 1.0);
            float k2 = k * k, k3 = k2 * k;
            return (2.0 * k3 - 3.0 * k2 + 1.0) * y0 + (k3 - 2.0 * k2 + k) * h * m0
                 + (-2.0 * k3 + 3.0 * k2) * y1 + (k3 - k2) * h * m1;
        }
        float dpWarp(float u) {
            float u1 = uWarp.x, u2 = uWarp.y, a = uWarp.z;
            float v0 = a / max(u1, 1e-4), v1 = (1.0 - 2.0 * a) / max(u2 - u1, 1e-4), v2 = a / max(1.0 - u2, 1e-4);
            float m1 = 0.5 * (v0 + v1), m2 = 0.5 * (v1 + v2);
            if (u < u1) return dpHermite(u, 0.0, u1, 0.0, a, v0, m1);
            if (u < u2) return dpHermite(u, u1, u2, a, 1.0 - a, m1, m2);
            return dpHermite(u, u2, 1.0, 1.0 - a, 1.0, m2, v2);
        }

        // Доля пути с учётом «сплочённости»: у концов пути частица идёт по своему расписанию
        // (распад и сборка по частицам), в вихре — догоняет общий поток соседей (jL, jA — её сдвиги).
        float dpPathS(float t, float L, float D, float jL, float jA, float cohesion) {
            float sOwn = dpWarp(clamp((t - L) / D, 0.0, 1.0));
            float Lc = L - jL;
            float Dc = max(0.05, D + jL - jA);
            float sCom = dpWarp(clamp((t - Lc) / Dc, 0.0, 1.0));
            float gOwn = sOwn * sOwn * (3.0 - 2.0 * sOwn);
            float c = cohesion * smoothstep(0.0, 1.0, 2.0 * min(gOwn, 1.0 - gOwn));
            return mix(sOwn, sCom, c);
        }

        // Скорость среды в точке x в момент tau: поле водоворотов (∇n1 × ∇n2 — без «ям и бугров»,
        // только завихрения). Поле вращается вместе с вихрем медленнее частиц и меняется во времени.
        vec3 dpFlowVel(vec3 x, float tau) {
            float phi = tau * uFlowC.z;
            float c = cos(phi), s = sin(phi);
            vec3 f = vec3(x.x * c - x.z * s, x.y, x.z * c + x.x * s);
            vec3 q = f * uFlowA.y + vec3(0.0, -tau * uFlowA.w, 0.0);
            vec3 g1 = dpSnoiseGrad(q).xyz;
            vec3 g2 = dpSnoiseGrad(q + vec3(31.4, 7.1 + tau * uFlowA.w * 0.5, 5.3)).xyz;
            vec3 v = cross(g1, g2);
            return vec3(v.x * c + v.z * s, v.y, v.z * c - v.x * s);
        }
        float dpAzimuth(vec3 p) { return (abs(p.x) + abs(p.z) < 1e-5) ? 0.0 : atan(p.x, p.z); }

    `;

    const pointsVertex = `
        ${commonPars}
        uniform mat4 uStageMatrix;
        uniform mat4 uStageMatrixInv;
        uniform vec4 uWave;
        uniform sampler2D uSimTex;
        uniform sampler2D uSimJit;
        uniform vec4 uSimInfo;
        attribute float aPairOut;
        attribute float aPairIn;
        uniform vec4 uFlowB;
        uniform vec4 uClumpA;
        uniform vec4 uClumpB;
        uniform vec4 uClumpC;
        uniform vec4 uTrail;
        uniform vec4 uSwirlA;
        uniform vec3 uSwirlColor;
        attribute vec4 aMorphOut;
        attribute vec4 aMorphIn;
        uniform vec4 uSwirlB;
        uniform vec4 uTwist;
        uniform vec4 uTwist2;
        uniform vec4 uFountA;
        uniform vec4 uFountB;
        uniform vec4 uFountC;
        uniform sampler2D uSmokeTex;
        uniform vec4 uSmokeA;
        uniform vec4 uSmokeB;
        uniform vec4 uSmokeC;
        uniform sampler2D uShadowTex;
        uniform mat4 uShadowLight;
        uniform vec4 uShadowInfo;
        varying float vDpW;
        varying float vDpWA;
        varying float vDpGlow;
        varying float vDpFade;
        varying vec3 vDpSwirlColor;
        varying float vDpSwirlAlpha;
        float dpHidden;
        float dpSizeMul;

        ${simplexNoise}
        ${flowGlsl}

        float dpHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }

        // restLocal — точка в покое (без анимации), animLocal — текущая анимированная позиция.
        // Обе в локальных координатах объекта. Возвращает мировую позицию.
        vec4 dpMorph(vec3 restLocal, vec3 animLocal) {
            dpHidden = 0.0; dpSizeMul = 1.0;
            vDpW = 0.0; vDpWA = 0.0; vDpGlow = 0.0; vDpFade = 1.0;
            vDpSwirlColor = uSwirlColor; vDpSwirlAlpha = 0.0;

            vec4 world = modelMatrix * vec4(animLocal, 1.0);
            if (uMorphActive < 0.5) return world;

            bool outRole = uMorphRole < 0.5;
            vec4 m = outRole ? aMorphOut : aMorphIn;
            float L = floor(m.x / 2048.0) * 0.01;
            float D = max(mod(m.x, 2048.0) * 0.01, 0.05);
            float arrive = L + D;
            float t = uMorphTime;
            float s = dpWarp(clamp((t - L) / D, 0.0, 1.0));
            vec2 dpSimUV = vec2(0.0);
            if (uSimInfo.x > 0.5) {
                float kk = outRole ? aPairOut : aPairIn;
                dpSimUV = (vec2(mod(kk, uSimInfo.y), floor(kk / uSimInfo.y)) + 0.5) / uSimInfo.y;
                vec4 jit = texture2D(uSimJit, dpSimUV);
                s = dpPathS(t, L, D, jit.x, jit.y, uSimJitInfo.x);
            }
            if (uFountA.x > 0.5 || uSmokeA.x > 0.5) s = clamp((t - L) / D, 0.0, 1.0);   // фонтан и дым: без ускорений участков вихря

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
            float extra = step(1.5, mod(m.z, 4.0));  // точка без пары: гаснет / рождается в вихре
            float rank = floor(m.z / 4.0);            // номер в хвосте (0 — лидер)
            float te = t - rank * uTrail.x;            // «время лидера»: поля видны с задержкой
            float delta = m.y;             // полный угол поворота пары вокруг оси
            float yMid = floor(m.w / 1024.0) / 256.0 - 2.0;  // высота пары в середине пути
            float rMid = mod(m.w, 1024.0) / 256.0;            // радиус пары в середине пути

            vec3 cur = (uStageMatrixInv * world).xyz;
            vec3 rest = (uStageMatrixInv * modelMatrix * vec4(restLocal, 1.0)).xyz;

            float h1 = dpHash(seed * 91.7);
            float h2 = dpHash(seed * 53.3 + 1.7);
            float h3 = dpHash(seed * 17.9 + 4.1);

            float clumped = step(h3, uClumpB.x);  // остальные — свободная пыль вокруг

            float w; vec3 p;
            float smokeSize = 1.0;
            if (uSmokeA.x > 0.5) {
                // ДЫМ: положение пары считает симуляция (js/core/smokesim.js) — обе фигуры читают один пиксель,
                // поэтому эстафета A → B не рвётся. Здесь — только переход с позы фигуры на симуляцию и обратно
                // и «жизнь» частицы в кольце (появление, угасание, рост, как в Particular).
                float kk = outRole ? aPairOut : aPairIn;
                vec2 suv = (vec2(mod(kk, uSmokeA.y), floor(kk / uSmokeA.y)) + 0.5) / uSmokeA.y;
                vec4 st = texture2D(uSmokeTex, suv);
                float T = L + D;
                float wA = smoothstep(0.0, 0.3, t - L);
                float wB = smoothstep(0.0, 0.35, T - t);
                p = mix(cur, st.xyz, outRole ? wA : wB);
                w = smoothstep(0.0, 0.5, t - L) * smoothstep(0.0, 0.5, T - t);
                float ringW = smoothstep(uSmokeB.w, uSmokeB.w + 0.3, t - L) * smoothstep(uSmokeC.x, uSmokeC.x + 0.3, T - t);
                float life = mix(uSmokeA.z, uSmokeA.w, dpHash(seed * 13.7 + 2.9));
                float k = clamp(st.w / life, 0.0, 1.0);
                float fl = st.w < 0.0 ? 1.0 : smoothstep(0.0, uSmokeB.x, k) * (1.0 - smoothstep(1.0 - uSmokeB.y, 1.0, k));
                vDpFade *= mix(1.0, fl, ringW);
                smokeSize = mix(1.0, uSmokeB.z, k * k * ringW);
                // Самозатенение: сколько дыма между частицей и светом (слои ближе к свету — целиком,
                // свой слой — наполовину). Частица в глубине темнее, освещённые кромки — яркие.
                if (uShadowInfo.x > 0.5) {
                    vec4 lc = uShadowLight * (uStageMatrix * vec4(p, 1.0));
                    vec4 S = texture2D(uShadowTex, lc.xy * 0.5 + 0.5);
                    float dz = clamp(lc.z * 0.5 + 0.5, 0.0, 0.9999) * 4.0;
                    float occ = S.x * step(1.0, dz) + S.y * step(2.0, dz) + S.z * step(3.0, dz)
                              + dot(S, vec4(equal(vec4(floor(dz)), vec4(0.0, 1.0, 2.0, 3.0)))) * fract(dz) * 0.5;
                    // Освещённые кромки ярче прежнего, глубина темнеет до 30% (не в черноту).
                    vDpFade *= mix(1.0, 0.3 + 1.1 * exp(-uShadowInfo.y * occ), w);
                }
            } else if (uFountA.x > 0.5) {
                // ФОНТАН: частица осыпается вниз по центральному столбу, у дна уходит наружу, поднимается
                // по стенке сферы, переходит через верх и падает сверху на своё место (петли, как силовые
                // линии магнита). Всё — в вертикальной плоскости частицы; по пути частицы сходятся в струи.
                // В точке эстафеты (s = 0.5) положение зависит только от общих данных пары.
                float hA = floor(m.w / 4096.0) / 4095.0;       // высота на уходящей фигуре (1 — верх)
                float hB = mod(m.w, 4096.0) / 4095.0;          // высота на прилетающей фигуре
                float aIn = 1.5707963 + (1.0 - hA) * 3.14159265 * uFountB.w;
                float aOut = 7.8539816 + (1.0 - hB) * 3.14159265 * uFountB.w;
                float e = s * s * (3.0 - 2.0 * s);
                float al = mix(aIn, aOut, e);
                float hs = dpHash(seed * 29.3 + 7.7);
                float kap = hs < 0.333 ? uFountC.x : (hs < 0.667 ? uFountC.y : uFountC.z);
                kap += (dpHash(seed * 61.1 + 2.3) - 0.5) * 2.0 * uFountC.w;
                float ex = 2.0 / uFountB.y;
                float ca = cos(al), sa = sin(al);
                float rho = uFountA.y + kap * uFountA.z * sign(ca) * pow(abs(ca), ex);
                float z = uFountA.w + kap * uFountB.x * sign(sa) * pow(abs(sa), ex);
                // Азимут: из своей плоскости частица сходится в струю, пока падает, и расходится при посадке.
                float phJ = m.y;
                float dph = dpAzimuth(cur) - phJ;
                dph -= 6.2831853 * floor((dph + 3.14159265) / 6.2831853);
                float kPh = outRole ? 1.0 - smoothstep(0.0, 0.35, s) : smoothstep(0.65, 1.0, s);
                float ph = phJ + dph * kPh;
                vec3 lp = vec3(sin(ph) * rho, z, cos(ph) * rho);
                // Поза на фигуре: до выхода на петлю частица осыпается с ускорением, при посадке — падает сверху.
                float tau = outRole ? s * D : (1.0 - s) * D;
                vec3 pose = cur;
                pose.y += (outRole ? -0.5 : 0.5) * uFountB.z * tau * tau;
                float wp = outRole ? smoothstep(0.05, 0.4, s) : 1.0 - smoothstep(0.6, 0.95, s);
                p = mix(pose, lp, wp);
                w = smoothstep(0.0, 0.25, s) * smoothstep(0.0, 0.25, 1.0 - s);
            } else {

                // 0 → 1 (плато в середине пути) → 0. На плато частица целиком в вихре — братья
                // по хвосту идут точно по траектории лидера, и хвост получается линией.
                w = smoothstep(0.0, uTrail.w, s) * smoothstep(0.0, uTrail.w, 1.0 - s);
                float g = s * s * (3.0 - 2.0 * s);            // плавный разгон и торможение по углу

                // Прогресс поворота от ближайшего конца пути: 0 — на месте, 1 — в середине вихря.
                // Сначала частица плавно уходит по кругу, и лишь по мере поворота среда «сопротивляется»:
                // поле нарастает с задержкой (fieldDelay) и так же раньше гаснет перед посадкой.
                float gp = 2.0 * min(g, 1.0 - g);
                float wf = smoothstep(uFlowB.y, 1.0, gp);         // сила поля
                float wp = smoothstep(0.0, uFlowB.z, gp);         // переход с видимой позы на траекторию

                // Фигура может изгибать точки своим шейдером (щупальца, лепестки), и видимое положение
                // отличается от сырой геометрии, по которой планировщик посчитал середину пути.
                // Переносим эту разницу на середину пути — иначе частица летит к «неизогнутому» месту
                // (щупальца ныряют в центр, цветок схлопывается). Для одной и той же фигуры A и B
                // одинаковы, эстафета не рвётся.
                // В середине вихря сдвиг убирается: у разных фигур он разный, а в точке эстафеты (s = 0.5)
                // положение должно зависеть только от общих данных пары.
                float dpKeep = 1.0 - smoothstep(0.5, 0.95, 2.0 * min(g, 1.0 - g));
                rMid = max(rMid + (length(cur.xz) - length(rest.xz)) * dpKeep, 0.0);
                yMid += (cur.y - rest.y) * dpKeep;
                float thRest = dpAzimuth(rest);
                float dTh = dpAzimuth(cur) - thRest;
                dTh -= 6.2831853 * floor((dTh + 3.14159265) / 6.2831853);
                float thPath = outRole ? thRest + delta * g : thRest - delta * (1.0 - g);
                float th = thPath + dTh * (1.0 - wp);

                // Перекрут ленты: сечение кольца поворачивается вокруг своей средней линии по ходу
                // вращения (uTwist.x раз за оборот) и медленно проворачивается во времени — плоская
                // лента складывается в жгут, частицы внутри идут по спиралям, а не по ровным кругам.
                if (uTwist.x != 0.0 || uTwist.y != 0.0) {
                    float ang = uTwist.x * thPath + uTwist.y * (t - rank * uTrail.x);
                    vec2 off = vec2(rMid - uTwist.z, yMid - uTwist.w);
                    float ca = cos(ang), sa = sin(ang);
                    off = vec2(off.x * ca - off.y * sa, (off.x * sa + off.y * ca) * uTwist2.x);
                    rMid = max(uTwist.z + off.x, 0.15);
                    yMid = uTwist.w + off.y;
                }
                float r = mix(length(cur.xz), rMid, wp);
                float y = mix(cur.y, yMid, wp);
                p = vec3(sin(th) * r, y, cos(th) * r);

                if (w > 0.0005) {
                    // 1) Среда: отклонение от траектории считает симуляция на видеокарте (js/core/flowsim.js).
                    //    Каждая пара частиц — пиксель текстуры; A и B читают один пиксель, эстафета не рвётся.
                    if (uSimInfo.x > 0.5) p += texture2D(uSimTex, dpSimUV).xyz * smoothstep(0.0, 0.1, gp);
                    p.xz += vec2(sin(te * 0.63), cos(te * 0.47)) * uFlowB.w * wf;

                    // 2) Морская волна по вертикали: радиус не меняется, частица поднимается и опускается.
                    //    Фаза зависит от места (угол на пути, радиус) и времени, а не от частицы —
                    //    соседи качаются вместе, по вихрю бегут пологие волны, а не хаос.
                    float wph = uWave.y * thPath + uWave.w * rMid - uWave.z * te;
                    p.y += (sin(wph) + 0.35 * sin(1.7 * wph + 2.1 * rMid + 0.6 * te)) * uWave.x * wf;

                    // 2) Стягивание в жгуты (сейчас выключено: clumpStrength = 0 — давало хаос).
                    if (uClumpA.x > 0.0) {
                        float spinK = uClumpB.z + uClumpB.w * log(1.4 / max(length(p.xz), 0.3));
                        float phi = t * spinK;
                        float cphi = cos(phi), sphi = sin(phi);
                        vec3 fp = vec3(p.x * cphi - p.z * sphi, p.y, p.z * cphi + p.x * sphi);
                        float wc = smoothstep(0.0, uClumpC.w, w) * uClumpA.x * clumped;
                        vec3 qc = fp * uClumpA.y;
                        vec3 o1 = vec3(0.3, -1.0, 0.2) * (t * uClumpB.y);
                        vec3 o2 = vec3(19.1, -7.3, 4.7) + vec3(-0.6, 0.5, 0.7) * (t * uClumpB.y);
                        vec3 d = vec3(0.0);
                        for (int it = 0; it < 2; it++) {
                            vec4 n1 = dpSnoiseGrad(qc + d + o1);
                            float g1 = dot(n1.xyz, n1.xyz) + 1e-3;
                            vec3 d1 = -n1.w * n1.xyz / g1;
                            vec4 n2 = dpSnoiseGrad(qc + d + d1 + o2);
                            vec3 d2 = -n2.w * n2.xyz / (dot(n2.xyz, n2.xyz) + 1e-3);
                            d2 -= n1.xyz * dot(d2, n1.xyz) / g1;   // двигаться вдоль первой поверхности
                            d += d1 + d2 * uClumpA.z;
                        }
                        float ld = length(d);
                        if (ld > uClumpA.w) d *= uClumpA.w / ld;
                        fp += d / uClumpA.y * wc;
                        p = vec3(fp.x * cphi + fp.z * sphi, fp.y, fp.z * cphi - fp.x * sphi);
                    }
                }
            }

            // Вид в полёте: большинство частиц мельче и тусклее, часть — яркие искры.
            float spark = h2 * h2 * h2;
            float visible = step(h3, uSwirlA.w);
            vDpW = w;
            // Яркость и цвет вихря частица набирает только глубоко в вихре: пока лепесток
            // срывается, частица остаётся такой же, какой была на цветке (без «проявления сверху»).
            vDpWA = pow(w, uSwirlB.y) * uSwirlB.w;   // swirlLook: насколько частица в полёте меняет свой вид
            vDpSwirlColor = mix(uSwirlColor * (0.7 + 0.5 * h1), vec3(0.9, 0.97, 1.0), spark * 0.7);
            vDpSwirlAlpha = uSwirlA.z * (0.6 + 1.8 * spark) * mix(0.25, 1.0, visible) * mix(uClumpC.z, 1.0, clumped)
                * (1.0 - uTrail.z * rank / max(uTrail.y, 1.0));   // хвост к концу тускнеет
            dpSizeMul = mix(1.0, uSwirlA.x * mix(uSwirlA.y, 1.0, h1 * h1), w) * smokeSize;
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
        uniform vec4 uSwirlB;
        varying float vDpW;
        varying float vDpWA;
        varying float vDpGlow;
        varying float vDpFade;
        varying vec3 vDpSwirlColor;
        varying float vDpSwirlAlpha;

        // color/alpha — «родной» цвет точки фигуры, texA — альфа текстуры частицы.
        vec4 dpMorphColor(vec3 color, float alpha, float texA) {
            vec3 c = mix(color, vDpSwirlColor, vDpWA * uSwirlB.z + vDpWA * vDpWA * (1.0 - uSwirlB.z));
            float a = mix(alpha, texA * vDpSwirlAlpha, vDpWA);
            c = mix(c, vec3(0.85, 0.95, 1.0), vDpGlow * 0.6 * uSwirlB.x);
            a *= (1.0 + vDpGlow * 1.8 * uSwirlB.x) * vDpFade;
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
                geo.setAttribute('aPairOut', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
                geo.setAttribute('aPairIn', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
            }
            const part = {
                start: total, count,
                rest: p.rest,
                order: geo.attributes.aOrder.array,
                outAttr: geo.attributes.aMorphOut,
                inAttr: geo.attributes.aMorphIn,
                pairOutAttr: geo.attributes.aPairOut,
                pairInAttr: geo.attributes.aPairIn
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
    function ringProfile(c, u) {
        const a = 2 * c.ringPeak, b = 2 * (1 - c.ringPeak);
        const fmax = Math.pow(c.ringPeak, a) * Math.pow(1 - c.ringPeak, b);
        return Math.pow(Math.pow(u, a) * Math.pow(1 - u, b) / fmax, c.ringSharp);
    }

    function sampleRing(c, k) {
        let u = 0.5, v = 0;
        for (let i = 0; i < 24; i++) {
            u = U.seededRandom(k * 2.113 + 9.7 + i * 13.1);
            v = U.seededRandom(k * 0.917 + 2.9 + i * 7.3) * 2 - 1;
            if (Math.abs(v) <= ringProfile(c, u)) break;
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
    // Границы фигуры (2% и 98% по радиусу и высоте) — для непрерывного перевода цветка в кольцо.
    function bounds(layouts) {
        const rs = [], ys = [];
        layouts.forEach(L => L.parts.forEach(p => {
            for (let i = 0; i < p.count; i += 97) {
                rs.push(Math.hypot(p.rest[i * 3], p.rest[i * 3 + 2]));
                ys.push(p.rest[i * 3 + 1]);
            }
        }));
        const q = (a, f) => { a.sort((x, y) => x - y); return a[Math.floor(f * (a.length - 1))] || 0; };
        return { r0: q(rs, 0.02), r1: q(rs, 0.98), y0: q(ys, 0.02), y1: q(ys, 0.98) };
    }

    // Записывает расписание в aMorphOut фигуры A и aMorphIn фигуры B.
    // Возвращает длительность морфинга (сек).
    function plan(A, B) {
        const c = DP.config.morph;
        shared.uSmokeA.value.x = 0;
        shared.uShadowInfo.value.x = 0;
        DP.morph.phases = null;
        DP.morph.tiltWindow = (c.mode === 'sweep' || c.mode === 'sphere' || c.mode === 'disk') ? [0, 1] : [0.15, 0.75];
        const smokeOk = DP.smokeSim && DP.smokeSim.supported();
        if (c.mode === 'disk' && smokeOk) return planDisk(A, B);
        if (c.mode === 'sphere' && smokeOk) return planSphere(A, B);
        if (c.mode === 'sweep' && smokeOk) return planSweep(A, B);
        if (c.mode === 'smoke' && smokeOk) return planSmoke(A, B);
        if (c.mode !== 'vortex') return planFountain(A, B);
        shared.uFountA.value.x = 0;
        syncConfig();
        const NA = A.total, NB = B.total, N = Math.max(NA, NB);
        const insideOut = c.assemble !== 'outside-in';
        const usedA = new Uint8Array(NA), usedB = new Uint8Array(NB);
        const bb = bounds([A, B]);
        const warp = warpOf(c);
        let end = 0;

        const pairOf = (k) => {
            const ia = A.sorted[Math.floor(k * NA / N)];
            const kb = Math.floor(k * NB / N);
            const ib = B.sorted[insideOut ? NB - 1 - kb : kb];
            const pa = A.parts[A.partOf[ia]], la = ia - pa.start;
            const pb = B.parts[B.partOf[ib]], lb = ib - pb.start;
            return { ia, ib, pa, la, pb, lb };
        };

        // --- Лидеры и хвосты ---
        // Соседние по порядку распада точки группируются по азимуту в «хвосты» по trailLength штук.
        // Первая — лидер; остальные летят по его расписанию с задержкой rank * trailLag и видят
        // поля с той же задержкой — поэтому в каждый момент стоят там, где лидер был чуть раньше.
        const G = Math.max(1, Math.min(255, Math.round(c.trailLength)));
        const leaderOf = new Int32Array(N), rankOf = new Uint8Array(N);
        const W = G * 64;
        for (let k0 = 0; k0 < N; k0 += W) {
            const n = Math.min(W, N - k0);
            const ks = new Array(n), az = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const P = pairOf(k0 + i), j = P.la * 3;
                ks[i] = k0 + i;
                az[i] = U.azimuth(P.pa.rest[j], P.pa.rest[j + 2]) * 8 + P.pa.rest[j + 1]; // азимут, затем высота
            }
            const idx = ks.map((_, i) => i).sort((x, y) => az[x] - az[y]);
            for (let g = 0; g < n; g += G) {
                const lead = ks[idx[g]];
                for (let m = 0; m < G && g + m < n; m++) {
                    leaderOf[ks[idx[g + m]]] = lead;
                    rankOf[ks[idx[g + m]]] = m;
                }
            }
        }

        // Общие для хвоста данные лидера: время, середина пути, seed.
        const leadInfo = (k) => {
            const P = pairOf(k);
            const ja = P.la * 3, jb = P.lb * 3;
            const ax = P.pa.rest[ja], ay = P.pa.rest[ja + 1], az = P.pa.rest[ja + 2];
            const bx = P.pb.rest[jb], by = P.pb.rest[jb + 1], bz = P.pb.rest[jb + 2];
            const seed = U.seededRandom(k * 0.618 + 0.37);
            const orderA = U.clamp(P.pa.order[P.la], 0, 1);
            const orderB = U.clamp(P.pb.order[P.lb], 0, 1);
            const keyB = insideOut ? 1 - orderB : orderB;
            // Общее (плавное по месту) расписание пары — в исходном времени, затем ускоряется:
            // фронт распада — в speedIn раз, полёт — по участкам (warp.K).
            const L0 = c.leaveStart + c.leaveSpread * orderA;
            const target = c.arriveStart + c.arriveSpread * keyB;
            const Lc = c.leaveStart + c.leaveSpread * orderA / c.speedIn;
            const Dc = U.clamp(target - L0, c.minTravel, c.maxTravel) * warp.K;
            // Свой разброс частицы (распад и сборка «по частицам»): сдвиг отрыва и сдвиг посадки.
            // В вихре частица догоняет общий поток (simCohesion), и полотна снова становятся чёткими.
            const jL = (U.seededRandom(k * 0.7311 + 3.3) - 0.5) * 2 * c.orderJitter * c.leaveSpread / c.speedIn;
            const jA = (U.seededRandom(k * 1.319 + 5.1) - 0.5) * c.travelJitter * warp.K;
            const L = Math.max(0, Lc + jL);
            const D = Math.max(0.05, Dc + jA - (L - Lc));

            // Середина пути — НЕПРЕРЫВНОЕ отображение цветка в кольцо: соседи на цветке остаются
            // соседями в вихре, поэтому лепесток на глазах вытягивается в ленту, а не тает в пыль.
            // cloudMix подмешивает случайную точку кольца.
            const rPair = 0.5 * (Math.hypot(ax, az) + Math.hypot(bx, bz));
            const yPair = 0.5 * (ay + by);
            const u = U.clamp((rPair - bb.r0) / Math.max(bb.r1 - bb.r0, 1e-3), 0, 1);
            const v = U.clamp((yPair - bb.y0) / Math.max(bb.y1 - bb.y0, 1e-3), 0, 1) * 2 - 1;
            const rMap = c.ringInner + (c.ringOuter - c.ringInner) * u;
            const yMap = c.ringY + v * c.ringThickness * ringProfile(c, u);
            const ring = sampleRing(c, k);
            let rMid = rMap + (ring.r - rMap) * c.cloudMix;
            let yMid = yMap + (ring.y - yMap) * c.cloudMix + c.lift * seed;
            // Без кольца: частица остаётся на своём уровне и радиусе (слой цветка летит целиком).
            if (!c.ringMode) { rMid = rPair; yMid = yPair + c.lift * seed; }
            // Нити: все частицы одной ячейки сечения летят по одной линии.
            if (c.threadCell > 0) {
                rMid = (Math.floor(rMid / c.threadCell) + 0.5) * c.threadCell;
                yMid = (Math.floor(yMid / c.threadCell) + 0.5) * c.threadCell;
            }
            rMid = U.clamp(rMid, 0, 3.99);
            yMid = U.clamp(yMid, -2, 5.99);
            return { L, D, seed, rMid, yMid, jL: L - Lc, jA };
        };

        // Данные пар для симуляции среды: пиксель k = (время, угол поворота, азимут старта, середина пути).
        const simSide = Math.max(1, Math.ceil(Math.sqrt(N)));
        const simData = new Float32Array(simSide * simSide * 4);
        const simJit = new Float32Array(simSide * simSide * 4);   // свой сдвиг отрыва и посадки (сек)

        let cacheK = -1, cache = null;
        for (let k = 0; k < N; k++) {
            const P = pairOf(k);
            const { ia, ib, pa, la, pb, lb } = P;
            const firstA = !usedA[ia], firstB = !usedB[ib];
            if (!firstA && !firstB) continue;
            usedA[ia] = 1; usedB[ib] = 1;

            const ax = pa.rest[la * 3], az = pa.rest[la * 3 + 2];
            const bx = pb.rest[lb * 3], bz = pb.rest[lb * 3 + 2];

            const lead = leaderOf[k], rank = rankOf[k];
            if (lead !== cacheK) { cache = leadInfo(lead); cacheK = lead; }
            const { seed, rMid, yMid } = cache;
            const L = cache.L + rank * c.trailLag;
            const D = cache.D;

            // Время упаковано в одно число: шаг 10 мс, до 20.47 с на каждое поле.
            const Lq = U.clamp(Math.round(L * 100), 0, 2047);
            const Dq = U.clamp(Math.round(D * 100), 5, 2047);
            const packed = Lq * 2048 + Dq;
            end = Math.max(end, (Lq + Dq) * 0.01);

            const delta = TWO_PI * c.turns + U.wrapPi(U.azimuth(bx, bz) - U.azimuth(ax, az));
            // Высота и радиус упакованы в одно число: шаг 1/256.
            const midPacked = Math.round((yMid + 2) * 256) * 1024 + Math.round(rMid * 256);
            // seed (дробная часть) + 2 * «без пары» + 4 * номер в хвосте.
            const zA = seed + (firstB ? 0 : 2) + rank * 4;
            const zB = seed + (firstA ? 0 : 2) + rank * 4;

            if (firstA) {
                const o = pa.outAttr.array, j = la * 4;
                o[j] = packed; o[j + 1] = delta; o[j + 2] = zA; o[j + 3] = midPacked;
                pa.pairOutAttr.array[la] = k;
            }
            if (firstB) {
                const o = pb.inAttr.array, j = lb * 4;
                o[j] = packed; o[j + 1] = delta; o[j + 2] = zB; o[j + 3] = midPacked;
                pb.pairInAttr.array[lb] = k;
            }
            const js = k * 4;
            simData[js] = packed; simData[js + 1] = delta; simData[js + 2] = U.azimuth(ax, az); simData[js + 3] = midPacked;
            simJit[js] = cache.jL; simJit[js + 1] = cache.jA;
        }

        A.parts.forEach(p => { p.outAttr.needsUpdate = true; p.pairOutAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; p.pairInAttr.needsUpdate = true; });
        if (DP.flowSim) DP.flowSim.prepare(simSide, simData, simJit);

        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    // ------------------------------------------
    // ПЛАНИРОВЩИК «ФОНТАНА»
    // ------------------------------------------
    // Обе фигуры режутся на секторы по кругу; внутри сектора точки сортируются сверху вниз, и k-я
    // уходящая становится k-й прилетающей: верх рушится первым и первым строит верх новой фигуры,
    // частица остаётся почти в своей вертикальной плоскости.
    function planFountain(A, B) {
        const c = DP.config.morph, f = c.fountain;
        syncConfig();
        const bA = bounds([A]), bB = bounds([B]), bb = bounds([A, B]);
        const wallR = bb.r1 * f.wallR;
        const aRho = (wallR - f.innerR) / 2;
        shared.uFountA.value.set(1, f.innerR + aRho, aRho, 0.5 * (bb.y0 + bb.y1));
        shared.uFountB.value.set(0.5 * (bb.y1 - bb.y0) * f.heightK, f.box, f.gravity, f.entry);
        shared.uFountC.value.set(f.shells[0], f.shells[1], f.shells[2], f.shellJitter);
        shared.uSimInfo.value.set(0, 1, 0, 0);                // симуляция среды здесь не нужна
        shared.uMorphSched.value.set(0.05, f.fallSpread, 0.05 + f.travel, f.fallSpread);
        shared.uMorphSched2.value.set(0, c.meshRevealLag, c.meshFade, 0);

        const dJet = TWO_PI / f.jets;
        let end = 0;
        sectorPairs(A, B, f.sectors, bA, bB, (P) => {
            const { ia, ib, hA, hB, firstA, firstB, kk } = P;
            const seed = U.seededRandom(kk * 0.618 + 0.37);
            const jit = (U.seededRandom(kk * 0.7311 + 3.3) - 0.5) * 2 * f.jitter;
            const jitA = (U.seededRandom(kk * 1.319 + 5.1) - 0.5) * 2 * f.jitter * 0.7;
            const L = Math.max(0, 0.05 + f.fallSpread * (1 - hA) + jit);
            const arrive = 0.05 + f.fallSpread * (1 - hB) + f.travel + jitA;
            const D = Math.max(0.6, arrive - L);
            const Lq = U.clamp(Math.round(L * 100), 0, 2047);
            const Dq = U.clamp(Math.round(D * 100), 5, 2047);
            const packed = Lq * 2048 + Dq;
            end = Math.max(end, (Lq + Dq) * 0.01);
            // Струя: азимут уходящей точки притягивается к ближайшей из f.jets струй.
            const phJ = Math.round(P.phA / dJet) * dJet + (U.seededRandom(kk * 2.17 + 0.9) - 0.5) * dJet * f.jetWidth;
            const hw = Math.round(hA * 4095) * 4096 + Math.round(hB * 4095);
            writePair(A, B, P, [packed, phJ, seed + (firstB ? 0 : 2), hw], [packed, phJ, seed + (firstA ? 0 : 2), hw]);
        });
        A.parts.forEach(p => { p.outAttr.needsUpdate = true; p.pairOutAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; p.pairInAttr.needsUpdate = true; });
        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    // ------------------------------------------
    // ПАРЫ ПО СЕКТОРАМ (фонтан, дым)
    // ------------------------------------------
    // Обе фигуры режутся на S секторов по кругу; внутри сектора точки сортируются сверху вниз, и k-я
    // уходящая становится k-й прилетающей: верх рушится первым и первым строит верх новой фигуры,
    // частица остаётся почти в своей вертикальной плоскости. visit(P) вызывается для каждой пары.
    function sectorPairs(A, B, S, bA, bB, visit) {
        const IDX = 4194304;
        const prep = (Lay, b) => {
            const n = Lay.total, keys = new Float64Array(n), h = new Float32Array(n), ph = new Float32Array(n);
            const cnt = new Int32Array(S);
            const dy = Math.max(b.y1 - b.y0, 1e-3);
            Lay.parts.forEach(p => {
                for (let i = 0; i < p.count; i++) {
                    const g = p.start + i, x = p.rest[i * 3], y = p.rest[i * 3 + 1], z = p.rest[i * 3 + 2];
                    const a = U.azimuth(x, z);
                    const sec = Math.min(S - 1, Math.floor((a + Math.PI) / TWO_PI * S));
                    h[g] = U.clamp((y - b.y0) / dy, 0, 1); ph[g] = a; cnt[sec]++;
                    keys[g] = (sec * 1048576 + Math.floor((1 - h[g]) * 1048575)) * IDX + g;
                }
            });
            keys.sort();
            const sorted = new Uint32Array(n);
            for (let k = 0; k < n; k++) sorted[k] = keys[k] % IDX;
            const start = new Int32Array(S + 1);
            for (let q = 0; q < S; q++) start[q + 1] = start[q] + cnt[q];
            return { h, ph, sorted, start, cnt };
        };
        const PA = prep(A, bA), PB = prep(B, bB);
        const nonEmpty = (P, sec) => { for (let d = 0; d < S; d++) { const q = (sec + d) % S; if (P.cnt[q] > 0) return q; } return -1; };
        const usedA = new Uint8Array(A.total), usedB = new Uint8Array(B.total);
        let total = 0;
        for (let sec = 0; sec < S; sec++) total += Math.max(PA.cnt[sec], PB.cnt[sec]);
        if (!visit) return total;
        let kk = 0;
        for (let sec = 0; sec < S; sec++) {
            if (PA.cnt[sec] === 0 && PB.cnt[sec] === 0) continue;
            const sa = PA.cnt[sec] ? sec : nonEmpty(PA, sec), sb = PB.cnt[sec] ? sec : nonEmpty(PB, sec);
            const n = Math.max(PA.cnt[sec], PB.cnt[sec]);
            if (sa < 0 || sb < 0) { kk += n; continue; }
            const nA = PA.cnt[sa], nB = PB.cnt[sb];
            for (let k = 0; k < n; k++, kk++) {
                const ia = PA.sorted[PA.start[sa] + Math.floor(k * nA / n)];
                const ib = PB.sorted[PB.start[sb] + Math.floor(k * nB / n)];
                const firstA = !usedA[ia], firstB = !usedB[ib];
                if (!firstA && !firstB) continue;
                usedA[ia] = 1; usedB[ib] = 1;
                visit({ ia, ib, hA: PA.h[ia], hB: PB.h[ib], phA: PA.ph[ia], firstA, firstB, kk });
            }
        }
        return total;
    }

    // Записать данные пары в атрибуты фигур (только тем точкам, у которых это первая пара).
    function writePair(A, B, P, outV, inV) {
        if (P.firstA) {
            const pa = A.parts[A.partOf[P.ia]], la = P.ia - pa.start, o = pa.outAttr.array, j = la * 4;
            o[j] = outV[0]; o[j + 1] = outV[1]; o[j + 2] = outV[2]; o[j + 3] = outV[3];
            pa.pairOutAttr.array[la] = P.kk;
        }
        if (P.firstB) {
            const pb = B.parts[B.partOf[P.ib]], lb = P.ib - pb.start, o = pb.inAttr.array, j = lb * 4;
            o[j] = inV[0]; o[j + 1] = inV[1]; o[j + 2] = inV[2]; o[j + 3] = inV[3];
            pb.pairInAttr.array[lb] = P.kk;
        }
    }
    // Порядок распада точек одним массивом (в порядке глобальных индексов).
    function flatOrder(Lay) {
        if (Lay._order) return Lay._order;
        const r = new Float32Array(Lay.total);
        Lay.parts.forEach(p => { for (let i = 0; i < p.count; i++) { const v = p.order[i]; r[p.start + i] = v < 0 ? 0 : v > 1 ? 1 : v; } });
        return (Lay._order = r);
    }
    // Быстрый псевдослучайный [0, 1) по числу (без Math.sin).
    function hash01(x) {
        let h = Math.imul((x * 1000003) | 0, 0x9E3779B1) ^ 0x85EBCA6B;
        h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D); h = Math.imul(h ^ (h >>> 12), 0x297A2D39);
        return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
    }
    // Буферы данных пар переиспользуются между морфингами (десятки МБ — не выделять каждый раз).
    let pairBuf = null;
    function pairBuffers(side) {
        if (!pairBuf || pairBuf.side !== side) {
            const n = side * side * 4;
            pairBuf = { side, dA: new Float32Array(n), dB: new Float32Array(n), dS: new Float32Array(n) };
        }
        return pairBuf;
    }
    const restOf = (Lay, gi) => { const p = Lay.parts[Lay.partOf[gi]], j = (gi - p.start) * 3; return [p.rest[j], p.rest[j + 1], p.rest[j + 2]]; };

    // ------------------------------------------
    // ПЛАНИРОВЩИК «ДЫМА»
    // ------------------------------------------
    // Фигура A рушится сверху вниз (осыпается, как песок), частицы затягивает в дымное кольцо, где их несёт
    // течение кольца и водовороты, и частицы живут: гаснут и рождаются заново в сердцевине. Когда подходит
    // очередь, кольцо отпускает частицу, и она собирается в фигуру B — тоже сверху вниз.
    function planSmoke(A, B) {
        const c = DP.config.morph, f = c.smoke;
        syncConfig();
        shared.uFountA.value.x = 0;
        shared.uSimInfo.value.set(0, 1, 0, 0);
        const bA = bounds([A]), bB = bounds([B]), bb = bounds([A, B]);
        DP.morph.lastBounds = bb;
        shared.uMorphSched.value.set(0.05, f.leaveSpread, 0.05 + f.leaveSpread + f.hold, f.arriveSpread);
        shared.uMorphSched2.value.set(0, c.meshRevealLag, c.meshFade, 0);
        const total = sectorPairs(A, B, f.sectors, bA, bB, null);
        const side = Math.max(1, Math.ceil(Math.sqrt(total)));
        const dA = new Float32Array(side * side * 4), dB = new Float32Array(side * side * 4), dS = new Float32Array(side * side * 4);
        const ringStart = 0.05 + f.leaveSpread + f.hold;
        let end = 0;
        sectorPairs(A, B, f.sectors, bA, bB, (P) => {
            const { hA, hB, firstA, firstB, kk } = P;
            const seed = U.seededRandom(kk * 0.618 + 0.37);
            const jit = (U.seededRandom(kk * 0.7311 + 3.3) - 0.5) * 2 * f.jitter;
            const jitA = (U.seededRandom(kk * 1.319 + 5.1) - 0.5) * 2 * f.jitter;
            const L = Math.max(0, 0.05 + f.leaveSpread * (1 - hA) + jit);
            const T = ringStart + f.arriveSpread * (1 - hB) + jitA;
            const D = Math.max(f.capture + f.land + 0.2, T - L);
            const Lq = U.clamp(Math.round(L * 100), 0, 2047);
            const Dq = U.clamp(Math.round(D * 100), 5, 2047);
            end = Math.max(end, (Lq + Dq) * 0.01);
            const packed = Lq * 2048 + Dq;
            writePair(A, B, P, [packed, 0, seed + (firstB ? 0 : 2), 0], [packed, 0, seed + (firstA ? 0 : 2), 0]);
            const a = restOf(A, P.ia), b = restOf(B, P.ib), j = kk * 4;
            dA[j] = a[0]; dA[j + 1] = a[1]; dA[j + 2] = a[2]; dA[j + 3] = Lq * 0.01;
            dB[j] = b[0]; dB[j + 1] = b[1]; dB[j + 2] = b[2]; dB[j + 3] = Dq * 0.01;
            dS[j] = seed;
        });
        A.parts.forEach(p => { p.outAttr.needsUpdate = true; p.pairOutAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; p.pairInAttr.needsUpdate = true; });

        // Кольцо: центр на оси фигур, радиус — от габаритов; параметры течения — в единицах лаборатории
        // (lab/smoke.html, радиус 1.46), всё масштабируется под размер кольца на сцене.
        const R = f.ringR * bb.r1;
        const center = new THREE.Vector3(0, bb.y0 + f.ringY * (bb.y1 - bb.y0), 0);
        DP.smokeSim.prepare(side, dA, dB, dS, { R, center });
        shared.uSmokeA.value.set(1, side, f.lifeMin, Math.max(f.lifeMin + 0.01, f.lifeMax));
        shared.uSmokeB.value.set(f.fadeIn, f.fadeOut, f.grow, f.capture);
        shared.uSmokeC.value.set(f.land, 0, 0, 0);
        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    // ------------------------------------------
    // ПЛАНИРОВЩИК «КОЛЬЦО-КИСТЬ» (sweep)
    // ------------------------------------------
    // Дымное кольцо опускается сверху вниз и «дышит» по силуэту фигур на своей высоте. Где оно проходит,
    // старая фигура срывается в кольцо (на каждом уровне сначала крайние точки), а над кольцом из дыма
    // проявляется новая. Пары — на одной высоте (сектор × полоса); где точек старой фигуры больше, лишние
    // тают в кольце, где меньше — недостающие рождаются из кольца.
    function planSweep(A, B) {
        const c = DP.config.morph, f = c.sweep;
        syncConfig();
        shared.uFountA.value.x = 0;
        shared.uSimInfo.value.set(0, 1, 0, 0);
        const bb = bounds([A, B]);
        DP.morph.lastBounds = bb;
        const H = Math.max(bb.y1 - bb.y0, 1e-3);
        const yTop = bb.y1 + f.margin * H, yBot = bb.y0 - f.margin * H;
        const Td = f.descent;
        const ease = (x) => { x = U.clamp(x, 0, 1); return x + (x * x * (3 - 2 * x) - x) * f.ease; };
        const yAt = (t) => yTop - (yTop - yBot) * ease(t / Td);
        const tAt = (y) => {
            let lo = 0, hi = Td;
            if (y >= yTop) return 0;
            if (y <= yBot) return Td;
            for (let i = 0; i < 30; i++) { const m = 0.5 * (lo + hi); if (yAt(m) > y) lo = m; else hi = m; }
            return 0.5 * (lo + hi);
        };

        // Кольцо обволакивает сферу вокруг фигур: на полюсах нулевое, к экватору разрастается (и толщина
        // сердцевины растёт вместе с ним), крутится всё быстрее; внизу снова сходит на нет. Без скачков.
        const yc = 0.5 * (yTop + yBot), hh = 0.5 * (yTop - yBot), Req = f.sphereR * bb.r1;
        const envAt = (y) => Math.sqrt(Math.max(0, 1 - Math.pow((y - yc) / hh, 2)));
        const Ry = (y) => Math.max(Req * envAt(y), 0.04 * Req);
        const ring = {
            at(t) {
                const e = 1 / 60, y = yAt(t), R = Ry(y);
                return { y, R, dy: (yAt(t + e) - yAt(t - e)) / (2 * e), dR: (Ry(yAt(t + e)) - Ry(yAt(t - e))) / (2 * e),
                         w: f.rotate * envAt(y) };
            }
        };

        // Пары по ячейкам «сектор × полоса высоты».
        const S = f.sectors, NBd = f.bands, IDX = 4194304;
        const cells = (Lay) => {
            const n = Lay.total, keys = new Float64Array(n), cnt = new Int32Array(S * NBd);
            const h = new Float32Array(n), r = new Float32Array(n);
            Lay.parts.forEach(p => {
                for (let i = 0; i < p.count; i++) {
                    const g = p.start + i, x = p.rest[i * 3], y = p.rest[i * 3 + 1], z = p.rest[i * 3 + 2];
                    const sec = Math.min(S - 1, Math.floor((U.azimuth(x, z) + Math.PI) / TWO_PI * S));
                    const hh = U.clamp((y - bb.y0) / H, 0, 1), band = Math.min(NBd - 1, Math.floor((1 - hh) * NBd));
                    const cell = sec * NBd + band;
                    h[g] = hh; r[g] = Math.hypot(x, z); cnt[cell]++;
                    keys[g] = (cell * 1048576 + Math.floor((1 - hh) * 1048575)) * IDX + g;
                }
            });
            keys.sort();
            const sorted = new Uint32Array(n);
            for (let k = 0; k < n; k++) sorted[k] = keys[k] % IDX;
            const start = new Int32Array(S * NBd + 1);
            for (let q = 0; q < S * NBd; q++) start[q + 1] = start[q] + cnt[q];
            return { sorted, start, cnt, h, r };
        };
        const CA = cells(A), CB = cells(B);
        let total = 0;
        for (let q = 0; q < S * NBd; q++) total += Math.max(CA.cnt[q], CB.cnt[q]);
        const side = Math.max(1, Math.ceil(Math.sqrt(total)));
        const dA = new Float32Array(side * side * 4), dB = new Float32Array(side * side * 4), dS = new Float32Array(side * side * 4);
        const usedA = new Uint8Array(A.total), usedB = new Uint8Array(B.total);
        let end = 0, kk = 0;
        for (let q = 0; q < S * NBd; q++) {
            const nA = CA.cnt[q], nB = CB.cnt[q], n = Math.max(nA, nB);
            for (let k = 0; k < n; k++, kk++) {
                const ia = nA ? CA.sorted[CA.start[q] + Math.floor(k * nA / n)] : -1;
                const ib = nB ? CB.sorted[CB.start[q] + Math.floor(k * nB / n)] : -1;
                const firstA = ia >= 0 && !usedA[ia], firstB = ib >= 0 && !usedB[ib];
                if (!firstA && !firstB) continue;
                if (ia >= 0) usedA[ia] = 1;
                if (ib >= 0) usedB[ib] = 1;
                const hA = ia >= 0 ? CA.h[ia] : CB.h[ib], hB = ib >= 0 ? CB.h[ib] : hA;
                const rA = ia >= 0 ? CA.r[ia] : 0;
                const yA = bb.y0 + hA * H, yB = bb.y0 + hB * H;
                const seed = U.seededRandom(kk * 0.618 + 0.37);
                const jit = (U.seededRandom(kk * 0.7311 + 3.3) - 0.5) * 2 * f.jitter;
                const jitA = (U.seededRandom(kk * 1.319 + 5.1) - 0.5) * 2 * f.jitter;
                // Отрыв: кольцо дошло до точки; крайние точки — раньше (фронт куполом), и чуть заранее (lead).
                const L = Math.max(0, 0.05 + tAt(yA + f.dome * H * U.clamp(rA / bb.r1, 0, 1)) - f.lead + jit);
                const T = 0.05 + tAt(yB) + f.dwell + jitA;
                const D = Math.max(f.capture + f.land + 0.2, T - L);
                const Lq = U.clamp(Math.round(L * 100), 0, 2047), Dq = U.clamp(Math.round(D * 100), 5, 2047);
                end = Math.max(end, (Lq + Dq) * 0.01);
                const packed = Lq * 2048 + Dq;
                const P = { ia, ib, firstA, firstB, kk };
                writePair(A, B, P, [packed, 0, seed + (firstB ? 0 : 2), 0], [packed, 0, seed + (firstA ? 0 : 2), 0]);
                // Нет своей точки в A — частица «рождается» в сердцевине кольца там, где оно в момент отрыва.
                let a, b;
                if (ia >= 0) a = restOf(A, ia);
                else {
                    const bp = restOf(B, ib), ph = U.azimuth(bp[0], bp[2]), y = yAt(Lq * 0.01), R = Ry(y);
                    a = [Math.sin(ph) * R, y, Math.cos(ph) * R];
                }
                b = ib >= 0 ? restOf(B, ib) : a;
                const j = kk * 4;
                dA[j] = a[0]; dA[j + 1] = a[1]; dA[j + 2] = a[2]; dA[j + 3] = Lq * 0.01;
                dB[j] = b[0]; dB[j + 1] = b[1]; dB[j + 2] = b[2]; dB[j + 3] = Dq * 0.01;
                dS[j] = seed;
            }
        }
        A.parts.forEach(p => { p.outAttr.needsUpdate = true; p.pairOutAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; p.pairInAttr.needsUpdate = true; });

        const sm = c.smoke;
        DP.smokeSim.prepare(side, dA, dB, dS, ring, { capture: f.capture, land: f.land, gravity: f.gravity, pull: f.pull, twist: f.twist, core: f.core });
        shared.uSmokeA.value.set(1, side, sm.lifeMin, Math.max(sm.lifeMin + 0.01, sm.lifeMax));
        shared.uSmokeB.value.set(sm.fadeIn, sm.fadeOut, sm.grow, f.capture);
        shared.uSmokeC.value.set(f.land, 0, 0, 0);
        shared.uMorphSched.value.set(0.05, Td, 0.05 + f.dwell, Td);
        shared.uMorphSched2.value.set(0, c.meshRevealLag, c.meshFade, 0);
        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    // ------------------------------------------
    // ПЛАНИРОВЩИК «ДЫМНАЯ СФЕРА» (sphere)
    // ------------------------------------------
    // Фигура распадается по своему порядку aOrder — от краёв элементов к середине и низу (края лепестка →
    // середина и низ лепестка, кончики щупалец → основание), частицы закручиваются вихрем и втягиваются
    // в клубящийся дымный шар; из него новая фигура собирается в том же порядке (от краёв к середине и низу).
    // Пары «по месту»: обе фигуры режутся на ячейки «сектор по кругу × полоса высоты», внутри ячейки точки
    // сортируются сверху вниз и сопоставляются по порядку. Соседи в старой фигуре — соседи и в новой, поэтому
    // в вихре они летят вместе (пряди, складки), а не перекрещиваются. Где в ячейке точек разное число,
    // лишние тают в вихре (ib < 0 или повтор), недостающие рождаются из него (ia < 0 или повтор).
    // Ячейки «сектор × полоса высоты» для фигуры: точки, отсортированные по ячейке и сверху вниз.
    // Зависят только от формы фигуры и границ пары — считаются один раз и кэшируются на раскладке;
    // заранее их считает фоновый поток (prewarm), поэтому старт морфинга не останавливает кадр.
    const cellsKey = (S, NBd, bb) => S + '|' + NBd + '|' + bb.y0.toFixed(4) + '|' + bb.y1.toFixed(4);
    const cellsSrc = `
        function cells(rest, n, S, NBd, y0, H) {
            const IDX = 4194304, TWO_PI = Math.PI * 2;
            const keys = new Float64Array(n), cnt = new Int32Array(S * NBd);
            for (let g = 0; g < n; g++) {
                const x = rest[g * 3], y = rest[g * 3 + 1], z = rest[g * 3 + 2];
                const az = (Math.abs(x) + Math.abs(z) < 1e-5) ? 0 : Math.atan2(x, z);
                const sec = Math.min(S - 1, Math.floor((az + Math.PI) / TWO_PI * S));
                let hh = (y - y0) / H; hh = hh < 0 ? 0 : hh > 1 ? 1 : hh;
                const band = Math.min(NBd - 1, Math.floor((1 - hh) * NBd));
                const cell = sec * NBd + band;
                cnt[cell]++;
                keys[g] = (cell * 1048576 + Math.floor((1 - hh) * 1048575)) * IDX + g;
            }
            keys.sort();
            const sorted = new Uint32Array(n);
            for (let k = 0; k < n; k++) sorted[k] = keys[k] % IDX;
            const start = new Int32Array(S * NBd + 1);
            for (let q = 0; q < S * NBd; q++) start[q + 1] = start[q] + cnt[q];
            return { sorted, start, cnt };
        }`;
    const cellsFn = new Function(cellsSrc + '; return cells;')();
    // Все точки раскладки одним массивом xyz (в порядке глобальных индексов).
    function flatRest(Lay) {
        if (Lay._flat) return Lay._flat;
        const r = new Float32Array(Lay.total * 3);
        Lay.parts.forEach(p => r.set(p.rest.subarray ? p.rest.subarray(0, p.count * 3) : p.rest.slice(0, p.count * 3), p.start * 3));
        return (Lay._flat = r);
    }
    function cellsOf(Lay, S, NBd, bb) {
        const key = cellsKey(S, NBd, bb);
        Lay._cells = Lay._cells || {};
        if (!Lay._cells[key]) Lay._cells[key] = cellsFn(flatRest(Lay), Lay.total, S, NBd, bb.y0, Math.max(bb.y1 - bb.y0, 1e-3));
        return Lay._cells[key];
    }
    let worker = null, workerJobs = 0;
    // Заранее посчитать ячейки пары A → B в фоновом потоке (результат — в кэш раскладок).
    function prewarm(A, B) {
        const c = DP.config.morph, f = c[c.mode];
        if (!f || !f.sectors || !f.bands) return;
        const bb = bounds([A, B]), key = cellsKey(f.sectors, f.bands, bb);
        [A, B].forEach(Lay => {
            Lay._cells = Lay._cells || {};
            if (Lay._cells[key] || (Lay._pending && Lay._pending[key])) return;
            try {
                if (!worker) {
                    const url = URL.createObjectURL(new Blob([cellsSrc + `
                        onmessage = (e) => { const d = e.data; const r = cells(d.rest, d.n, d.S, d.NBd, d.y0, d.H);
                            postMessage({ id: d.id, sorted: r.sorted, start: r.start, cnt: r.cnt }, [r.sorted.buffer, r.start.buffer, r.cnt.buffer]); };`],
                        { type: 'application/javascript' }));
                    worker = new Worker(url);
                    worker.onmessage = (e) => {
                        const job = worker.jobs[e.data.id]; delete worker.jobs[e.data.id];
                        if (job) { job.Lay._cells[job.key] = { sorted: e.data.sorted, start: e.data.start, cnt: e.data.cnt }; delete job.Lay._pending[job.key]; }
                    };
                    worker.jobs = {};
                }
                const id = ++workerJobs;
                Lay._pending = Lay._pending || {}; Lay._pending[key] = true;
                worker.jobs[id] = { Lay, key };
                worker.postMessage({ id, rest: flatRest(Lay), n: Lay.total, S: f.sectors, NBd: f.bands, y0: bb.y0, H: Math.max(bb.y1 - bb.y0, 1e-3) });
            } catch (e) { worker = false; }   // нет фоновых потоков — посчитается при старте морфинга
        });
    }

    function cellPairs(A, B, S, NBd, bb, visit) {
        const CA = cellsOf(A, S, NBd, bb), CB = cellsOf(B, S, NBd, bb);
        let total = 0;
        for (let q = 0; q < S * NBd; q++) total += Math.max(CA.cnt[q], CB.cnt[q]);
        if (!visit) return total;
        const usedA = new Uint8Array(A.total), usedB = new Uint8Array(B.total);
        let kk = 0;
        for (let q = 0; q < S * NBd; q++) {
            const nA = CA.cnt[q], nB = CB.cnt[q], n = Math.max(nA, nB);
            for (let k = 0; k < n; k++, kk++) {
                const ia = nA ? CA.sorted[CA.start[q] + Math.floor(k * nA / n)] : -1;
                const ib = nB ? CB.sorted[CB.start[q] + Math.floor(k * nB / n)] : -1;
                const firstA = ia >= 0 && !usedA[ia], firstB = ib >= 0 && !usedB[ib];
                if (!firstA && !firstB) continue;
                if (ia >= 0) usedA[ia] = 1;
                if (ib >= 0) usedB[ib] = 1;
                visit({ ia, ib, firstA, firstB, kk });
            }
        }
        return total;
    }

    function planSphere(A, B) {
        const c = DP.config.morph, f = c.sphere;
        syncConfig();
        shared.uFountA.value.x = 0;
        shared.uSimInfo.value.set(0, 1, 0, 0);
        const bb = bounds([A, B]);
        DP.morph.lastBounds = bb;
        const R = f.sphereR * bb.r1;
        const center = new THREE.Vector3(0, bb.y0 + f.sphereY * (bb.y1 - bb.y0), 0);
        const bySpace = f.pairing !== 'order';
        const NA = A.total, NB = B.total, N = Math.max(NA, NB);
        const total = bySpace ? cellPairs(A, B, f.sectors, f.bands, bb, null) : N;
        const side = Math.max(1, Math.ceil(Math.sqrt(total)));
        const dA = new Float32Array(side * side * 4), dB = new Float32Array(side * side * 4), dS = new Float32Array(side * side * 4);
        const arriveStart = 0.05 + f.leaveSpread + f.hold;
        const orderOf = (Lay, gi) => { const p = Lay.parts[Lay.partOf[gi]]; return U.clamp(p.order[gi - p.start], 0, 1); };
        let end = 0;
        const visit = (P) => {
            const { ia, ib, firstA, firstB, kk } = P;
            const oA = ia >= 0 ? orderOf(A, ia) : orderOf(B, ib), oB = ib >= 0 ? orderOf(B, ib) : oA;
            const seed = U.seededRandom(kk * 0.618 + 0.37);
            const jit = (U.seededRandom(kk * 0.7311 + 3.3) - 0.5) * 2 * f.jitter;
            const jitA = (U.seededRandom(kk * 1.319 + 5.1) - 0.5) * 2 * f.jitter;
            const L = Math.max(0, 0.05 + f.leaveSpread * oA + jit);
            const T = arriveStart + f.arriveSpread * oB + jitA;
            const D = Math.max(f.land + 0.4, T - L);   // подхват — лишь плавное включение, ему не нужно завершаться
            const Lq = U.clamp(Math.round(L * 100), 0, 2047), Dq = U.clamp(Math.round(D * 100), 5, 2047);
            end = Math.max(end, (Lq + Dq) * 0.01);
            const packed = Lq * 2048 + Dq;
            writePair(A, B, P, [packed, 0, seed + (firstB ? 0 : 2), 0], [packed, 0, seed + (firstA ? 0 : 2), 0]);
            // Нет точки в A — частица рождается внутри шара, в стороне своей точки B.
            let a;
            if (ia >= 0) a = restOf(A, ia);
            else {
                const b0 = restOf(B, ib), dx = b0[0] - center.x, dy = b0[1] - center.y, dz = b0[2] - center.z;
                const k = 0.6 * R / Math.max(1e-3, Math.hypot(dx, dy, dz));
                a = [center.x + dx * k, center.y + dy * k, center.z + dz * k];
            }
            const b = ib >= 0 ? restOf(B, ib) : a, j = kk * 4;
            dA[j] = a[0]; dA[j + 1] = a[1]; dA[j + 2] = a[2]; dA[j + 3] = Lq * 0.01;
            dB[j] = b[0]; dB[j + 1] = b[1]; dB[j + 2] = b[2]; dB[j + 3] = Dq * 0.01;
            dS[j] = seed;
        };
        if (bySpace) cellPairs(A, B, f.sectors, f.bands, bb, visit);
        else {
            const usedA = new Uint8Array(NA), usedB = new Uint8Array(NB);
            for (let k = 0; k < N; k++) {
                const ia = A.sorted[Math.floor(k * NA / N)], ib = B.sorted[Math.floor(k * NB / N)];
                const firstA = !usedA[ia], firstB = !usedB[ib];
                if (!firstA && !firstB) continue;
                usedA[ia] = 1; usedB[ib] = 1;
                visit({ ia, ib, firstA, firstB, kk: k });
            }
        }
        A.parts.forEach(p => { p.outAttr.needsUpdate = true; p.pairOutAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; p.pairInAttr.needsUpdate = true; });

        const sm = c.smoke;
        DP.smokeSim.prepare(side, dA, dB, dS, { center, R, w: f.rotate },
            { capture: f.capture, land: f.land, gravity: f.gravity, pull: f.pull, twist: f.twist, shape: 1, roll: f.roll, noiseK: f.noiseK,
              respawn: f.respawn, twistRamp: f.twistRamp, spiral: f.spiral,
              eddy: [f.eddyBig, f.eddyBigScale, f.eddySmall, f.eddySmallScale, f.eddySpeed] });
        DP.smokeSim.setShadow(f.shadow, center, Math.max(R, 0.5 * (bb.y1 - bb.y0)) * 1.6);
        // Вид частиц в полёте — свой у сферы: мельче и ярче, пряди читаются нитями, а не туманом.
        shared.uSwirlA.value.set(f.flightSize, c.swirlSizeMin, f.flightAlpha, c.swirlVisible);
        shared.uSwirlB.value.set(c.leaveGlow, c.swirlBlend, c.swirlTint, f.flightLook);
        shared.uSmokeA.value.set(1, side, sm.lifeMin, Math.max(sm.lifeMin + 0.01, sm.lifeMax));
        shared.uSmokeB.value.set(sm.fadeIn, sm.fadeOut, sm.grow, f.capture);
        shared.uSmokeC.value.set(f.land, 0, 0, 0);
        shared.uMorphSched.value.set(0.05, f.leaveSpread, arriveStart, f.arriveSpread);
        shared.uMorphSched2.value.set(0, c.meshRevealLag, c.meshFade, 0);
        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    // ------------------------------------------
    // ПЛАНИРОВЩИК «ДИСК» (disk) — чистый вихрь, без водоворотов
    // ------------------------------------------
    // Фигура распадается от краёв элементов к середине и низу (aOrder), частицы закручиваются, как чай в чашке,
    // и стягиваются в толстое вращающееся кольцо-диск с пустой серединой на уровне экватора. Из диска частицы
    // разлетаются по местам новой фигуры сверху вниз: сначала верх, потом середина, потом самый низ.
    // Подготовка «диска» по частям: генератор отдаёт управление каждые ~150 тыс. пар, поэтому её можно
    // растянуть на несколько кадров заранее (planAhead), пока фигура спокойно вращается.
    function* buildDisk(A, B, f) {
        const bb = bounds([A, B]), bB = bounds([B]);
        const R = f.diskR * bb.r1;
        const center = new THREE.Vector3(0, bb.y0 + f.diskY * (bb.y1 - bb.y0), 0);
        // Быстрый проход по парам (≈1.3 млн): без временных объектов, буферы переиспользуются между морфингами.
        const S = f.sectors, NBd = f.bands;
        const CA = cellsOf(A, S, NBd, bb), CB = cellsOf(B, S, NBd, bb);
        let total = 0;
        for (let q = 0; q < S * NBd; q++) total += Math.max(CA.cnt[q], CB.cnt[q]);
        const side = Math.max(1, Math.ceil(Math.sqrt(total)));
        const { dA, dB, dS } = pairBuffers(side);
        const arriveStart = 0.05 + f.leaveSpread + f.hold;
        const rA = flatRest(A), rB = flatRest(B), oAf = flatOrder(A), oBf = flatOrder(B);
        const by0 = bB.y0, bdy = Math.max(bB.y1 - bB.y0, 1e-3);
        const usedA = new Uint8Array(A.total), usedB = new Uint8Array(B.total);
        const aParts = A.parts, bParts = B.parts, aOf = A.partOf, bOf = B.partOf;
        let end = 0, kk = 0, lastYield = 0, hand = 0;
        for (let q = 0; q < S * NBd; q++) {
            const nA = CA.cnt[q], nB = CB.cnt[q], n = Math.max(nA, nB);
            if (kk - lastYield > 40000) { lastYield = kk; yield; }
            for (let k = 0; k < n; k++, kk++) {
                const j = kk * 4;
                const ia = nA ? CA.sorted[CA.start[q] + Math.floor(k * nA / n)] : -1;
                const ib = nB ? CB.sorted[CB.start[q] + Math.floor(k * nB / n)] : -1;
                const firstA = ia >= 0 && !usedA[ia], firstB = ib >= 0 && !usedB[ib];
                if (!firstA && !firstB) { dB[j + 3] = 0; continue; }
                if (ia >= 0) usedA[ia] = 1;
                if (ib >= 0) usedB[ib] = 1;
                const oA = ia >= 0 ? oAf[ia] : oBf[ib];
                let hB = 1 - oA;
                if (ib >= 0) { hB = (rB[ib * 3 + 1] - by0) / bdy; hB = hB < 0 ? 0 : hB > 1 ? 1 : hB; }
                const seed = hash01(kk * 0.618 + 0.37);
                const jit = (hash01(kk * 0.7311 + 3.3) - 0.5) * 2 * f.jitter;
                const jitA = (hash01(kk * 1.319 + 5.1) - 0.5) * 2 * f.jitter;
                const L = Math.max(0, 0.05 + f.leaveSpread * oA + jit);
                const T = arriveStart + f.arriveSpread * (1 - hB) + jitA;   // сборка сверху вниз
                const D = Math.max(f.land + 0.4, T - L);
                let Lq = Math.round(L * 100); Lq = Lq < 0 ? 0 : Lq > 2047 ? 2047 : Lq;
                let Dq = Math.round(D * 100); Dq = Dq < 5 ? 5 : Dq > 2047 ? 2047 : Dq;
                if ((Lq + Dq) * 0.01 > end) end = (Lq + Dq) * 0.01;
                if (Lq * 0.01 + Dq * 0.005 > hand) hand = Lq * 0.01 + Dq * 0.005;   // последняя передача эстафеты A → B
                const packed = Lq * 2048 + Dq;
                if (firstA) {
                    const pa = aParts[aOf[ia]], la = ia - pa.start, o = pa.outAttr.array, m = la * 4;
                    o[m] = packed; o[m + 1] = 0; o[m + 2] = seed + (firstB ? 0 : 2); o[m + 3] = 0;
                    pa.pairOutAttr.array[la] = kk;
                }
                if (firstB) {
                    const pb = bParts[bOf[ib]], lb = ib - pb.start, o = pb.inAttr.array, m = lb * 4;
                    o[m] = packed; o[m + 1] = 0; o[m + 2] = seed + (firstA ? 0 : 2); o[m + 3] = 0;
                    pb.pairInAttr.array[lb] = kk;
                }
                // Нет точки в A — частица рождается в диске, в стороне своей точки B.
                let ax, ay, az;
                if (ia >= 0) { ax = rA[ia * 3]; ay = rA[ia * 3 + 1]; az = rA[ia * 3 + 2]; }
                else {
                    const ph = U.azimuth(rB[ib * 3], rB[ib * 3 + 2]), rr = R * (f.diskIn + (1 - f.diskIn) * hash01(kk * 3.1 + 0.7));
                    ax = Math.sin(ph) * rr; ay = center.y; az = Math.cos(ph) * rr;
                }
                dA[j] = ax; dA[j + 1] = ay; dA[j + 2] = az; dA[j + 3] = Lq * 0.01;
                if (ib >= 0) { dB[j] = rB[ib * 3]; dB[j + 1] = rB[ib * 3 + 1]; dB[j + 2] = rB[ib * 3 + 2]; }
                else { dB[j] = ax; dB[j + 1] = ay; dB[j + 2] = az; }
                dB[j + 3] = Dq * 0.01;
                dS[j] = seed;
            }
        }
        dB.fill(0, kk * 4);   // хвост текстуры — пустые пиксели
        return { A, B, bb, R, center, side, dA, dB, dS, end, hand };
    }

    // Применить готовую подготовку: выгрузить атрибуты и данные пар, выставить uniform'ы. Возвращает длительность.
    function applyDisk(r) {
        const c = DP.config.morph, f = c.disk, { A, B, bb, R, center, side, dA, dB, dS, end, hand } = r;
        // Когда старую фигуру можно больше не рисовать и когда можно остановить симуляцию (в режиме точек):
        // нагрузка снижается постепенно, а не обрывается в конце морфинга.
        DP.morph.phases = { hideFrom: hand + 0.05, simEnd: end + 0.05 };
        const arriveStart = 0.05 + f.leaveSpread + f.hold;
        syncConfig();
        shared.uFountA.value.x = 0;
        shared.uSimInfo.value.set(0, 1, 0, 0);
        DP.morph.lastBounds = bb;
        A.parts.forEach(p => { p.outAttr.needsUpdate = true; p.pairOutAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; p.pairInAttr.needsUpdate = true; });

        const sm = c.smoke;
        // Обороты: замер (400 частиц) — при spin 2.2 и закрутке 3 частица в среднем делает 2 оборота (внутренние
        // быстрее — до ×2); вращение и закрутка масштабируются под заданное среднее число оборотов.
        const tk = f.turns / 2;
        DP.smokeSim.prepare(side, dA, dB, dS, { center, R, w: 0 },
            { capture: f.capture, land: f.land, gravity: f.gravity, pull: 0, twist: f.twist * tk, shape: 2, roll: 0,
              respawn: 0, twistRamp: 0, spiral: 1, escape: 0, speed: 1,
              eddy: [f.eddyBig, f.eddyBigScale, f.eddySmall, f.eddySmallScale, f.eddySpeed],
              disk: [f.diskIn, f.thick, f.spin * tk, f.pullR, f.pullY, f.spinPow, f.levels] });
        DP.smokeSim.setShadow(f.shadow, center, Math.max(R, 0.5 * (bb.y1 - bb.y0)) * 1.6);
        shared.uSwirlA.value.set(f.flightSize, c.swirlSizeMin, f.flightAlpha, c.swirlVisible);
        shared.uSwirlB.value.set(c.leaveGlow, c.swirlBlend, c.swirlTint, f.flightLook);
        shared.uSmokeA.value.set(1, side, sm.lifeMin, Math.max(sm.lifeMin + 0.01, sm.lifeMax));
        shared.uSmokeB.value.set(sm.fadeIn, sm.fadeOut, sm.grow, f.capture);
        shared.uSmokeC.value.set(f.land, 0, 0, 0);
        shared.uMorphSched.value.set(0.05, f.leaveSpread, arriveStart, f.arriveSpread);
        shared.uMorphSched2.value.set(0, c.meshRevealLag, c.meshFade, 0);
        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    const diskKey = (A, B) => JSON.stringify(DP.config.morph.disk) + '|' + A.total + '|' + B.total;
    let ahead = null;   // { A, B, key, gen, result }
    function planDisk(A, B) {
        const key = diskKey(A, B);
        if (ahead && ahead.A === A && ahead.B === B && ahead.key === key) {
            if (!ahead.gen) ahead.gen = buildDisk(A, B, DP.config.morph.disk);   // подготовка ещё ждала сортировку
            while (!ahead.result) { const st = ahead.gen.next(); if (st.done) ahead.result = st.value; }   // досчитать остаток
            const r = ahead.result; ahead = null;
            return applyDisk(r);
        }
        ahead = null;
        const gen = buildDisk(A, B, DP.config.morph.disk);
        let st; do { st = gen.next(); } while (!st.done);
        return applyDisk(st.value);
    }
    // Заранее, по частям (не больше ~6 мс за шаг), подготовить морфинг A → B, пока фигура спокойно вращается.
    function planAhead(A, B) {
        const c = DP.config.morph;
        if (c.mode !== 'disk' || !(DP.smokeSim && DP.smokeSim.supported())) return;
        const key = diskKey(A, B);
        if (ahead && ahead.A === A && ahead.B === B && ahead.key === key) return;
        const job = ahead = { A, B, key, gen: null, result: null };
        const bb = bounds([A, B]), ck = cellsKey(c.disk.sectors, c.disk.bands, bb);
        // Только в простое между кадрами и маленькими кусками — кадры идут ровно даже на экранах 120 Гц.
        const idle = (fn) => window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 250 })
            : setTimeout(() => fn({ timeRemaining: () => 3, didTimeout: false }), 20);
        const budgetOf = (dl) => Math.max(1, Math.min(3, dl.timeRemaining() - 1));
        let upload = null;
        const tick = (dl) => {
            if (ahead !== job) return;                                    // отменено (морфинг начался или новая подготовка)
            if (!(A._cells && A._cells[ck]) || !(B._cells && B._cells[ck])) {   // ждём сортировку из фонового потока
                if (!(A._pending && A._pending[ck]) && !(B._pending && B._pending[ck])) prewarm(A, B);
                return setTimeout(() => idle(tick), 50);
            }
            const t0 = performance.now(), budget = budgetOf(dl);
            if (!job.gen) job.gen = buildDisk(A, B, c.disk);
            while (!job.result && performance.now() - t0 < budget) { const st = job.gen.next(); if (st.done) job.result = st.value; }
            if (job.result && !upload) upload = DP.smokeSim.stageJob(job.result.side, job.result.dA, job.result.dB, job.result.dS);
            if (upload && performance.now() - t0 < budget) { if (upload.step(budget - (performance.now() - t0))) return; }   // всё готово
            idle(tick);
        };
        idle(tick);
    }

    DP.morph = {
        shared,
        syncConfig,
        createInstanceUniforms,
        uniformsFor,
        createLayout,
        plan,
        prewarm,
        planAhead,
        glsl: { pointsVertex, pointsFragment, meshVertex, meshFragment, simplexNoise, flowGlsl }
    };
})(window.DP);
