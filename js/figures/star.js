// ==========================================
// DARK PEONY — ФИГУРА «СВЕТИЛО» (планетарная система)
// ==========================================
// Части:
//  • светило (референсы автора: сфера из светящихся прожилок, частицы по линиям тока, как у Квана) —
//    частицы в оболочке стянуты на нулевую поверхность шумового поля (ветвящиеся прожилки) и текут вдоль
//    них; второй слой — частицы на изолиниях плавного поля (линии тока); искры-узлы; светлое ядро;
//  • лучи — тонкие полосы из частиц бегут от ядра наружу (длинные редкие, короткие частые);
//  • протуберанцы — арки-петли над поверхностью, плазма течёт вдоль них, петли «дышат»;
//  • орбиты — тонкие пунктирные эллипсы (небольшие наклоны), за планетой тянется светящийся след;
//  • планеты — освещены светилом (день/ночь, френель), фактура: кратеры, континенты, полосы;
//    у второй — спутник (гладкий шар).
// Вся система в покое — в момент времени 0; движение (орбиты, вращение, поток частиц) — в шейдерах.
(function (DP) {
    'use strict';

    const { seededRandom } = DP.util;

    const FIG_Y_OFFSET = 0.1;
    const STAR_R = 0.8;                // радиус светила
    const STEP = 0.019;                // шаг сетки точек на поверхностях (как у лепестков пиона и купола медузы)
    const MULT = 3;                    // точек на узел сетки
    const STAR_SPIN = 0.05;            // вращение узора поверхности и короны, рад/с

    const VEIN_COUNT = 150000;         // частиц в прожилках (крупные + мелкие)
    const FLOW_COUNT = 60000;          // частиц на линиях тока
    const SPARK_COUNT = 2500;          // искр-узлов
    const CORE_COUNT = 22000;          // ядро
    const RAY_COUNT = 1400;            // лучей
    const RAY_POINTS = 48;             // частиц в луче
    const LOOP_COUNT = 8;              // протуберанцев
    const LOOP_POINTS = 5000;

    // Орбиты: радиус, наклон, долгота узла, фаза, угловая скорость (внутренние быстрее), планета.
    const ORBITS = [
        { R: 1.75, incl: 0.10, node: 0.4, phase: 0.6, omega: 0.21,
          planet: { r: 0.14, tex: 'craters', spin: 0.25, seed: 1.3 } },
        { R: 2.45, incl: -0.14, node: 2.1, phase: 3.4, omega: 0.13,
          planet: { r: 0.2, tex: 'continents', spin: 0.3, seed: 4.7 },
          moon: { R: 0.38, incl: 0.3, node: 1.0, phase: 1.2, omega: 0.7, r: 0.055 } },
        { R: 3.4, incl: 0.2, node: 4.2, phase: 5.3, omega: 0.075,
          planet: { r: 0.17, tex: 'bands', spin: 0.35, seed: 7.9, ring: true } },
        // крест-накрест с остальными: плоскость почти поперёк, ход — в обратную сторону
        { R: 2.1, incl: 1.25, node: 0.9, phase: 2.2, omega: -0.16,
          planet: { r: 0.12, tex: 'ice', spin: 0.3, seed: 12.4 } }
    ];
    const PLANET_AXIS_TILT = 0.4;

    // Какие части показывать (доводим по частям, как медузу; '' — все). ?parts= в адресе важнее.
    // star — светило (дымная сфера), veins — прежние прожилки, core — ядро, corona — лучи, loops — протуберанцы,
    // orbits — орбиты, planets — планеты и спутник.
    const DEFAULT_PARTS = 'star';      // сейчас автор настраивает ядро и дым со всполохами

    // Дымная сфера (метод Квана, как дымное кольцо в lab/smoke.html): частицы на видеокарте, их несут
    // водовороты двух масштабов (∇n1 × ∇n2 — поле без стоков), мягкая пружина держит частицы в оболочке
    // радиуса светила; жизнь частицы — появление, угасание, рост (как в Particular). Ползунки — панель ?tune.
    DP.config.starSmoke = Object.assign({
        speed: 0.43,       // скорость течения (значения — подобраны автором)
        noiseAmp: 0.25,    // крупное завихрение вдоль сферы: сила
        noiseScale: 1.2,   // крупное: частота (больше — мельче)
        detailAmp: 0.06,   // мелкое завихрение: сила
        detailScale: 2.8,
        gather: 0.1,       // объёмные водовороты: сгущают нити в пряди (много — слипается в комки)
        noiseSpeed: 0.35,  // изменчивость водоворотов во времени
        spring: 4.0,       // сила, возвращающая частицу к радиусу оболочки
        radial: 0.87,      // свобода по радиусу для объёмных водоворотов (завитки за край)
        spin: 1.0,         // вращение потока вокруг оси Y (как у сферы целиком)
        fieldSpin: 0.25,   // узор водоворотов плывёт вокруг оси Y, рад/с (частицы при этом не обязаны вращаться)
        emitShare: 0.35,   // доля частиц, рождённых у эмиттеров, которые ездят по сфере вокруг Y
        emitSpin: 0.6,     // скорость эмиттеров, рад/с
        emitDrag: 0.5,     // эмиттер увлекает поток за собой (шлейфы)
        emitSize: 0.28,    // размер зоны эмиттера (доля радиуса)
        flare: 0.2,        // доля частиц-всполохов: рождаются в узких источниках-языках и уходят наружу
        flareLift: 0.51,   // скорость ухода всполохов
        flareZone: 0.11,   // ширина языка у основания (доля радиуса)
        flareAlpha: 2.0,   // яркость всполохов относительно дыма
        lifeMin: 1.1, lifeMax: 2.9,
        fadeIn: 0.61, fadeOut: 0.45,
        grow: 1.75,        // во сколько раз частица крупнее к концу жизни
        size: 1.6,
        alpha: 0.33
    }, DP.config.starSmoke || {});
    // Ядро: сфера точек внутри дымной оболочки, без флуктуаций; точки мигают по очень крупному шуму
    // (размер от нуля до полного).
    DP.config.starCore = Object.assign({
        radius: 0.96,      // доля радиуса дымной оболочки (значения — подобраны автором)
        size: 2.2, alpha: 2.0,
        noiseScale: 1.25,  // масштаб шума мигания (меньше — крупнее пятна)
        speed: 0.54,       // скорость мигания
        blinkSoft: 0.6,    // мягкость границы между точками и пустотами (больше — плавнее градиент)
        blinkLevel: 0.1    // доля пустот: порог шума (больше — пустот больше)
    }, DP.config.starCore || {});

    const ORDER_NOISE = 0.25;
    const ORDER_CURVE = 0.6;

    // ==========================================
    // GLSL
    // ==========================================
    // Общие куски: затемнение дальней стороны и «за светилом» (точки позади диска светила притушены).
    const commonPars = `
        uniform float uTime;
        uniform vec2 uDepth;
        uniform float uStarR;
        varying float vDepthK;
        float dpBehindStar(vec3 mvPos) {
            vec3 c = (viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            if (mvPos.z > c.z) return 1.0;                        // ближе центра светила — не закрыто
            vec2 q = mvPos.xy * (c.z / mvPos.z);                   // проекция на плоскость центра светила
            float d = length(q - c.xy);
            return mix(0.18, 1.0, smoothstep(uStarR * 0.85, uStarR * 1.08, d));
        }
    `;
    const depthVert = 'vDepthK = (1.0 - uDepth.y * smoothstep(-1.5, 2.0, dist - uDepth.x));';
    const orbitGlsl = `
        // Поворот орбиты: сначала наклон вокруг X, затем узел вокруг Y (как на CPU — orbitMatrix).
        vec3 dpOrbitPos(float R, float incl, float node, float ang) {
            vec3 p = vec3(R * cos(ang), 0.0, R * sin(ang));
            p = vec3(p.x, p.y * cos(incl) - p.z * sin(incl), p.y * sin(incl) + p.z * cos(incl));
            return vec3(p.x * cos(node) + p.z * sin(node), p.y, -p.x * sin(node) + p.z * cos(node));
        }
    `;

    // Светило. Поле f(p, t) — шум на сфере, медленно живёт. Частица стягивается на уровень L поля
    // (шаг Ньютона вдоль касательного градиента) и одновременно сдвигается вдоль линии уровня
    // (касательная = p × ∇f — поток без «ям», как curl-шум у Квана), поэтому течёт по прожилке.
    // Уровень 0 шумового поля на сфере — ветвящаяся сеть прожилок; уровни плавного поля — линии тока.
    // aV: x — фаза, y — скорость потока, z — радиус оболочки (доля R), w — уровень L;
    // aK: x — частота поля, y — толщина нити, z — яркость, w — искра (0/1).
    const veinVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        attribute vec4 aV, aK;
        attribute float aSizeScale;
        varying float vA, vFresnel, vSpark, vShell;
        float dpVF(vec3 p, float F, float t) { return dpSnoise(p * F + vec3(t * 0.021, t * 0.033, -t * 0.017)); }
        // значение и градиент (4 вызова шума)
        vec4 dpVFG(vec3 p, float F, float t) {
            const float e = 0.015;
            float f = dpVF(p, F, t);
            return vec4((dpVF(p + vec3(e, 0.0, 0.0), F, t) - f) / e, (dpVF(p + vec3(0.0, e, 0.0), F, t) - f) / e,
                        (dpVF(p + vec3(0.0, 0.0, e), F, t) - f) / e, f);
        }
        void main() {
            vec3 dpRest = position;
            float a = uTime * ${STAR_SPIN.toFixed(3)};
            vec3 p = normalize(position);
            p = vec3(p.x * cos(a) - p.z * sin(a), p.y, p.x * sin(a) + p.z * cos(a));
            float t = uTime, F = aK.x, L = aV.w;
            float u = fract(aV.x + t * aV.y);
            float ds = (u - 0.5) * 0.36 / 3.0;              // путь вдоль нити за цикл жизни частицы (рад)
            vec3 gt = vec3(0.0);
            float res = 0.0;
            for (int i = 0; i < 3; i++) {
                vec4 fg = dpVFG(p, F, t);
                gt = fg.xyz - dot(fg.xyz, p) * p;
                float gg = max(dot(gt, gt), 1e-3);
                vec3 d = gt * ((fg.w - L) / gg);
                float dl = length(d);
                res = dl;
                if (dl > 0.3) d *= 0.3 / dl;
                vec3 T = normalize(cross(p, gt) + 1e-5);
                p = normalize(p - d + T * ds);
            }
            // толщина нити: сдвиг поперёк (вдоль градиента)
            p = normalize(p + normalize(gt + 1e-5) * (aSizeScale - 0.5) * 2.0 * aK.y);
            vec3 pos = p * aV.z * uStarR;
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * p), normalize(-mv.xyz))), 0.0, 1.0), 1.5);
            float tw = 0.5 + 0.5 * sin(t * (1.3 + 2.7 * fract(aV.x * 13.7)) + aV.x * 41.0);
            vSpark = aK.w * tw * tw;
            vShell = aV.z;
            vA = aK.z * pow(sin(3.14159265 * u), 0.6) * exp(-res * res / 0.0012);   // не севшие на нить — гаснут (тёмные промежутки)
            gl_PointSize = uSize * uViewportScale * (0.6 + 0.5 * aSizeScale) * (1.0 + 3.5 * vSpark) / (0.35 + 0.06 * dist);
            dpMorphFinish();
        }
    `;
    const veinFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vA, vFresnel, vSpark, vShell, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            float a = tex.a * vA * 1.4 * (0.6 + 0.6 * vFresnel) * mix(0.55, 1.0, smoothstep(0.8, 1.0, vShell)) + tex.a * vSpark * 2.0;
            vec3 color = mix(vec3(0.5, 0.7, 1.0), vec3(0.9, 0.96, 1.0), 0.4 + 0.4 * vFresnel + vSpark);
            a = a / (0.5 + a * 1.2) * vDepthK;
            gl_FragColor = dpMorphColor(color, a, tex.a);
        }
    `;

    // Ядро-сфера: точки рядками внутри дымной оболочки, без флуктуаций; мигают по очень крупному шуму —
    // размер от нуля до полного. uCore: x — радиус (доля R), y — размер, z — масштаб шума, w — скорость.
    const coreSphereVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale;
        uniform vec4 uCore;
        uniform vec2 uBlink;       // x — порог (доля пустот), y — мягкость границы
        attribute float aSizeScale;
        varying float vFresnel, vSz;
        void main() {
            vec3 dpRest = position;
            vec3 n = normalize(position);
            vec3 pos = n * uStarR * uCore.x;
            float tw = dpSnoise(n * uCore.z + vec3(uTime * uCore.w, -uTime * uCore.w * 0.7, uTime * uCore.w * 0.4));
            float sz = smoothstep(uBlink.x - uBlink.y, uBlink.x + uBlink.y, tw);
            sz = sz * sz * (3.0 - 2.0 * sz);                 // ещё и плавный вход/выход
            vSz = sz;                                        // точка и уменьшается, и гаснет — граница мягче
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * n), normalize(-mv.xyz))), 0.0, 1.0), 1.5);
            gl_PointSize = uCore.y * uViewportScale * (0.7 + 0.5 * aSizeScale) * sz / (0.35 + 0.06 * dist);
            dpMorphFinish();
        }
    `;
    const coreSphereFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        uniform float uCoreAlpha;
        varying float vFresnel, vDepthK, vSz;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            vec3 c = mix(vec3(0.7, 0.85, 1.0), vec3(0.95, 0.98, 1.0), vFresnel);
            gl_FragColor = dpMorphColor(c, tex.a * uCoreAlpha * (0.6 + 0.4 * vFresnel) * vSz * vDepthK, tex.a);
        }
    `;

    // Ядро: светлая сердцевина — частицы в объёме, гуще к центру, мерцают.
    const coreVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        attribute float aSizeScale;
        varying float vA;
        void main() {
            vec3 dpRest = position;
            vec4 mv = viewMatrix * dpMorph(dpRest, position);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            // редкие крупные мягкие точки дают свечение, мелкие — искристую сердцевину
            float big = step(0.94, aSizeScale);
            vA = (0.55 + mix(0.45, 0.12, big) * sin(uTime * (0.8 + 1.5 * aSizeScale) + aSizeScale * 60.0)) * mix(1.0, 0.35, big)
               * (1.0 - smoothstep(0.2, 0.85, length(position) / uStarR));
            gl_PointSize = uSize * uViewportScale * (0.6 + 0.8 * aSizeScale) * (1.0 + 14.0 * big) / (0.35 + 0.06 * dist);
            dpMorphFinish();
        }
    `;
    const coreFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vA, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            gl_FragColor = dpMorphColor(vec3(0.92, 0.97, 1.0), tex.a * vA * 0.22 * vDepthK, tex.a);
        }
    `;

    // Луч: полоса из RAY_POINTS частиц на одном направлении; все частицы луча бегут наружу вместе
    // (фазы подряд) — видна тонкая черта, уходящая от ядра. aR: x — фаза, y — скорость, z — длина пути,
    // w — яркость; aI — место частицы в черте (0 — хвост, 1 — голова).
    const rayVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        attribute vec4 aR;
        attribute float aI;
        varying float vA;
        void main() {
            vec3 dpRest = position;
            vec3 d0 = normalize(position);
            float a = uTime * ${STAR_SPIN.toFixed(3)};
            vec3 d = vec3(d0.x * cos(a) - d0.z * sin(a), d0.y, d0.x * sin(a) + d0.z * cos(a));
            float u = fract(aR.x + uTime * aR.y);
            float r = uStarR * (0.35 + (u * 1.15 + aI * 0.22) * aR.z);
            vec3 pos = d * r;
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vA = aR.w * sin(3.14159265 * u) * (0.3 + 0.7 * aI) * smoothstep(0.6, 1.0, r / uStarR);
            gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
            dpMorphFinish();
        }
    `;
    const rayFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vA, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            gl_FragColor = dpMorphColor(vec3(0.85, 0.94, 1.0), tex.a * vA * 1.4 * vDepthK, tex.a);
        }
    `;

    // ---------- ДЫМНАЯ СФЕРА: симуляция (пиксель = частица: xyz + возраст) ----------
    const smokeSimFrag = (N) => `
        precision highp float;
        uniform sampler2D uPos, uInfo;
        uniform float uTime, uDt, uR;
        uniform vec4 uNoise;   // крупные: сила, частота; мелкие: сила, частота
        uniform vec4 uShell;   // пружина, свобода по радиусу, вращение, изменчивость
        uniform vec4 uLife;    // жизнь от, до, скорость течения, -
        uniform float uGather; // сила «собирающих» водоворотов
        ${DP.morph.glsl.simplexNoise}
        vec3 eddy(vec3 q, float t) {
            vec3 g1 = dpSnoiseGrad(q + vec3(0.0, -t, 0.0)).xyz;
            vec3 g2 = dpSnoiseGrad(q + vec3(31.4, 7.1 + 0.5 * t, 5.3)).xyz;
            return cross(g1, g2);
        }
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        uniform vec4 uEmit;    // доля у эмиттеров, скорость эмиттеров, увлечение, размер зоны
        uniform vec4 uFlare;   // доля всполохов, скорость ухода, порог зон, вращение узора
        vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
        // Эмиттер k: едет по сфере вокруг Y на своей широте, со своей скоростью.
        vec3 emitter(float k, float t, out float om) {
            float y = (fract(sin(k * 12.9898 + 1.3) * 43758.5453) - 0.5) * 1.5;
            om = uEmit.y * (0.7 + 0.6 * fract(sin(k * 78.233 + 2.1) * 12345.678)) * (mod(k, 3.0) < 0.5 ? -0.6 : 1.0);
            float a = fract(sin(k * 39.425) * 24634.634) * 6.2831853 + om * t;
            float s = sqrt(1.0 - y * y);
            return vec3(s * cos(a), y, s * sin(a)) * uR;
        }
        // Источник всполохов j: узкое место на поверхности, медленно дрейфует; сила пульсирует (язык то бьёт, то гаснет).
        vec3 flareSrc(float j, float t, out float pulse) {
            float y = (fract(sin(j * 91.7 + 4.3) * 43758.5453) - 0.5) * 1.6;
            float a = fract(sin(j * 27.1 + 0.7) * 24634.634) * 6.2831853 + t * 0.12 * (fract(sin(j * 5.3) * 999.1) - 0.5);
            float s = sqrt(1.0 - y * y);
            pulse = 0.5 + 0.5 * sin(t * (0.9 + 0.8 * fract(sin(j * 3.7) * 777.7)) + j * 2.3);
            return vec3(s * cos(a), y, s * sin(a));
        }
        vec3 flow(vec3 p, float t, float flare, float kLife) {
            float ts = t * uShell.w;
            float r = max(length(p), 1e-4);
            vec3 n = p / r;
            if (flare > 0.5) {
                // всполох: уходит наружу с ускорением; плавное покачивание растёт к концу языка — он извивается и рвётся
                vec3 w = eddy(p * 1.1 + vec3(3.3, 1.1, -4.4), t * 0.45);
                return n * uFlare.y * (0.35 + 1.2 * kLife) + w * 0.35 * (0.15 + kLife)
                     + cross(vec3(0.0, 1.0, 0.0), p) * uShell.z * 0.5;
            }
            // Узор водоворотов плывёт вокруг Y: поле считаем в повёрнутой системе и возвращаем обратно.
            float fa = -uFlare.w * t;
            vec3 q = rotY(p, fa), nq = rotY(n, fa);
            // Завихрение вдоль сферы: n × ∇ψ — на сфере без стоков, дым не слипается в комки, а тянется в нити.
            vec3 g1 = dpSnoiseGrad(q * uNoise.y + vec3(0.0, -ts, 0.0)).xyz;
            vec3 g2 = dpSnoiseGrad(q * uNoise.w + vec3(17.0, 3.0 + ts * 1.7, -9.0)).xyz;
            vec3 v = uNoise.x * cross(nq, g1) + uNoise.z * cross(nq, g2);
            // Немного объёмных водоворотов: сгущают нити в пряди и выбивают завитки за край (свобода по радиусу).
            vec3 e = eddy(q * uNoise.y * 1.3 + vec3(5.1, -2.7, 8.3), ts * 1.3);
            e -= nq * dot(e, nq) * (1.0 - uShell.y);
            v += uGather * e;
            v = rotY(v, -fa);
            // Эмиттеры увлекают поток за собой — тянутся шлейфы.
            for (int k = 0; k < 6; k++) {
                float om; vec3 E = emitter(float(k), t, om);
                vec3 d = p - E;
                v += cross(vec3(0.0, 1.0, 0.0), E) * om * uEmit.z * exp(-dot(d, d) / (uEmit.w * uEmit.w * uR * uR));
            }
            v += n * (uR - r) * uShell.x;                                // пружина к радиусу оболочки
            v += cross(vec3(0.0, 1.0, 0.0), p) * uShell.z;               // вращение потока вокруг Y
            return v;
        }
        void main() {
            vec2 uv = gl_FragCoord.xy / vec2(${N}.0);
            vec4 P = texture2D(uPos, uv);
            vec4 I = texture2D(uInfo, uv);
            float life = mix(uLife.x, uLife.y, I.x);
            float flare = step(100.0, P.w);                 // признак всполоха хранится в возрасте (+100)
            float age = P.w - 100.0 * flare + uDt;
            vec3 p = P.xyz;
            if (age > life) {
                // смерть → рождение: часть — у эмиттеров, остальные — в случайной точке оболочки
                float h1 = h(uv + fract(uTime * 0.137)), h2 = h(uv * 1.7 + fract(uTime * 0.291) + 3.1), h3 = h(uv * 2.3 + fract(uTime * 0.173) + 7.7);
                float h4 = h(uv * 3.1 + fract(uTime * 0.219) + 1.9), h5 = h(uv * 0.7 + fract(uTime * 0.313) + 5.3);
                float z = h1 * 2.0 - 1.0, a = h2 * 6.2831853, s = sqrt(1.0 - z * z);
                vec3 rn = vec3(s * cos(a), z, s * sin(a));
                if (h4 < uEmit.x) {
                    float om; vec3 E = emitter(floor(h5 * 6.0), uTime, om);
                    rn = normalize(E / uR + rn * uEmit.w * sqrt(h3));
                }
                flare = 0.0;
                float h6 = fract(h5 * 7.13);
                if (h6 < uFlare.x) {
                    // всполох рождается в узком источнике (языке), если тот сейчас «бьёт»
                    float pulse; vec3 F = flareSrc(floor(fract(h4 * 3.71) * 7.0), uTime, pulse);
                    if (fract(h3 * 5.9) < pulse) { rn = normalize(F + (rn - F * dot(rn, F)) * uFlare.z * sqrt(h1)); flare = 1.0; }
                }
                p = rn * uR * (1.0 + (h3 - 0.5) * 0.04);
                age = 0.0;
            } else {
                float vd = uDt * uLife.z, kl = age / life;
                vec3 v1 = flow(p, uTime, flare, kl);
                vec3 v2 = flow(p + v1 * vd * 0.5, uTime + uDt * 0.5, flare, kl);
                p += v2 * vd;
            }
            gl_FragColor = vec4(p, age + 100.0 * flare);
        }
    `;
    const smokeVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale;
        uniform sampler2D uSmokePos, uSmokeInfo;
        uniform vec4 uSmokeLife;   // жизнь от, до
        uniform vec4 uSmokeLook;   // появление, угасание, рост, размер
        uniform vec4 uSmokeLook2;  // x — яркость всполохов
        attribute vec2 aRef;
        varying float vA, vK;
        void main() {
            vec3 dpRest = position;
            vec4 P = texture2D(uSmokePos, aRef);
            float life = mix(uSmokeLife.x, uSmokeLife.y, texture2D(uSmokeInfo, aRef).x);
            float fl = step(100.0, P.w);
            float k = clamp((P.w - 100.0 * fl) / life, 0.0, 1.0);
            vA = smoothstep(0.0, uSmokeLook.x, k) * (1.0 - smoothstep(1.0 - uSmokeLook.y, 1.0, k));
            // всполох: вспыхивает сразу у поверхности и долго тает, уходя наружу (язык пламени)
            vA = mix(vA, smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.25, 1.0, k)) * uSmokeLook2.x, fl);
            vK = k;
            vec4 mv = viewMatrix * dpMorph(dpRest, P.xyz);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            gl_PointSize = uSmokeLook.w * uViewportScale * mix(1.0, uSmokeLook.z, k * k) / (0.35 + 0.06 * dist);
            if (vA < 0.001) gl_PointSize = 0.0;
            dpMorphFinish();
        }
    `;
    const smokeFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        uniform float uAlpha;
        varying float vA, vK, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            vec3 c = mix(vec3(0.88, 0.95, 1.0), vec3(0.55, 0.72, 0.98), vK);   // старый дым холоднее
            gl_FragColor = dpMorphColor(c, tex.a * vA * uAlpha * vDepthK, tex.a);
        }
    `;

    // Протуберанец: петля между двумя точками поверхности. aF1, aF2 — основания; aLp: x — фаза,
    // y — скорость течения, z — высота, w — наклон вбок; aOff: смещение в сечении (x, y) и толщина (z).
    // Та же формула на CPU — loopPoint (для положения в покое).
    const loopGlsl = `
        vec3 dpLoop(vec3 F1, vec3 F2, float u, float H, float lean, vec3 off) {
            vec3 dir = normalize(mix(F1, F2, u));
            vec3 side = normalize(cross(F1, F2));
            float s = sin(3.14159265 * u);
            vec3 p = dir * (uStarR + H * pow(s, 0.8)) + side * (lean * H * s);
            float th = off.z * (0.35 + 0.65 * s);
            return p + (dir * off.x + side * off.y) * th;
        }
    `;
    const loopVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        ${loopGlsl}
        uniform float uViewportScale, uSize;
        attribute vec3 aF1, aF2, aOff;
        attribute vec4 aLp;
        varying float vA, vS;
        void main() {
            vec3 dpRest = position;
            float a = uTime * ${STAR_SPIN.toFixed(3)};
            mat3 spin = mat3(cos(a), 0.0, sin(a), 0.0, 1.0, 0.0, -sin(a), 0.0, cos(a));
            float u = fract(aLp.x + uTime * aLp.y);
            float H = aLp.z * (1.0 + 0.14 * sin(uTime * 0.35 + aLp.x * 17.0));   // петля «дышит»
            vec3 pos = spin * dpLoop(aF1, aF2, u, H, aLp.w, aOff);
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            float s = sin(3.14159265 * u);
            vS = s;
            vA = smoothstep(0.0, 0.12, s) * dpBehindStar(mv.xyz);
            gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
            dpMorphFinish();
        }
    `;
    const loopFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vA, vS, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            float a = tex.a * vA * (0.07 + 0.08 * vS);
            a = a / (0.45 + a * 1.6) * vDepthK;
            gl_FragColor = dpMorphColor(mix(vec3(0.55, 0.75, 1.0), vec3(0.95, 0.98, 1.0), vS), a, tex.a);
        }
    `;

    // Орбита: пунктир; за планетой — светящийся след (планета только что прошла эти точки).
    const orbitVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        uniform vec4 uPlanet;            // x — фаза, y — угловая скорость
        attribute float aAng;
        varying float vA;
        void main() {
            vec3 dpRest = position;
            vec4 mv = viewMatrix * dpMorph(dpRest, position);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            float ph = uPlanet.x + uPlanet.y * uTime;
            float behind = mod(ph - aAng, 6.2831853);
            vA = (0.35 + 1.6 * exp(-behind * 1.6)) * dpBehindStar(mv.xyz);
            gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
            dpMorphFinish();
        }
    `;
    const orbitFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vA, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            float a = tex.a * vA * 0.5 * vDepthK;
            gl_FragColor = dpMorphColor(vec3(0.62, 0.8, 1.0), a, tex.a);
        }
    `;

    // Планета/спутник: точка = центр на орбите (+ орбита родителя у спутника) + повёрнутая локальная точка.
    // Освещение от светила: день/ночь; френель по краю; фактура aTex (x — яркость поверхности, y — кромки).
    const bodyPars = `
        uniform vec4 uOrbit;             // R, наклон, узел, фаза
        uniform vec4 uOrbit2;            // x — угловая скорость, y — вращение вокруг оси
        uniform vec4 uParent;            // орбита родителя (для спутника): R, наклон, узел, фаза
        uniform float uParentOmega;      // скорость родителя; < 0 — родителя нет
        uniform float uBodyR;            // радиус тела (для кольца: что закрыто планетой и что в её тени)
        vec3 dpBodyCenter(float t) {
            vec3 c = dpOrbitPos(uOrbit.x, uOrbit.y, uOrbit.z, uOrbit.w + uOrbit2.x * t);
            if (uParentOmega >= 0.0) c += dpOrbitPos(uParent.x, uParent.y, uParent.z, uParent.w + uParentOmega * t);
            return c;
        }
        vec3 dpBodyLocal(vec3 l, float t) {
            float a = uOrbit2.y * t;
            l = vec3(l.x * cos(a) - l.z * sin(a), l.y, l.x * sin(a) + l.z * cos(a));        // вращение вокруг оси
            float k = ${PLANET_AXIS_TILT.toFixed(3)};
            return vec3(l.x * cos(k) - l.y * sin(k), l.x * sin(k) + l.y * cos(k), l.z);     // наклон оси
        }
    `;
    const bodyVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        ${orbitGlsl}
        ${bodyPars}
        uniform float uViewportScale, uSize;
        attribute vec3 aLocal;
        attribute vec2 aTex;
        attribute float aSizeScale;
        varying float vFresnel, vDay;
        varying vec2 vTex;
        void main() {
            vec3 dpRest = position;
            vec3 c = dpBodyCenter(uTime);
            vec3 l = dpBodyLocal(aLocal, uTime);
            vec3 pos = c + l;
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vec3 n = normalize(l);
            vDay = smoothstep(-0.2, 0.45, dot(n, normalize(-c)));
            float facing = dot(normalize(normalMatrix * n), normalize(-mv.xyz));
            vFresnel = pow(clamp(1.0 - abs(facing), 0.0, 1.0), 1.4);
            vTex = aTex;
            if (aTex.y > 1.5) {
                // кольцо: видно целиком, кроме части за диском планеты; освещено, если не в тени планеты
                vec3 cv = (viewMatrix * modelMatrix * vec4(c, 1.0)).xyz;
                float behind = step(mv.z, cv.z) * (1.0 - smoothstep(uBodyR * 0.95, uBodyR * 1.05, length(mv.xy * (cv.z / mv.z) - cv.xy)));
                vec3 toStar = normalize(-c);
                float shadow = step(0.0, -dot(l, toStar)) * (1.0 - smoothstep(uBodyR * 0.9, uBodyR * 1.1, length(l - dot(l, toStar) * toStar)));
                vDay = 1.0 - 0.85 * shadow;
                vFresnel = 0.0;
                vDepthK *= dpBehindStar(mv.xyz) * (1.0 - behind);
            } else {
                // тело непрозрачное: задняя половина не видна (иначе фактура двух сторон смешивается в кашу)
                vDepthK *= dpBehindStar(mv.xyz) * smoothstep(-0.08, 0.15, facing);
            }
            gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) / (0.35 + 0.06 * dist);
            dpMorphFinish();
        }
    `;
    const bodyFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vFresnel, vDay, vDepthK;
        varying vec2 vTex;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            // ночная сторона тусклее, но фактура читается всегда (иначе планета перед светилом — пустой круг)
            if (vTex.y > 1.5) {                       // кольцо: тонкие полосы, тусклее планеты
                float ar = tex.a * vTex.x * (0.25 + 0.75 * vDay) * 0.55 * vDepthK;
                gl_FragColor = dpMorphColor(vec3(0.75, 0.88, 1.0), ar, tex.a);
                return;
            }
            float lit = 0.42 + 0.58 * vDay;
            float a = tex.a * (lit * (0.02 + 0.8 * pow(vTex.x, 1.5) + 1.0 * vTex.y) + 0.3 * vFresnel * (0.3 + 0.7 * vDay));
            vec3 color = mix(vec3(0.25, 0.45, 0.75), vec3(0.85, 0.94, 1.0), 0.3 + 0.5 * vTex.x * vDay + 0.4 * vFresnel);
            a = min(1.0, a * 2.4) * vDepthK;   // без сжатия яркости: иначе суша и океан выравниваются
            gl_FragColor = dpMorphColor(color, a, tex.a);
        }
    `;

    // ==========================================
    // ГЕОМЕТРИЯ
    // ==========================================
    const cache = {};

    function orbitPos(R, incl, node, ang) {      // = dpOrbitPos
        let x = R * Math.cos(ang), y = 0, z = R * Math.sin(ang);
        const y2 = y * Math.cos(incl) - z * Math.sin(incl), z2 = y * Math.sin(incl) + z * Math.cos(incl);
        y = y2; z = z2;
        return [x * Math.cos(node) + z * Math.sin(node), y, -x * Math.sin(node) + z * Math.cos(node)];
    }
    function bodyLocal(l) {                        // = dpBodyLocal при t = 0
        const k = PLANET_AXIS_TILT;
        return [l[0] * Math.cos(k) - l[1] * Math.sin(k), l[0] * Math.sin(k) + l[1] * Math.cos(k), l[2]];
    }

    // Сфера из точек рядками: параллели × меридианы (у полюсов меридианов меньше), MULT точек на узел
    // со сдвигом ±0.4 ячейки — как у купола медузы.
    function spherePoints(R, q, cb) {
        const h = STEP / Math.sqrt(q);
        const nS = Math.max(6, Math.ceil(Math.PI * R / h));
        let sd = R * 13.1;
        for (let i = 0; i <= nS; i++) {
            const th0 = (i / nS) * Math.PI;
            const nT = Math.max(6, Math.round(2 * Math.PI * R * Math.sin(th0) / h));
            for (let j = 0; j < nT; j++) for (let m = 0; m < MULT; m++) {
                const th = Math.min(Math.PI, Math.max(0, (i + (seededRandom(sd += 1.1) - 0.5) * 0.8) / nS * Math.PI));
                const ph = (j + (seededRandom(sd += 1.3) - 0.5) * 0.8) / nT * Math.PI * 2;
                cb(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph), seededRandom(sd += 0.9));
            }
        }
    }

    // Шум для фактуры планет (на CPU, в покое): сглаженная решётка + октавы.
    function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
    function vnoise3(x, y, z) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        const fx = x - ix, fy = y - iy, fz = z - iz;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
        let s = 0;
        for (let c = 0; c < 8; c++) {
            const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
            s += hash3(ix + dx, iy + dy, iz + dz) * (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
        }
        return s;
    }
    function fbm3(x, y, z, oct) { let s = 0, w = 0.5, n = 0; for (let o = 0; o < oct; o++) { s += vnoise3(x, y, z) * w; n += w; x *= 2.03; y *= 2.03; z *= 2.03; w *= 0.5; } return s / n; }

    // Фактура: [яркость поверхности, кромка]. craters — кольца кратеров и тёмные днища; continents — суша ярче
    // океана, береговая линия светится; bands — полосы по широте с завихрениями.
    function surfaceTex(kind, x, y, z, seed, craters) {
        if (kind === 'craters') {
            let base = 0.45 + 0.5 * (fbm3(x * 3 + seed, y * 3, z * 3, 3) - 0.5), rim = 0;
            for (const c of craters) {
                const d = Math.acos(Math.max(-1, Math.min(1, x * c[0] + y * c[1] + z * c[2])));
                if (d < c[3] * 0.85) base *= 0.25;                  // тёмное днище
                rim = Math.max(rim, Math.exp(-Math.pow((d - c[3]) / (c[3] * 0.18), 2)));
            }
            return [base, rim * 0.9];
        }
        if (kind === 'continents') {
            const n = fbm3(x * 2.2 + seed, y * 2.2 + 1.7, z * 2.2 - seed, 5);
            const land = DP.util.smoothstep(0.5, 0.56, n);
            const coast = Math.exp(-Math.pow((n - 0.53) / 0.025, 2));
            return [land, coast];                                  // океан почти прозрачный — читаются материки
        }
        if (kind === 'ice') {                           // лёд: светлая корка с сетью трещин
            const n = fbm3(x * 3 + seed, y * 3, z * 3, 4);
            const crack = Math.exp(-Math.pow((n - 0.5) / 0.02, 2));
            return [0.45 + 0.3 * fbm3(x * 6, y * 6 + seed, z * 6, 2), crack];
        }
        const w = fbm3(x * 2.5 + seed, y * 1.2, z * 2.5, 3);
        const b = 0.5 + 0.5 * Math.sin(y * 9 + w * 5 + seed);
        return [Math.pow(b, 2), Math.pow(b, 8) * 0.7];
    }

    // Протуберанец в покое (= dpLoop).
    function loopPoint(F1, F2, u, H, lean, off) {
        const d = F1.clone().lerp(F2, u).normalize();
        const side = new THREE.Vector3().crossVectors(F1, F2).normalize();
        const s = Math.sin(Math.PI * u);
        const p = d.clone().multiplyScalar(STAR_R + H * Math.pow(s, 0.8)).addScaledVector(side, lean * H * s);
        const th = off.z * (0.35 + 0.65 * s);
        return p.addScaledVector(d, off.x * th).addScaledVector(side, off.y * th);
    }

    function randomDir(k) {
        const u = seededRandom(k) * 2 - 1, a = seededRandom(k * 1.7 + 0.3) * Math.PI * 2, s = Math.sqrt(1 - u * u);
        return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
    }
    const gauss = (k) => (seededRandom(k) + seededRandom(k * 1.7 + 0.3) + seededRandom(k * 2.9 + 0.7) - 1.5) / 1.5;

    function buildGeometry(tier) {
        const q = Math.pow(tier.petalSegments / 100, 2) * tier.petalMultiplier / 3;   // плотность относительно high

        // ---------- СВЕТИЛО: прожилки, линии тока, искры ----------
        // Положение в покое — случайная точка оболочки (шейдер стягивает её на нить); для раскладки морфинга
        // этого достаточно: частица уходит с видимого места (cur), а садится на нить за последние доли секунды.
        const nV = Math.round(VEIN_COUNT * q), nF = Math.round(FLOW_COUNT * q), nS = Math.round(SPARK_COUNT * q);
        const nAll = nV + nF + nS;
        const vp = new Float32Array(nAll * 3), va = new Float32Array(nAll * 4), vk = new Float32Array(nAll * 4), vs = new Float32Array(nAll);
        for (let i = 0; i < nAll; i++) {
            const kind = i < nV ? 0 : i < nV + nF ? 1 : 2;       // 0 — прожилка, 1 — линия тока, 2 — искра
            const d = randomDir(i * 1.91 + 101);
            const major = seededRandom(i * 2.33 + 102) < 0.62;    // крупные прожилки / мелкие ветки
            // оболочка: в основном у поверхности, часть — глубже (объём, тусклее)
            const shell = kind === 1 ? 0.97 + 0.03 * seededRandom(i * 3.1 + 103)
                : 1 - Math.pow(seededRandom(i * 3.7 + 104), 3) * 0.4;
            const lv = kind === 1 ? Math.round((seededRandom(i * 4.3 + 105) - 0.5) * 12) / 10 : 0;
            vp[i * 3] = d.x * shell * STAR_R; vp[i * 3 + 1] = d.y * shell * STAR_R; vp[i * 3 + 2] = d.z * shell * STAR_R;
            va[i * 4] = seededRandom(i * 5.9 + 106);
            va[i * 4 + 1] = 0.08 + 0.07 * seededRandom(i * 6.7 + 107);
            va[i * 4 + 2] = shell; va[i * 4 + 3] = lv;
            vk[i * 4] = kind === 1 ? 1.1 : (major ? 1.7 : 3.4);
            vk[i * 4 + 1] = kind === 1 ? 0.004 : (major ? 0.012 : 0.006);
            vk[i * 4 + 2] = kind === 1 ? 0.35 : (major ? 1.0 : 0.6);
            vk[i * 4 + 3] = kind === 2 ? 1 : 0;
            vs[i] = seededRandom(i * 7.3 + 108);
        }
        const veinGeo = new THREE.BufferGeometry();
        veinGeo.setAttribute('position', new THREE.BufferAttribute(vp, 3));
        veinGeo.setAttribute('aV', new THREE.BufferAttribute(va, 4));
        veinGeo.setAttribute('aK', new THREE.BufferAttribute(vk, 4));
        veinGeo.setAttribute('aSizeScale', new THREE.BufferAttribute(vs, 1));

        // ---------- ДЫМНАЯ СФЕРА: частицы (сторона текстуры N) ----------
        const SN = tier.petalSegments >= 100 ? 512 : tier.petalSegments >= 80 ? 384 : 256;
        const smokeRef = new Float32Array(SN * SN * 2), smokePos = new Float32Array(SN * SN * 3);
        const smokeInit = new Float32Array(SN * SN * 4), smokeInfo = new Float32Array(SN * SN * 4);
        for (let i = 0; i < SN * SN; i++) {
            smokeRef[i * 2] = ((i % SN) + 0.5) / SN; smokeRef[i * 2 + 1] = (Math.floor(i / SN) + 0.5) / SN;
            const d = randomDir(i * 1.37 + 501), rr = STAR_R * (1 + (seededRandom(i * 2.9 + 502) - 0.5) * 0.04);
            smokePos[i * 3] = d.x * rr; smokePos[i * 3 + 1] = d.y * rr; smokePos[i * 3 + 2] = d.z * rr;
            for (let k = 0; k < 4; k++) smokeInfo[i * 4 + k] = seededRandom(i * 3.7 + k * 1.3 + 503);
            smokeInit[i * 4] = smokePos[i * 3]; smokeInit[i * 4 + 1] = smokePos[i * 3 + 1]; smokeInit[i * 4 + 2] = smokePos[i * 3 + 2];
            smokeInit[i * 4 + 3] = seededRandom(i * 4.9 + 504) * 2.0;     // разные фазы жизни
        }
        const smokeGeo = new THREE.BufferGeometry();
        smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
        smokeGeo.setAttribute('aRef', new THREE.BufferAttribute(smokeRef, 2));
        const smoke = { N: SN, init: smokeInit, info: smokeInfo };

        // ---------- ЯДРО-СФЕРА ----------
        const csP = [], csS = [];
        const coreR = STAR_R * DP.config.starCore.radius;
        spherePoints(coreR, q, (x, y, z, rs) => { csP.push(x * coreR, y * coreR, z * coreR); csS.push(rs); });
        const coreSphereGeo = new THREE.BufferGeometry();
        coreSphereGeo.setAttribute('position', new THREE.Float32BufferAttribute(csP, 3));
        coreSphereGeo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(csS, 1));

        // ---------- ЯДРО ----------
        const nCore = Math.round(CORE_COUNT * q);
        const cp = new Float32Array(nCore * 3), cs = new Float32Array(nCore);
        for (let i = 0; i < nCore; i++) {
            const d = randomDir(i * 2.71 + 201), r = STAR_R * 0.85 * Math.pow(seededRandom(i * 3.13 + 202), 1.7);
            cp[i * 3] = d.x * r; cp[i * 3 + 1] = d.y * r; cp[i * 3 + 2] = d.z * r;
            cs[i] = seededRandom(i * 4.7 + 203);
        }
        const coreGeo = new THREE.BufferGeometry();
        coreGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
        coreGeo.setAttribute('aSizeScale', new THREE.BufferAttribute(cs, 1));

        // ---------- ЛУЧИ ----------
        const nR = Math.round(RAY_COUNT * Math.sqrt(q)), nRP = nR * RAY_POINTS;
        const rp = new Float32Array(nRP * 3), ra = new Float32Array(nRP * 4), ri = new Float32Array(nRP);
        for (let k = 0; k < nR; k++) {
            const d = randomDir(k * 3.77 + 301);
            const long = seededRandom(k * 1.37 + 302) < 0.12;       // редкие длинные яркие лучи
            const len = long ? 1.6 + seededRandom(k * 2.9 + 303) * 1.4 : 0.5 + seededRandom(k * 2.9 + 303) * 0.7;
            const ph = seededRandom(k * 4.1 + 304), sp = (0.05 + 0.06 * seededRandom(k * 5.3 + 305)) / (0.4 + len * 0.3);
            const br = long ? 0.7 + 0.3 * seededRandom(k * 6.1 + 306) : 0.2 + 0.3 * seededRandom(k * 6.1 + 306);
            for (let j = 0; j < RAY_POINTS; j++) {
                const i = k * RAY_POINTS + j, aI = j / (RAY_POINTS - 1);
                const r = STAR_R * (0.35 + (ph * 1.15 + aI * 0.22) * len);
                rp[i * 3] = d.x * r; rp[i * 3 + 1] = d.y * r; rp[i * 3 + 2] = d.z * r;
                ra[i * 4] = ph; ra[i * 4 + 1] = sp; ra[i * 4 + 2] = len; ra[i * 4 + 3] = br;
                ri[i] = aI;
            }
        }
        const rayGeo = new THREE.BufferGeometry();
        rayGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
        rayGeo.setAttribute('aR', new THREE.BufferAttribute(ra, 4));
        rayGeo.setAttribute('aI', new THREE.BufferAttribute(ri, 1));

        // ---------- ПРОТУБЕРАНЦЫ ----------
        const nL = Math.round(LOOP_POINTS * q);
        const lp = [], lf1 = [], lf2 = [], llp = [], lo = [];
        for (let k = 0; k < LOOP_COUNT; k++) {
            const c = randomDir(k * 9.1 + 40);
            const t1 = new THREE.Vector3().crossVectors(c, new THREE.Vector3(0.3, 1, 0.2).normalize()).normalize();
            const sep = 0.22 + seededRandom(k * 2.3 + 41) * 0.3;
            const F1 = c.clone().addScaledVector(t1, -sep / 2).normalize(), F2 = c.clone().addScaledVector(t1, sep / 2).normalize();
            const H = 0.22 + seededRandom(k * 3.7 + 42) * 0.4, lean = (seededRandom(k * 4.9 + 43) - 0.5) * 0.8;
            const speed = (0.06 + seededRandom(k * 5.3 + 44) * 0.07);
            const thick = 0.025 + seededRandom(k * 6.1 + 45) * 0.03;
            for (let i = 0; i < nL; i++) {
                const sd = k * 1000 + i;
                const u0 = seededRandom(sd * 1.13 + 46);
                const rr = Math.sqrt(seededRandom(sd * 2.17 + 47)), aa = seededRandom(sd * 3.19 + 48) * Math.PI * 2;
                const off = { x: rr * Math.cos(aa), y: rr * Math.sin(aa), z: thick, lean };
                const p = loopPoint(F1, F2, u0, H, lean, off);
                lp.push(p.x, p.y, p.z);
                lf1.push(F1.x, F1.y, F1.z); lf2.push(F2.x, F2.y, F2.z);
                llp.push(u0, speed * (0.85 + 0.3 * seededRandom(sd * 4.3 + 49)), H, lean);
                lo.push(off.x, off.y, thick);
            }
        }
        const loopGeo = new THREE.BufferGeometry();
        loopGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
        loopGeo.setAttribute('aF1', new THREE.Float32BufferAttribute(lf1, 3));
        loopGeo.setAttribute('aF2', new THREE.Float32BufferAttribute(lf2, 3));
        loopGeo.setAttribute('aLp', new THREE.Float32BufferAttribute(llp, 4));
        loopGeo.setAttribute('aOff', new THREE.Float32BufferAttribute(lo, 3));

        // ---------- ОРБИТЫ ----------
        const orbits = ORBITS.map((O, oi) => {
            const n = Math.round(2 * Math.PI * O.R / 0.012 * 3 * Math.sqrt(q));
            const pos = new Float32Array(n * 3), ang = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2 + (seededRandom(oi * 77 + i * 1.7) - 0.5) * 0.004;
                const p = orbitPos(O.R + (seededRandom(oi * 91 + i * 2.3) - 0.5) * 0.008, O.incl, O.node, a);
                pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1] + (seededRandom(oi * 53 + i * 3.1) - 0.5) * 0.006; pos[i * 3 + 2] = p[2];
                ang[i] = a;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
            return { geo, O };
        });

        // ---------- ПЛАНЕТЫ И СПУТНИК ----------
        const bodies = [];
        const makeBody = (r, kind, seed, center, orbit, parent, ring) => {
            const craters = [];
            if (kind === 'craters') for (let k = 0; k < 26; k++) { const d = randomDir(seed * 31 + k * 2.9); craters.push([d.x, d.y, d.z, 0.12 + Math.pow(seededRandom(seed * 17 + k), 2) * 0.35]); }
            const P = [], L = [], T = [], S = [];
            spherePoints(r, q * 3, (x, y, z, rs) => {      // мелкие тела — сетка втрое плотнее, иначе фактура не читается
                const tx = kind === 'plain' ? [0.75, 0] : surfaceTex(kind, x, y, z, seed, craters);
                const l = [x * r, y * r, z * r], w = bodyLocal(l);
                P.push(center[0] + w[0], center[1] + w[1], center[2] + w[2]);
                L.push(l[0], l[1], l[2]); T.push(tx[0], tx[1]); S.push(rs);
            });
            if (ring) {
                // кольцо, как у Сатурна: плоскость экватора планеты, несколько полос с щелями
                const nRing = Math.round(26000 * q);
                for (let i = 0; i < nRing; i++) {
                    let rr, band, k = 0;
                    do { k++; rr = r * (1.45 + seededRandom(i * 1.7 + k * 0.37 + seed) * 1.05); const x = rr / r; band = 0.5 + 0.25 * Math.sin(x * 23 + seed) + 0.15 * Math.sin(x * 61 + seed * 2) + 0.1 * Math.sin(x * 137); }
                    while (k < 20 && (seededRandom(i * 2.3 + k * 0.53 + seed * 3) > band || (rr > r * 2.02 && rr < r * 2.1)));   // полосы и щель Кассини
                    const a = seededRandom(i * 3.9 + seed * 5) * Math.PI * 2;
                    const l = [Math.cos(a) * rr, (seededRandom(i * 4.7) - 0.5) * r * 0.012, Math.sin(a) * rr], w = bodyLocal(l);
                    P.push(center[0] + w[0], center[1] + w[1], center[2] + w[2]);
                    L.push(l[0], l[1], l[2]); T.push(band, 2); S.push(seededRandom(i * 5.1));
                }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
            geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(L, 3));
            geo.setAttribute('aTex', new THREE.Float32BufferAttribute(T, 2));
            geo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(S, 1));
            const meshGeo = new THREE.SphereGeometry(r, 32, 24);
            bodies.push({ geo, meshGeo, r, orbit, parent, center });
        };
        ORBITS.forEach((O) => {
            const c = orbitPos(O.R, O.incl, O.node, O.phase);
            makeBody(O.planet.r, O.planet.tex, O.planet.seed, c, { R: O.R, incl: O.incl, node: O.node, phase: O.phase, omega: O.omega, spin: O.planet.spin }, null, O.planet.ring);
            if (O.moon) {
                const M = O.moon, m = orbitPos(M.R, M.incl, M.node, M.phase);
                makeBody(M.r, 'plain', 11.1, [c[0] + m[0], c[1] + m[1], c[2] + m[2]],
                    { R: M.R, incl: M.incl, node: M.node, phase: M.phase, omega: M.omega, spin: 0.1 }, O);
            }
        });

        const starMesh = new THREE.SphereGeometry(STAR_R, 64, 48);
        const rootMatrix = new THREE.Matrix4().makeTranslation(0, FIG_Y_OFFSET, 0);
        const data = { smokeGeo, smoke, coreSphereGeo, veinGeo, coreGeo, rayGeo, loopGeo, orbits, bodies, starMesh, rootMatrix };
        assignOrderAndLayout(data);
        return data;
    }

    // ==========================================
    // ПОРЯДОК РАСПАДА: от периферии (орбиты, планеты, кончики короны) к центру светила
    // ==========================================
    function assignOrderAndLayout(data) {
        const v = new THREE.Vector3();
        const dist = (x, y, z) => Math.hypot(x, y, z) + ORDER_NOISE * (Math.sin(x * 1.7 + y * 0.9) * Math.sin(z * 1.9 - y * 1.3) + 0.5 * Math.sin(x * 3.1 - z * 2.7 + y * 2.3));
        const pointGeos = [data.smokeGeo, data.coreSphereGeo, data.veinGeo, data.coreGeo, data.rayGeo, data.loopGeo].concat(data.orbits.map(o => o.geo), data.bodies.map(b => b.geo));
        const meshGeos = [data.starMesh].concat(data.bodies.map(b => b.meshGeo));
        let dMin = Infinity, dMax = -Infinity;
        pointGeos.forEach(g => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const d = dist(p.getX(i), p.getY(i), p.getZ(i)); if (d < dMin) dMin = d; if (d > dMax) dMax = d; } });
        const toOrder = (d) => 1 - Math.pow(Math.min(1, Math.max(0, (d - dMin) / (dMax - dMin))), ORDER_CURVE);
        const rests = pointGeos.map(g => {
            const p = g.attributes.position, n = p.count, order = new Float32Array(n), rest = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                order[i] = toOrder(dist(p.getX(i), p.getY(i), p.getZ(i)));
                v.fromBufferAttribute(p, i).applyMatrix4(data.rootMatrix);
                rest[i * 3] = v.x; rest[i * 3 + 1] = v.y; rest[i * 3 + 2] = v.z;
            }
            g.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
            return { geometry: g, rest };
        });
        // Поверхности: светило — по своему радиусу, планеты — по радиусу своей орбиты (уходят первыми).
        meshGeos.forEach((g, gi) => {
            const n = g.attributes.position.count, order = new Float32Array(n);
            const b = gi > 0 ? data.bodies[gi - 1] : null, c = b ? b.center : [0, 0, 0];
            const p = g.attributes.position;
            for (let i = 0; i < n; i++) order[i] = toOrder(dist(p.getX(i) + c[0], p.getY(i) + c[1], p.getZ(i) + c[2]));
            g.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
        });
        data.layout = DP.morph.createLayout(rests);
    }

    // ==========================================
    // МАТЕРИАЛЫ
    // ==========================================
    function createMaterials(ctx, data) {
        const G = DP.morph.glsl;
        const morphUniforms = DP.morph.uniformsFor(ctx.uniforms);
        const S = DP.shared;
        const list = [];
        const add = (m) => { list.push(m); return m; };
        const pointsBase = (extra) => Object.assign({}, DP.pointsMaterialConfig, extra);
        const common = { uTime: S.uTime, uDepth: { value: new THREE.Vector2(8.1, 0.4) }, uStarR: { value: STAR_R },
                         uTexture: S.uTexture, uViewportScale: S.uViewportScale };
        const pts = (vs, fs, extra) => add(new THREE.ShaderMaterial(pointsBase({
            uniforms: Object.assign({}, common, extra, morphUniforms), vertexShader: vs(G), fragmentShader: fs(G)
        })));

        const veins = pts(veinVertex, veinFragment, { uSize: { value: 1.7 } });
        const core = pts(coreVertex, coreFragment, { uSize: { value: 2.2 } });
        const rays = pts(rayVertex, rayFragment, { uSize: { value: 1.6 } });
        const loops = pts(loopVertex, loopFragment, { uSize: { value: 2.0 } });
        const orbits = data.orbits.map(o => pts(orbitVertex, orbitFragment, { uSize: { value: 2.0 }, uPlanet: { value: new THREE.Vector4(o.O.phase, o.O.omega, 0, 0) } }));
        const bodyUniforms = (b) => ({
            uOrbit: { value: new THREE.Vector4(b.orbit.R, b.orbit.incl, b.orbit.node, b.orbit.phase) },
            uOrbit2: { value: new THREE.Vector4(b.orbit.omega, b.orbit.spin, 0, 0) },
            uParent: { value: b.parent ? new THREE.Vector4(b.parent.R, b.parent.incl, b.parent.node, b.parent.phase) : new THREE.Vector4() },
            uParentOmega: { value: b.parent ? b.parent.omega : -1 },
            uBodyR: { value: b.r }
        });
        const bodies = data.bodies.map(b => pts(bodyVertex, bodyFragment, Object.assign({ uSize: { value: 1.9 } }, bodyUniforms(b))));

        // Поверхности (MESH): светило и планеты, френель; планеты движутся так же, как точки.
        const meshFrag = `
            ${G.meshFragment}
            varying vec3 vNormal, vViewPosition;
            varying float vLit;
            void main() {
                float dpGlow = dpMeshGlow();
                float fresnel = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 1.4);
                vec3 color = mix(vec3(0.03, 0.07, 0.14), vec3(0.75, 0.9, 1.0), fresnel * 1.2 + 0.25 * vLit);
                gl_FragColor = vec4(color + dpGlow * vec3(0.45, 0.7, 1.0), 0.55 + 0.3 * vLit);
            }
        `;
        const starMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${G.meshVertex} uniform float uTime; varying vec3 vNormal, vViewPosition; varying float vLit;
                void main(){ vDpOrder = aOrder; vLit = 1.0; vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mv.xyz; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: meshFrag, transparent: true, depthWrite: false
        }));
        const bodyMeshes = data.bodies.map(b => add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, bodyUniforms(b), morphUniforms),
            vertexShader: `${G.meshVertex} uniform float uTime; ${orbitGlsl} ${bodyPars}
                varying vec3 vNormal, vViewPosition; varying float vLit;
                void main(){ vDpOrder = aOrder; vec3 c = dpBodyCenter(uTime); vec3 l = dpBodyLocal(position, uTime);
                vLit = smoothstep(-0.2, 0.45, dot(normalize(l), normalize(-c)));
                vec4 mv = modelViewMatrix * vec4(c + l, 1.0); vViewPosition = -mv.xyz;
                vNormal = normalize(normalMatrix * normalize(l)); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: meshFrag, transparent: true, depthWrite: false
        })));

        return { list, veins, core, rays, loops, orbits, bodies, starMesh, bodyMeshes };
    }

    // ==========================================
    // ДЫМНАЯ СФЕРА: симуляция на видеокарте (своя у каждого экземпляра)
    // ==========================================
    const coreVec = new THREE.Vector4(), blinkVec = new THREE.Vector2();
    function createSmokeSim(data) {
        const renderer = DP.stage.renderer, caps = renderer.capabilities, ext = renderer.extensions;
        const vtf = caps.maxVertexTextures > 0;
        let type = THREE.FloatType;
        if (caps.isWebGL2) { if (!ext.has('EXT_color_buffer_float')) type = THREE.HalfFloatType; }
        else if (!ext.has('WEBGL_color_buffer_float')) type = ext.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : null;
        if (!vtf || !type) return null;                       // нет рендера в float-текстуры → прежние прожилки
        const N = data.smoke.N;
        if (!data.smoke.initTex) {
            data.smoke.initTex = new THREE.DataTexture(data.smoke.init, N, N, THREE.RGBAFormat, THREE.FloatType); data.smoke.initTex.needsUpdate = true;
            data.smoke.infoTex = new THREE.DataTexture(data.smoke.info, N, N, THREE.RGBAFormat, THREE.FloatType); data.smoke.infoTex.needsUpdate = true;
        }
        const rt = () => new THREE.WebGLRenderTarget(N, N, { type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
        const targets = [rt(), rt()];
        const simMat = new THREE.ShaderMaterial({
            uniforms: { uPos: { value: data.smoke.initTex }, uInfo: { value: data.smoke.infoTex }, uTime: { value: 0 }, uDt: { value: 0 },
                        uR: { value: STAR_R }, uGather: { value: 0 }, uEmit: { value: new THREE.Vector4() }, uFlare: { value: new THREE.Vector4() }, uNoise: { value: new THREE.Vector4() }, uShell: { value: new THREE.Vector4() }, uLife: { value: new THREE.Vector4() } },
            vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: smokeSimFrag(N), depthTest: false, depthWrite: false
        });
        const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat); quad.frustumCulled = false; scene.add(quad);
        let cur = 0, first = true, simTime = 0;
        const life = { value: new THREE.Vector4() }, look = { value: new THREE.Vector4() }, look2 = { value: new THREE.Vector4() }, pos = { value: data.smoke.initTex };
        function sync() {
            const S = DP.config.starSmoke, u = simMat.uniforms;
            u.uNoise.value.set(S.noiseAmp, S.noiseScale, S.detailAmp, S.detailScale);
            u.uShell.value.set(S.spring, S.radial, S.spin, S.noiseSpeed);
            u.uGather.value = S.gather;
            u.uEmit.value.set(S.emitShare, S.emitSpin, S.emitDrag, S.emitSize);
            u.uFlare.value.set(S.flare, S.flareLift, S.flareZone, S.fieldSpin);
            u.uLife.value.set(S.lifeMin, Math.max(S.lifeMin + 0.01, S.lifeMax), S.speed, 0);
            life.value.copy(u.uLife.value);
            look.value.set(S.fadeIn, S.fadeOut, S.grow, S.size);
            look2.value.set(S.flareAlpha, 0, 0, 0);
        }
        function step(dt) {
            if (dt <= 0) return;
            sync();
            const prev = renderer.getRenderTarget();
            const n = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 60))));
            for (let i = 0; i < n; i++) {
                const u = simMat.uniforms;
                u.uPos.value = first ? data.smoke.initTex : targets[cur].texture;
                u.uDt.value = dt / n; u.uTime.value = simTime;
                renderer.setRenderTarget(targets[1 - cur]);
                renderer.render(scene, cam);
                cur = 1 - cur; first = false; simTime += dt / n;
            }
            renderer.setRenderTarget(prev);
            pos.value = targets[cur].texture;
        }
        for (let i = 0; i < 90; i++) step(1 / 30);                // прогрев: структура дыма сразу сложилась
        // отладка: прочитать состояние частиц (xyz + возраст, +100 у всполохов)
        const read = () => { const buf = new Float32Array(N * N * 4); renderer.readRenderTargetPixels(targets[cur], 0, 0, N, N, buf); return buf; };
        DP.starSmokeSim = { read, get N() { return N; } };
        return {
            step, uniforms: { uSmokePos: pos, uSmokeInfo: { value: data.smoke.infoTex }, uSmokeLife: life, uSmokeLook: look, uSmokeLook2: look2,
                              uAlpha: { get value() { return DP.config.starSmoke.alpha; } } },
            dispose() { targets.forEach(t => t.dispose()); simMat.dispose(); }
        };
    }

    // ==========================================
    // РЕГИСТРАЦИЯ
    // ==========================================
    DP.figures.register({
        name: 'star',
        stageTilt: -0.41,     // взгляд сверху ≈25° к плоскости орбит — орбиты видны вытянутыми эллипсами
        getLayout(ctx) { return (cache[ctx.quality] || (cache[ctx.quality] = buildGeometry(ctx.qualityTier))).layout; },
        createInstance(ctx) {
            const data = cache[ctx.quality] || (cache[ctx.quality] = buildGeometry(ctx.qualityTier));
            const mats = createMaterials(ctx, data);
            const root = new THREE.Group();
            root.matrixAutoUpdate = false;
            root.matrix.copy(data.rootMatrix);
            const meshRoot = new THREE.Group();
            const pointsRoot = new THREE.Group();
            root.add(meshRoot, pointsRoot);

            const partsParam = DP.params.get('parts') || DEFAULT_PARTS;
            const show = (k) => !partsParam || partsParam.split(',').indexOf(k) >= 0;
            let sim = null;
            if (show('star')) {
                meshRoot.add(new THREE.Mesh(data.starMesh, mats.starMesh));
                {
                    const G = DP.morph.glsl, S = DP.shared, C = DP.config.starCore;
                    const uCore = { get value() { return coreVec.set(C.radius, C.size, C.noiseScale, C.speed); } };
                    const m = new THREE.ShaderMaterial(Object.assign({}, DP.pointsMaterialConfig, {
                        uniforms: Object.assign({ uTime: S.uTime, uDepth: { value: new THREE.Vector2(8.1, 0.4) }, uStarR: { value: STAR_R },
                                                  uTexture: S.uTexture, uViewportScale: S.uViewportScale, uCore,
                                                  uBlink: { get value() { return blinkVec.set(C.blinkLevel, Math.max(0.01, C.blinkSoft)); } },
                                                  uCoreAlpha: { get value() { return C.alpha; } } }, DP.morph.uniformsFor(ctx.uniforms)),
                        vertexShader: coreSphereVertex(G), fragmentShader: coreSphereFragment(G)
                    }));
                    mats.list.push(m);
                    pointsRoot.add(new THREE.Points(data.coreSphereGeo, m));
                }
                sim = createSmokeSim(data);
                if (sim) {
                    const G = DP.morph.glsl, S = DP.shared;
                    const m = new THREE.ShaderMaterial(Object.assign({}, DP.pointsMaterialConfig, {
                        uniforms: Object.assign({ uTime: S.uTime, uDepth: { value: new THREE.Vector2(8.1, 0.4) }, uStarR: { value: STAR_R },
                                                  uTexture: S.uTexture, uViewportScale: S.uViewportScale }, sim.uniforms, DP.morph.uniformsFor(ctx.uniforms)),
                        vertexShader: smokeVertex(G), fragmentShader: smokeFragment(G)
                    }));
                    mats.list.push(m);
                    pointsRoot.add(new THREE.Points(data.smokeGeo, m));
                } else pointsRoot.add(new THREE.Points(data.veinGeo, mats.veins));   // нет float-текстур
            }
            if (show('veins')) pointsRoot.add(new THREE.Points(data.veinGeo, mats.veins));
            if (show('core')) pointsRoot.add(new THREE.Points(data.coreGeo, mats.core));
            if (show('corona')) pointsRoot.add(new THREE.Points(data.rayGeo, mats.rays));
            if (show('loops')) pointsRoot.add(new THREE.Points(data.loopGeo, mats.loops));
            if (show('orbits')) data.orbits.forEach((o, i) => pointsRoot.add(new THREE.Points(o.geo, mats.orbits[i])));
            if (show('planets')) data.bodies.forEach((b, i) => {
                meshRoot.add(new THREE.Mesh(b.meshGeo, mats.bodyMeshes[i]));
                pointsRoot.add(new THREE.Points(b.geo, mats.bodies[i]));
            });

            return {
                root, meshRoot, pointsRoot, layout: data.layout,
                update(time, dt) { if (sim && root.visible) sim.step(dt); },
                dispose() { mats.list.forEach(m => m.dispose()); if (sim) sim.dispose(); }
            };
        }
    });
})(window.DP);
