// ==========================================
// DARK PEONY — ФИГУРА «МЕДУЗА»
// ==========================================
// Три части:
//  • юбка — расширяющийся книзу подол от края купола с крупными складками (две синусоиды колышут её);
//  • купол — тело вращения: сфера, закруглённая внизу и вдавленная сама в себя (внешняя сторона,
//    скруглённый край, внутренняя чаша), с радиальными полосками-каналами и ресничками по краю;
//  • ленты (ротовые щупальца) — плоские ленты: верх не узкий, середина самая широкая, низ сходит в ноль;
//    одна сторона почти прямая, другая длиннее и собирается в рюши; сверху уходят в прозрачность;
//  • тонкие щупальца от края купола — нити-бусины, как щупальца пиона.
// Медуза стоит вертикально и вращается вокруг своей оси Y вместе со сценой; «взгляд чуть снизу»
// даёт наклон сцены stageTilt (см. js/core/orchestrator.js).
(function (DP) {
    'use strict';

    const { seededRandom } = DP.util;

    const FIG_SCALE = 1.4;
    const FIG_Y_OFFSET = 0.55;

    const RIB_COUNT = 16;         // радиальные каналы купола
    const RIBBON_COUNT = 6;       // ленты
    const TENTACLE_COUNT = 12;    // длинные щупальца
    const STAMENS_PER_GAP = 5;    // коротких «тычинок» между соседними лентами
    // Какие части медузы показывать по умолчанию (доводим по частям; '' — все). ?parts= в адресе важнее.
    const DEFAULT_PARTS = 'bell,skirt,ribbons';
    const FRINGE_COUNT = 0;       // короткие реснички по краю купола (выкл.: давали хаос из точек у края)

    const ORDER_ANCHOR = new THREE.Vector3(0, 0.95, 0); // вершина купола: распадается последней
    const ORDER_NOISE = 0.3;
    const ORDER_CURVE = 0.6;

    // ==========================================
    // ПРОФИЛЬ КУПОЛА (r, y): вершина → внешняя сторона → скруглённый край, чуть загнутый внутрь
    // ==========================================
    // Контур незамкнутый: внутренней чаши нет, край лишь чуть загибается внутрь.
    const BELL_PROFILE = [
        [0.00, 0.95], [0.30, 0.92], [0.58, 0.83], [0.85, 0.64], [1.06, 0.38], [1.19, 0.08],
        [1.22, -0.18], [1.15, -0.36], [1.02, -0.45], [0.92, -0.42], [0.86, -0.34]
    ];

    // sr, sy — масштаб по радиусу и высоте, dy — сдвиг (внутренний купол — уменьшенная копия внешнего).
    function makeBellCurve(sr, sy, dy) {
        return new THREE.SplineCurve(BELL_PROFILE.map(p => new THREE.Vector2(p[0] * sr, p[1] * sy + dy)));
    }

    // ==========================================
    // GLSL
    // ==========================================
    const bellPars = `
        uniform float uTime;
        uniform float uRimProf;
        attribute float aRib;
        varying vec3 vNormal, vViewPosition;
        varying vec2 vUv;
        varying float vRib;
    `;
    // Купол «дышит»: край сжимается сильнее вершины.
    const bellDisplacement = `
        vUv = uv; vRib = aRib;
        vec3 pos = position; vec3 dpRest = position;
        float prof = uv.y;
        float rimW = exp(-pow((prof - uRimProf) / 0.22, 2.0));
        float pulse = 0.5 + 0.5 * sin(uTime * 1.1);
        float sq = 0.05 * pulse * (0.3 + 0.7 * rimW);
        pos.xz *= 1.0 - sq;
        pos.y += sq * 0.4 * rimW;
        pos.y += sin(uv.x * 6.2831853 * 3.0 + uTime * 0.7) * 0.015 * rimW;
    `;

    const ribbonPars = `
        uniform float uTime;
        attribute float aSeed;
        attribute vec3 aRuf;
        varying vec3 vNormal, vViewPosition;
        varying vec2 vUv;
    `;
    // uv.x — поперёк ленты (0 прямой край, 1 волнистый), uv.y — вдоль (0 верх, 1 низ).
    const ribbonDisplacement = `
        vUv = uv; vec3 pos = position; vec3 dpRest = position;
        float u = uv.y;
        // Свой характер у каждой ленты (как phase/amp/flex у лепестков пиона).
        float rA = fract(sin(aSeed * 12.9898) * 43758.5453);
        float rB = fract(sin(aSeed * 78.233) * 12345.678);
        float rC = fract(sin(aSeed * 39.425) * 24634.634);
        float flex = 0.75 + 0.6 * rA;
        // Синяя волна — вся лента: бежит от основания к кончику.
        float whip = pow(u, 1.3) * flex;
        float t1 = uTime * (0.8 + 0.3 * rB) - u * (2.8 + 1.2 * rC) + aSeed * 5.1;
        float t2 = uTime * (0.55 + 0.25 * rC) - u * (4.2 + 1.2 * rA) + aSeed * 2.7;
        pos.x += (sin(t1) * 0.22 + cos(t2) * 0.10) * whip;
        pos.z += (cos(t1 * 0.8) * 0.22 + sin(t2 * 1.2) * 0.10) * whip;
        // Зелёная волна — рюши кромки бегут вниз; амплитуда меняется пакетами, которые тоже
        // бегут вниз: то вильнёт сильнее, то слабее. aRuf: x — амплитуда, y — фаза, z — скручивание.
        {
            float ph = aRuf.y - uTime * (2.6 + 1.4 * rB);
            float env = 0.45 + 0.55 * (0.6 * sin(u * (5.0 + 3.0 * rC) - uTime * (1.1 + 0.6 * rA) + aSeed * 3.0)
                                     + 0.4 * sin(u * (9.0 + 4.0 * rA) - uTime * (1.7 + 0.5 * rC) + aSeed * 1.3)) ;
            env *= 0.8 + 0.5 * rC;
            float amp = aRuf.x * env * (0.15 + 0.85 * smoothstep(0.03, 0.45, u));   // у крепления рюши слабые
            float acr = pow(uv.x, 2.0) * amp * 0.3 * sin(ph);
            float zz = pow(uv.x, 1.8) * amp * sin(ph + 0.5);
            float ca = cos(aRuf.z), sa = sin(aRuf.z);
            pos.x += acr * ca - zz * sa;
            pos.z += acr * sa + zz * ca;
        }
    `;

    // Юбка: uv.x — угол по кругу (0..1), uv.y — от стыка с куполом (0) к нижнему краю (1).
    const skirtPars = `
        uniform float uTime;
        attribute float aSeed;
        attribute float aFolds;
        attribute vec4 aSk;          // длина профиля, угол крепления, кривизна в покое, глубина складок
        attribute float aHem;        // волнистость среза подола
        varying vec3 vNormal, vViewPosition;
        varying vec2 vUv;

        // Рюши юбки с природным разбросом (та же формула на CPU — skirtFoldJS):
        // неровный шаг (фазовые искажения), разная высота (огибающая до ±50%), волнистый срез подола
        // и провисание краёв. t — время дрейфа (0 — форма в покое).
        vec2 skFold(float th, float t, float N, float sd) {
            float r1 = fract(sin(sd * 12.9898) * 43758.5453) * 6.2832;
            float r2 = fract(sin(sd * 78.233) * 12345.678) * 6.2832;
            float r3 = fract(sin(sd * 39.425) * 24634.634) * 6.2832;
            float warp = 1.1 * sin(th + r1 + 0.21 * t) + 0.8 * sin(2.0 * th + r2 - 0.17 * t) + 0.5 * sin(3.0 * th + r3 + 0.13 * t);
            float ph = th * N + sd + t * 0.35 * N + warp;
            float env = 1.0 + 0.3 * sin(2.0 * th + r3 + 0.11 * t) + 0.2 * sin(3.0 * th + r1 - 0.09 * t) + 0.15 * sin(5.0 * th + r2);
            float fine = sin(th * (N + 7.0) - t * 0.6 + sd * 3.1) * (0.5 + 0.5 * sin(4.0 * th - t * 0.3 + r1));
            float radial = env * sin(ph) + 0.3 * fine;
            float hem = env * cos(ph) + 0.7 * sin(2.0 * th + r2) + 0.5 * sin(3.0 * th + r3 - 0.05 * t);
            return vec2(radial, hem);
        }
    `;
    // Юбка меняет только кривизну профиля (длина постоянна, верхний край неподвижен):
    //  • «гребок» в такт пульсации купола — подол подворачивается под себя и распрямляется;
    //  • поперечная волна бежит по кругу — подол то подворачивается, то выворачивается наружу;
    //  • складки подола бегут по кругу (против часовой стрелки при взгляде сверху).
    // Юбка меняет только кривизну профиля (длина постоянна, верхний край неподвижен).
    //  • Гребок — не «ставни», а волна изгиба, бегущая от купола к подолу (как рука на видео автора):
    //    основание уже возвращается, а подол ещё идёт наружу и потом заворачивается; к краю волна сильнее,
    //    внутрь (подворот, «фонарик») — сильнее, чем наружу («колокольчик»). Ритм — пульс купола.
    //  • Лёгкая поперечная волна по кругу.
    //  • Рюши бегут по кругу против часовой стрелки (взгляд сверху); их высота и шаг живут своей жизнью:
    //    где-то крупнее, где-то мельче и дробнее, и всё время меняются (природный рандомайз).
    // Профиль интегрируется по шагам: кривизна разная по длине.
    const skirtDisplacement = `
        vUv = uv; vec3 pos = position; vec3 dpRest = position;
        {
            float h = uv.y;
            float th = uv.x * 6.2831853;
            vec2 dir = normalize(position.xz + 1e-5);
            float sL = h * aSk.x;
            float wave = sin(uTime * 1.3 - th * 2.0 + aSeed) * 0.65 + sin(uTime * 0.8 + th * 3.0 + aSeed * 1.7) * 0.35;
            float cyc = uTime * 1.1 + 0.6;
            float ang = aSk.y;
            vec2 a1 = vec2(0.0);
            float ds = sL / 12.0;
            for (int i = 0; i < 12; i++) {
                float u = (float(i) + 0.5) * ds / aSk.x;              // 0 у купола → 1 у подола
                float w = sin(cyc - u * 3.4 + 0.25 * sin(th * 3.0 + aSeed));   // волна бежит к подолу
                float amp = 1.0 + 2.8 * u;
                if (w < 0.0) amp *= 1.35;                              // подворот сильнее выворота
                float k = aSk.z + amp * w + 0.5 * wave;
                ang += k * ds * 0.5;
                a1 += vec2(sin(ang), -cos(ang)) * ds;
                ang += k * ds * 0.5;
            }
            vec2 a0 = abs(aSk.z) < 1e-3 ? vec2(sL * sin(aSk.y), -sL * cos(aSk.y))
                : vec2(cos(aSk.y) - cos(aSk.y + aSk.z * sL), -(sin(aSk.y + aSk.z * sL) - sin(aSk.y))) / aSk.z;
            vec2 f0 = skFold(th, 0.0, aFolds, aSeed);
            vec2 f1 = skFold(th, uTime, aFolds, aSeed);
            pos.xz += dir * (a1.x - a0.x + (f1.x - f0.x) * pow(h, 1.3) * aSk.w);
            pos.y += (f1.y - f0.y) * aHem * pow(h, 2.0);
            pos.y += a1.y - a0.y;
        }
    `;

    const tentPars = `uniform float uTime; attribute float aSeed; attribute vec3 aRingC; varying vec3 vNormal, vViewPosition; varying vec2 vUv;`;
    const tentDisplacement = `
        vUv = uv; vec3 pos = position; vec3 dpRest = position; float whip = pow(uv.y, 1.3);
        // Кольца наклонены к зрителю (одинаково для всех): сбоку они видны овалами, как у пиона сверху.
        {
            vec3 dC = cameraPosition - modelMatrix[3].xyz;
            float s2 = dot(modelMatrix[0].xyz, modelMatrix[0].xyz);
            vec3 camL = vec3(dot(modelMatrix[0].xyz, dC), dot(modelMatrix[1].xyz, dC), dot(modelMatrix[2].xyz, dC)) / s2;
            vec2 toCam = camL.xz - aRingC.xz;
            toCam /= max(length(toCam), 1e-4);
            vec3 o = position - aRingC;
            pos.y -= dot(o.xz, toCam) * 0.5;
        }
        float t1 = uTime * 1.2 - uv.y * 7.0 + aSeed * 9.1;
        float t2 = uTime * 0.9 - uv.y * 9.5 + aSeed * 4.3;
        pos.x += (sin(t1) * 0.22 + cos(t2) * 0.10) * whip;
        pos.z += (cos(t1 * 0.85) * 0.22 + sin(t2 * 1.1) * 0.10) * whip;
    `;

    // ==========================================
    // ГЕОМЕТРИЯ
    // ==========================================
    const cache = {};

    // Вид купола (общий для всех экземпляров, можно крутить из консоли: DP.jellyfish.bellLook.value.set(...)):
    // x — базовая видимость лицевой стороны (против провала в центре), y — «свет сверху» (сферичность),
    // z — яркость каналов, w — укрупнение точек на гребне канала.
    const bellLook = { value: new THREE.Vector4(0.12, 0.75, 0.2, 0.35) };
    DP.jellyfish = { bellLook };

    function matrixOf(setup) {
        const pivot = new THREE.Object3D();
        const obj = new THREE.Object3D();
        pivot.add(obj);
        setup(pivot, obj);
        pivot.updateMatrixWorld(true);
        return obj.matrixWorld.clone();
    }

    function ribAt(theta, phase = 0) { return Math.pow(0.5 + 0.5 * Math.cos(RIB_COUNT * theta + phase), 10); }

    // ---------- КУПОЛ ----------
    // ribPhase — сдвиг каналов (у внутреннего купола на полшага: вдвое больше линий к вершине).
    function buildBell(density, sr, sy, dy, ribPhase = 0) {
        const curve = makeBellCurve(sr, sy, dy);
        const lenP = curve.getLength();

        // Параметр профиля в самой нижней точке края.
        let sRim = 0, yMin = Infinity;
        for (let i = 0; i <= 400; i++) { const p = curve.getPointAt(i / 400); if (p.y < yMin) { yMin = p.y; sRim = i / 400; } }

        const ribAmp = 0.03;
        const profR = (s, theta) => {
            const p = curve.getPointAt(s);
            const outer = s < sRim ? Math.pow(Math.sin(Math.PI * s / sRim), 0.6) : 0;
            return { r: Math.max(0, p.x) + ribAmp * ribAt(theta, ribPhase) * outer, y: p.y };
        };

        // Точки — как у лепестков пиона: ровная сетка (параллели по профилю × меридианы по кругу),
        // у каждого узла MULT точек со сдвигом не больше ±0.4 ячейки — видны рядки.
        // Ближе к вершине меридианов вдвое меньше (каждый второй), чтобы точки не слипались в пятно.
        const MULT = 3;
        const h = 1 / Math.sqrt(density / MULT);          // шаг сетки
        const nS = Math.ceil(lenP / h);
        let rMax = 0;
        for (let i = 0; i <= 200; i++) rMax = Math.max(rMax, curve.getPointAt(i / 200).x);
        const nBase = Math.pow(2, Math.round(Math.log2(Math.PI * 2 * rMax / h)));
        const pos = [], nor = [], uvs = [], rib = [], size = [];
        let sd = 1.3;
        for (let i = 0; i <= nS; i++) {
            const s0 = i / nS;
            const r0 = Math.max(0.005, curve.getPointAt(Math.min(1, s0)).x);
            let nT = nBase;
            while (nT > 8 && Math.PI * 2 * r0 / nT < h * 0.7) nT /= 2;
            for (let j = 0; j < nT; j++) for (let m = 0; m < MULT; m++) {
                const s = Math.min(1, Math.max(0, (i + (seededRandom(sd += 1.1) - 0.5) * 0.8) / nS));
                const theta = (j + (seededRandom(sd += 1.3) - 0.5) * 0.8) / nT * Math.PI * 2;
                const { r, y } = profR(s, theta);
                const t = curve.getTangentAt(s);
                const nr = -t.y, ny = t.x;                  // нормаль профиля
                pos.push(r * Math.sin(theta), y, r * Math.cos(theta));
                nor.push(nr * Math.sin(theta), ny, nr * Math.cos(theta));
                uvs.push(theta / (Math.PI * 2), s);
                rib.push(Math.min(1, ribAt(theta, ribPhase) * (s < sRim ? 1 : 0.55)));
                size.push(seededRandom(sd += 0.9));
            }
        }
        const pointsGeo = new THREE.BufferGeometry();
        pointsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        pointsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        pointsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        pointsGeo.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 1));
        pointsGeo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(size, 1));

        // Поверхность (MESH): тело вращения по тому же профилю.
        const profPts = curve.getSpacedPoints(120).map(p => new THREE.Vector2(Math.max(0.0005, p.x), p.y));
        const meshGeo = new THREE.LatheGeometry(profPts, 128);
        const mp = meshGeo.attributes.position, muv = meshGeo.attributes.uv;
        const mRib = new Float32Array(mp.count);
        for (let i = 0; i < mp.count; i++) {
            const theta = Math.atan2(mp.getX(i), mp.getZ(i));
            const s = muv.getY(i);
            const outer = s < sRim ? Math.pow(Math.sin(Math.PI * s / sRim), 0.6) : 0;
            const k = 1 + ribAmp * ribAt(theta, ribPhase) * outer / Math.max(0.05, Math.hypot(mp.getX(i), mp.getZ(i)));
            mp.setXYZ(i, mp.getX(i) * k, mp.getY(i), mp.getZ(i) * k);
            mRib[i] = ribAt(theta, ribPhase) * (s < sRim ? 1 : 0.55);
        }
        meshGeo.setAttribute('aRib', new THREE.BufferAttribute(mRib, 1));
        meshGeo.computeVertexNormals();

        return { pointsGeo, meshGeo, sRim, rimR: curve.getPointAt(sRim).x, rimY: yMin };
    }

    // ---------- ЛЕНТА ----------
    // Форма ленты в её собственных координатах: x — поперёк, y — вниз по длине, z — из плоскости.
    // ruffle = false — плоская лента без рюшей (рюши рисует шейдер и гонит их волной по кромке).
    function ribbonPoint(u, v, p, ruffle = true) {
        const W = p.width * Math.sin(Math.PI * (0.2 + 0.8 * u));
        const ph = ruffleWarp(u) * p.len * p.ruffleK + p.seed;
        const rA = ruffle ? p.ruffleAmp * (W / p.width) : 0;
        // Волнистый край длиннее прямого: волна в плоскости ленты + рюши из плоскости в той же фазе
        // (без сдвига фаз край не закручивается штопором, а складывается гармошкой).
        let across = v * W + Math.pow(v, 2.0) * rA * 0.3 * Math.sin(ph);
        let z = Math.pow(v, 1.8) * rA * Math.sin(ph + 0.5);
        const a = p.twist * u;                                             // лёгкое скручивание вдоль длины (у крепления лента строго радиальна)
        const x = across * Math.cos(a) - z * Math.sin(a);
        z = across * Math.sin(a) + z * Math.cos(a);
        return [
            x + p.splay * Math.pow(u, 0.8) + Math.sin(u * Math.PI * 1.2 + p.seed) * 0.14 * u,
            -u * p.len,
            z + Math.cos(u * Math.PI * 0.9 + p.seed * 1.7) * 0.12 * u
        ];
    }

    // У основания волна рюшей длиннее (вдвое), к середине — обычная: фаза растёт медленнее у крепления.
    function ruffleWarp(u) { return u - 0.5 * u * (1 - u) * (1 - u); }

    // Параметры оборки в точке ленты для шейдера: амплитуда, фаза, угол скручивания.
    function ribbonRuffle(u, p) {
        const W = p.width * Math.sin(Math.PI * (0.2 + 0.8 * u));
        return [p.ruffleAmp * (W / p.width), ruffleWarp(u) * p.len * p.ruffleK + p.seed, p.twist * u];
    }

    // Точки ленты — как у лепестков пиона: ровная сетка, у каждого узла несколько точек
    // со сдвигом не больше ±0.4 ячейки — видны рядки.
    function buildRibbon(p, tier) {
        // Шаг сетки как у лепестков пиона на экране (≈0.019), иначе рядки сливаются.
        const qs = tier.petalSegments / 100;
        const step = 0.019 / FIG_SCALE / qs;
        const segU = Math.round(p.len / step), segV = Math.max(4, Math.round(p.width / step));
        // Меньше точек на узел и меньший сдвиг, чем у лепестков: лента плоская и видна плашмя,
        // иначе рядки тонут в шуме и лента выглядит тяжелее лепестков пиона.
        const mult = Math.max(1, tier.petalMultiplier - 1);
        const pos = [], nor = [], uvs = [], seeds = [], size = [], ruf = [];
        const e = 1e-3;
        let sd = p.seed * 11.3;
        for (let i = 0; i <= segU; i++) for (let j = 0; j <= segV; j++) {
            for (let m = 0; m < mult; m++) {
                const u = Math.min(1, Math.max(0, (i + (seededRandom(sd += 1.1) - 0.5) * 0.3) / segU));
                const v = Math.min(1, Math.max(0, (j + (seededRandom(sd += 1.3) - 0.5) * 0.3) / segV));
                const qr = ribbonPoint(u, v, p);                 // с рюшами — только для нормали (френель)
                const q = ribbonPoint(u, v, p, false);          // позиция — плоская лента
                const du = ribbonPoint(Math.min(1, u + e), v, p), dv = ribbonPoint(u, Math.min(1, v + e), p);
                const ax = du[0] - qr[0], ay = du[1] - qr[1], az = du[2] - qr[2];
                const bx = dv[0] - qr[0], by = dv[1] - qr[1], bz = dv[2] - qr[2];
                const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
                const nl = Math.hypot(nx, ny, nz) || 1;
                ruf.push(...ribbonRuffle(u, p));
                pos.push(q[0], q[1], q[2]);
                nor.push(nx / nl, ny / nl, nz / nl);
                uvs.push(v, u);
                seeds.push(p.seed);
                size.push(seededRandom(sd += 0.7));
            }
        }
        const pointsGeo = new THREE.BufferGeometry();
        pointsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        pointsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        pointsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        pointsGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
        pointsGeo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(size, 1));
        pointsGeo.setAttribute('aRuf', new THREE.Float32BufferAttribute(ruf, 3));

        // Поверхность.
        const mU = 220, mV = 16;
        const mPos = [], mUv = [], mSeed = [], mRuf = [], idx = [];
        for (let i = 0; i <= mU; i++) for (let j = 0; j <= mV; j++) {
            const u = i / mU, v = j / mV;
            const q = ribbonPoint(u, v, p, false);
            mPos.push(q[0], q[1], q[2]); mUv.push(v, u); mSeed.push(p.seed);
            mRuf.push(...ribbonRuffle(u, p));
        }
        for (let i = 0; i < mU; i++) for (let j = 0; j < mV; j++) {
            const a = i * (mV + 1) + j, b = a + mV + 1;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
        const meshGeo = new THREE.BufferGeometry();
        meshGeo.setIndex(idx);
        meshGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
        meshGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mUv, 2));
        meshGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(mSeed, 1));
        meshGeo.setAttribute('aRuf', new THREE.Float32BufferAttribute(mRuf, 3));
        meshGeo.computeVertexNormals();
        return { pointsGeo, meshGeo };
    }

    // ---------- ЮБКА (под куполом) ----------
    // Расширяющийся книзу подол от края купола: крупные складки по кругу, нижний край — волнистый.
    // Та же формула, что skFold в шейдере (t = 0 — форма в покое).
    function skirtFoldJS(th, N, sd) {
        const fr = (x) => x - Math.floor(x);
        const r1 = fr(Math.sin(sd * 12.9898) * 43758.5453) * 6.2832;
        const r2 = fr(Math.sin(sd * 78.233) * 12345.678) * 6.2832;
        const r3 = fr(Math.sin(sd * 39.425) * 24634.634) * 6.2832;
        const warp = 1.1 * Math.sin(th + r1) + 0.8 * Math.sin(2 * th + r2) + 0.5 * Math.sin(3 * th + r3);
        const ph = th * N + sd + warp;
        const env = 1 + 0.3 * Math.sin(2 * th + r3) + 0.2 * Math.sin(3 * th + r1) + 0.15 * Math.sin(5 * th + r2);
        const fine = Math.sin(th * (N + 7) + sd * 3.1) * (0.5 + 0.5 * Math.sin(4 * th + r1));
        return [env * Math.sin(ph) + 0.3 * fine, env * Math.cos(ph) + 0.7 * Math.sin(2 * th + r2) + 0.5 * Math.sin(3 * th + r3)];
    }

    // Профиль юбки — дуга постоянной длины: из точки крепления (r0, y0) под углом phi0 от вертикали
    // (наружу) с кривизной kappa. Длина профиля не меняется ни при какой кривизне — юбка не растягивается.
    // Шейдер меняет только кривизну (подворачивается / выворачивается) и фазу складок.
    function skirtArc(kappa, s, phi0) {
        if (Math.abs(kappa) < 1e-3) return [s * Math.sin(phi0), -s * Math.cos(phi0)];
        return [(Math.cos(phi0) - Math.cos(phi0 + kappa * s)) / kappa, -(Math.sin(phi0 + kappa * s) - Math.sin(phi0)) / kappa];
    }
    function skirtPoint(t, h, p) {
        const th = t * Math.PI * 2;
        const a = skirtArc(p.kappa0, h * p.len, p.phi0);
        // Подол шире верха: лишняя ширина собирается в складки — одна плавная синусоида по радиусу.
        const f = skirtFoldJS(th, p.folds, p.seed);
        const r = p.r0 + a[0] + f[0] * p.foldAmp * Math.pow(h, 1.3);
        return [r * Math.sin(th), p.y0 + a[1] + f[1] * p.hemAmp * Math.pow(h, 2.0), r * Math.cos(th)];
    }

    function buildSkirt(p, tier) {
        const qs = tier.petalSegments / 100;
        const step = 0.019 / FIG_SCALE / qs;
        const segT = Math.round(Math.PI * 2 * (p.r0 + p.len * Math.sin(p.phi0) * 0.5) / step), segH = Math.max(4, Math.round(p.len * 1.2 / step));
        const mult = tier.petalMultiplier;
        const pos = [], nor = [], uvs = [], size = [];
        const e = 1e-3;
        let sd = 91.7;
        for (let i = 0; i < segT; i++) for (let j = 0; j <= segH; j++) {
            for (let m = 0; m < mult; m++) {
                const t = (i + (seededRandom(sd += 1.1) - 0.5) * 0.8) / segT;
                const h = Math.min(1, Math.max(0, (j + (seededRandom(sd += 1.3) - 0.5) * 0.8) / segH));
                const q = skirtPoint(t, h, p);
                const dt = skirtPoint(t + e, h, p), dh = skirtPoint(t, Math.min(1, h + e), p);
                const ax = dt[0] - q[0], ay = dt[1] - q[1], az = dt[2] - q[2];
                const bx = dh[0] - q[0], by = dh[1] - q[1], bz = dh[2] - q[2];
                const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
                const nl = Math.hypot(nx, ny, nz) || 1;
                pos.push(q[0], q[1], q[2]);
                nor.push(nx / nl, ny / nl, nz / nl);
                uvs.push(t, h);
                size.push(seededRandom(sd += 0.7));
            }
        }
        const pointsGeo = new THREE.BufferGeometry();
        pointsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        pointsGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        pointsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        pointsGeo.setAttribute('aSizeScale', new THREE.Float32BufferAttribute(size, 1));
        pointsGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(size.length).fill(p.seed), 1));
        pointsGeo.setAttribute('aFolds', new THREE.Float32BufferAttribute(new Float32Array(size.length).fill(p.folds), 1));
        pointsGeo.setAttribute('aHem', new THREE.Float32BufferAttribute(new Float32Array(size.length).fill(p.hemAmp), 1));
        pointsGeo.setAttribute('aSk', new THREE.Float32BufferAttribute(new Float32Array(size.length * 4).map((_, i) => [p.len, p.phi0, p.kappa0, p.foldAmp][i % 4]), 4));

        const mT = 240, mH = 24;
        const mPos = [], mUv = [], idx = [];
        for (let i = 0; i <= mT; i++) for (let j = 0; j <= mH; j++) {
            const q = skirtPoint(i / mT, j / mH, p);
            mPos.push(q[0], q[1], q[2]); mUv.push(i / mT, j / mH);
        }
        for (let i = 0; i < mT; i++) for (let j = 0; j < mH; j++) {
            const a = i * (mH + 1) + j, b = a + mH + 1;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
        const meshGeo = new THREE.BufferGeometry();
        meshGeo.setIndex(idx);
        meshGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
        meshGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mUv, 2));
        meshGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(mPos.length / 3).fill(p.seed), 1));
        meshGeo.setAttribute('aFolds', new THREE.Float32BufferAttribute(new Float32Array(mPos.length / 3).fill(p.folds), 1));
        meshGeo.setAttribute('aHem', new THREE.Float32BufferAttribute(new Float32Array(mPos.length / 3).fill(p.hemAmp), 1));
        meshGeo.setAttribute('aSk', new THREE.Float32BufferAttribute(new Float32Array(mPos.length / 3 * 4).map((_, i) => [p.len, p.phi0, p.kappa0, p.foldAmp][i % 4]), 4));
        meshGeo.computeVertexNormals();
        return { pointsGeo, meshGeo, matrix: new THREE.Matrix4() };
    }

    // ---------- ТОНКОЕ ЩУПАЛЬЦЕ (трубка вниз) ----------
    // aRingC — центр кольца: шейдер наклоняет кольцо к зрителю (см. tentDisplacement).
    function buildTentacle(len, radius, seed, segments, radial, sway) {
        const pts = [];
        for (let s = 0; s <= 40; s++) {
            const t = s / 40;
            pts.push(new THREE.Vector3(
                Math.sin(t * Math.PI * 1.3 + seed) * sway * t + t * 0.25 * sway,
                -t * len,
                Math.cos(t * Math.PI * 0.9 + seed * 1.3) * sway * 0.8 * t));
        }
        const path = new THREE.CatmullRomCurve3(pts);
        const pos = [], nor = [], uvs = [], seeds = [], idx = [], ringC = [];
        for (let i = 0; i <= segments; i++) {
            const v = i / segments;
            const c = path.getPointAt(v);
            const r = radius * Math.max(0.08, Math.pow(1 - v * 0.88, 1.1));   // широкое кольцо у основания, к концу сужается (как у пиона)
            for (let j = 0; j <= radial; j++) {
                const th = j / radial * Math.PI * 2;
                const nx = Math.cos(th), nz = Math.sin(th);
                pos.push(c.x + nx * r, c.y, c.z + nz * r);
                nor.push(nx, 0, nz);
                uvs.push(j / radial, v);
                seeds.push(seed);
                ringC.push(c.x, c.y, c.z);
            }
        }
        for (let i = 0; i < segments; i++) for (let j = 0; j < radial; j++) {
            const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
        const geo = new THREE.BufferGeometry();
        geo.setIndex(idx);
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
        geo.setAttribute('aRingC', new THREE.Float32BufferAttribute(ringC, 3));
        return geo;
    }

    function buildGeometry(tier) {
        // Плотность точек относительно эталона (high): как у пиона — меньше на слабых уровнях.
        const q = Math.pow(tier.petalSegments / 100, 2) * tier.petalMultiplier / 3;
        const density = 16000 * q;

        // Два купола: внешний и внутренний поменьше — слои накладываются (add) и дают плотность головы.
        const bell = buildBell(density, 1, 1, 0);
        const inner = buildBell(density * 0.8, 0.95, 0.96, -0.03, Math.PI);
        bell.matrix = new THREE.Matrix4();
        inner.matrix = new THREE.Matrix4();
        const bells = [bell, inner];

        // Расстановка (вид снизу, эскиз автора): ленты — у края внутреннего купола, между ними — короткие
        // «тычинки»; длинные щупальца — плотным кольцом ближе к центру, с разбросом по радиусу.
        const RING_STEP = 0.042 / FIG_SCALE, TUBE_R = 0.05 / FIG_SCALE;
        const innerR = inner.rimR, innerY = inner.rimY;
        const ribbons = [];
        for (let i = 0; i < RIBBON_COUNT; i++) {
            const seed = i * 3.71 + 0.9;
            const p = {
                seed,
                len: 1.6 + seededRandom(seed * 2.1) * 0.35,
                width: 0.42 + seededRandom(seed * 3.3) * 0.1,
                ruffleK: 16 + seededRandom(seed * 4.7) * 4,
                ruffleAmp: 0.12,
                twist: (seededRandom(seed * 5.9) - 0.5) * 0.5,
                splay: 0.05 + seededRandom(seed * 6.7) * 0.08
            };
            const { pointsGeo, meshGeo } = buildRibbon(p, tier);
            const angle = (i / RIBBON_COUNT) * Math.PI * 2;
            const matrix = matrixOf((pivot, obj) => {
                pivot.rotation.y = angle;
                obj.position.set(0, innerY + 0.16, innerR * 0.28);   // ниже: не просвечивает сквозь голову
                obj.rotation.y = -Math.PI / 2;       // прямой край к оси, волнистый — наружу
            });
            ribbons.push({ pointsGeo, meshGeo, matrix });
        }

        const tentacles = [];
        // Длинные щупальца — трубки из колец точек, как у пиона (16 точек в кольце, тот же шаг на экране).
        for (let i = 0; i < TENTACLE_COUNT; i++) {
            const seed = i * 2.43 + 1.7;
            const angle = (i / TENTACLE_COUNT) * Math.PI * 2 + (seededRandom(seed * 3.3) - 0.5) * 0.3;
            const r = innerR * (0.3 + seededRandom(seed * 5.1) * 0.25);
            const len = 1.9 + seededRandom(seed * 1.9) * 0.5;
            const geo = buildTentacle(len, TUBE_R * 1.8, seed, Math.round(len / RING_STEP), 16, 0.3);
            const matrix = matrixOf((pivot, obj) => {
                pivot.rotation.y = angle;
                obj.position.set(0, innerY + 0.3, r);
            });
            tentacles.push({ geo, matrix, kind: 'tentacles' });
        }
        // «Тычинки» без шариков — короткие тонкие щупальца между лентами.
        for (let i = 0; i < RIBBON_COUNT; i++) for (let k = 0; k < STAMENS_PER_GAP; k++) {
            const seed = i * 7.1 + k * 1.93 + 20.5;
            const angle = ((i + (k + 1) / (STAMENS_PER_GAP + 1)) / RIBBON_COUNT) * Math.PI * 2;
            const r = innerR * (0.8 + (seededRandom(seed) - 0.5) * 0.12);
            const len = 0.7 + seededRandom(seed * 2.7) * 0.35;
            const geo = buildTentacle(len, TUBE_R * 0.8, seed, Math.round(len / RING_STEP), 12, 0.04);
            const matrix = matrixOf((pivot, obj) => {
                pivot.rotation.y = angle;
                obj.position.set(0, innerY + 0.08, r);
                obj.rotation.x = 0.15;
            });
            tentacles.push({ geo, matrix, kind: 'stamens' });
        }
        for (let i = 0; i < FRINGE_COUNT; i++) {
            const seed = i * 1.37 + 40.2;
            const angle = (i / FRINGE_COUNT) * Math.PI * 2;
            const len = 0.18 + seededRandom(seed) * 0.16;
            const geo = buildTentacle(len, TUBE_R * 0.5, seed, Math.max(3, Math.round(len / RING_STEP)), 8, 0.05);
            const matrix = matrixOf((pivot, obj) => {
                pivot.rotation.y = angle;
                obj.position.set(0, bell.rimY + 0.02, bell.rimR);
                obj.rotation.x = 0.35;               // реснички чуть наружу
            });
            tentacles.push({ geo, matrix, kind: 'fringe' });
        }

        const rootMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(0, FIG_Y_OFFSET, 0), new THREE.Quaternion(),
            new THREE.Vector3(FIG_SCALE, FIG_SCALE, FIG_SCALE));

        // Два слоя юбки: второй — меньшего радиуса, со своими складками и фазой; слои частично
        // пересекаются (как лепестки пиона) и дают плотность без «провала» в центре.
        const skirts = [
            buildSkirt({ r0: bell.rimR * 0.88, y0: bell.rimY + 0.07, len: 0.55, phi0: 0.55, kappa0: 0.25,
                         folds: 20, foldAmp: 0.06, hemAmp: 0.04, seed: 0.7 }, tier),
            buildSkirt({ r0: bell.rimR * 0.76, y0: bell.rimY + 0.11, len: 0.48, phi0: 0.45, kappa0: 0.2,
                         folds: 15, foldAmp: 0.055, hemAmp: 0.035, seed: 2.9 }, tier)
        ];

        const data = { bell, bells, skirts, ribbons, tentacles, rootMatrix };
        assignOrderAndLayout(data);
        return data;
    }

    // ==========================================
    // ПОРЯДОК РАСПАДА: от концов щупалец и лент вверх к куполу, купол — от края к вершине
    // ==========================================
    function orderDistance(x, y, z) {
        const dx = x - ORDER_ANCHOR.x, dy = y - ORDER_ANCHOR.y, dz = z - ORDER_ANCHOR.z;
        const n = Math.sin(x * 1.7 + y * 0.9) * Math.sin(z * 1.9 - y * 1.3) + 0.5 * Math.sin(x * 3.1 - z * 2.7 + y * 2.3);
        return Math.sqrt(dx * dx + dy * dy + dz * dz) + ORDER_NOISE * n;
    }

    function assignOrderAndLayout(data) {
        const v = new THREE.Vector3();
        const pointSources = data.bells.map(b => ({ geo: b.pointsGeo, matrix: b.matrix }));
        data.skirts.forEach(k => pointSources.push({ geo: k.pointsGeo, matrix: k.matrix }));
        data.ribbons.forEach(r => pointSources.push({ geo: r.pointsGeo, matrix: r.matrix }));
        data.tentacles.forEach(t => pointSources.push({ geo: t.geo, matrix: t.matrix }));
        const meshOnly = data.bells.map(b => ({ geo: b.meshGeo, matrix: b.matrix }));
        data.skirts.forEach(k => meshOnly.push({ geo: k.meshGeo, matrix: k.matrix }));
        data.ribbons.forEach(r => meshOnly.push({ geo: r.meshGeo, matrix: r.matrix }));

        let dMin = Infinity, dMax = -Infinity;
        const raw = (src) => {
            const pos = src.geo.attributes.position, n = pos.count;
            src.raw = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(src.matrix);
                const d = orderDistance(v.x, v.y, v.z);
                src.raw[i] = d;
                if (d < dMin) dMin = d;
                if (d > dMax) dMax = d;
            }
        };
        pointSources.forEach(raw);
        meshOnly.forEach(raw);
        const toOrder = (d) => 1 - Math.pow(Math.min(1, Math.max(0, (d - dMin) / (dMax - dMin))), ORDER_CURVE);

        pointSources.forEach(src => {
            const pos = src.geo.attributes.position, n = pos.count;
            const order = new Float32Array(n);
            src.rest = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                order[i] = toOrder(src.raw[i]);
                v.fromBufferAttribute(pos, i).applyMatrix4(src.matrix).applyMatrix4(data.rootMatrix);
                src.rest[i * 3] = v.x; src.rest[i * 3 + 1] = v.y; src.rest[i * 3 + 2] = v.z;
            }
            src.geo.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
            src.raw = null;
        });
        meshOnly.forEach(src => {
            const order = new Float32Array(src.raw.length);
            for (let i = 0; i < order.length; i++) order[i] = toOrder(src.raw[i]);
            src.geo.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
            src.raw = null;
        });

        data.layout = DP.morph.createLayout(pointSources.map(src => ({ geometry: src.geo, rest: src.rest })));
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
        const uRimProf = { value: data.bell.sRim };
        // Затемнение по глубине: дальняя сторона фигуры тусклее ближней — объём читается лучше.
        const uDepth = { value: new THREE.Vector2(8.1, 0.45) };   // расстояние до центра фигуры, сила
        const depthVert = 'vDepthK = 1.0 - uDepth.y * smoothstep(-1.2, 1.6, dist - uDepth.x);';

        const meshFrag = (alphaExpr, extra) => `
            ${G.meshFragment}
            varying vec3 vNormal, vViewPosition;
            varying vec2 vUv;
            ${extra || ''}
            void main() {
                float dpGlow = dpMeshGlow();
                vec3 N = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
                float fresnel = pow(clamp(1.0 - abs(dot(N, normalize(vViewPosition))), 0.0, 1.0), 1.4);
                vec3 color = mix(vec3(0.02, 0.05, 0.1), vec3(0.72, 0.88, 1.0), fresnel * 1.2);
                float a = ${alphaExpr};
                gl_FragColor = vec4(color + dpGlow * vec3(0.45, 0.7, 1.0), a);
            }
        `;

        // ---------- КУПОЛ ----------
        const bellMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime, uRimProf }, morphUniforms),
            vertexShader: `${bellPars} ${G.meshVertex} void main(){ ${bellDisplacement} vDpOrder = aOrder;
                vec4 mv = modelViewMatrix * vec4(pos, 1.0); vViewPosition = -mv.xyz; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: meshFrag('(0.55 + 0.35 * vRib) * (1.0 - smoothstep(0.95, 1.0, vUv.y))', 'varying float vRib;'),
            side: THREE.DoubleSide, transparent: true, depthWrite: false
        }));
        const bellPoints = add(new THREE.ShaderMaterial(pointsBase({
            uniforms: Object.assign({ uTime: S.uTime, uRimProf, uDepth, uBellLook: bellLook, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.2 } }, morphUniforms),
            vertexShader: `
                ${bellPars}
                ${G.pointsVertex}
                uniform vec2 uDepth;
                uniform vec4 uBellLook;
                varying float vDepthK;
                uniform float uViewportScale, uSize;
                attribute float aSizeScale;
                varying float vFresnel, vRimW, vLight;
                void main() {
                    ${bellDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1);
                    ${depthVert}
                    vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.3);
                    vRimW = rimW;
                    // «Свет сверху» в пространстве фигуры: верх купола ярче, к краю — в тень.
                    vLight = clamp(dot(normalize(normal), normalize(vec3(0.15, 1.0, 0.35))) * 0.5 + 0.5, 0.0, 1.0);
                    gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) * (1.0 + uBellLook.w * aRib) / (0.35 + 0.06 * dist);
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                uniform vec4 uBellLook;
                uniform float uRimProf;
                varying float vFresnel, vRimW, vRib, vDepthK, vLight;
                varying vec2 vUv;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    float lit = mix(1.0, vLight * vLight * 1.6, uBellLook.y);
                    vec3 color = mix(vec3(0.05, 0.12, 0.22), vec3(0.72, 0.88, 1.0), vFresnel * 1.1 + vRib * 0.4 + lit * 0.25);
                    // Градиент как у пиона: белое — в нижней широкой части купола, к вершине — лёгкая синева.
                    float whiteK = smoothstep(0.1, uRimProf, vUv.y);
                    color = mix(color * vec3(0.62, 0.8, 1.12), mix(color, vec3(0.92, 0.97, 1.0), 0.35), whiteK);
                    float a = tex.a * (uBellLook.x * lit + 0.12 * vFresnel + uBellLook.z * vRib + 0.05 * vRimW);
                    a *= 1.0 - smoothstep(0.95, 1.0, vUv.y);   // загиб внутрь: последние 5% профиля — в ноль
                    a = a / (0.45 + a * 2.2) * vDepthK;
                    gl_FragColor = dpMorphColor(color, a, tex.a);
                }
            `
        })));

        // ---------- ЛЕНТЫ ----------
        const ribbonAlpha = 'smoothstep(0.03, 0.3, vUv.y) * (1.0 - 0.6 * smoothstep(0.85, 1.0, vUv.y))';   // выходит из «тени» под куполом
        const ribbonMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${ribbonPars} ${G.meshVertex} void main(){ ${ribbonDisplacement} vDpOrder = aOrder;
                vec4 mv = modelViewMatrix * vec4(pos, 1.0); vViewPosition = -mv.xyz; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: meshFrag(`0.6 * ${ribbonAlpha}`),
            side: THREE.DoubleSide, transparent: true, depthWrite: false
        }));
        // Как лепестки пиона: френель, ярче к волнистому краю, та же формула прозрачности.
        const ribbonPoints = add(new THREE.ShaderMaterial(pointsBase({
            uniforms: Object.assign({ uTime: S.uTime, uDepth, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.2 } }, morphUniforms),
            vertexShader: `
                ${ribbonPars}
                ${G.pointsVertex}
                uniform vec2 uDepth;
                varying float vDepthK;
                uniform float uViewportScale, uSize;
                attribute float aSizeScale;
                varying float vAlpha, vFresnel;
                void main() {
                    ${ribbonDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1);
                    ${depthVert}
                    vec3 N = normalize(normalMatrix * normal);
                    vFresnel = pow(clamp(1.0 - abs(dot(N, normalize(-mv.xyz))), 0.0, 1.0), 1.3);
                    gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) * (1.0 + 0.35 * smoothstep(0.7, 1.0, uv.x)) / (0.35 + 0.06 * dist);
                    // Выравнивание видимости: лента, повёрнутая к камере ребром, иначе складывает все точки
                    // в одну яркую линию (add) и «выпрыгивает» вперёд. Плотность точек на экране растёт как
                    // 1/|cos| угла к взгляду — гасим прозрачность обратно; лицевые ленты чуть ярче прежнего.
                    float facing = abs(dot(N, normalize(-mv.xyz)));
                    float comp = mix(0.18, 1.0, smoothstep(0.04, 0.55, facing));
                    vAlpha = (0.34 + 0.2 * vFresnel) * comp * ${ribbonAlpha};
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                varying float vAlpha, vFresnel, vDepthK;
                varying vec2 vUv;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    vec3 color = mix(vec3(0.04, 0.1, 0.2), vec3(0.7, 0.88, 1.0), 0.45 + 0.6 * vFresnel);
                    // Края светятся сильнее, чем у лепестков пиона: волнистая кромка и немного — прямой край.
                    float edgeGlow = smoothstep(0.55, 1.0, vUv.x) * 3.0 + (1.0 - smoothstep(0.0, 0.12, vUv.x)) * 1.8;
                    float a = tex.a * vAlpha * 0.9 * (1.0 + edgeGlow);
                    a = a / (0.45 + a * 2.2) * vDepthK;
                    gl_FragColor = dpMorphColor(color, a, tex.a);
                }
            `
        })));

        // ---------- ЮБКА ----------
        // У стыка с куполом — ноль по прозрачности, к краю с рюшами — видимая; френель как у лепестков.
        const skirtAlpha = 'smoothstep(0.0, 0.55, vUv.y)';
        const skirtMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${skirtPars} ${G.meshVertex} void main(){ ${skirtDisplacement} vDpOrder = aOrder;
                vec4 mv = modelViewMatrix * vec4(pos, 1.0); vViewPosition = -mv.xyz; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: meshFrag(`0.6 * ${skirtAlpha}`),
            side: THREE.DoubleSide, transparent: true, depthWrite: false
        }));
        const skirtPoints = add(new THREE.ShaderMaterial(pointsBase({
            uniforms: Object.assign({ uTime: S.uTime, uDepth, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.2 } }, morphUniforms),
            vertexShader: `
                ${skirtPars}
                ${G.pointsVertex}
                uniform vec2 uDepth;
                varying float vDepthK;
                uniform float uViewportScale, uSize;
                attribute float aSizeScale;
                varying float vAlpha, vFresnel;
                void main() {
                    ${skirtDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1);
                    ${depthVert}
                    vec3 N = normalize(normalMatrix * normal);
                    vFresnel = pow(clamp(1.0 - abs(dot(N, normalize(-mv.xyz))), 0.0, 1.0), 1.3);
                    gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) * (1.0 + 0.35 * smoothstep(0.8, 1.0, uv.y)) / (0.35 + 0.06 * dist);
                    vAlpha = (0.38 + 0.5 * vFresnel) * ${skirtAlpha};   // лицевая сторона не проваливается (как у купола)
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                varying float vAlpha, vFresnel, vDepthK;
                varying vec2 vUv;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    vec3 color = mix(vec3(0.04, 0.1, 0.2), vec3(0.7, 0.88, 1.0), vFresnel * 1.1);
                    float hemGlow = smoothstep(0.65, 1.0, vUv.y) * 3.0;   // нижний край с рюшами светится
                    float a = tex.a * vAlpha * 0.6 * (1.0 + hemGlow);
                    a = a / (0.45 + a * 2.2) * vDepthK;
                    gl_FragColor = dpMorphColor(color, a, tex.a);
                }
            `
        })));

        // ---------- ЩУПАЛЬЦА ----------
        const tentAlpha = 'smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y))';
        const tentMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${tentPars} ${G.meshVertex} void main(){ ${tentDisplacement} vDpOrder = aOrder;
                vec4 mv = modelViewMatrix * vec4(pos, 1.0); vViewPosition = -mv.xyz; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: meshFrag(`0.5 * ${tentAlpha}`),
            side: THREE.DoubleSide, transparent: true, depthWrite: false
        }));
        const tentPoints = add(new THREE.ShaderMaterial(pointsBase({
            depthTest: false,
            uniforms: Object.assign({ uTime: S.uTime, uDepth, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.0 } }, morphUniforms),
            vertexShader: `
                ${tentPars}
                ${G.pointsVertex}
                uniform vec2 uDepth;
                varying float vDepthK;
                uniform float uViewportScale, uSize;
                varying float vFresnel;
                void main(){
                    ${tentDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    float dist = max(-mv.z, 0.1);
                    ${depthVert}
                    gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
                    vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.2);
                    gl_Position = projectionMatrix * mv;
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                varying float vFresnel, vDepthK;
                varying vec2 vUv;
                void main(){
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.02) discard;
                    float tipGlow = smoothstep(0.1, 0.85, vUv.y) * 1.4;
                    float a = tex.a * (0.12 + tipGlow * 0.2) * ${tentAlpha};
                    a = a / (0.45 + a * 1.2) * vDepthK;
                    vec3 baseColor = mix(vec3(0.1, 0.22, 0.38), vec3(0.7, 0.85, 1.0), vFresnel * 1.1);
                    gl_FragColor = dpMorphColor(mix(baseColor, vec3(0.4, 0.7, 0.95), smoothstep(0.4, 0.85, vUv.y)), a, tex.a);
                }
            `
        })));

        return { list, bellMesh, bellPoints, skirtMesh, skirtPoints, ribbonMesh, ribbonPoints, tentMesh, tentPoints };
    }

    // ==========================================
    // РЕГИСТРАЦИЯ
    // ==========================================
    DP.figures.register({
        name: 'jellyfish',
        stageTilt: -0.95,     // наклон сцены: смотрим чуть снизу, «под юбку» купола
        createInstance(ctx) {
            const data = cache[ctx.quality] || (cache[ctx.quality] = buildGeometry(ctx.qualityTier));
            const mats = createMaterials(ctx, data);

            const root = new THREE.Group();
            root.matrixAutoUpdate = false;
            root.matrix.copy(data.rootMatrix);
            const meshRoot = new THREE.Group();
            const pointsRoot = new THREE.Group();
            root.add(meshRoot, pointsRoot);
            const place = (group, obj, matrix) => { obj.matrixAutoUpdate = false; obj.matrix.copy(matrix); group.add(obj); };

            // ?parts=bell,skirt,ribbons,tentacles,stamens — показать только эти части (для доработки по частям).
            const partsParam = DP.params.get('parts') || DEFAULT_PARTS;
            const show = (k) => !partsParam || partsParam.split(',').indexOf(k) >= 0;

            if (show('bell')) data.bells.forEach(b => {
                place(meshRoot, new THREE.Mesh(b.meshGeo, mats.bellMesh), b.matrix);
                place(pointsRoot, new THREE.Points(b.pointsGeo, mats.bellPoints), b.matrix);
            });
            if (show('skirt')) data.skirts.forEach(k => {
                place(meshRoot, new THREE.Mesh(k.meshGeo, mats.skirtMesh), k.matrix);
                place(pointsRoot, new THREE.Points(k.pointsGeo, mats.skirtPoints), k.matrix);
            });
            if (show('ribbons')) data.ribbons.forEach(r => {
                place(meshRoot, new THREE.Mesh(r.meshGeo, mats.ribbonMesh), r.matrix);
                place(pointsRoot, new THREE.Points(r.pointsGeo, mats.ribbonPoints), r.matrix);
            });
            data.tentacles.forEach(t => {
                if (!show(t.kind)) return;
                place(meshRoot, new THREE.Mesh(t.geo, mats.tentMesh), t.matrix);
                place(pointsRoot, new THREE.Points(t.geo, mats.tentPoints), t.matrix);
            });

            return {
                root, meshRoot, pointsRoot,
                layout: data.layout,
                dispose() { mats.list.forEach(m => m.dispose()); }
            };
        }
    });
})(window.DP);
