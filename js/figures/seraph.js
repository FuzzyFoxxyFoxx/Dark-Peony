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
    // Вид глаза (ползунки ?tune — «Серафим: глаз»).
    DP.config.seraphEye = Object.assign({
        rim: 2.2, rimWidth: 0.06,      // кант по краю разреза: яркость, ширина (доли полуширины глаза)
        ball: 4.8,                   // яркость глазного яблока (в середине; к краям — в тень)
        skinBase: 0.12, skinCurve: 0.8,  // кожа: базовая видимость, свечение изгибов (френель купола)
        light: 0.8,                   // источник света (сверху-слева-спереди): сила светотени на коже и яблоке
        fadeWave: 0.25, fadeSpeed: 0.0, fadeStart: 0.05,   // переход в прозрачность: неровность контура, скорость «гуляния», где начинается спад (доля радиуса)
        // Профиль кожи по референсу автора («Simple beginner version», вид сбоку): центральный профиль (PROF_UP/PROF_LO) +
        // почти плоский краевой профиль, между ними плавный переход по x; сверху парабола (выгиб по горизонтали).
        profDepth: 1.0,               // контрастность центрального профиля относительно краевого (1 — как на референсе, 0 — без борозды)
        lidT: 0.005,                   // толщина века у разреза (зазор до яблока); к уголкам сходит на нет
        lowerSq: 1.0,                // сжатие нижнего профиля по y (S-переход в скулу ближе)
        grooveDepth: 0.13, grooveW: 0.075, grooveY: 0.72,   // борозда (орбитопальпебральная): глубина, ширина, высота — гауссов провал поверх гладкого профиля, идёт вместе со складками, к уголкам гаснет
        edgeFade: 0.035,              // ширина перехода в ноль у края разреза (локальные единицы; ≈ 3 частицы)
        lidLocal: 0.75, lidW: 0.55,   // доля движения века, локальная над роговицей (остальное — целиком), ширина изгиба по x
        lidFollow: 0.35,              // веки следят за взглядом (0 — не двигаются)
        cornea: 0.16,                 // роговица: насколько купол выступает над сферой яблока (доля радиуса)
        archDrop: 1.0,                // насколько складки повторяют форму разреза (0 — параллельны оси x)
        paraA: 1.35, paraW: 1.55, paraP: 2.6,     // парабола вид сверху: насколько кожа уходит назад к носу/уху и с какой ширины
        creaseHalf: 1.2, creaseFlat: 0.6,   // полудлина центрального профиля по x; где начинает переходить в краевой (доля)
        lidShadowTop: 0.55,           // тень верхнего века на яблоке шире, чем нижнего (меньше — шире)
        halo: 2.2,                   // ореол складки над глазом (спереди)
        lidShadow: 0.5                // тень век на яблоке: у краёв разреза яблоко темнее
    }, DP.config.seraphEye || {});
    const eyeLook = new THREE.Vector4(), eyeLook2 = new THREE.Vector4(), eyeFade = new THREE.Vector4(), eyeCr = new THREE.Vector4(), eyeCr2 = new THREE.Vector4(), eyeCr3 = new THREE.Vector4(), eyeGr = new THREE.Vector4();
    // Доводим по частям, как медузу и светило ('' — все). ?parts= в адресе важнее.
    // petals — лепестки, eye — центральный глаз, eyes — малые глаза, tendrils — усики, rings — кольца.
    const DEFAULT_PARTS = 'eye';
    const EYE_STUDY = 2.2;            // когда показан только центральный глаз — он крупнее, для разглядывания

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

    // ---------- ГЛАЗ: кожа-лоскут с разрезом + глазное яблоко (идея автора) ----------
    // Локальные единицы — полуширина глаза. Кожа — эллиптический лоскут (шире по горизонтали), выгнут куполом над
    // яблоком и к краям уходит в ноль по прозрачности; в нём продольный разрез-миндалина: верхнее и нижнее веко
    // управляются отдельно (при закрытии кожа тянется к щели). Глазное яблоко — сфера под кожей, видна только в
    // разрезе; радужка и зрачок лежат на сфере, взгляд — поворот сферы (радужка сжимается в овал, уходит под веко).
    // ОДНА поверхность из двух профилей: вертикальный профиль (по y, непрерывный от брови до скулы — не разрывается на разрезе)
    // и горизонтальный (по x: центр → уголки → край). PROF_C — центральный вертикальный профиль, СНЯТ с картинки автора
    // (лист «0°/30°/60°/90°», сторона 90°: крайние точки силуэта по строкам; масштаб — полуширина разреза 150 px = 1; z — вперёд,
    // вершина глаза 0.27): лоб → надбровье (y≈1.0) → борозда (y≈0.84, неглубокая) → толстая губа века (пик y≈0.6, z 0.24) →
    // ресничный край (y 0.44, z 0.14) → яблоко (роговица, скрыто разрезом) → край нижнего века (y −0.44, z 0.10) → нижнее веко →
    // скула. PROF_S — то же без борозды/губы/надбровья: к нему поверхность приходит у уголков и на краю (складка уходит в ноль).
    // Автор (ракурс 3/4): лишних складок нет — сверху ровно одна (губа века + борозда, повторяют контур разреза), надбровного
    // горба выше борозды нет, у нижнего века нет «мешка»: край нижнего века → ровный спуск в скулу.
    // Автор (рисунок с линиями обтекания): верхнее веко — ТОЛСТЫЙ край, доходящий до самой кромки разреза (никакой тонкой
    // «плёнки» между валиком и разрезом); из него растут ресницы. Нижнее веко — тоже толстый край, после него угол: крутой
    // спуск и потом положе, в скулу.
    // ПРОФИЛЬ = БЕЛЫЙ КОНТУР АВТОРА (2026-09-29, рисунок поверх силуэтов; снят программно, не на глаз): масштаб единый
    // (край верхнего века y 0.38 ↔ нижнего −0.34 по 366 px рисунка → 0.00197 ед/px), вершина роговицы z 0.27. На контуре: надбровье
    // (z 0.09) → борозда (первое углубление, y 0.73, z 0.05) → верхнее веко ЦЕЛИКОМ (толстое, до кромки разреза y 0.38, z 0.175,
    // пик y 0.44) → роговица (внутри разреза) → нижнее веко (толстое, пик y −0.42) → ЗАМЕТНЫЙ угол в скулу (впадина y −0.76,
    // z 0.06, дальше скула вперёд). Всё, что выходит из-под края, — это веко, а не плёнка.
    const PROF_C = [[-2.4, 0.16], [-1.6, 0.14], [-1.015, 0.116], [-0.896, 0.087], [-0.802, 0.061], [-0.755, 0.057], [-0.707, 0.067], [-0.613, 0.106],
                    [-0.518, 0.152], [-0.435, 0.181], [-0.412, 0.181], [-0.376, 0.164], [-0.341, 0.152], [-0.258, 0.191], [-0.164, 0.229], [-0.069, 0.254],
                    [0.026, 0.27], [0.12, 0.27], [0.227, 0.252], [0.321, 0.215], [0.38, 0.175], [0.416, 0.191], [0.439, 0.203], [0.51, 0.164],
                    [0.605, 0.108], [0.676, 0.071], [0.735, 0.05], [0.778, 0.077], [0.822, 0.104], [0.887, 0.123], [0.952, 0.126], [0.996, 0.099], [1.039, 0.05], [1.083, -0.004], [1.126, -0.042], [1.17, -0.061], [1.213, -0.064], [1.278, -0.061], [1.409, -0.037], [1.539, -0.002], [1.67, 0.042], [1.8, 0.091], [2.1, 0.205], [2.4, 0.319]];   // выше конца контура автора (y 1.8) — прямое продолжение его наклона, без собственных изгибов   // выше борозды — контур автора (лоб: выступ надбровья → впадина → лоб вперёд), снят с рисунка на 90°
    const PROF_S = [[-2.4, 0.16], [-1.6, 0.14], [-1.0, 0.12], [-0.5, 0.15], [0, 0.17], [0.5, 0.16], [1.0, 0.10], [1.5, 0.03], [2.4, -0.10]];
    // Оцифрованный контур автора «шумный» (точки через 0.02–0.05, гармонические касательные → скачки наклона и кривизны), а френель
    // и свет реагируют на любой излом — отсюда лишние полоски. Поэтому профиль пересобирается: линейная интерполяция точек →
    // гауссово сглаживание (sigma) → узлы через 0.1 → касательные центральными разностями (кривая Катмулла — Рома, гладкая).
    const smoothProfile = (P, sigma, step) => {
        const lin = (y) => { if (y <= P[0][0]) return P[0][1]; for (let i = 0; i < P.length - 1; i++) if (y <= P[i + 1][0]) { const t = (y - P[i][0]) / (P[i + 1][0] - P[i][0]); return P[i][1] + t * (P[i + 1][1] - P[i][1]); } return P[P.length - 1][1]; };
        const y0 = P[0][0], y1 = P[P.length - 1][0], out = [];
        for (let y = y0; y <= y1 + 1e-6; y += step) {
            let sw = 0, sz = 0;
            for (let k = -3; k <= 3; k += 0.25) { const w = Math.exp(-0.5 * k * k), yy = Math.min(y1, Math.max(y0, y + k * sigma)); sw += w; sz += w * lin(yy); }
            out.push([y, sz / sw]);
        }
        return out;
    };
    const profTangents = (P) => P.map((p, i) => {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        return new THREE.Vector3(p[0], p[1], (b[1] - a[1]) / (b[0] - a[0]));
    });
    const SMOOTH = 0.13;
    const profC = profTangents(smoothProfile(PROF_C, SMOOTH, 0.1)), profS = profTangents(smoothProfile(PROF_S, 0.2, 0.1));
    const profEval = (T, s) => {                                        // кубика Эрмита по узлам (s, z, наклон)
        s = Math.min(T[T.length - 1].x, Math.max(T[0].x, s));
        for (let i = 0; i < T.length - 1; i++) if (s <= T[i + 1].x) {
            const a = T[i], b = T[i + 1], h = b.x - a.x, t = (s - a.x) / h, t2 = t * t, t3 = t2 * t;
            return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * h * a.z + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * h * b.z;
        }
        return T[T.length - 1].y;
    };
    const profGlsl = (fn, un, n) => `
        float ${fn}(float s) {
            s = clamp(s, ${un}[0].x, ${un}[${n - 1}].x);
            float z = ${un}[${n - 1}].y;
            for (int i = 0; i < ${n - 1}; i++) { vec3 a = ${un}[i], b = ${un}[i + 1];
                if (s >= a.x && s <= b.x) { float h = b.x - a.x, t = (s - a.x) / h, t2 = t * t, t3 = t2 * t;
                    z = (2.0 * t3 - 3.0 * t2 + 1.0) * a.y + (t3 - 2.0 * t2 + t) * h * a.z + (-2.0 * t3 + 3.0 * t2) * b.y + (t3 - t2) * h * b.z; } }
            return z;
        }`;
    const smoothS = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const eyeHU = (x) => EYE.hh * Math.pow(Math.max(0, 1 - x * x), EYE.pu), eyeHL = (x) => EYE.hl * Math.pow(Math.max(0, 1 - x * x), EYE.pl);   // = eHU/eHL (GLSL): «лимончик»
    const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
    const eyeSurfZ = (x, y) => {                                        // = eSurf(...).z (GLSL), для положений точек в покое
        const C = DP.config.seraphEye, u = Math.min(1, Math.abs(x) / (C.creaseHalf * (0.95 + 0.05 * smoothS(-0.25, 0.25, y)))), arch = 0.5 * (1 - Math.cos(Math.PI * u));
        const hu = eyeHU(x), hl = eyeHL(x);
        const du = (EYE.hh - hu) * C.archDrop, dl = (EYE.hl - hl) * C.archDrop;
        let ye = y + du * smoothS(0.0, 0.12 + du * 0.8, y) - dl * smoothS(0.0, 0.12 + dl * 0.8, -y);
        ye *= 1 + (C.lowerSq - 1) * (1 - smoothS(-0.6, 0.0, y));
        const w = 1 - smoothS(C.creaseFlat, 1, u), zS = profEval(profS, ye), zC = profEval(profC, ye);
        const gg = (ye - C.grooveY) / C.grooveW, z = zS + C.profDepth * (zC - zS) * w - C.grooveDepth * w * Math.exp(-gg * gg) - C.paraA * (1 - Math.exp(-Math.pow(Math.abs(x) / C.paraW, C.paraP)));
        const R = 1.0 + C.lidT * (1 - smoothS(0.35, 1.0, Math.abs(x))), rr = x * x + y * y;   // век не уходит внутрь яблока
        return rr < R * R ? smax(z, -0.76 + Math.sqrt(R * R - rr), 0.03) : z;
    };
    DP.eyeSurfZ = (x, y) => eyeSurfZ(x, y);      // отладка: высота кожи глаза в покое (для срезов «как томограф»)
    const EYE = { ax: 2.9, ay: 2.2, hh: 0.38, hl: 0.34, pu: 0.85, pl: 1.35, rb: 1.0, zb: -0.76, iris: 0.38, pupil: 0.36,
                  lid: 0.05, flat: 0.0, hugIn: 0.85, hugOut: 1.5, fadeIn: 0.2 };   // hugIn/hugOut — доли радиуса яблока: где кожа сходит с него и где ложится на плоскость
    // Профиль кожи (набросок автора): у разреза кожа облегает яблоко с зазором lid (толщина века), дальше
    // S-образно спускается в ровную плоскость на уровне zb + flat (около середины яблока); hugIn…hugOut — где
    // облегание переходит в плоскость (эллиптический радиус).
    const eyeGlsl = `
        const float E_AX = ${EYE.ax.toFixed(3)}, E_AY = ${EYE.ay.toFixed(3)}, E_HH = ${EYE.hh.toFixed(3)}, E_HL = ${EYE.hl.toFixed(3)}, E_PU = ${EYE.pu.toFixed(3)}, E_PL = ${EYE.pl.toFixed(3)};
        const float E_RB = ${EYE.rb.toFixed(3)}, E_ZB = ${EYE.zb.toFixed(3)};
        const float E_LID = ${EYE.lid.toFixed(3)}, E_FLAT = ${EYE.flat.toFixed(3)}, E_HIN = ${EYE.hugIn.toFixed(3)}, E_HOUT = ${EYE.hugOut.toFixed(3)};
        const float E_IRIS = ${EYE.iris.toFixed(3)}, E_PUP = ${EYE.pupil.toFixed(3)};
        vec4 gLid = vec4(0.0, 0.0, 0.0, 0.55);   // веки по взгляду: центр изгиба по x (где роговица), сдвиг верхнего, сдвиг нижнего, ширина
        float lidBell(float x) { float d = (x - gLid.x) / gLid.w; return exp(-d * d); }
        vec3 gCornea = vec3(0.0);                 // положение вершины роговицы в координатах глаза (xy) и её высота (z) — для реакции век
        const vec3 E_LIGHT = vec3(0.41, -0.68, 0.61);      // свет снизу-справа-спереди: тень складки ложится НАД глазом (как складка верхнего века)
        // Разрез — «лимончик»: верхняя и нижняя кромки (полувысота у центра E_HH / E_HL, показатели E_PU / E_PL) сходятся в острые уголки.
        float eHU(float x) { return E_HH * pow(max(0.0, 1.0 - x * x), E_PU); }
        float eHL(float x) { return E_HL * pow(max(0.0, 1.0 - x * x), E_PL); }
        uniform vec4 uGroove;
        uniform vec4 uCrease, uCrease2, uCrease3;   // (profDepth, lidT, paraA, paraW); (creaseFlat, creaseHalf, -, тень верхнего века); (lowerSq, archDrop, -, -)
        uniform vec3 uVC[${profC.length}], uVS[${profS.length}];   // вертикальные профили: (y, z, наклон)
        ${profGlsl('eVC', 'uVC', profC.length)}
        ${profGlsl('eVS', 'uVS', profS.length)}
        float eSMax(float a, float b, float k) { return 0.5 * (a + b + sqrt((a - b) * (a - b) + k * k)); }
        // Кожа — ОДНА поверхность z(x, y): вертикальный профиль (борозда, надбровье, скула) непрерывен по y и не рвётся на
        // разрезе; по x центральный профиль плавно переходит в гладкий (борозда уходит в ноль к концам), арка борозды опускается
        // к уголкам (archDrop); парабола вида сверху уводит плоскость назад к носу/уху; снизу профиль сжат (lowerSq) — скула ближе.
        // Разрез (миндалина) вырезается отдельно. Век не уходит внутрь яблока: сглаженный максимум с поверхностью яблока + толщина
        // века (к уголкам → 0).
        vec3 eSurf2(vec2 r, vec2 q) {   // r — положение точки кожи в покое (профиль привязан к коже и едет с ней при моргании), q — текущее положение (яблоко, скругление)
            float u = min(1.0, abs(r.x) / (uCrease2.y * mix(0.95, 1.0, smoothstep(-0.25, 0.25, r.y))));   // низ: складка сходит в гладкий профиль раньше (у уголков нижнего века складок нет)
            // складки повторяют форму разреза: вертикальная координата профиля сдвигается на разницу между краем разреза в центре и
            // на данном x (веса плавно набираются от y = 0 до края разреза), так что линии складок идут параллельно кромке
            float hu = eHU(r.x), hl = eHL(r.x), du = (E_HH - hu) * uCrease3.y, dl = (E_HL - hl) * uCrease3.y;
            float ye = r.y + du * smoothstep(0.0, 0.12 + du * 0.8, r.y) - dl * smoothstep(0.0, 0.12 + dl * 0.8, -r.y);   // все складки сдвигаются ровно на смещение кромки — идут параллельно разрезу; у уголков профиль и так гладкий (w→0)
            ye *= 1.0 + (uCrease3.x - 1.0) * (1.0 - smoothstep(-0.6, 0.0, r.y));
            float w = 1.0 - smoothstep(uCrease2.x, 1.0, u), zS = eVS(ye);
            float gg = (ye - uGroove.x) / uGroove.y;
            float z = zS + uCrease.x * (eVC(ye) - zS) * w - uCrease3.w * w * exp(-gg * gg);
            z -= uCrease.z * (1.0 - exp(-pow(abs(r.x) / uCrease.w, uCrease3.z)));   // вид сверху: супер-гауссиана (плоская вершина, круче к краям) ≈ дуга шара
            float R = E_RB + uCrease.y * (1.0 - smoothstep(0.35, 1.0, abs(q.x))), rr = q.x * q.x + q.y * q.y;
            if (rr < R * R) {
                vec2 dc = q - gCornea.xy;
                float zA = E_ZB + sqrt(R * R - rr) + gCornea.z * exp(-dot(dc, dc) / (E_IRIS * E_IRIS * E_RB * E_RB * 3.0));   // веки облегают выпуклость роговицы
                z = eSMax(z, zA, 0.03);
            }
            return vec3(q, z);
        }
        vec3 eSurf(vec2 q) { return eSurf2(q, q); }
        float eDome(vec2 q) { return eSurf(q).z; }
        // Точка кожи из положения в покое (глаз открыт) в текущее: веко oU/oL (0 — закрыто, 1 — открыто).
        vec2 eSkin(vec2 q, float oU, float oL) {
            float x = q.x;
            if (abs(x) < 1.0) {
                float lu = eHU(x), ll = eHL(x);
                if (q.y >= 0.0) { float top = lu + 0.42 * pow(max(0.0, 1.0 - x * x), 0.8);   // борозда (верх подвижной части века): кожа для смыкания берётся оттуда, сама борозда стоит на месте
                    float y0 = lu, y1 = mix(-ll * 0.96, lu, oU + gLid.y * lidBell(q.x));
                    if (q.y > y0 && q.y < top) q.y = y1 + (q.y - y0) * (top - y1) / max(1e-3, top - y0); }
                else { float bot = -ll - 0.42 * pow(max(0.0, 1.0 - x * x), 0.8);   // граница нижнего века и скулы (неподвижная часть — скула)
                    float y0 = -ll, y1 = mix(-ll * 0.96, -ll, oL + gLid.z * lidBell(q.x));
                    if (q.y < y0 && q.y > bot) q.y = y1 + (q.y - y0) * (bot - y1) / min(-1e-3, bot - y0); }
            }
            return q;
        }
        // В разрезе ли точка (x, y) при веках oU/oL.
        float eInSlit(vec2 q, float oU, float oL) {
            float lu = eHU(q.x), ll = eHL(q.x);
            float yU = mix(-ll * 0.96, lu, oU + gLid.y * lidBell(q.x)), yL = mix(-ll * 0.96, -ll, oL + gLid.z * lidBell(q.x));
            return step(abs(q.x), 0.99) * smoothstep(-0.015, 0.015, yU - q.y) * smoothstep(-0.015, 0.015, q.y - yL);
        }
        vec3 eRotGaze(vec3 p, vec2 g) {                                                  // поворот яблока взглядом
            float yaw = g.x * 0.55, pitch = g.y * 0.42;
            float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);
            p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp);
            return vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
        }
    `;

    // Глаз: aE — (индекс глаза, вид: 0 кожа, 2 радужка, 3 лучи, 4 белок); aQ — для кожи и лучей (x, y) в покое,
    // для радужки (t вдоль волокна 0..1, азимут); aS — точка на единичной сфере яблока (белок);
    // крепление на лепесток: aP (u, фаза, seed, длина; u < 0 — нет). uGaze[i] — (взгляд x, y, зрачок ×, раскрытие век).
    const eyeVertex = (G) => `
        ${flapGlsl}
        ${depthGlsl}
        ${eyeGlsl}
        ${G.pointsVertex}
        uniform float uViewportScale, uSize;
        uniform vec4 uGaze[${MAX_EYES}];
        uniform vec4 uEyeC[${MAX_EYES}];     // центр (x, y, z) и полуширина
        uniform vec4 uEyeR[${MAX_EYES}];     // x — поворот в плоскости, y — глаз показан
        uniform float uEdgeFade, uCornea, uLidFollow, uLidLocal, uLidW;
        uniform vec4 uEyeFade;               // x — неровность контура прозрачности, y — скорость, z — где начинается спад
        attribute vec4 aE, aP;
        attribute vec2 aQ, aF;
        attribute vec3 aS;
        attribute float aSizeScale;
        uniform float uRimW;
        varying float vA, vKind, vFres, vRim, vLit, vShade, vHalo;
        void main() {
            int ei = int(aE.x + 0.5);
            vec4 gz = uGaze[0], ec = uEyeC[0], er = uEyeR[0];
            for (int i = 0; i < ${MAX_EYES}; i++) if (i == ei) { gz = uGaze[i]; ec = uEyeC[i]; er = uEyeR[i]; }
            float kind = aE.y;
            { vec3 pc = eRotGaze(vec3(0.0, 0.0, 1.0), gz.xy); gCornea = vec3(pc.xy * E_RB, uCornea * E_RB); }
            float oU = gz.w, oL = 0.82 + 0.18 * gz.w;
            {   // веки следят за взглядом: вверх — верхнее поднимается, нижнее подтягивается; вниз — верхнее опускается. Сдвиг больше всего над роговицей (колокол по x с центром там, где зрачок), у уголков меньше: при взгляде вбок веко изгибается в ту сторону
                float gu = uLidFollow * gz.y * gz.w, gl = -uLidFollow * 0.9 * max(0.0, gz.y) * gz.w + uLidFollow * 0.25 * max(0.0, -gz.y);
                gLid = vec4(sin(gz.x * 0.55) * E_RB, gu * uLidLocal, gl * uLidLocal, uLidW);
                oU += gu * (1.0 - uLidLocal); oL += gl * (1.0 - uLidLocal);
            }
            vec3 loc, nrmW = vec3(0.0, 0.0, 1.0); vA = 1.0; vFres = 0.0; vRim = 0.0; vLit = 0.0; vShade = 1.0; vHalo = 0.0;
            if (kind < 0.5) {                                  // кожа
                vec2 q = eSkin(aQ, oU, oL);
                loc = eSurf2(aQ, q);
                float e = (q.x / E_AX) * (q.x / E_AX) + (q.y / E_AY) * (q.y / E_AY);
                // прозрачность к краю лоскута: широкий мягкий переход; контур неровный — сумма синусоид с разным шагом и размахом (uEyeFade.x — размах, .y — скорость «гуляния»)
                float th = atan(q.y / E_AY, q.x / E_AX), tt = uTime * uEyeFade.y + float(ei) * 1.7;
                float wob = 0.42 * sin(2.0 * th + 1.3 + tt * 0.9) + 0.30 * sin(3.0 * th + 4.1 - tt * 0.7) + 0.20 * sin(5.0 * th + 2.2 + tt * 1.3) + 0.12 * sin(8.0 * th + 0.4 - tt * 1.1);
                float rr = sqrt(e) * (1.0 + uEyeFade.x * (0.5 + 0.5 * wob));   // контур уходит только внутрь
                vA = 1.0 - smoothstep(uEyeFade.z, 1.0, rr);
                vA *= vA;                                                   // хвост мягче
                vec2 d = vec2(eSurf2(aQ + vec2(0.08, 0.0), q + vec2(0.08, 0.0)).z - eSurf2(aQ - vec2(0.08, 0.0), q - vec2(0.08, 0.0)).z, eSurf2(aQ + vec2(0.0, 0.08), q + vec2(0.0, 0.08)).z - eSurf2(aQ - vec2(0.0, 0.08), q - vec2(0.0, 0.08)).z) / 0.16;
                vFres = length(d);                             // крутизна поверхности (сглаженная по шагу 0.08, чтобы узкие детали не давали лишних слоёв) — «френель» кожи
                vec3 nb = normalize(vec3(-d, 1.0));
                vHalo = smoothstep(0.7, 1.5, vFres) * (0.2 + 0.8 * max(0.0, -nb.y));   // ореол складки (спереди): склон круче и смотрит вниз
                // светотень — по настоящей нормали поверхности со складкой (с навесом)
                vec2 ex = vec2(0.015, 0.0), ey = vec2(0.0, 0.015);
                vec3 sx = eSurf2(aQ + ex, eSkin(aQ + ex, oU, oL)) - eSurf2(aQ - ex, eSkin(aQ - ex, oU, oL)), sy = eSurf2(aQ + ey, eSkin(aQ + ey, oU, oL)) - eSurf2(aQ - ey, eSkin(aQ - ey, oU, oL));
                vec3 nrm = normalize(cross(sx, sy));
                vLit = dot(nrm, E_LIGHT) - E_LIGHT.z;
                float c0 = cos(er.x), s0 = sin(er.x);
                nrmW = vec3(nrm.x * c0 - nrm.y * s0, nrm.x * s0 + nrm.y * c0, nrm.z);   // нормаль кожи в мировых осях — для скрытия обратных сторон
                vA *= 1.0 - eInSlit(q, oU, oL);                // в разрезе кожи нет
                // кант: край разреза подсвечен (как кромки лепестков пиона); в уголках глаза — тоже
                float lu = eHU(q.x), ll = eHL(q.x);
                float yU = mix(-ll * 0.96, lu, oU + gLid.y * lidBell(q.x)), yL = mix(-ll * 0.96, -ll, oL + gLid.z * lidBell(q.x));
                float dE = abs(q.x) < 1.0 ? (q.y >= 0.0 ? q.y - yU : yL - q.y) : length(vec2(abs(q.x) - 1.0, q.y));
                vRim = exp(-dE * dE / (uRimW * uRimW));
                vA *= smoothstep(0.0, uEdgeFade, dE);          // последние 2–3 частицы у края разреза уходят в ноль (≈ 5% → 30% → 70%): без «пикселя» на кромке
            } else if (kind < 3.5 && kind > 2.5) {             // лучи
                loc = vec3(aQ, 0.0);
            } else {                                           // яблоко: радужка / белок
                vec3 sp;
                if (kind < 2.5) {
                    float th = mix(E_IRIS * E_PUP * gz.z, E_IRIS, aQ.x);
                    float ph = aQ.y + 0.03 * sin(uTime * 0.7 + aF.y * 6.0);
                    sp = vec3(sin(th) * cos(ph), sin(th) * sin(ph), cos(th));
                } else sp = aS;
                float th0 = acos(clamp(sp.z, -1.0, 1.0));
                float cornea = 1.0 - smoothstep(0.0, E_IRIS * 1.7, th0);              // купол роговицы: гладкая «нашлёпка» на сфере (линза), плавно сходит на нет
                sp = eRotGaze(sp, gz.xy);
                loc = sp * E_RB * (1.0 + uCornea * cornea * cornea * (3.0 - 2.0 * cornea)) + vec3(0.0, 0.0, E_ZB);
                vA = smoothstep(0.2, 0.3, sp.z) * eInSlit(loc.xy, oU, oL);    // только передняя часть яблока — та, что видна в разрезе
                vFres = sp.z;                                  // яблоко: к краям уходит в тень
                vLit = dot(sp, E_LIGHT);
                float lu2 = eHU(loc.x), ll2 = eHL(loc.x), yU2 = mix(-ll2 * 0.96, lu2, oU + gLid.y * lidBell(loc.x)), yL2 = mix(-ll2 * 0.96, -ll2, oL + gLid.z * lidBell(loc.x));
                float dS = abs(loc.x) < 1.0 ? min((yU2 - loc.y) * uCrease2.w, loc.y - yL2) : 0.0;
                vShade = smoothstep(0.0, 0.32, dS);            // тень век: у края разреза темнее
            }
            float c = cos(er.x), s = sin(er.x);
            vec3 pos = ec.xyz + vec3(loc.x * c - loc.y * s, loc.x * s + loc.y * c, loc.z) * ec.w;
            if (aP.x >= 0.0) pos.z += dpFlap(aP.x, aP.y, aP.z, aP.w);
            pos.y += dpBob();
            vec3 dpRest = position;
            vec4 mv = viewMatrix * dpMorph(dpRest, pos);
            if (kind < 0.5) { float fc = dot(mat3(viewMatrix) * nrmW, normalize(-mv.xyz)); vA *= smoothstep(0.02, 0.4, fc); }   // кожа непрозрачна; на скользящем угле (ребром) точки слипаются в яркую полосу — гасим   // кожа непрозрачна: стороны, повёрнутые от камеры, скрыты
            gl_Position = projectionMatrix * mv;
            float dist = max(-mv.z, 0.1);
            ${depthVert}
            vKind = kind;
            gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) * (kind > 3.5 ? 0.7 : 1.0) / (0.35 + 0.06 * dist);
            dpMorphFinish();
            // спрятать: глаз не показан или точка закрыта (размер 0 на Metal не прячет — выносим за экран)
            if (er.y < 0.5 || vA < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
        }
    `;
    const eyeFragment = (G) => `
        ${G.pointsFragment}
        uniform sampler2D uTexture;
        uniform vec4 uEyeLook, uEyeLook2;           // x — кант, y — яркость яблока, z — кожа: база, w — кожа: изгибы
        varying float vA, vKind, vFres, vRim, vLit, vShade, vHalo, vDepthK;
        void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            if (tex.a < 0.01) discard;
            float k;
            if (vKind < 0.5) k = max(0.0, (uEyeLook.z + uEyeLook.w * min(1.0, vFres * 1.4)) * (1.0 + uEyeLook2.x * vLit * 2.2)) + uEyeLook.x * vRim + uEyeLook2.z * vHalo;   // кожа (со светотенью) + кант + ореол складки
            else if (vKind < 2.5) k = 0.5 * (0.35 + 0.65 * vFres);          // радужка: тоже темнеет к краю яблока
            else if (vKind < 3.5) k = 0.18;                                 // лучи
            else k = uEyeLook.y * (0.14 + 0.9 * pow(1.0 - max(0.0, vFres), 1.2) * (0.6 + 0.6 * uEyeLook2.x * max(0.0, vLit))) * mix(1.0, vShade, uEyeLook2.y);   // яблоко: середина почти невидима, к краям — френель (как у светила), у век — тень
            vec3 color = vKind < 2.5 && vKind > 1.5 ? vec3(0.7, 0.86, 1.0) : vec3(0.82, 0.93, 1.0);
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
        const partsNow = DP.params.get('parts') || DEFAULT_PARTS;
        const ep = [], ee = [], eq = [], ef = [], eatt = [], es = [], eS = [];
        eyes.forEach((E, i) => {
            const wShow = E.w * (E.main && partsNow === 'eye' ? EYE_STUDY : 1);     // размер на экране — для плотности точек
            const push = (kind, qx, qy, lx, ly, lz, sd, sx = 0, sy = 0, sz = 0) => {
                ep.push(E.c[0] + lx * E.w, E.c[1] + ly * E.w, E.c[2] + lz * E.w);
                ee.push(i, kind, 0, 0); eq.push(qx, qy); eS.push(sx, sy, sz);
                ef.push(seededRandom(sd), seededRandom(sd * 1.7)); eatt.push(...E.att); es.push(seededRandom(sd * 2.3));
            };
            const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
            const domeC = (x, y) => eyeSurfZ(x, y);                                // = eSurf(...).z (GLSL)
            let sd = i * 977.1;
            // кожа: сетка рядками (как у лепестков), без точек в разрезе (глаз открыт)
            const hStep = 0.0105 / wShow * Math.sqrt(1 / Math.max(0.3, q));
            const nX = Math.ceil(2 * EYE.ax / hStep), nY = Math.ceil(2 * EYE.ay / (hStep * 1.25));
            for (let a = 0; a <= nX; a++) for (let b = 0; b <= nY; b++) for (let m = 0; m < 2; m++) {
                const x = -EYE.ax + (a + (seededRandom(sd += 1.1) - 0.5) * 0.8) * hStep;
                const y = -EYE.ay + (b + (seededRandom(sd += 1.3) - 0.5) * 0.3) * hStep * 1.25;
                const ee = (x / EYE.ax) ** 2 + (y / EYE.ay) ** 2;
                if (ee > 1) continue;
                if (seededRandom(sd += 0.37) > 1 - 0.7 * Math.min(1, Math.max(0, (ee - 0.15) / 0.85))) continue;   // к краям реже
                if (Math.abs(x) < 1 && y < eyeHU(x) && y > -eyeHL(x)) continue;
                push(0, x, y, x, y, domeC(x, y), sd += 0.3);
            }
            // радужка: волокна от зрачка к краю, на сфере яблока
            const nF = Math.round(260 * wShow / 0.46 * Math.sqrt(q)), nP = Math.round(24 * wShow / 0.46 * Math.sqrt(q) + 6);
            for (let f = 0; f < nF; f++) {
                const a0 = f / nF * Math.PI * 2 + (seededRandom(sd += 1.3) - 0.5) * 0.03, wav = seededRandom(sd += 1.7) * 6.28;
                for (let k = 0; k < nP; k++) {
                    if (seededRandom(sd += 0.7) < 0.2) continue;
                    const t = k / (nP - 1), ph = a0 + 0.05 * Math.sin(t * 7 + wav);
                    const th = EYE.iris * (EYE.pupil + (1 - EYE.pupil) * t);
                    const x = Math.sin(th) * Math.cos(ph) * EYE.rb, y = Math.sin(th) * Math.sin(ph) * EYE.rb, z = Math.cos(th) * EYE.rb + EYE.zb;
                    push(2, t, ph, x, y, z, sd += 0.3);
                }
            }
            // белок: точки по сфере яблока рядками-параллелями (как ядро светила), без хаоса; дальняя задняя шапка в разрез не попадает
            const dRow = hStep * 1.25 / EYE.rb, dAlong = hStep / EYE.rb;
            for (let yy = -1 + dRow * 0.5; yy < 1; yy += dRow) {
                const rr = Math.sqrt(1 - yy * yy), nA = Math.max(6, Math.ceil(2 * Math.PI * rr / dAlong)), a0 = seededRandom(sd += 1.7) * 6.28;
                for (let k = 0; k < nA; k++) {
                    const a = a0 + (k + (seededRandom(sd += 2.1) - 0.5) * 0.3) / nA * Math.PI * 2;
                    const yj = yy + (seededRandom(sd += 1.9) - 0.5) * 0.3 * dRow;      // разброс поперёк рядка ±0.15
                    const r2 = Math.sqrt(Math.max(0, 1 - yj * yj)), sx = r2 * Math.sin(a), sz = r2 * Math.cos(a), sy = yj;
                    if (sz < 0.12 || Math.acos(sz) < EYE.iris * 1.02) continue;    // под радужкой белка нет
                    push(4, 0, 0, sx * EYE.rb, sy * EYE.rb, sz * EYE.rb + EYE.zb, sd += 0.5, sx, sy, sz);
                }
            }
            // лучи вокруг большого глаза
            if (E.main) {
                for (let k = 0; k < 90; k++) {
                    const a = k / 90 * Math.PI * 2 + (seededRandom(sd += 1.1) - 0.5) * 0.04;
                    const len = 0.35 + Math.pow(seededRandom(sd += 1.3), 2) * 1.1;
                    const n = Math.round(len * 90 * Math.sqrt(q));
                    for (let j = 0; j < n; j++) {
                        const r = 1.7 + (j / n) * len, x = Math.cos(a) * r, y = Math.sin(a) * r * 0.62;
                        push(3, x, y, x, y, 0, sd += 0.4);
                    }
                }
            }
        });
        const eyeGeo = new THREE.BufferGeometry();
        eyeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
        eyeGeo.setAttribute('aE', new THREE.Float32BufferAttribute(ee, 4));
        eyeGeo.setAttribute('aQ', new THREE.Float32BufferAttribute(eq, 2));
        eyeGeo.setAttribute('aS', new THREE.Float32BufferAttribute(eS, 3));
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
        const fixedGaze = DP.params.get('gaze') === 'fixed';               // ?gaze=fixed — взгляд прямо, без моргания (для сверки с референсом)
        function update(T, dt, root) {
            if (fixedGaze) { const op = parseFloat(DP.params.get('open') || '1'), gx = parseFloat(DP.params.get('gx') || '0'), gy = parseFloat(DP.params.get('gy') || '0'); for (let i = 0; i < MAX_EYES; i++) gaze[i].set(gx, gy, 1, 0.03 + 0.97 * op); return; }
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
            const partsParam = DP.params.get('parts') || DEFAULT_PARTS;
            const show = (k) => !partsParam || partsParam.split(',').indexOf(k) >= 0;
            const study = partsParam === 'eye' ? EYE_STUDY : 1;
            const eyeC = [], eyeR = [];
            for (let i = 0; i < MAX_EYES; i++) {
                const E = data.eyes[i] || data.eyes[0], main = i === 0;
                eyeC.push(new THREE.Vector4(E.c[0], E.c[1], E.c[2], E.w * (main ? study : 1)));
                eyeR.push(new THREE.Vector4(E.roll, (main ? show('eye') : show('eyes')) && i < data.eyes.length ? 1 : 0, 0, 0));
            }
            const uT0 = { value: 0 };
            const mPetal = mat(petalVertex, petalFragment, { uSize: { value: 2.0 } });
            const EL = DP.config.seraphEye;
            const mEye = mat(eyeVertex, eyeFragment, { uSize: { value: 1.9 },
                uEyeLook: { get value() { return eyeLook.set(EL.rim, EL.ball, EL.skinBase, EL.skinCurve); } },
                uEdgeFade: { get value() { return EL.edgeFade; } },
                uCornea: { get value() { return EL.cornea; } },
                uLidFollow: { get value() { return EL.lidFollow; } },
                uLidLocal: { get value() { return EL.lidLocal; } }, uLidW: { get value() { return EL.lidW; } },
                uCrease: { get value() { return eyeCr.set(EL.profDepth, EL.lidT, EL.paraA, EL.paraW); } },
                uCrease3: { get value() { return eyeCr3.set(EL.lowerSq, EL.archDrop, EL.paraP, EL.grooveDepth); } },
                uGroove: { get value() { return eyeGr.set(EL.grooveY, EL.grooveW, 0, 0); } },
                uCrease2: { get value() { return eyeCr2.set(EL.creaseFlat, EL.creaseHalf, 0, EL.lidShadowTop); } },
                uVC: { value: profC }, uVS: { value: profS },
                uEyeFade: { get value() { return eyeFade.set(EL.fadeWave, EL.fadeSpeed, EL.fadeStart, 0); } },
                uEyeLook2: { get value() { return eyeLook2.set(EL.light, EL.lidShadow, EL.halo, 0); } },
                uRimW: { get value() { return EL.rimWidth; } }, uGaze: { value: gz.gaze }, uEyeC: { value: eyeC }, uEyeR: { value: eyeR } });
            const mTend = mat(tendrilVertex, tendrilFragment, { uSize: { value: 2.0 } });
            const ringU = data.RINGS.map(R => new THREE.Vector4(R.axis[0], R.axis[1], R.axis[2], R.speed));
            const mRing = mat(ringVertex, ringFragment, { uSize: { value: 2.0 }, uRing: { value: ringU }, uT0 });

            const root = new THREE.Group();
            const meshRoot = new THREE.Group(), pointsRoot = new THREE.Group();
            root.add(meshRoot, pointsRoot);
            if (show('petals')) pointsRoot.add(new THREE.Points(data.petalGeo, mPetal));
            if (show('eye') || show('eyes')) pointsRoot.add(new THREE.Points(data.eyeGeo, mEye));
            if (show('tendrils')) pointsRoot.add(new THREE.Points(data.tendGeo, mTend));
            if (show('rings')) pointsRoot.add(new THREE.Points(data.ringGeo, mRing));
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
            if (show('petals')) data.meshes.forEach(g => meshRoot.add(new THREE.Mesh(g, meshMat)));

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
