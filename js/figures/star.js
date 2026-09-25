// ==========================================
// DARK PEONY — ФИГУРА «СВЕТИЛО» (планетарная система)
// ==========================================
// Части:
//  • светило — два слоя сферы из точек (рядками, как купол медузы): по поверхности медленно плывут вспышки
//    и грануляция, край светится (френель); второй слой не даёт центру «провалиться»;
//  • корона — частицы непрерывно уходят от поверхности радиально (гуще — в лучах-стримерах), слегка
//    изгибаются и гаснут вдали;
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

    const CORONA_COUNT = 220000;
    const STREAMERS = 16;              // лучей короны
    const LOOP_COUNT = 8;              // протуберанцев
    const LOOP_POINTS = 5000;

    // Орбиты: радиус, наклон, долгота узла, фаза, угловая скорость (внутренние быстрее), планета.
    const ORBITS = [
        { R: 1.75, incl: 0.10, node: 0.4, phase: 0.6, omega: 0.21,
          planet: { r: 0.14, tex: 'craters', spin: 0.25, seed: 1.3 } },
        { R: 2.45, incl: -0.14, node: 2.1, phase: 3.4, omega: 0.13,
          planet: { r: 0.2, tex: 'continents', spin: 0.3, seed: 4.7 },
          moon: { R: 0.38, incl: 0.3, node: 1.0, phase: 1.2, omega: 0.7, r: 0.055 } },
        { R: 3.05, incl: 0.2, node: 4.2, phase: 5.3, omega: 0.085,
          planet: { r: 0.17, tex: 'bands', spin: 0.35, seed: 7.9 } }
    ];
    const PLANET_AXIS_TILT = 0.4;

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

    // Светило: точки на сфере; вспышки и грануляция — шум, привязанный к вращающейся поверхности.
    const starVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        attribute float aSizeScale, aLayer;
        varying float vFresnel, vFlash, vGran, vLayer;
        void main() {
            vec3 dpRest = position;
            vec3 n = normalize(position);
            float a = uTime * ${STAR_SPIN.toFixed(3)};
            vec3 q = vec3(n.x * cos(a) - n.z * sin(a), n.y, n.x * sin(a) + n.z * cos(a));   // поверхность вращается
            float t = uTime;
            // крупные вспышки: медленно всплывают и гаснут; мелкая грануляция «кипит»
            float f = dpSnoise(q * 2.1 + vec3(0.0, t * 0.12, aLayer * 7.3)) * 0.7 + dpSnoise(q * 4.3 - vec3(t * 0.09, 0.0, 0.0)) * 0.3;
            vFlash = smoothstep(0.1, 0.7, f);
            vGran = 0.5 + 0.5 * dpSnoise(q * 11.0 + vec3(t * 0.35, aLayer * 3.1, 0.0));
            vec3 pos = position * (1.0 + 0.012 * (vFlash - 0.3) + 0.006 * vGran);
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * n), normalize(-mv.xyz))), 0.0, 1.0), 1.5);
            vLayer = aLayer;
            gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) * (1.0 + 0.4 * vFlash) / (0.35 + 0.06 * dist);
            dpMorphFinish();
        }
    `;
    const starFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vFresnel, vFlash, vGran, vLayer, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            // лицевая сторона не проваливается: базовая видимость + вспышки + грануляция; край — френель
            float a = tex.a * (0.2 + 0.14 * vGran + 0.9 * vFlash + 0.5 * vFresnel) * (vLayer > 0.5 ? 0.8 : 1.0);
            vec3 color = mix(vec3(0.3, 0.52, 0.8), vec3(0.8, 0.92, 1.0), 0.35 + 0.5 * vFresnel + 0.2 * vGran);
            color = mix(color, vec3(0.97, 0.99, 1.0), vFlash * 0.8);
            a = a / (0.45 + a * 2.0) * vDepthK;
            gl_FragColor = dpMorphColor(color, a, tex.a);
        }
    `;

    // Корона: частица бежит от поверхности наружу (u 0 → 1) и гаснет; по кругу — снова у поверхности.
    // aC: x — фаза, y — скорость, z — длина пути, w — изгиб.
    const coronaVertex = (G) => `
        ${commonPars}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        attribute vec4 aC;
        attribute float aSizeScale;
        varying float vA;
        void main() {
            vec3 dpRest = position;
            vec3 d0 = normalize(position);
            float a = uTime * ${STAR_SPIN.toFixed(3)};
            vec3 d = vec3(d0.x * cos(a) - d0.z * sin(a), d0.y, d0.x * sin(a) + d0.z * cos(a));
            float u = fract(aC.x + uTime * aC.y);
            // изгиб: плавное поле, одинаковое для соседей — лучи колышутся, а не рассыпаются
            vec3 np = d * 1.6 + vec3(0.0, uTime * 0.05, 0.0);
            vec3 defl = vec3(dpSnoise(np), dpSnoise(np + vec3(5.2, 1.3, 2.8)), dpSnoise(np + vec3(9.1, 4.7, 7.3)));
            d = normalize(d + defl * aC.w * u);
            vec3 pos = d * (uStarR * 1.01 + pow(u, 1.25) * aC.z);
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vA = smoothstep(0.0, 0.06, u) * pow(1.0 - u, 1.6) * dpBehindStar(mv.xyz);
            gl_PointSize = uSize * uViewportScale * (0.6 + aSizeScale * 0.6) / (0.4 + 0.06 * dist);
            dpMorphFinish();
        }
    `;
    const coronaFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        uniform float uAlpha;
        varying float vA, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            float a = tex.a * vA * uAlpha * vDepthK;
            gl_FragColor = dpMorphColor(mix(vec3(0.45, 0.66, 0.95), vec3(0.85, 0.94, 1.0), vA), a, tex.a);
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
            // тело непрозрачное: задняя половина не видна (иначе фактура двух сторон смешивается в кашу)
            vDepthK *= dpBehindStar(mv.xyz) * smoothstep(-0.08, 0.15, facing);
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

        // ---------- СВЕТИЛО: два слоя ----------
        const sp = [], sl = [], ss = [];
        [[STAR_R, 0], [STAR_R * 0.95, 1]].forEach(([R, layer]) => spherePoints(R, q * (layer ? 0.8 : 1), (x, y, z, r) => {
            sp.push(x * R, y * R, z * R); sl.push(layer); ss.push(r);
        }));
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        starGeo.setAttribute('aLayer', new THREE.Float32BufferAttribute(sl, 1));
        starGeo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(ss, 1));

        // ---------- КОРОНА ----------
        const streamers = [];
        for (let k = 0; k < STREAMERS; k++) streamers.push({ d: randomDir(k * 5.3 + 2), w: 0.08 + seededRandom(k * 3.1) * 0.14, len: 1.3 + seededRandom(k * 7.7) * 1.3 });
        const nC = Math.round(CORONA_COUNT * q);
        const cp = new Float32Array(nC * 3), cc = new Float32Array(nC * 4), cs = new Float32Array(nC);
        const tmp = new THREE.Vector3();
        for (let i = 0; i < nC; i++) {
            let d, len;
            if (seededRandom(i * 1.31 + 5) < 0.55) {     // в луче: разброс вокруг оси луча
                const S = streamers[Math.floor(seededRandom(i * 2.07 + 6) * STREAMERS)];
                const t1 = new THREE.Vector3().crossVectors(S.d, Math.abs(S.d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
                const t2 = new THREE.Vector3().crossVectors(S.d, t1);
                d = S.d.clone().addScaledVector(t1, gauss(i * 3.3 + 7) * S.w).addScaledVector(t2, gauss(i * 4.1 + 8) * S.w).normalize();
                len = S.len * (0.6 + 0.6 * seededRandom(i * 5.7 + 9));
            } else {
                d = randomDir(i * 6.3 + 10);
                len = 0.45 + 0.65 * seededRandom(i * 7.1 + 11);
            }
            const u0 = seededRandom(i * 8.9 + 12);
            tmp.copy(d).multiplyScalar(STAR_R * 1.01 + Math.pow(u0, 1.25) * len);
            cp[i * 3] = tmp.x; cp[i * 3 + 1] = tmp.y; cp[i * 3 + 2] = tmp.z;
            cc[i * 4] = u0;
            cc[i * 4 + 1] = (0.08 + 0.08 * seededRandom(i * 9.7 + 13)) * (1.2 / (len + 0.3));   // путь ≈ 6–12 с
            cc[i * 4 + 2] = len;
            cc[i * 4 + 3] = 0.15 + 0.3 * seededRandom(i * 10.3 + 14);
            cs[i] = seededRandom(i * 11.9 + 15);
        }
        const coronaGeo = new THREE.BufferGeometry();
        coronaGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
        coronaGeo.setAttribute('aC', new THREE.BufferAttribute(cc, 4));
        coronaGeo.setAttribute('aSizeScale', new THREE.BufferAttribute(cs, 1));

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
        const makeBody = (r, kind, seed, center, orbit, parent) => {
            const craters = [];
            if (kind === 'craters') for (let k = 0; k < 26; k++) { const d = randomDir(seed * 31 + k * 2.9); craters.push([d.x, d.y, d.z, 0.12 + Math.pow(seededRandom(seed * 17 + k), 2) * 0.35]); }
            const P = [], L = [], T = [], S = [];
            spherePoints(r, q * 3, (x, y, z, rs) => {      // мелкие тела — сетка втрое плотнее, иначе фактура не читается
                const tx = kind === 'plain' ? [0.75, 0] : surfaceTex(kind, x, y, z, seed, craters);
                const l = [x * r, y * r, z * r], w = bodyLocal(l);
                P.push(center[0] + w[0], center[1] + w[1], center[2] + w[2]);
                L.push(l[0], l[1], l[2]); T.push(tx[0], tx[1]); S.push(rs);
            });
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
            makeBody(O.planet.r, O.planet.tex, O.planet.seed, c, { R: O.R, incl: O.incl, node: O.node, phase: O.phase, omega: O.omega, spin: O.planet.spin }, null);
            if (O.moon) {
                const M = O.moon, m = orbitPos(M.R, M.incl, M.node, M.phase);
                makeBody(M.r, 'plain', 11.1, [c[0] + m[0], c[1] + m[1], c[2] + m[2]],
                    { R: M.R, incl: M.incl, node: M.node, phase: M.phase, omega: M.omega, spin: 0.1 }, O);
            }
        });

        const starMesh = new THREE.SphereGeometry(STAR_R, 64, 48);
        const rootMatrix = new THREE.Matrix4().makeTranslation(0, FIG_Y_OFFSET, 0);
        const data = { starGeo, coronaGeo, loopGeo, orbits, bodies, starMesh, rootMatrix };
        assignOrderAndLayout(data);
        return data;
    }

    // ==========================================
    // ПОРЯДОК РАСПАДА: от периферии (орбиты, планеты, кончики короны) к центру светила
    // ==========================================
    function assignOrderAndLayout(data) {
        const v = new THREE.Vector3();
        const dist = (x, y, z) => Math.hypot(x, y, z) + ORDER_NOISE * (Math.sin(x * 1.7 + y * 0.9) * Math.sin(z * 1.9 - y * 1.3) + 0.5 * Math.sin(x * 3.1 - z * 2.7 + y * 2.3));
        const pointGeos = [data.starGeo, data.coronaGeo, data.loopGeo].concat(data.orbits.map(o => o.geo), data.bodies.map(b => b.geo));
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

        const star = pts(starVertex, starFragment, { uSize: { value: 2.2 } });
        const corona = pts(coronaVertex, coronaFragment, { uSize: { value: 2.0 }, uAlpha: { value: 1.4 } });
        const loops = pts(loopVertex, loopFragment, { uSize: { value: 2.0 } });
        const orbits = data.orbits.map(o => pts(orbitVertex, orbitFragment, { uSize: { value: 2.0 }, uPlanet: { value: new THREE.Vector4(o.O.phase, o.O.omega, 0, 0) } }));
        const bodyUniforms = (b) => ({
            uOrbit: { value: new THREE.Vector4(b.orbit.R, b.orbit.incl, b.orbit.node, b.orbit.phase) },
            uOrbit2: { value: new THREE.Vector4(b.orbit.omega, b.orbit.spin, 0, 0) },
            uParent: { value: b.parent ? new THREE.Vector4(b.parent.R, b.parent.incl, b.parent.node, b.parent.phase) : new THREE.Vector4() },
            uParentOmega: { value: b.parent ? b.parent.omega : -1 }
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

        return { list, star, corona, loops, orbits, bodies, starMesh, bodyMeshes };
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

            meshRoot.add(new THREE.Mesh(data.starMesh, mats.starMesh));
            data.bodies.forEach((b, i) => meshRoot.add(new THREE.Mesh(b.meshGeo, mats.bodyMeshes[i])));
            pointsRoot.add(new THREE.Points(data.starGeo, mats.star));
            pointsRoot.add(new THREE.Points(data.coronaGeo, mats.corona));
            pointsRoot.add(new THREE.Points(data.loopGeo, mats.loops));
            data.orbits.forEach((o, i) => pointsRoot.add(new THREE.Points(o.geo, mats.orbits[i])));
            data.bodies.forEach((b, i) => pointsRoot.add(new THREE.Points(b.geo, mats.bodies[i])));

            return { root, meshRoot, pointsRoot, layout: data.layout, dispose() { mats.list.forEach(m => m.dispose()); } };
        }
    });
})(window.DP);
