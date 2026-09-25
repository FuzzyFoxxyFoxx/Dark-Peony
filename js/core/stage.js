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
    // ФОН: ГАЛАКТИКА (звёзды) + ДЫМКА
    // ------------------------------------------
    // Постоянная часть фона, не относится к фигурам. Галактика — «пол»: плоский диск звёзд в горизонтальной
    // плоскости (как у цветка), уходит к горизонту и медленно вращается вокруг вертикальной оси. Над ним —
    // россыпь звёзд, вращается медленнее (параллакс). Туманности — в основном в плоскости диска.
    // Защитный кокон: звёзды и дымка видны только за фигурой (дальше от камеры, чем её центр) — крупные звёзды
    // перед камерой не пролетают; на границе кокона плавно гаснут.
    const bg = cfg.background;
    const galaxy = new THREE.Group();   // диск + туманности (вращается вокруг своей оси)
    const halo = new THREE.Group();     // звёзды над диском (вращаются медленнее)
    // Плоскость галактики наклонена так, чтобы её видимый дальний край был на `horizon` высоты экрана сверху
    // (автор: на линии, делящей верхнюю половину пополам; угол утверждён).
    const galaxyTilt = new THREE.Group();
    galaxyTilt.position.set(0, bg.diskY, 0);
    (function placeHorizon() {
        // угол подбирается так, чтобы дальний край звёздного диска (diskOut) был на `horizon` высоты экрана сверху
        camera.updateMatrixWorld(); camera.updateProjectionMatrix();
        const p = new THREE.Vector3(), screenY = (a) => {
            galaxyTilt.rotation.x = a; galaxyTilt.updateMatrixWorld(true);
            p.set(0, 0, -bg.diskOut).applyMatrix4(galaxyTilt.matrixWorld).project(camera);
            return (1 - p.y) / 2;
        };
        let lo = -1.4, hi = 0.5;                                            // выше угол — выше дальний край
        for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (screenY(m) > bg.horizon) lo = m; else hi = m; }
        galaxyTilt.rotation.x = (lo + hi) / 2;
    })();
    galaxyTilt.add(galaxy);
    galaxy.scale.setScalar(bg.scale);   // крупнее (автор, +40%); наклон «пола» считается по исходному размеру — угол прежний
    scene.add(galaxyTilt, halo);
    const cocoon = { value: 8.5 };      // глубина (от камеры), ближе которой фона нет; задаётся по центру фигуры
    const cocoonGlsl = `
        uniform float uCocoon;
        float dpCocoon(float depth) { return smoothstep(uCocoon, uCocoon + 1.5, depth); }
    `;
    // Тёмная середина галактики (автор): в центре всегда фигура, и точки галактики там мешают — туманность, звёзды
    // и пыль диска, облака плавно гаснут к центру (радиусы — в единицах диска, до масштаба bg.scale).
    const hole = { value: new THREE.Vector2(bg.holeIn, bg.holeOut) };
    const holeGlsl = `
        uniform vec2 uHole;
        float dpHole(vec3 p) { float r = length(p.xz); float k = smoothstep(uHole.x, uHole.y, r); return k * k * (3.0 - 2.0 * k); }
    `;
    function starMaterial(holeOn) {
        return new THREE.ShaderMaterial(Object.assign({}, DP.pointsMaterialConfig, {
            uniforms: {
                uTexture: DP.shared.uTexture, uViewportScale: DP.shared.uViewportScale,
                uSize: { value: bg.starSize }, uAlpha: { value: bg.starAlpha }, uTime: DP.shared.uTime, uCocoon: cocoon,
                uHole: hole, uHoleOn: { value: holeOn ? 1 : 0 }
            },
            vertexShader: `
                uniform float uViewportScale, uSize, uTime, uHoleOn;
                attribute float aSizeScale, aPhase, aFree;
                varying float vAlpha;
                ${cocoonGlsl}
                ${holeGlsl}
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    float dist = max(-mvPosition.z, 0.1);
                    // крупные звёзды редкие; за коконом звёзды не мельчают сильнее, чем на расстоянии ~9 (иначе пропадают)
                    gl_PointSize = uSize * uViewportScale * (0.6 + 1.6 * aSizeScale * aSizeScale) / (0.4 + 0.08 * min(dist, 9.0));
                    float tw = 0.55 + 0.45 * sin(uTime * (0.6 + 1.3 * fract(aPhase * 3.1)) + aPhase);   // мерцание
                    vAlpha = (0.35 + 0.65 * aSizeScale) * tw * max(dpCocoon(dist), aFree);   // aFree = 1: звезда рукава, кокон не действует
                    vAlpha *= mix(1.0, dpHole(position), uHoleOn);                          // диск — с тёмной серединой, «небо» — нет
                    if (vAlpha < 0.002) gl_PointSize = 0.0;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;
                uniform float uAlpha;
                varying float vAlpha;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    vec3 col = mix(vec3(0.25, 0.5, 0.85), vec3(0.85, 0.95, 1.0), tex.a);
                    gl_FragColor = vec4(col, tex.a * vAlpha * uAlpha);
                }
            `
        }));
    }
    function starPoints(count, place, salt, holeOn) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3), scales = new Float32Array(count), phases = new Float32Array(count), free = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const p = place(i);
            pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2]; free[i] = p[3] || 0;
            scales[i] = seededRandom(i * 4.1 + salt);
            phases[i] = seededRandom(i * 7.3 + salt) * 6.2831853;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aSizeScale', new THREE.BufferAttribute(scales, 1));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geo.setAttribute('aFree', new THREE.BufferAttribute(free, 1));
        const pts = new THREE.Points(geo, starMaterial(holeOn));
        pts.frustumCulled = false;
        return pts;
    }
    const nHalo = Math.round(bg.stars * bg.halo), nDisk = bg.stars - nHalo;
    // Спираль: рукава неравные (автор: «натуралистичность и рандомайз») — у каждого свой сдвиг угла, закрутка,
    // ширина, сила и длина хвоста, лёгкая волнистость. Тот же список — у туманности, звёзд, пыли и облаков.
    const ARMS = [];
    for (let k = 0; k < bg.arms; k++) {
        const rnd = (m) => seededRandom(k * 13.7 + m * 3.1 + bg.armSeed);
        ARMS.push({
            phase: (k + (rnd(1) - 0.5) * 0.7) * Math.PI * 2 / bg.arms,
            wind: bg.winding * (0.75 + 0.5 * rnd(2)),
            width: 0.65 + 0.7 * rnd(3),
            power: k < 2 ? 1 : 0.7 + 0.25 * rnd(4),                 // два главных рукава, остальные чуть слабее
            tail: bg.nebulaR * (0.65 + 0.45 * rnd(5)),             // где рукав сходит на нет
            wob: rnd(6) * 6.28
        });
    }
    const armPower = ARMS.reduce((a, b) => a + b.power, 0);
    const pickArm = (u) => { let x = u * armPower; for (let k = 0; k < ARMS.length; k++) { x -= ARMS[k].power; if (x <= 0) return k; } return ARMS.length - 1; };
    const armAngle = (r, k) => { const A = ARMS[k % ARMS.length], rr = Math.max(r, 0.25);
        return A.phase + Math.log(rr / bg.diskIn) * A.wind + 0.18 * Math.sin(rr * 1.1 + A.wob); };
    const gauss = (k) => (seededRandom(k) + seededRandom(k * 1.7 + 0.3) + seededRandom(k * 2.9 + 0.7) - 1.5) / 1.5;
    // Диск: звёзды в основном на рукавах спирали (с разбросом), часть — хаотично; толстый в середине, к краю тоньше.
    const diskStars = starPoints(nDisk, (i) => {
        const r = bg.diskIn + Math.pow(seededRandom(i * 2.3), 0.9) * (bg.diskOut - bg.diskIn);
        let u, onArm = seededRandom(i * 6.1 + 0.4) < bg.armShare;
        if (onArm) { const k = pickArm(seededRandom(i * 1.5)); u = armAngle(r, k) + gauss(i * 3.3) * bg.armSpread * ARMS[k].width; }
        else u = seededRandom(i * 1.5) * Math.PI * 2;
        const thick = bg.diskThick * Math.pow(1 - (r - bg.diskIn) / (bg.diskOut - bg.diskIn), 0.8) + 0.05;
        return [Math.cos(u) * r, gauss(i * 3.7) * thick, Math.sin(u) * r, onArm ? 1 : 0];   // звёзды рукавов видны и перед фигурой
    }, 0, true);
    galaxy.add(diskStars);

    // Туманность в плоскости пола: мягкая спиральная туманность без штрихов (автор: «царапины на пластинке» не нужны).
    // Плотность считается попиксельно: рукава спирали (та же armAngle, что у звёзд) × облачный фрактальный шум.
    // Шум берётся в «раскрученной» системе координат — облака вытягиваются вдоль рукавов. Вращается вместе с диском.
    (function createNebula() {
        const S = 512, c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        const NR = bg.nebulaR, half = S / 2, scale = half / NR;   // единицы сцены → пиксели текстуры
        // сглаженный шум по решётке + фрактал (несколько октав)
        const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
        const vnoise = (x, y) => {
            const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
            const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
            const a = hash(ix, iy), b = hash(ix + 1, iy), c2 = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
            return a + (b - a) * ux + (c2 - a) * uy + (a - b - c2 + d) * ux * uy;
        };
        const fbm = (x, y, oct) => { let s = 0, w = 0.5, n = 0; for (let o = 0; o < oct; o++) { s += vnoise(x, y) * w; n += w; x = x * 2.03 + 17.1; y = y * 2.03 + 5.3; w *= 0.5; } return s / n; };
        const img = g.createImageData(S, S), D = img.data;
        const sigma = bg.armSpread * 0.7;
        for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
            const x = (px + 0.5 - half) / scale, y = (py + 0.5 - half) / scale;
            const r = Math.hypot(x, y);
            if (r >= NR) continue;
            const th = Math.atan2(y, x);
            // близость к рукавам: гауссиана по углу; у каждого рукава своя ширина (гуляет по длине), сила и хвост
            let arm = 0;
            for (let k = 0; k < ARMS.length; k++) {
                const A = ARMS[k], d = DP.util.wrapPi(th - armAngle(r, k));
                const sg = sigma * A.width * (0.75 + 0.45 * r / NR) * (0.8 + 0.25 * Math.sin(r * 1.7 + A.wob * 2));
                const tail = 1 - DP.util.smoothstep(A.tail * 0.45, A.tail, r);
                arm = Math.max(arm, Math.exp(-(d * d) / (sg * sg)) * A.power * tail);
            }
            // раскрученные координаты: в них рукава прямые, облака потом закручиваются вместе с ними
            const un = -Math.log(Math.max(r, 0.25) / bg.diskIn) * bg.winding, cu = Math.cos(un), su = Math.sin(un);
            const qx = (x * cu - y * su) * 0.9, qy = (x * su + y * cu) * 0.9;
            const wx = fbm(qx + 3.1, qy + 7.7, 3), wy = fbm(qx - 5.2, qy + 1.3, 3);     // искажение — клубы, а не пятна
            const n = fbm(qx + 2.2 * wx, qy + 2.2 * wy, 5);
            const cloud = Math.max(0, n - 0.22) / 0.78;
            // ярче к центру, к хвостам слабее; рукава закручиваются почти до ядра; слабое ядро (bg.nebulaCore)
            const env = DP.util.smoothstep(0.15, bg.diskIn * 0.7, r) * Math.pow(1 - r / NR, 1.5) * (1 + 1.2 * Math.exp(-r / bg.diskIn));
            const core = bg.nebulaCore * Math.exp(-(r * r) / (bg.diskIn * bg.diskIn * 0.35)) * (0.6 + 0.4 * n);
            const dens = env * (0.12 + 0.88 * arm) * Math.pow(cloud, 1.25) * 2.6 + core;
            // мягкий «потолок»: плотные места рукавов не выгорают в белое (автор)
            D[(py * S + px) * 4 + 3] = 255 * bg.nebulaCap * (1 - Math.exp(-dens / bg.nebulaCap));
        }
        g.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: tex }, uAlpha: { value: bg.nebulaAlpha }, uCocoon: cocoon, uHole: hole, uNR: { value: NR } },
            vertexShader: `
                varying vec2 vUv; varying float vDepth;
                void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
            `,
            fragmentShader: `
                uniform sampler2D uTex; uniform float uAlpha; uniform float uCocoon, uNR;
                varying vec2 vUv; varying float vDepth;
                ${holeGlsl}
                void main() {
                    vec4 t = texture2D(uTex, vUv);
                    // туманность тоньше кокона: её дальняя часть видна, ближняя (перед фигурой) мягко гаснет
                    float k = smoothstep(uCocoon - 3.0, uCocoon, vDepth);
                    vec2 q = (vUv - 0.5) * 2.0 * uNR;
                    k *= dpHole(vec3(q.x, 0.0, q.y));                   // тёмная середина
                    gl_FragColor = vec4(vec3(0.72, 0.84, 1.0), t.a * uAlpha * k);
                }
            `,
            transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(NR * 2, NR * 2), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.renderOrder = -2;
        mesh.frustumCulled = false;
        galaxy.add(mesh);
        galaxy.userData.nebulaMat = mat;
    })();
    // Звёздная пыль: много мелких звёзд размером с точку лепестка пиона — вдоль рукавов, с толщиной (к центру
    // толще), поэтому при вращении виден параллакс: галактика — объём, а не картинка на плоскости.
    const dust = (function createDust() {
        const n = Math.round(bg.dust * (DP.quality === 'low' ? 0.4 : DP.quality === 'medium' ? 0.7 : 1));
        const R = bg.dustR, geo = new THREE.BufferGeometry();
        const pos = new Float32Array(n * 3), br = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const onArm = seededRandom(i * 1.37 + 71) < 0.8;
            const r = 0.25 + Math.pow(seededRandom(i * 2.11 + 72), 1.5) * (R - 0.25);   // гуще к центру
            let u;
            if (onArm) {
                // распыление вдоль рукава (автор: на 20–30% сильнее, мягче переход от пустоты к скоплению):
                // основной разброс × dustSpread, у трети звёзд — вдвое шире («хвост» разброса)
                const k = pickArm(seededRandom(i * 3.07 + 73)), wide = seededRandom(i * 9.7 + 79) < 0.33 ? 2 : 1;
                u = armAngle(r, k) + gauss(i * 4.3 + 74) * bg.armSpread * 0.55 * bg.dustSpread * wide * ARMS[k].width;
            }
            else u = seededRandom(i * 5.9 + 75) * Math.PI * 2;
            const thick = bg.dustThick * (0.25 + Math.exp(-r / (bg.diskIn * 1.2)));
            const rr = r + gauss(i * 6.1 + 76) * 0.12 * bg.dustSpread * 1.4;
            pos[i * 3] = Math.cos(u) * rr; pos[i * 3 + 1] = gauss(i * 7.7 + 77) * thick; pos[i * 3 + 2] = Math.sin(u) * rr;
            br[i] = (0.25 + 0.75 * Math.pow(seededRandom(i * 8.3 + 78), 2)) * (onArm ? 1 : 0.5) * (1 - 0.7 * r / R)
                  * (0.5 + seededRandom(i * 10.9 + 80));   // яркость гуляет ±50%
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aBright', new THREE.BufferAttribute(br, 1));
        const mat = new THREE.ShaderMaterial(Object.assign({}, DP.pointsMaterialConfig, {
            uniforms: { uTexture: DP.shared.uTexture, uViewportScale: DP.shared.uViewportScale,
                        uSize: { value: bg.dustSize }, uAlpha: { value: bg.dustAlpha }, uHole: hole },
            vertexShader: `
                uniform float uViewportScale, uSize;
                attribute float aBright;
                varying float vA;
                ${holeGlsl}
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1);
                    gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * min(dist, 8.0)));   // как точка лепестка
                    vA = aBright * dpHole(position);   // пыль рукавов — без кокона (автор); середина тёмная
                    if (vA < 0.002) gl_PointSize = 0.0;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture; uniform float uAlpha;
                varying float vA;
                void main() {
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if (tex.a < 0.01) discard;
                    gl_FragColor = vec4(vec3(0.75, 0.87, 1.0), tex.a * vA * uAlpha);
                }
            `
        }));
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        galaxy.add(pts);
        return pts;
    })();
    // Звёздное небо: дальняя сфера вокруг фигуры — её дальняя половина (за коконом) закрывает весь кадр
    // позади фигуры, и сверху, и снизу; вращается медленнее диска (параллакс).
    const haloStars = starPoints(nHalo, (i) => {
        const u = seededRandom(i * 1.9 + 11) * Math.PI * 2, ct = seededRandom(i * 3.3 + 13) * 2 - 1, st = Math.sqrt(1 - ct * ct);
        const r = bg.haloIn + seededRandom(i * 2.9 + 12) * (bg.haloOut - bg.haloIn);
        return [Math.cos(u) * st * r, ct * r, Math.sin(u) * st * r];
    }, 50);
    halo.add(haloStars);

    (function createHaze() {
        // Мягкая текстура облака: пятно с неровным краем (несколько смещённых градиентов).
        const size = 256, c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        for (let k = 0; k < 7; k++) {
            const x = size * (0.5 + (seededRandom(k * 3.1) - 0.5) * 0.35), y = size * (0.5 + (seededRandom(k * 5.7) - 0.5) * 0.35);
            const r = size * (0.22 + seededRandom(k * 2.3) * 0.22);
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, 'rgba(255,255,255,0.22)');
            gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(0, 0, size, size);
        }
        const tex = new THREE.CanvasTexture(c);
        const count = bg.clouds;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3), seed = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const high = seededRandom(i * 3.9 + 5) < bg.cloudHigh;   // немногие облака — выше диска
            const r = bg.diskIn + Math.sqrt(seededRandom(i * 6.7 + 2)) * (bg.diskOut - bg.diskIn);
            const u = armAngle(r, pickArm(seededRandom(i * 9.1 + 1))) + gauss(i * 2.2 + 9) * bg.armSpread;   // облака — вдоль рукавов
            pos[i * 3] = Math.cos(u) * r;
            pos[i * 3 + 1] = high ? 1.5 + seededRandom(i * 4.3 + 3) * bg.haloHigh * 0.6 : (seededRandom(i * 4.3 + 3) - 0.5) * bg.diskThick * 2;
            pos[i * 3 + 2] = Math.sin(u) * r;
            seed[i] = seededRandom(i * 2.9 + 4);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: tex }, uTime: DP.shared.uTime, uViewportScale: DP.shared.uViewportScale,
                        uSize: { value: bg.cloudSize }, uAlpha: { value: bg.cloudAlpha }, uCocoon: cocoon, uHole: hole },
            vertexShader: `
                uniform float uTime, uViewportScale, uSize;
                attribute float aSeed;
                varying float vA; varying float vRot;
                ${cocoonGlsl}
                ${holeGlsl}
                void main() {
                    vec3 p = position;
                    p.x += sin(uTime * 0.05 + aSeed * 12.0) * 0.4;   // облака медленно плывут
                    p.z += cos(uTime * 0.04 + aSeed * 7.0) * 0.4;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1);
                    gl_PointSize = uSize * uViewportScale * (0.7 + 0.8 * aSeed) / (0.4 + 0.08 * dist);
                    vA = (0.5 + 0.5 * sin(uTime * (0.07 + 0.08 * aSeed) + aSeed * 20.0)) * dpCocoon(dist) * dpHole(position);   // медленно «дышат»
                    vRot = aSeed * 6.2831853 + uTime * 0.02 * (aSeed - 0.5);
                    if (vA < 0.002) gl_PointSize = 0.0;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTex; uniform float uAlpha;
                varying float vA; varying float vRot;
                void main() {
                    vec2 q = gl_PointCoord - 0.5;
                    float c = cos(vRot), s = sin(vRot);
                    q = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + 0.5;
                    float a = texture2D(uTex, q).a;
                    gl_FragColor = vec4(vec3(0.45, 0.62, 0.9), a * vA * uAlpha);
                }
            `,
            transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        pts.renderOrder = -1;
        galaxy.add(pts);
        galaxy.userData.cloudMat = mat;
    })();
    DP.background = {
        galaxy, halo,
        // Фон (галактика, звёзды, облака) можно спрятать — чтобы рассматривать фигуру (?bg=0, кнопка на панели ?tune).
        get visible() { return galaxy.visible; },
        setVisible(v) { galaxyTilt.visible = halo.visible = galaxy.visible = !!v; },
        // Применить значения из DP.config.background / hud на ходу (панель ?tune).
        sync() {
            const b = cfg.background, c = galaxy.userData.cloudMat.uniforms;
            [diskStars, haloStars].forEach(p => { p.material.uniforms.uSize.value = b.starSize; p.material.uniforms.uAlpha.value = b.starAlpha; });
            c.uSize.value = b.cloudSize; c.uAlpha.value = b.cloudAlpha;
            galaxy.userData.nebulaMat.uniforms.uAlpha.value = b.nebulaAlpha;
            dust.material.uniforms.uSize.value = b.dustSize; dust.material.uniforms.uAlpha.value = b.dustAlpha;
            hole.value.set(b.holeIn, Math.max(b.holeIn + 0.01, b.holeOut)); galaxy.scale.setScalar(b.scale);
            drawHud(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
        }
    };
    if (DP.params.get('bg') === '0') DP.background.setVisible(false);
    // Кокон — по центру фигур: всё фоновое, что ближе к камере, чем центр фигуры (+ запас), не рисуется.
    cocoon.value = camera.position.distanceTo(new THREE.Vector3(0, -0.48, 0)) + bg.cocoonMargin;

    // ------------------------------------------
    // 2D HUD: две «весики» — малая (с крестиками) и большая
    // ------------------------------------------
    // Малая: круг R в центре и два круга R с центрами сверху и снизу — проходят через центр; на пересечениях —
    // крестики. Большая — то же с радиусом R2 (выходит за экран), без знаков на пересечениях.
    // Все линии одной толщины; крестики масштабируются вместе с кругами (размер — доля R).
    const hudCanvas = document.getElementById('hudCanvas');
    const hudCtx = hudCanvas.getContext('2d');

    function drawHud(w, h) {
        const dpr = Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio);
        hudCanvas.width = Math.round(w * dpr);
        hudCanvas.height = Math.round(h * dpr);
        hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        hudCtx.clearRect(0, 0, w, h);
        const H = cfg.hud;

        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.475;
        const R2 = R * H.bigK;

        hudCtx.lineWidth = H.line;
        hudCtx.strokeStyle = H.color;
        const circle = (x, y, r) => { hudCtx.beginPath(); hudCtx.arc(x, y, r, 0, Math.PI * 2); hudCtx.stroke(); };
        [R, R2].forEach(r => { circle(cx, cy, r); circle(cx, cy - r, r); circle(cx, cy + r, r); });

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

        // Точки пересечения: круг r в центре с кругами сверху/снизу — под углом ±30° от горизонтали.
        const marks = (r) => { const ox = r * Math.sin(Math.PI / 3); return [[cx - ox, cy - r / 2], [cx + ox, cy - r / 2], [cx - ox, cy + r / 2], [cx + ox, cy + r / 2]]; };
        const crossSz = R * H.crossK, crossW = Math.max(0.35, R * H.crossLineK);   // тоньше 1 px — на ретине это 1 физ. пиксель
        hudCtx.strokeStyle = H.markColor; hudCtx.lineWidth = crossW;
        hudCtx.globalAlpha = H.crossAlpha;
        marks(R).forEach(([x, y]) => {
            hudCtx.beginPath();
            hudCtx.moveTo(x - crossSz, y); hudCtx.lineTo(x + crossSz, y);
            hudCtx.moveTo(x, y - crossSz); hudCtx.lineTo(x, y + crossSz);
            hudCtx.stroke();
        });
        hudCtx.globalAlpha = 1;
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
        galaxy.rotation.y = DP.shared.uTime.value * cfg.background.spin;             // диск галактики медленно вращается
        halo.rotation.y = DP.shared.uTime.value * cfg.background.spin * cfg.background.haloSpin;   // россыпь — медленнее (параллакс)
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
