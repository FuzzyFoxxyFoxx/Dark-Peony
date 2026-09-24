// ==========================================
// DARK PEONY — ФИГУРА «МЕДУЗА»
// ==========================================
// Три части:
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
    const RIBBON_COUNT = 5;       // ленты
    const TENTACLE_COUNT = 12;    // длинные тонкие щупальца
    const FRINGE_COUNT = 72;      // короткие реснички по краю купола

    const ORDER_ANCHOR = new THREE.Vector3(0, 0.95, 0); // вершина купола: распадается последней
    const ORDER_NOISE = 0.3;
    const ORDER_CURVE = 0.6;

    // ==========================================
    // ПРОФИЛЬ КУПОЛА (r, y): вершина → внешняя сторона → скруглённый край → внутренняя чаша → внутренняя вершина
    // ==========================================
    const BELL_PROFILE = [
        [0.00, 0.95], [0.30, 0.92], [0.58, 0.83], [0.85, 0.64], [1.06, 0.38], [1.19, 0.08],
        [1.22, -0.18], [1.15, -0.36], [1.02, -0.45], [0.90, -0.41], [0.86, -0.28],
        [0.80, -0.12], [0.64, 0.03], [0.42, 0.14], [0.20, 0.20], [0.00, 0.22]
    ];

    function makeBellCurve() {
        return new THREE.SplineCurve(BELL_PROFILE.map(p => new THREE.Vector2(p[0], p[1])));
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
        varying vec3 vNormal, vViewPosition;
        varying vec2 vUv;
    `;
    // uv.x — поперёк ленты (0 прямой край, 1 волнистый), uv.y — вдоль (0 верх, 1 низ).
    const ribbonDisplacement = `
        vUv = uv; vec3 pos = position; vec3 dpRest = position;
        float u = uv.y;
        float whip = pow(u, 1.3);
        float t1 = uTime * 0.9 - u * 3.2 + aSeed * 5.1;
        float t2 = uTime * 0.65 - u * 4.6 + aSeed * 2.7;
        pos.x += (sin(t1) * 0.22 + cos(t2) * 0.10) * whip;
        pos.z += (cos(t1 * 0.8) * 0.22 + sin(t2 * 1.2) * 0.10) * whip;
        pos.z += sin(uTime * 1.3 + u * 14.0 + aSeed) * 0.03 * uv.x * whip;
    `;

    const tentPars = `uniform float uTime; attribute float aSeed; varying vec3 vNormal, vViewPosition; varying vec2 vUv;`;
    const tentDisplacement = `
        vUv = uv; vec3 pos = position; vec3 dpRest = position; float whip = pow(uv.y, 1.3);
        float t1 = uTime * 1.2 - uv.y * 7.0 + aSeed * 9.1;
        float t2 = uTime * 0.9 - uv.y * 9.5 + aSeed * 4.3;
        pos.x += (sin(t1) * 0.22 + cos(t2) * 0.10) * whip;
        pos.z += (cos(t1 * 0.85) * 0.22 + sin(t2 * 1.1) * 0.10) * whip;
    `;

    // ==========================================
    // ГЕОМЕТРИЯ
    // ==========================================
    const cache = {};

    function matrixOf(setup) {
        const pivot = new THREE.Object3D();
        const obj = new THREE.Object3D();
        pivot.add(obj);
        setup(pivot, obj);
        pivot.updateMatrixWorld(true);
        return obj.matrixWorld.clone();
    }

    function ribAt(theta) { return Math.pow(0.5 + 0.5 * Math.cos(RIB_COUNT * theta), 10); }

    // ---------- КУПОЛ ----------
    function buildBell(density) {
        const curve = makeBellCurve();
        const lenP = curve.getLength();

        // Параметр профиля в самой нижней точке края.
        let sRim = 0, yMin = Infinity;
        for (let i = 0; i <= 400; i++) { const p = curve.getPointAt(i / 400); if (p.y < yMin) { yMin = p.y; sRim = i / 400; } }

        const ribAmp = 0.03;
        const profR = (s, theta) => {
            const p = curve.getPointAt(s);
            const outer = s < sRim ? Math.pow(Math.sin(Math.PI * s / sRim), 0.6) : 0;
            return { r: Math.max(0, p.x) + ribAmp * ribAt(theta) * outer, y: p.y };
        };

        // Точки: равномерная плотность по площади + уплотнение вдоль каналов.
        const h = 1 / Math.sqrt(density);
        const nS = Math.ceil(lenP / h);
        const pos = [], nor = [], uvs = [], rib = [], size = [];
        let sd = 1.3;
        const pushPoint = (s, theta, ribBoost) => {
            const { r, y } = profR(s, theta);
            const t = curve.getTangentAt(s);
            const nr = -t.y, ny = t.x;                  // нормаль профиля
            const jit = (seededRandom(sd += 1.7) - 0.5) * 0.02;
            const x = (r + nr * jit) * Math.sin(theta), z = (r + nr * jit) * Math.cos(theta);
            pos.push(x, y + ny * jit, z);
            nor.push(nr * Math.sin(theta), ny, nr * Math.cos(theta));
            uvs.push(theta / (Math.PI * 2), s);
            const outer = s < sRim ? 1 : 0.55;
            rib.push(Math.min(1, ribAt(theta) * outer + ribBoost));
            size.push(seededRandom(sd += 0.9));
        };
        for (let i = 0; i < nS; i++) {
            const s = Math.min(1, (i + seededRandom(i * 3.1 + 0.4)) / nS);
            const r = Math.max(0.01, curve.getPointAt(s).x);
            const nT = Math.max(3, Math.round(Math.PI * 2 * r / h));
            for (let j = 0; j < nT; j++) pushPoint(s, (j + seededRandom(i * 7.7 + j * 1.31)) / nT * Math.PI * 2, 0);
            // Каналы: дополнительные точки по линиям от вершины к краю.
            if (s > 0.02) for (let k = 0; k < RIB_COUNT; k++) {
                if (seededRandom(i * 5.3 + k * 2.9) < 0.55) pushPoint(s, (k + (seededRandom(i + k * 9.1) - 0.5) * 0.04) / RIB_COUNT * Math.PI * 2, 0.6);
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
            const k = 1 + ribAmp * ribAt(theta) * outer / Math.max(0.05, Math.hypot(mp.getX(i), mp.getZ(i)));
            mp.setXYZ(i, mp.getX(i) * k, mp.getY(i), mp.getZ(i) * k);
            mRib[i] = ribAt(theta) * (s < sRim ? 1 : 0.55);
        }
        meshGeo.setAttribute('aRib', new THREE.BufferAttribute(mRib, 1));
        meshGeo.computeVertexNormals();

        return { pointsGeo, meshGeo, sRim, rimR: curve.getPointAt(sRim).x, rimY: yMin };
    }

    // ---------- ЛЕНТА ----------
    // Форма ленты в её собственных координатах: x — поперёк, y — вниз по длине, z — из плоскости.
    function ribbonPoint(u, v, p) {
        const W = p.width * Math.sin(Math.PI * (0.2 + 0.8 * u));
        const ph = u * p.len * p.ruffleK + p.seed;
        const rA = p.ruffleAmp * (W / p.width);
        // Волнистый край длиннее прямого: волна в плоскости ленты + рюши из плоскости в той же фазе
        // (без сдвига фаз край не закручивается штопором, а складывается гармошкой).
        let across = v * W + Math.pow(v, 2.0) * rA * 0.9 * Math.sin(ph);
        let z = Math.pow(v, 1.8) * rA * 0.6 * Math.sin(ph + 0.5);
        const a = p.twist * u + p.seed * 0.3;                              // лёгкое скручивание вдоль длины
        const x = across * Math.cos(a) - z * Math.sin(a);
        z = across * Math.sin(a) + z * Math.cos(a);
        return [
            x + p.splay * Math.pow(u, 0.8) + Math.sin(u * Math.PI * 1.2 + p.seed) * 0.14 * u,
            -u * p.len,
            z + Math.cos(u * Math.PI * 0.9 + p.seed * 1.7) * 0.12 * u
        ];
    }

    function buildRibbon(p, density) {
        const h = 1 / Math.sqrt(density);
        const nU = Math.ceil(p.len * 1.15 / h);
        const pos = [], nor = [], uvs = [], seeds = [], size = [];
        const e = 1e-3;
        let sd = p.seed * 11.3;
        for (let i = 0; i < nU; i++) {
            const u = Math.min(1, (i + seededRandom(sd += 1.1)) / nU);
            const W = p.width * Math.sin(Math.PI * (0.2 + 0.8 * u));
            const nV = Math.max(1, Math.ceil(W * 1.35 / h));
            for (let j = 0; j < nV; j++) {
                const v = Math.min(1, (j + seededRandom(sd += 1.3)) / nV);
                const q = ribbonPoint(u, v, p);
                const du = ribbonPoint(Math.min(1, u + e), v, p), dv = ribbonPoint(u, Math.min(1, v + e), p);
                const ax = du[0] - q[0], ay = du[1] - q[1], az = du[2] - q[2];
                const bx = dv[0] - q[0], by = dv[1] - q[1], bz = dv[2] - q[2];
                let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
                const nl = Math.hypot(nx, ny, nz) || 1;
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

        // Поверхность.
        const segU = 220, segV = 16;
        const mPos = [], mUv = [], mSeed = [], idx = [];
        for (let i = 0; i <= segU; i++) for (let j = 0; j <= segV; j++) {
            const u = i / segU, v = j / segV;
            const q = ribbonPoint(u, v, p);
            mPos.push(q[0], q[1], q[2]); mUv.push(v, u); mSeed.push(p.seed);
        }
        for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
            const a = i * (segV + 1) + j, b = a + segV + 1;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
        const meshGeo = new THREE.BufferGeometry();
        meshGeo.setIndex(idx);
        meshGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
        meshGeo.setAttribute('uv', new THREE.Float32BufferAttribute(mUv, 2));
        meshGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(mSeed, 1));
        meshGeo.computeVertexNormals();
        return { pointsGeo, meshGeo };
    }

    // ---------- ТОНКОЕ ЩУПАЛЬЦЕ (трубка вниз) ----------
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
        const pos = [], nor = [], uvs = [], seeds = [], idx = [];
        for (let i = 0; i <= segments; i++) {
            const v = i / segments;
            const c = path.getPointAt(v);
            const r = radius * Math.max(0.1, Math.pow(1 - v * 0.9, 1.1));
            for (let j = 0; j <= radial; j++) {
                const th = j / radial * Math.PI * 2;
                const nx = Math.cos(th), nz = Math.sin(th);
                pos.push(c.x + nx * r, c.y, c.z + nz * r);
                nor.push(nx, 0, nz);
                uvs.push(j / radial, v);
                seeds.push(seed);
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
        return geo;
    }

    function buildGeometry(tier) {
        // Плотность точек относительно эталона (high): как у пиона — меньше на слабых уровнях.
        const q = Math.pow(tier.petalSegments / 100, 2) * tier.petalMultiplier / 3;
        const density = 16000 * q;

        const bell = buildBell(density);
        bell.matrix = new THREE.Matrix4();

        const ribbons = [];
        for (let i = 0; i < RIBBON_COUNT; i++) {
            const seed = i * 3.71 + 0.9;
            const p = {
                seed,
                len: 1.55 + seededRandom(seed * 2.1) * 0.4,
                width: 0.7 + seededRandom(seed * 3.3) * 0.2,
                ruffleK: 22 + seededRandom(seed * 4.7) * 6,
                ruffleAmp: 0.16,
                twist: 0.2 + seededRandom(seed * 5.9) * 0.3,
                splay: 0.45 + seededRandom(seed * 6.7) * 0.25
            };
            const { pointsGeo, meshGeo } = buildRibbon(p, density);
            const angle = (i / RIBBON_COUNT) * Math.PI * 2 + 0.3;
            const matrix = matrixOf((pivot, obj) => {
                pivot.rotation.y = angle;
                obj.position.set(0, 0.24, 0.3);
                obj.rotation.y = -Math.PI / 2;       // поперёк ленты — наружу от оси
            });
            ribbons.push({ pointsGeo, meshGeo, matrix });
        }

        const tentacles = [];
        for (let i = 0; i < TENTACLE_COUNT; i++) {
            const seed = i * 2.43 + 1.7;
            const angle = (i / TENTACLE_COUNT) * Math.PI * 2 + 0.12;
            const len = 1.8 + seededRandom(seed * 1.9) * 0.5;
            const geo = buildTentacle(len, 0.035, seed, 130, 8, 0.35);
            const matrix = matrixOf((pivot, obj) => {
                pivot.rotation.y = angle;
                obj.position.set(0, bell.rimY + 0.04, bell.rimR * 0.96);
            });
            tentacles.push({ geo, matrix });
        }
        for (let i = 0; i < FRINGE_COUNT; i++) {
            const seed = i * 1.37 + 40.2;
            const angle = (i / FRINGE_COUNT) * Math.PI * 2;
            const geo = buildTentacle(0.18 + seededRandom(seed) * 0.16, 0.02, seed, 14, 4, 0.05);
            const matrix = matrixOf((pivot, obj) => {
                pivot.rotation.y = angle;
                obj.position.set(0, bell.rimY + 0.02, bell.rimR);
                obj.rotation.x = 0.35;               // реснички чуть наружу
            });
            tentacles.push({ geo, matrix });
        }

        const rootMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(0, FIG_Y_OFFSET, 0), new THREE.Quaternion(),
            new THREE.Vector3(FIG_SCALE, FIG_SCALE, FIG_SCALE));

        const data = { bell, ribbons, tentacles, rootMatrix };
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
        const pointSources = [{ geo: data.bell.pointsGeo, matrix: data.bell.matrix }];
        data.ribbons.forEach(r => pointSources.push({ geo: r.pointsGeo, matrix: r.matrix }));
        data.tentacles.forEach(t => pointSources.push({ geo: t.geo, matrix: t.matrix }));
        const meshOnly = [{ geo: data.bell.meshGeo, matrix: data.bell.matrix }];
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
            fragmentShader: meshFrag('0.55 + 0.35 * vRib', 'varying float vRib;'),
            side: THREE.DoubleSide, transparent: true, depthWrite: false
        }));
        const bellPoints = add(new THREE.ShaderMaterial(pointsBase({
            uniforms: Object.assign({ uTime: S.uTime, uRimProf, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.2 } }, morphUniforms),
            vertexShader: `
                ${bellPars}
                ${G.pointsVertex}
                uniform float uViewportScale, uSize;
                attribute float aSizeScale;
                varying float vFresnel, vRimW;
                void main() {
                    ${bellDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1);
                    vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.3);
                    vRimW = rimW;
                    gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) / (0.35 + 0.06 * dist);
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                varying float vFresnel, vRimW, vRib;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    vec3 color = mix(vec3(0.05, 0.12, 0.22), vec3(0.72, 0.88, 1.0), vFresnel * 1.1 + vRib * 0.4);
                    float a = tex.a * (0.02 + 0.09 * vFresnel + 0.07 * vRib + 0.05 * vRimW);
                    a = a / (0.45 + a * 2.2);
                    gl_FragColor = dpMorphColor(color, a, tex.a);
                }
            `
        })));

        // ---------- ЛЕНТЫ ----------
        const ribbonAlpha = 'smoothstep(0.0, 0.09, vUv.y) * (1.0 - 0.6 * smoothstep(0.85, 1.0, vUv.y))';
        const ribbonMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${ribbonPars} ${G.meshVertex} void main(){ ${ribbonDisplacement} vDpOrder = aOrder;
                vec4 mv = modelViewMatrix * vec4(pos, 1.0); vViewPosition = -mv.xyz; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: meshFrag(`0.6 * ${ribbonAlpha}`),
            side: THREE.DoubleSide, transparent: true, depthWrite: false
        }));
        const ribbonPoints = add(new THREE.ShaderMaterial(pointsBase({
            uniforms: Object.assign({ uTime: S.uTime, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.2 } }, morphUniforms),
            vertexShader: `
                ${ribbonPars}
                ${G.pointsVertex}
                uniform float uViewportScale, uSize;
                attribute float aSizeScale;
                varying float vFresnel;
                void main() {
                    ${ribbonDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1);
                    vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.3);
                    gl_PointSize = uSize * uViewportScale * (0.7 + aSizeScale * 0.5) / (0.35 + 0.06 * dist);
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                varying float vFresnel;
                varying vec2 vUv;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    float edge = smoothstep(0.6, 1.0, vUv.x);
                    vec3 color = mix(vec3(0.05, 0.12, 0.22), vec3(0.72, 0.88, 1.0), vFresnel * 1.1 + edge * 0.3);
                    float a = tex.a * (0.03 + 0.10 * vFresnel + 0.07 * edge) * ${ribbonAlpha};
                    a = a / (0.45 + a * 2.2);
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
            uniforms: Object.assign({ uTime: S.uTime, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.0 } }, morphUniforms),
            vertexShader: `
                ${tentPars}
                ${G.pointsVertex}
                uniform float uViewportScale, uSize;
                varying float vFresnel;
                void main(){
                    ${tentDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    float dist = max(-mv.z, 0.1);
                    gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
                    vFresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.2);
                    gl_Position = projectionMatrix * mv;
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                varying float vFresnel;
                varying vec2 vUv;
                void main(){
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.02) discard;
                    float tipGlow = smoothstep(0.1, 0.85, vUv.y) * 1.4;
                    float a = tex.a * (0.12 + tipGlow * 0.2) * ${tentAlpha};
                    a = a / (0.45 + a * 1.2);
                    vec3 baseColor = mix(vec3(0.1, 0.22, 0.38), vec3(0.7, 0.85, 1.0), vFresnel * 1.1);
                    gl_FragColor = dpMorphColor(mix(baseColor, vec3(0.4, 0.7, 0.95), smoothstep(0.4, 0.85, vUv.y)), a, tex.a);
                }
            `
        })));

        return { list, bellMesh, bellPoints, ribbonMesh, ribbonPoints, tentMesh, tentPoints };
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

            place(meshRoot, new THREE.Mesh(data.bell.meshGeo, mats.bellMesh), data.bell.matrix);
            place(pointsRoot, new THREE.Points(data.bell.pointsGeo, mats.bellPoints), data.bell.matrix);
            data.ribbons.forEach(r => {
                place(meshRoot, new THREE.Mesh(r.meshGeo, mats.ribbonMesh), r.matrix);
                place(pointsRoot, new THREE.Points(r.pointsGeo, mats.ribbonPoints), r.matrix);
            });
            data.tentacles.forEach(t => {
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
