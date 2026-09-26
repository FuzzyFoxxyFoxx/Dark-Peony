// ==========================================
// DARK PEONY — ФИГУРА «СЕРАФИМ» (цветок-серафим с глазами)
// ==========================================
// Набросок автора (2026-09-26): цветок, лепестки которого лежат крыльями серафима (симметрично: вверх, в стороны,
// вниз), полупрозрачные «рентгеновские» лепестки с прожилками (референс — орхидея), на лепестках глаза, большой
// глаз в центре; снизу свисают длинные усики; вокруг вращаются кольца.
// Части:
//  • лепестки — точки рядками (как у пиона), френель, прожилки и кромка ярче; машут, как крылья (волна изгиба
//    от основания к кончику, у пар свой ритм); вся фигура плавно покачивается по вертикали — парит;
//  • глаза (1 большой в центре + 6 на лепестках + 1 под центром) — веки-миндалины из точек, радужка — волокна
//    от зрачка к краю, зрачок сужается и расширяется, моргание. Поведение хамелеона: каждый глаз резко
//    переводит взгляд в свою точку; при движении мыши (пальца) все глаза фокусируются на курсоре, зрачки
//    сужаются; курсор замер — снова «хамелеон»;
//  • усики — нити из колец точек, покачиваются;
//  • кольца — наклонные кольца из точек с четырёхлучевыми звёздочками, вращаются вокруг фигуры.
// Фигура сама не вращается (faceViewer): сцена доворачивается лицом к зрителю.
(function (DP) {
    'use strict';

    const { seededRandom } = DP.util;

    const FIG_Y = 0.25;               // центр цветка (глаз) по высоте в сцене фигуры
    const STEP = 0.014;               // шаг сетки точек лепестка
    const MULT = 3;
    const MAX_EYES = 8;

    // Лепестки: угол от вертикали (рад, по часовой при взгляде спереди), длина, ширина, изгиб к зрителю, фаза взмаха.
    // Симметрично слева и справа — как крылья серафима: верхние, боковые, нижние + длинные узкие нижние.
    const PETALS = [];
    [[0.38, 2.25, 0.62, 0.35, 0.0, 0.35], [1.15, 2.05, 0.58, 0.3, 0.9, 0.3], [1.98, 1.75, 0.5, 0.25, 1.8, -0.25], [2.78, 2.4, 0.26, 0.15, 2.6, -0.3]]
        .forEach(([a, L, W, curl, ph, sw], k) => [-1, 1].forEach(side => PETALS.push({ a: a * side, L, W, curl, ph, sweep: sw * side, seed: k * 3.1 + (side > 0 ? 1.7 : 0), side })));
    // Глаза: центр (в плоскости фигуры) или на лепестке (индекс, доля длины), полуширина.
    const EYES = [
        { x: 0, y: 0, w: 0.46, main: true },
        { petal: 0, u: 0.56, w: 0.17 }, { petal: 1, u: 0.56, w: 0.17 },
        { petal: 2, u: 0.55, w: 0.16 }, { petal: 3, u: 0.55, w: 0.16 },
        { petal: 4, u: 0.55, w: 0.14 }, { petal: 5, u: 0.55, w: 0.14 },
        { x: 0, y: -0.62, w: 0.22 }
    ];
    const ORDER_NOISE = 0.25;

    // ==========================================
    // GLSL
    // ==========================================
    // Взмах лепестка: волна изгиба из плоскости, от основания к кончику; u — доля длины, L — длина.
    const flapGlsl = `
        uniform float uTime;
        float dpFlap(float u, float ph, float sd, float L) {
            float t = uTime;
            float w = sin(t * 0.9 + ph - u * 1.6) * 0.16 + sin(t * 0.55 + ph * 1.7 + sd - u * 2.4) * 0.06;
            return w * pow(u, 1.4) * L;
        }
        float dpBob() { return 0.07 * sin(uTime * 0.6) + 0.025 * sin(uTime * 1.13 + 1.3); }   // парение
    `;
    const depthGlsl = `
        uniform vec2 uDepth;
        varying float vDepthK;
    `;
    const depthVert = 'vDepthK = 1.0 - uDepth.y * smoothstep(-1.2, 1.6, dist - uDepth.x);';

    // Лепесток: aP — (u, v, фаза, seed), aL — длина.
    const petalVertex = (G) => `
        ${flapGlsl}
        ${depthGlsl}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        attribute vec4 aP;
        attribute float aL, aSizeScale, aVein;
        varying float vFresnel, vU, vV, vVein;
        void main() {
            vec3 dpRest = position;
            vec3 pos = position;
            pos.z += dpFlap(aP.x, aP.z, aP.w, aL);
            pos.y += dpBob();
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.3);
            vU = aP.x; vV = aP.y; vVein = aVein;
            gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) * (1.0 + 0.3 * aVein) / (0.35 + 0.06 * dist);
            dpMorphFinish();
        }
    `;
    const petalFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vFresnel, vU, vV, vVein, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            float edge = smoothstep(0.72, 1.0, abs(vV));
            float base = 1.0 - smoothstep(0.0, 0.25, vU);                        // у основания — свечение
            float a = tex.a * (0.07 + 0.35 * vFresnel + 0.35 * vVein + 0.5 * edge + 0.25 * base) * smoothstep(0.0, 0.06, vU);
            vec3 color = mix(vec3(0.3, 0.5, 0.8), vec3(0.82, 0.93, 1.0), 0.3 + 0.7 * vFresnel + 0.4 * vVein + 0.5 * base);
            a = a / (0.45 + a * 2.0) * vDepthK;
            gl_FragColor = dpMorphColor(color, a, tex.a);
        }
    `;

    // Глаз: aE — (индекс глаза, вид: 0 веко верхнее, 1 веко нижнее, 2 радужка, 3 лучи, 4 белок), aQ — локальные
    // (x, y) в долях полуширины глаза, aF — (фаза, seed); крепление на лепесток: aP (u, фаза, seed, длина; u<0 — нет).
    // uGaze[i] — (взгляд x, y ∈ [-1, 1], зрачок ×, раскрытие век 0..1).
    const eyeVertex = (G) => `
        ${flapGlsl}
        ${depthGlsl}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        uniform vec4 uGaze[${MAX_EYES}];
        uniform vec4 uEyeC[${MAX_EYES}];     // центр (x, y, z) и полуширина
        uniform vec4 uEyeR[${MAX_EYES}];     // x — поворот глаза в плоскости
        attribute vec4 aE, aP;
        attribute vec2 aQ, aF;
        attribute float aSizeScale;
        varying float vA, vKind;
        void main() {
            int ei = int(aE.x + 0.5);
            vec4 gz = uGaze[0], ec = uEyeC[0], er = uEyeR[0];
            for (int i = 0; i < ${MAX_EYES}; i++) if (i == ei) { gz = uGaze[i]; ec = uEyeC[i]; er = uEyeR[i]; }
            float kind = aE.y;
            float hh = 0.46;                                   // полувысота миндалины (доля полуширины)
            vec2 q = aQ;
            float open = gz.w;
            vA = 1.0;
            if (kind < 0.5) {                                  // верхнее веко опускается при моргании
                q.y = mix(-q.y * 0.9, q.y, open);
            } else if (kind < 2.5 && kind > 1.5) {             // радужка: зрачок, взгляд, обрезка веками
                float R = hh * 0.92, p0 = R * 0.36, p = p0 * gz.z;
                float r = length(q), ang = atan(q.y, q.x);
                float r2 = p + (r - p0) / (R - p0) * (R - p);
                ang += 0.03 * sin(uTime * 0.7 + aF.y * 6.0);   // волокна чуть шевелятся
                q = vec2(cos(ang), sin(ang)) * r2 + gz.xy * vec2(0.5, 0.22);
                float lid = hh * (1.0 - q.x * q.x);
                float top = mix(-lid * 0.9, lid, open);
                vA = step(abs(q.x), 0.98) * smoothstep(-0.02, 0.02, top - q.y) * smoothstep(-0.02, 0.02, q.y + lid);
            } else if (kind > 3.5) {                           // белок: едва заметен, тоже закрывается
                float lid = hh * (1.0 - q.x * q.x);
                vA = smoothstep(-0.02, 0.02, mix(-lid * 0.9, lid, open) - q.y);
            }
            float c = cos(er.x), s = sin(er.x);
            vec3 loc = vec3(q.x * c - q.y * s, q.x * s + q.y * c, 0.0) * ec.w;
            vec3 pos = ec.xyz + loc + vec3(0.0, 0.0, 0.01);
            if (aP.x >= 0.0) pos.z += dpFlap(aP.x, aP.y, aP.z, aP.w);
            pos.y += dpBob();
            vec3 dpRest = position;
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vKind = kind;
            float sz = kind < 1.5 ? 1.25 : (kind < 2.5 ? 1.0 : 0.85);
            gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) * sz / (0.35 + 0.06 * dist);
            if (vA < 0.01) gl_PointSize = 0.0;
            dpMorphFinish();
        }
    `;
    const eyeFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vA, vKind, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            float k = vKind < 1.5 ? 0.9 : (vKind < 2.5 ? 0.55 : (vKind < 3.5 ? 0.18 : 0.06));
            vec3 color = vKind < 1.5 ? vec3(0.9, 0.96, 1.0) : vec3(0.7, 0.86, 1.0);
            float a = tex.a * k * vA;
            a = a / (0.45 + a * 1.6) * vDepthK;
            gl_FragColor = dpMorphColor(color, a, tex.a);
        }
    `;

    // Усик: кольца точек; aT — (v вдоль 0..1, seed), качание.
    const tendrilVertex = (G) => `
        ${flapGlsl}
        ${depthGlsl}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        attribute vec2 aT;
        varying float vV, vFresnel;
        void main() {
            vec3 dpRest = position;
            float v = aT.x, sd = aT.y;
            float wv = pow(v, 1.4);
            vec3 pos = position;
            pos.x += (sin(uTime * 0.8 - v * 5.0 + sd * 3.1) * 0.16 + sin(uTime * 0.5 - v * 7.0 + sd) * 0.06) * wv;
            pos.z += (cos(uTime * 0.7 - v * 4.0 + sd * 1.7) * 0.14) * wv;
            pos.y += dpBob();
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vV = v;
            vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.2);
            gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
            dpMorphFinish();
        }
    `;
    const tendrilFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vV, vFresnel, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.02) discard;
            float a = tex.a * (0.3 + 0.4 * smoothstep(0.1, 0.85, vV)) * smoothstep(0.0, 0.05, vV) * (1.0 - smoothstep(0.88, 1.0, vV));
            a = a / (0.45 + a * 1.2) * vDepthK;
            gl_FragColor = dpMorphColor(mix(vec3(0.3, 0.5, 0.8), vec3(0.75, 0.9, 1.0), vFresnel), a, tex.a);
        }
    `;

    // Кольца: aR — (номер кольца, яркость). Кольцо вращается вокруг своей оси (uRing[i]: ось xyz, скорость).
    const ringVertex = (G) => `
        ${depthGlsl}
        ${G.pointsVertex}
        uniform float uTime, uT0, uViewportScale, uSize;
        uniform vec4 uRing[3];
        attribute vec2 aR;
        varying float vA;
        vec3 rotAxis(vec3 p, vec3 ax, float a) { float c = cos(a), s = sin(a); return p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c); }
        void main() {
            vec3 dpRest = position;
            int ri = int(aR.x + 0.5);
            vec4 R = uRing[0];
            for (int i = 0; i < 3; i++) if (i == ri) R = uRing[i];
            vec3 pos = rotAxis(position - vec3(0.0, ${FIG_Y.toFixed(3)}, 0.0), normalize(R.xyz), R.w * (uTime - uT0)) + vec3(0.0, ${FIG_Y.toFixed(3)}, 0.0);
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vA = aR.y;
            gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
            dpMorphFinish();
        }
    `;
    const ringFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        varying float vA, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            gl_FragColor = dpMorphColor(vec3(0.62, 0.8, 1.0), tex.a * vA * 1.0 * vDepthK, tex.a);
        }
    `;

    // ==========================================
    // ГЕОМЕТРИЯ
    // ==========================================
    const cache = {};
    const gauss = (k) => (seededRandom(k) + seededRandom(k * 1.7 + 0.3) + seededRandom(k * 2.9 + 0.7) - 1.5) / 1.5;

    // Точка лепестка в покое: u — вдоль (0 основание → 1 кончик), v — поперёк (−1..1).
    // Ширина: округлое «брюшко» ближе к основанию, мягко сужается к кончику.
    function petalWidth(u) { return Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.0)), 0.55) * (1 - 0.4 * u * u); }
    // Средняя линия лепестка изгибается наружу, как крыло (угол растёт к кончику: sweep).
    function petalAxis(P, u) {
        const n = 10;
        let x = 0, y = 0.08, a = P.a;
        for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n * u;
            a = P.a + P.sweep * t * t;
            x += Math.sin(a) * P.L * u / n; y += Math.cos(a) * P.L * u / n;
        }
        a = P.a + P.sweep * u * u;
        return [x, y, a];
    }
    function petalPoint(P, u, v) {
        const [ax, ay, a] = petalAxis(P, u);
        const px = Math.cos(a), py = -Math.sin(a);
        const w = petalWidth(u) * P.W, across = v * w;
        const z = P.curl * (u * u) * P.L * 0.35 + 0.12 * (v * v) * w - 0.05 * u;   // кончик к зрителю, края чашей
        return [ax + px * across, FIG_Y + ay + py * across, z];
    }

    function buildGeometry(tier) {
        const q = Math.pow(tier.petalSegments / 100, 2) * tier.petalMultiplier / 3;
        const h = STEP / Math.sqrt(q);

        // ---------- ЛЕПЕСТКИ ----------
        const pp = [], pn = [], pa = [], pl = [], ps = [], pv = [];
        const meshes = [];
        PETALS.forEach((P, k) => {
            const nU = Math.ceil(P.L / h), nV = Math.ceil(2 * P.W / h);
            let sd = k * 101.7;
            for (let i = 0; i <= nU; i++) for (let j = 0; j <= nV; j++) for (let m = 0; m < MULT; m++) {
                const u = Math.min(1, Math.max(0, (i + (seededRandom(sd += 1.1) - 0.5) * 0.8) / nU));
                const v = Math.min(1, Math.max(-1, ((j + (seededRandom(sd += 1.3) - 0.5) * 0.8) / nV) * 2 - 1));
                if (Math.abs(v) > 0.999) continue;
                const p = petalPoint(P, u, v);
                const e = 0.002;
                const pu = petalPoint(P, Math.min(1, u + e), v), pvv = petalPoint(P, u, Math.min(1, v + e));
                const a = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]], b = [pvv[0] - p[0], pvv[1] - p[1], pvv[2] - p[2]];
                let nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0];
                const nl = Math.hypot(nx, ny, nz) || 1;
                // прожилки: средняя и веер боковых, чуть волнистые
                let vein = Math.exp(-v * v / 0.0025);
                [0.28, 0.52, 0.76].forEach(vk => { const vv = Math.abs(v) - vk * (0.6 + 0.4 * u) - 0.02 * Math.sin(u * 9 + k); vein = Math.max(vein, 0.7 * Math.exp(-vv * vv / 0.0012)); });
                pp.push(p[0], p[1], p[2]); pn.push(nx / nl, ny / nl, nz / nl);
                pa.push(u, v, P.ph, P.seed); pl.push(P.L); ps.push(seededRandom(sd += 0.9)); pv.push(vein * (0.5 + 0.5 * u));
            }
            // поверхность (MESH)
            const mg = new THREE.PlaneGeometry(1, 1, 24, 12), mp = mg.attributes.position;
            const mo = new Float32Array(mp.count);
            for (let i = 0; i < mp.count; i++) {
                const u = mp.getX(i) + 0.5, v = mp.getY(i) * 2, pt = petalPoint(P, u, v);
                mp.setXYZ(i, pt[0], pt[1], pt[2]); mo[i] = 0;
            }
            mg.computeVertexNormals();
            meshes.push(mg);
        });
        const petalGeo = new THREE.BufferGeometry();
        petalGeo.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
        petalGeo.setAttribute('normal', new THREE.Float32BufferAttribute(pn, 3));
        petalGeo.setAttribute('aP', new THREE.Float32BufferAttribute(pa, 4));
        petalGeo.setAttribute('aL', new THREE.Float32BufferAttribute(pl, 1));
        petalGeo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(ps, 1));
        petalGeo.setAttribute('aVein', new THREE.Float32BufferAttribute(pv, 1));

        // ---------- ГЛАЗА ----------
        const eyes = EYES.map((E, i) => {
            if (E.petal == null) return { c: [E.x, FIG_Y + E.y, 0.06], w: E.w, roll: 0, att: [-1, 0, 0, 0], main: !!E.main };
            const P = PETALS[E.petal], c = petalPoint(P, E.u, 0);
            return { c: [c[0], c[1], c[2] + 0.02], w: E.w, roll: 0, att: [E.u, P.ph, P.seed, P.L] };
        });
        const ep = [], ee = [], eq = [], ef = [], eatt = [], es = [];
        const hh = 0.46;
        eyes.forEach((E, i) => {
            const push = (kind, x, y, sd) => {
                const c = Math.cos(E.roll), s = Math.sin(E.roll);
                ep.push(E.c[0] + (x * c - y * s) * E.w, E.c[1] + (x * s + y * c) * E.w, E.c[2]);
                ee.push(i, kind, 0, 0); eq.push(x, y); ef.push(seededRandom(sd), seededRandom(sd * 1.7)); eatt.push(...E.att); es.push(seededRandom(sd * 2.3));
            };
            const dens = (E.main ? 1 : 0.6) * Math.sqrt(q);
            let sd = i * 977.1;
            // веки: верхнее и нижнее — миндалина, по 3 ряда
            const nL = Math.round(260 * dens * (E.main ? 1 : 0.8));
            for (let k = 0; k < nL; k++) for (let row = 0; row < 3; row++) {
                const x = (k / (nL - 1)) * 2 - 1, yy = hh * (1 - x * x) + (row - 1) * 0.012;
                push(0, x, yy, sd += 1.1); push(1, x, -yy, sd += 1.1);
            }
            // радужка: волокна от зрачка к краю
            const R = hh * 0.92, p0 = R * 0.36, nF = Math.round(220 * dens), nP = Math.round(26 * dens + 6);
            for (let f = 0; f < nF; f++) {
                const a0 = f / nF * Math.PI * 2 + (seededRandom(sd += 1.3) - 0.5) * 0.03;
                const wav = seededRandom(sd += 1.7) * 6.28;
                for (let k = 0; k < nP; k++) {
                    const t = k / (nP - 1), r = p0 + (R - p0) * t;
                    const a = a0 + 0.05 * Math.sin(t * 7 + wav);
                    if (seededRandom(sd += 0.7) < 0.2) continue;
                    push(2, Math.cos(a) * r, Math.sin(a) * r, sd += 0.3);
                }
            }
            // белок — редкие точки внутри миндалины
            for (let k = 0; k < Math.round(260 * dens); k++) {
                const x = seededRandom(sd += 1.9) * 2 - 1, y = (seededRandom(sd += 2.1) * 2 - 1) * hh * (1 - x * x);
                if (Math.hypot(x, y) < R) continue;
                push(4, x, y, sd += 0.5);
            }
            // лучи вокруг большого глаза
            if (E.main) {
                for (let k = 0; k < 90; k++) {
                    const a = k / 90 * Math.PI * 2 + (seededRandom(sd += 1.1) - 0.5) * 0.04;
                    const len = 0.35 + Math.pow(seededRandom(sd += 1.3), 2) * 1.1;
                    const n = Math.round(len * 90 * Math.sqrt(q));
                    for (let j = 0; j < n; j++) {
                        const r = 1.12 + (j / n) * len;
                        const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.62;
                        push(3, x, y, sd += 0.4);
                    }
                }
            }
        });
        const eyeGeo = new THREE.BufferGeometry();
        eyeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
        eyeGeo.setAttribute('aE', new THREE.Float32BufferAttribute(ee, 4));
        eyeGeo.setAttribute('aQ', new THREE.Float32BufferAttribute(eq, 2));
        eyeGeo.setAttribute('aF', new THREE.Float32BufferAttribute(ef, 2));
        eyeGeo.setAttribute('aP', new THREE.Float32BufferAttribute(eatt, 4));
        eyeGeo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(es, 1));

        // ---------- УСИКИ ----------
        const tp = [], tn = [], tt = [];
        const TEND = [[-0.12, 2.6, 0.5], [0.1, 2.9, 1.7], [-0.3, 2.2, 3.1], [0.28, 2.4, 4.3], [0.0, 3.2, 5.6]];
        TEND.forEach(([x0, len, sdd]) => {
            const nR = Math.round(len / 0.032), nP = 12;
            for (let i = 0; i < nR; i++) {
                const v = i / (nR - 1), rad = 0.035 * (1 - v * 0.85);
                const cx = x0 + Math.sin(v * 3 + sdd) * 0.08 * v, cy = FIG_Y - 0.55 - v * len, cz = 0.02 * Math.sin(v * 2 + sdd);
                for (let k = 0; k < nP; k++) {
                    const a = k / nP * Math.PI * 2 + i * 0.3;
                    tp.push(cx + Math.cos(a) * rad, cy, cz + Math.sin(a) * rad);
                    tn.push(Math.cos(a), 0, Math.sin(a)); tt.push(v, sdd);
                }
            }
        });
        const tendGeo = new THREE.BufferGeometry();
        tendGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
        tendGeo.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
        tendGeo.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 2));

        // ---------- КОЛЬЦА ----------
        const RINGS = [
            { r: 2.55, tilt: [0.25, 0, 0.1], axis: [0.1, 1, 0.15], speed: 0.07 },
            { r: 2.85, tilt: [1.2, 0.3, 0], axis: [0.3, 0.2, 1], speed: -0.05 },
            { r: 3.1, tilt: [0.6, -0.8, 0.4], axis: [1, 0.4, 0.2], speed: 0.035 }
        ];
        const rp = [], ra = [];
        RINGS.forEach((R, ri) => {
            const e = new THREE.Euler(R.tilt[0], R.tilt[1], R.tilt[2]), v = new THREE.Vector3();
            const n = Math.round(2 * Math.PI * R.r / 0.01 * Math.sqrt(q));
            for (let i = 0; i < n; i++) {
                const a = i / n * Math.PI * 2;
                v.set(Math.cos(a) * R.r, 0, Math.sin(a) * R.r).applyEuler(e);
                rp.push(v.x, v.y + FIG_Y, v.z); ra.push(ri, 0.5 + 0.5 * seededRandom(ri * 31 + i));
            }
            // четырёхлучевые звёздочки на кольце
            for (let m = 0; m < 4; m++) {
                const a = m / 4 * Math.PI * 2 + ri;
                const c = new THREE.Vector3(Math.cos(a) * R.r, 0, Math.sin(a) * R.r).applyEuler(e);
                const t1 = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).applyEuler(e), t2 = new THREE.Vector3(0, 1, 0).applyEuler(e);
                [t1, t2].forEach(t => { for (let k = -14; k <= 14; k++) { const s = k / 14, L = 0.12 * (1 - Math.abs(s) * 0.2);
                    v.copy(c).addScaledVector(t, s * L); rp.push(v.x, v.y + FIG_Y, v.z); ra.push(ri, 1.6 * (1 - Math.abs(s))); } });
            }
        });
        const ringGeo = new THREE.BufferGeometry();
        ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        ringGeo.setAttribute('aR', new THREE.Float32BufferAttribute(ra, 2));

        const rootMatrix = new THREE.Matrix4();
        const data = { petalGeo, eyeGeo, tendGeo, ringGeo, meshes, eyes, RINGS, rootMatrix };
        assignOrderAndLayout(data);
        return data;
    }

    // Порядок распада: от периферии (кольца, кончики, усики) к центральному глазу.
    function assignOrderAndLayout(data) {
        const dist = (x, y, z) => Math.hypot(x, y - FIG_Y, z) + ORDER_NOISE * (Math.sin(x * 1.7 + y * 0.9) * Math.sin(z * 1.9 - y * 1.3) + 0.5 * Math.sin(x * 3.1 - z * 2.7 + y * 2.3));
        const geos = [data.petalGeo, data.eyeGeo, data.tendGeo, data.ringGeo];
        let dMin = Infinity, dMax = -Infinity;
        geos.concat(data.meshes).forEach(g => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const d = dist(p.getX(i), p.getY(i), p.getZ(i)); if (d < dMin) dMin = d; if (d > dMax) dMax = d; } });
        const toOrder = (d) => 1 - Math.pow(Math.min(1, Math.max(0, (d - dMin) / (dMax - dMin))), 0.6);
        const setOrder = (g) => { const p = g.attributes.position, o = new Float32Array(p.count); for (let i = 0; i < p.count; i++) o[i] = toOrder(dist(p.getX(i), p.getY(i), p.getZ(i))); g.setAttribute('aOrder', new THREE.BufferAttribute(o, 1)); };
        geos.forEach(setOrder); data.meshes.forEach(setOrder);
        data.layout = DP.morph.createLayout(geos.map(g => ({ geometry: g, rest: Float32Array.from(g.attributes.position.array) })));
    }

    // ==========================================
    // ГЛАЗА: хамелеон ↔ фокус на курсоре
    // ==========================================
    const pointer = { x: 0, y: 0, t: -1e9 };
    const onMove = (e) => { const p = e.touches ? e.touches[0] : e; pointer.x = p.clientX; pointer.y = p.clientY; pointer.t = performance.now() / 1000; };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });

    function createGaze(data) {
        const n = data.eyes.length, rnd = Math.random;
        const st = data.eyes.map(() => ({ x: 0, y: 0, tx: 0, ty: 0, next: 0, p: 1, tp: 1, open: 1, blinkAt: 2 + rnd() * 5, blinkT: -1 }));
        const gaze = [], v = new THREE.Vector3();
        for (let i = 0; i < MAX_EYES; i++) gaze.push(new THREE.Vector4(0, 0, 1, 1));
        let focused = false;
        function update(T, dt, root) {
            const now = performance.now() / 1000;
            const focus = now - pointer.t < 1.6;
            if (focus && !focused) st.forEach(s => { s.tp = 0.62; });            // навелись — зрачки сузились
            focused = focus;
            st.forEach((s, i) => {
                if (focus) {
                    // направление от глаза к курсору на экране
                    const E = data.eyes[i];
                    v.set(E.c[0], E.c[1], E.c[2]).applyMatrix4(root.matrixWorld).project(DP.stage.camera);
                    const ex = (v.x + 1) / 2 * innerWidth, ey = (1 - v.y) / 2 * innerHeight;
                    const dx = pointer.x - ex, dy = ey - pointer.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / (innerHeight * 0.3));
                    s.tx = dx / d * k; s.ty = dy / d * k;
                    if (T > s.next) { s.tp = 0.7 + rnd() * 0.15; s.next = T + 0.8 + rnd(); }
                } else if (T > s.next) {                                         // хамелеон: каждый глаз — своя точка
                    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
                    s.tx = Math.cos(a) * r; s.ty = Math.sin(a) * r;
                    s.next = T + 0.4 + rnd() * 2.2;
                    if (rnd() < 0.35) s.tp = 0.8 + rnd() * 0.55;
                }
                const k = Math.min(1, dt * 26);                                  // резкий перевод взгляда (саккада)
                s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k;
                s.p += (s.tp - s.p) * Math.min(1, dt * 3);
                if (s.blinkT < 0 && T > s.blinkAt) s.blinkT = 0;                 // моргание
                if (s.blinkT >= 0) {
                    s.blinkT += dt;
                    const b = s.blinkT / 0.18;
                    s.open = b < 0.5 ? 1 - b * 2 : Math.min(1, (b - 0.5) * 2);
                    if (b >= 1) { s.blinkT = -1; s.open = 1; s.blinkAt = T + 2.5 + rnd() * 6; }
                }
                gaze[i].set(s.x, s.y, s.p, 0.03 + 0.97 * s.open);
            });
        }
        return { gaze, update };
    }

    // ==========================================
    // МАТЕРИАЛЫ И ЭКЗЕМПЛЯР
    // ==========================================
    DP.figures.register({
        name: 'seraph',
        stageTilt: -0.81,        // плоскость цветка — лицом к камере
        faceViewer: true,        // сама не вращается: сцена доворачивается лицом к зрителю
        getLayout(ctx) { return (cache[ctx.quality] || (cache[ctx.quality] = buildGeometry(ctx.qualityTier))).layout; },
        createInstance(ctx) {
            const data = cache[ctx.quality] || (cache[ctx.quality] = buildGeometry(ctx.qualityTier));
            const G = DP.morph.glsl, S = DP.shared, mu = DP.morph.uniformsFor(ctx.uniforms);
            const list = [];
            const common = { uTime: S.uTime, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uDepth: { value: new THREE.Vector2(8.1, 0.35) } };
            const mat = (vs, fs, extra) => { const m = new THREE.ShaderMaterial(Object.assign({}, DP.pointsMaterialConfig, {
                uniforms: Object.assign({}, common, extra, mu), vertexShader: vs(G), fragmentShader: fs(G) })); list.push(m); return m; };
            const gz = createGaze(data);
            const eyeC = [], eyeR = [];
            for (let i = 0; i < MAX_EYES; i++) {
                const E = data.eyes[i] || data.eyes[0];
                eyeC.push(new THREE.Vector4(E.c[0], E.c[1], E.c[2], E.w)); eyeR.push(new THREE.Vector4(E.roll, 0, 0, 0));
            }
            const uT0 = { value: 0 };
            const mPetal = mat(petalVertex, petalFragment, { uSize: { value: 2.0 } });
            const mEye = mat(eyeVertex, eyeFragment, { uSize: { value: 1.9 }, uGaze: { value: gz.gaze }, uEyeC: { value: eyeC }, uEyeR: { value: eyeR } });
            const mTend = mat(tendrilVertex, tendrilFragment, { uSize: { value: 2.0 } });
            const ringU = data.RINGS.map(R => new THREE.Vector4(R.axis[0], R.axis[1], R.axis[2], R.speed));
            const mRing = mat(ringVertex, ringFragment, { uSize: { value: 2.0 }, uRing: { value: ringU }, uT0 });

            const root = new THREE.Group();
            const meshRoot = new THREE.Group(), pointsRoot = new THREE.Group();
            root.add(meshRoot, pointsRoot);
            pointsRoot.add(new THREE.Points(data.petalGeo, mPetal), new THREE.Points(data.eyeGeo, mEye),
                           new THREE.Points(data.tendGeo, mTend), new THREE.Points(data.ringGeo, mRing));
            const meshMat = new THREE.ShaderMaterial({
                uniforms: Object.assign({}, mu),
                vertexShader: `${G.meshVertex} varying vec3 vN, vV; void main(){ vDpOrder = aOrder; vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
                fragmentShader: `${G.meshFragment} varying vec3 vN, vV; void main(){ float g = dpMeshGlow();
                    float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.4);
                    gl_FragColor = vec4(mix(vec3(0.03, 0.07, 0.14), vec3(0.75, 0.9, 1.0), f) + g * vec3(0.45, 0.7, 1.0), 0.5); }`,
                side: THREE.DoubleSide, transparent: true, depthWrite: false
            });
            list.push(meshMat);
            data.meshes.forEach(g => meshRoot.add(new THREE.Mesh(g, meshMat)));

            let lastT = -1e9;
            return {
                root, meshRoot, pointsRoot, layout: data.layout,
                update(time, dt) {
                    if (time - lastT > 0.25) uT0.value = time;          // появилась — кольца с начального положения
                    lastT = time;
                    gz.update(time, dt, root);
                },
                dispose() { list.forEach(m => m.dispose()); }
            };
        }
    });
})(window.DP);
