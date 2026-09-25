// ==========================================
// DARK PEONY — ДЫМНОЕ КОЛЬЦО ДЛЯ МОРФИНГА (симуляция на видеокарте)
// ==========================================
//
// Каждая пара частиц морфинга — один пиксель текстуры: в нём положение частицы (xyz, пространство сцены)
// и её возраст в кольце (w). Физика — как в лаборатории lab/smoke.html:
//   • до отрыва частица стоит на фигуре A;
//   • оторвавшись, осыпается вниз с ускорением (песок), и кольцо захватывает её: тянет к сердцевине тора;
//   • в кольце её несёт течение вихревого кольца (кружение вокруг сердцевины + бег вдоль кольца)
//     и водовороты двух размеров; частица живёт: к концу жизни гаснет и рождается заново в сердцевине;
//   • в свой срок кольцо отпускает частицу, и она садится на своё место в фигуре B.
// w: −1 — стоит на фигуре (до отрыва или после посадки), −0.5 — в полёте, но ещё не в кольце, ≥ 0 — возраст.
(function (DP) {
    'use strict';

    const shared = DP.morph.shared;
    const LAB_R = 1.46;   // радиус кольца в лаборатории: параметры течения заданы в её единицах
    let support = null, side = 0, targets = null, cur = 0;
    let texA = null, texB = null, texS = null;
    let scene = null, camera = null, material = null;
    let needReset = true, lastTime = 0;

    const simFragment = `
        precision highp float;
        uniform sampler2D uState, uA, uB, uS;
        uniform float uSide, uTime, uDt, uReset;
        uniform vec4 uCenter;   // центр кольца (xyz), масштаб «сцена / лаборатория»
        uniform vec4 uRing;     // R, сердцевина, кружение, бег вдоль кольца (единицы лаборатории)
        uniform vec4 uNoise;    // крупные: сила, частота; мелкие: сила, частота
        uniform vec4 uNoise2;   // изменчивость, доля улетающих, подъём, скорость частиц
        uniform vec4 uLife;     // жизнь от, до, появление (доля), наклон кольца
        uniform vec4 uTimes;    // захват (с), посадка (с), ускорение осыпания, притяжение к сердцевине
        uniform vec4 uShape;    // форма: 0 — кольцо, 1 — сфера; клубление сферы (вихрь Хилла); перерождение частиц (0/1); разгон закрутки, с (0 — только до захвата)
        uniform vec4 uExtra;    // посадка по спирали (0/1), -, -, -
        uniform vec4 uDisk;     // диск (координаты кольца): внутренний радиус, внешний, полутолщина, скорость вращения
        uniform vec4 uDisk2;    // диск: притяжение по радиусу, по высоте, показатель (скорость ~ r^p), уровни (0 — диск, 1 — каждая на своей высоте)
        uniform vec4 uMove;     // движение кольца: скорость центра по высоте, скорость «дыхания» (dR/dt / R), закрутка до захвата, вращение кольца (рад/с)
        ${DP.morph.glsl.simplexNoise}
        float dpHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
        float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 eddy(vec3 q, float t) {
            vec3 g1 = dpSnoiseGrad(q + vec3(0.0, -t, 0.0)).xyz;
            vec3 g2 = dpSnoiseGrad(q + vec3(31.4, 7.1 + 0.5 * t, 5.3)).xyz;
            return cross(g1, g2);
        }
        // Кольцо в своих координатах (лаборатория): ось — Y, наклон uLife.w вокруг X.
        vec3 toRing(vec3 p) {
            vec3 d = (p - uCenter.xyz) / uCenter.w;
            float c = cos(uLife.w), s = sin(uLife.w);
            return vec3(d.x, d.y * c + d.z * s, -d.y * s + d.z * c);
        }
        vec3 fromRingDir(vec3 v) {
            float c = cos(uLife.w), s = sin(uLife.w);
            return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c) * uCenter.w;
        }
        vec3 fromRingPos(vec3 q) { return uCenter.xyz + fromRingDir(q); }
        // Течение кольца в точке (координаты кольца), + притяжение к сердцевине с силой pull.
        vec3 ringFlow(vec3 p, float t, float pull) {
            float R = uRing.x, a = uRing.y;
            vec3 e = normalize(vec3(p.x, 0.0, p.z) + vec3(1e-5, 0.0, 0.0));
            vec2 q = vec2(length(p.xz) - R, p.y);
            float rho = max(length(q), 1e-4);
            float vt = uRing.z * a / rho * (1.0 - exp(-rho * rho / (a * a)));
            vec2 tq = vec2(-q.y, q.x) / rho;
            vec3 up = vec3(0.0, 1.0, 0.0);
            vec3 v = (e * tq.x + up * tq.y) * vt;
            v += cross(up, e) * uRing.w * exp(-rho * rho / (4.0 * a * a));
            float ts = t * uNoise2.x;
            v += uNoise.x * eddy(p * uNoise.y, ts);
            v += uNoise.z * eddy(p * uNoise.w + vec3(17.0, 3.0, -9.0), ts * 1.7);
            // Захват: частицу вдали от сердцевины тянет к ней (в сечении тора).
            vec2 pq = -q / rho * pull * smoothstep(a, 3.0 * a, rho);
            v += e * pq.x + up * pq.y;
            return v;
        }
        // Дымная сфера (координаты кольца, радиус R): вихрь Хилла — внутри шар клубится (вверх по оси, вниз
        // по краям), снаружи течение гаснет, и частицу мягко тянет обратно к шару; водовороты — те же.
        vec3 sphereFlow(vec3 p, float t, float pull) {
            float a = uRing.x;
            vec3 e = normalize(vec3(p.x, 0.0, p.z) + vec3(1e-5, 0.0, 0.0));
            vec3 up = vec3(0.0, 1.0, 0.0);
            float rho = length(p.xz), z = p.y, r = length(p);
            float k = uShape.y;
            vec3 v = 2.0 * k * ((rho * z / (a * a)) * e + (1.0 - (2.0 * rho * rho + z * z) / (a * a)) * up);
            if (r > a) v *= pow(a / r, 3.0);
            v += cross(up, e) * uRing.w * rho / a;                       // закрутка вокруг оси
            float ts = t * uNoise2.x;
            v += uNoise.x * eddy(p * uNoise.y, ts);
            v += uNoise.z * eddy(p * uNoise.w + vec3(17.0, 3.0, -9.0), ts * 1.7);
            v -= normalize(p + vec3(1e-5)) * pull * smoothstep(a * 0.9, a * 1.6, r);
            return v;
        }
        // Диск (координаты кольца): вихрь как чай в чашке — всё вращается вокруг оси (внутри быстрее),
        // частицы стягиваются в толстое кольцо-диск с пустой серединой на уровне экватора. Без водоворотов.
        // lvl — «свой уровень» пары (координаты кольца): между местом в старой и в новой фигуре.
        vec3 diskFlow(vec3 p, float seed, vec3 lvl) {
            vec3 up = vec3(0.0, 1.0, 0.0);
            float r = length(p.xz);
            vec3 e = normalize(vec3(p.x, 0.0, p.z) + vec3(1e-5, 0.0, 0.0));
            float vt = uDisk.w * pow(max(r, 0.25 * uDisk.y) / uDisk.y, uDisk2.z);
            vec3 v = cross(up, e) * vt;
            // У каждой частицы своё место в толще диска (радиус и высота от seed) — диск заполнен объёмно,
            // частицы не скапливаются на его границах.
            float ur = sqrt(dpHash(seed * 5.31 + 0.7));
            float rT = mix(uDisk.x, uDisk.y, ur);
            // Сечение — линза: толще всего в середине кольца, к краям сходит на нет (бублик, галактика).
            float yT = (dpHash(seed * 9.17 + 2.3) * 2.0 - 1.0) * uDisk.z * pow(sin(3.14159265 * ur), 0.8);
            // Уровни: частица крутится на своей высоте (верх — в верх, низ — в низ), радиус — свой, но не ближе
            // к оси, чем пустая середина.
            float lr = max(length(lvl.xz), uDisk.x * (0.7 + 0.3 * ur));
            yT = mix(yT, lvl.y, uDisk2.w);
            rT = mix(rT, lr, uDisk2.w);
            v += e * (rT - r) * uDisk2.x;
            v.y += (yT - p.y) * uDisk2.y;
            return v;
        }
        void main() {
            vec2 uv = gl_FragCoord.xy / uSide;
            vec4 A = texture2D(uA, uv), B = texture2D(uB, uv);
            if (B.w <= 0.0) { gl_FragColor = vec4(0.0); return; }
            float L = A.w, T = A.w + B.w, t = uTime;
            vec4 st = texture2D(uState, uv);
            if (uReset > 0.5 || t <= L) { gl_FragColor = vec4(A.xyz, -1.0); return; }
            if (t >= T) { gl_FragColor = vec4(B.xyz, -1.0); return; }
            vec3 p = st.xyz; float age = st.w;
            if (age < -0.75) { p = A.xyz; age = -0.5; }          // только что оторвалась
            float seed = texture2D(uS, uv).x;
            float life = mix(uLife.x, uLife.y, dpHash(seed * 13.7 + 2.9));
            float since = t - L, left = T - t;
            float cap = smoothstep(0.0, uTimes.x, since);         // кольцо захватывает частицу
            float land = 1.0 - smoothstep(0.0, uTimes.y, left);   // кольцо отпускает, частица садится
            float ringW = cap * (1.0 - land);

            // Осыпание: пока кольцо не захватило частицу, она падает с ускорением.
            vec3 v = vec3(0.0, -uTimes.z * since, 0.0) * (1.0 - cap);
            // Закрутка: до захвата частица начинает кружить вокруг оси фигуры (как вихрь), всё быстрее.
            vec3 ew = normalize(vec3(p.x, 0.0, p.z) + vec3(1e-5, 0.0, 0.0));
            // Закрутка как чай в стакане: скорость по кругу растёт со временем и одинакова на любом радиусе,
            // поэтому внутри частицы делают больше оборотов — вихрь тянется в спиральные рукава.
            // uShape.w > 0: закрутка продолжается и в середине (разгон за uShape.w с) и гаснет только при посадке.
            float twistV = uShape.w > 0.0 ? min(since, uShape.w) * (1.0 - land) : (1.0 - cap) * since;
            v += cross(vec3(0.0, 1.0, 0.0), ew) * uMove.z * twistV;
            // Кольцо едет и «дышит» — захваченные частицы едут вместе с ним.
            v += (vec3(0.0, uMove.x, 0.0) + vec3(p.x - uCenter.x, 0.0, p.z - uCenter.z) * uMove.y) * cap * (1.0 - land);
            // Вращение кольца вокруг оси (вихрь): всё кольцо крутится, быстрее всего на экваторе сферы.
            v += cross(vec3(0.0, 1.0, 0.0), vec3(p.x - uCenter.x, 0.0, p.z - uCenter.z)) * uMove.w * cap * (1.0 - land);
            vec3 q = toRing(p);
            vec3 vr = (uShape.x > 1.5 ? diskFlow(q, seed, toRing(mix(A.xyz, B.xyz, smoothstep(0.0, 1.0, since / max(T - L, 1e-3))))) : uShape.x > 0.5 ? sphereFlow(q, t, uTimes.w) : ringFlow(q, t, uTimes.w)) * uNoise2.w;
            // Улетающие: часть частиц отрывается от кольца и уходит вверх, рассеиваясь.
            float esc = step(dpHash(seed * 7.3 + 1.1), uNoise2.y) * uNoise2.z * (age > 0.0 ? smoothstep(0.2, 1.0, age / life) : 0.0);
            vr.y += esc;
            v += fromRingDir(vr) * cap * (1.0 - land * land);   // водовороты гаснут только к самому концу посадки
            p += v * uDt;

            // Посадка: частица подходит к своему месту в фигуре B и садится точно к сроку.
            if (land > 0.0) {
                float fl = clamp(uDt * 3.0 / max(left, uDt), 0.0, 1.0) * land;
                if (uExtra.x > 0.5) {
                    // Сборка — зеркало распада: частица раскручивается из вихря по спирали в ту же сторону
                    // (угол вокруг оси догоняет свой угол вперёд), замедляется и садится на своё место.
                    vec2 c0 = uCenter.xz;
                    vec2 d = p.xz - c0, db = B.xz - c0;
                    float r = length(d), rb = length(db);
                    float th = atan(d.x, d.y), thb = atan(db.x, db.y);
                    float dth = mod(thb - th + 1.5707963, 6.2831853) - 1.5707963;
                    th += dth * fl; r = mix(r, rb, fl);
                    p = vec3(c0.x + sin(th) * r, mix(p.y, B.y, fl), c0.y + cos(th) * r);
                } else p = mix(p, B.xyz, fl);
            }

            // Жизнь в кольце: первая жизнь начинается уже видимой; умершая частица рождается в сердцевине.
            if (age < 0.0 && cap > 0.99 && uShape.z > 0.5) age = life * uLife.z;   // без перерождения — жизнь не идёт
            if (age >= 0.0) {
                age += uDt;
                if (age > life && ringW > 0.99 && left > uTimes.y + 0.3) {
                    float r1 = h2(uv + fract(t * 0.137)), r2 = h2(uv * 1.7 + fract(t * 0.291) + 3.1), r3 = h2(uv * 2.3 + fract(t * 0.173) + 7.7);
                    float ph = r1 * 6.2831853, th = r2 * 6.2831853, rr = uRing.y * 0.8 * sqrt(r3);
                    vec3 e = vec3(cos(ph), 0.0, sin(ph));
                    if (uShape.x > 0.5) {   // сфера: рождается в случайной точке шара
                        float ct = r2 * 2.0 - 1.0, rs = uRing.x * pow(r3, 0.333);
                        p = fromRingPos(rs * vec3(sqrt(1.0 - ct * ct) * cos(ph), ct, sqrt(1.0 - ct * ct) * sin(ph)));
                    } else p = fromRingPos(e * (uRing.x + rr * cos(th)) + vec3(0.0, rr * sin(th), 0.0));
                    age = 0.0;
                }
            }
            gl_FragColor = vec4(p, age);
        }
    `;

    function checkSupport(renderer) {
        const caps = renderer.capabilities, ext = renderer.extensions;
        if (!caps.floatVertexTextures) return false;
        let type = null;
        if (caps.isWebGL2) {
            if (ext.has('EXT_color_buffer_float')) type = THREE.FloatType;
        } else if (ext.has('OES_texture_float') && ext.has('WEBGL_color_buffer_float')) type = THREE.FloatType;
        if (!type) return false;   // положению частицы нужна полная точность (half float «дрожит»)
        const rt = new THREE.WebGLRenderTarget(4, 4, { type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt);
        const gl = renderer.getContext();
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        renderer.setRenderTarget(prev);
        rt.dispose();
        return ok ? { type } : false;
    }

    const dataTex = (arr, n) => {
        const t = new THREE.DataTexture(arr, n, n, THREE.RGBAFormat, THREE.FloatType);
        t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
    };
    const makeTarget = (n, type) => new THREE.WebGLRenderTarget(n, n, {
        type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false });

    DP.smokeSim = {
        supported() {
            if (!DP.stage) return false;
            if (support === null) {
                try { support = checkSupport(DP.stage.renderer); } catch (e) { console.warn('DP.smokeSim:', e); support = false; }
                if (!support) console.info('DP.smokeSim: устройство не поддерживает дымный морфинг — используется фонтан');
            }
            return !!support;
        },

        // n — сторона текстуры; dA: xyz фигуры A + отрыв L; dB: xyz фигуры B + длительность D; dS: seed.
        // ring: { center, R } — неподвижное кольцо, или { at(t) → {y, R, dy, dR} } — кольцо едет и дышит.
        // timing: { capture, land, gravity, pull, twist } — вместо значений DP.config.morph.smoke.
        prepare(n, dA, dB, dS, ring, timing) {
            if (!this.supported()) return;
            if (n !== side) {
                if (targets) targets.forEach(t => t.dispose());
                side = n;
                targets = [makeTarget(n, support.type), makeTarget(n, support.type)];
            }
            [texA, texB, texS].forEach(t => t && t.dispose());
            texA = dataTex(dA, n); texB = dataTex(dB, n); texS = dataTex(dS, n);
            if (!material) {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uState: { value: null }, uA: { value: null }, uB: { value: null }, uS: { value: null },
                        uSide: { value: 1 }, uTime: { value: 0 }, uDt: { value: 0 }, uReset: { value: 1 },
                        uCenter: { value: new THREE.Vector4() }, uRing: { value: new THREE.Vector4() },
                        uNoise: { value: new THREE.Vector4() }, uNoise2: { value: new THREE.Vector4() },
                        uLife: { value: new THREE.Vector4() }, uTimes: { value: new THREE.Vector4() }, uMove: { value: new THREE.Vector4() }, uShape: { value: new THREE.Vector4() }, uExtra: { value: new THREE.Vector4() },
                        uDisk: { value: new THREE.Vector4() }, uDisk2: { value: new THREE.Vector4() }
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
            const u = material.uniforms, f = DP.config.morph.smoke;
            u.uA.value = texA; u.uB.value = texB; u.uS.value = texS; u.uSide.value = n;
            this.ring = ring; this.timing = timing || null;
            this.placeRing(0);
            this.sync();
            needReset = true; lastTime = 0;
            shared.uSmokeTex.value = targets[cur].texture;
        },

        // Параметры течения и жизни из DP.config.morph.smoke (можно менять на ходу).
        placeRing(t) {
            const u = material.uniforms, r = this.ring;
            if (r.at) {
                const q = r.at(t);
                u.uCenter.value.set(0, q.y, 0, q.R / LAB_R);
                u.uMove.value.x = q.dy; u.uMove.value.y = q.dR / Math.max(q.R, 1e-3); u.uMove.value.w = q.w || 0;
            } else {
                u.uCenter.value.set(r.center.x, r.center.y, r.center.z, r.R / LAB_R);
                u.uMove.value.x = 0; u.uMove.value.y = 0; u.uMove.value.w = r.w || 0;
            }
        },

        sync() {
            if (!material) return;
            const u = material.uniforms, f = DP.config.morph.smoke;
            const tc = this.timing && this.timing.core != null ? this.timing.core : f.core;
            u.uRing.value.set(LAB_R, tc, f.spin, f.swirl);
            const tm0 = this.timing || {}, nk = tm0.noiseK != null ? tm0.noiseK : 1;
            u.uNoise.value.set(f.noiseAmp * nk, f.noiseScale, f.detailAmp * nk, f.detailScale);
            // Свои водовороты режима: крупные гнут вихрь, мелкие рвут кромки на завитки.
            if (tm0.eddy) { const e = tm0.eddy; u.uNoise.value.set(e[0], e[1], e[2], e[3]); u.uNoise2.value.x = e[4]; }
            u.uShape.value.set(tm0.shape || 0, tm0.roll || 0, tm0.respawn != null ? tm0.respawn : 1, tm0.twistRamp || 0);
            u.uExtra.value.set(tm0.spiral ? 1 : 0, 0, 0, 0);
            if (tm0.escape != null) u.uNoise2.value.y = tm0.escape;
            if (tm0.speed != null) u.uNoise2.value.w = tm0.speed;
            if (tm0.disk) { const d = tm0.disk; u.uDisk.value.set(d[0] * LAB_R, LAB_R, d[1] * LAB_R, d[2]); u.uDisk2.value.set(d[3], d[4], d[5], d[6] || 0); }
            u.uNoise2.value.set(f.noiseSpeed, f.escape, f.lift, f.speed);
            u.uLife.value.set(f.lifeMin, Math.max(f.lifeMin + 0.01, f.lifeMax), f.fadeIn, f.tilt);
            const tm = this.timing || f;
            u.uTimes.value.set(tm.capture, tm.land, tm.gravity, tm.pull);
            u.uMove.value.z = tm.twist || 0;
        },

        step(time) {
            if (!targets || !material || shared.uSmokeA.value.x < 0.5) return;
            const renderer = DP.stage.renderer, u = material.uniforms;
            this.sync();
            const total = Math.max(0, time - lastTime);
            const n = needReset ? 1 : Math.min(6, Math.max(1, Math.ceil(total / (1 / 60))));
            const prevTarget = renderer.getRenderTarget(), prevAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            for (let i = 0; i < n; i++) {
                u.uState.value = targets[cur].texture;
                u.uTime.value = needReset ? 0 : lastTime + total * (i + 1) / n;
                u.uDt.value = needReset ? 0 : total / n;
                u.uReset.value = needReset ? 1 : 0;
                this.placeRing(u.uTime.value);
                renderer.setRenderTarget(targets[1 - cur]);
                renderer.render(scene, camera);
                cur = 1 - cur;
                needReset = false;
            }
            renderer.setRenderTarget(prevTarget);
            renderer.autoClear = prevAutoClear;
            lastTime = time;
            shared.uSmokeTex.value = targets[cur].texture;
        },

        stop() { shared.uSmokeA.value.x = 0; shared.uShadowInfo.value.x = 0; },

        // ---------- самозатенение (как в The Spirit): плотность дыма «со стороны света» ----------
        // Точки пар рисуются ортографической камерой света в маленькую текстуру; канал = слой глубины
        // (R — ближе всего к свету … A — дальше всего). Шейдер фигуры читает её (DP.morph: uShadowTex).
        setShadow(k, center, radius) {
            shared.uShadowInfo.value.set(k > 0 ? 1 : 0, k, 0, 0);
            this.shadowCenter = center; this.shadowR = radius;
            if (!(k > 0) || !targets) return;
            if (!this.shadowRT) {
                this.shadowRT = new THREE.WebGLRenderTarget(256, 256, { type: support.type === THREE.FloatType ? THREE.HalfFloatType : support.type,
                    format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
                // HalfFloat не везде рисуется — тогда полная точность.
                const r = DP.stage.renderer, prev = r.getRenderTarget();
                r.setRenderTarget(this.shadowRT);
                const gl = r.getContext();
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    this.shadowRT.dispose();
                    this.shadowRT = new THREE.WebGLRenderTarget(256, 256, { type: support.type, format: THREE.RGBAFormat,
                        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
                }
                r.setRenderTarget(prev);
                this.lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
                this.shadowMat = new THREE.ShaderMaterial({
                    uniforms: { uState: { value: null }, uStage: shared.uStageMatrix, uLight: { value: new THREE.Matrix4() } },
                    vertexShader: `
                        uniform sampler2D uState; uniform mat4 uStage, uLight;
                        attribute vec2 aRef; varying float vSlab;
                        void main() {
                            vec4 st = texture2D(uState, aRef);
                            if (st.x == 0.0 && st.y == 0.0 && st.z == 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
                            vec4 c = uLight * (uStage * vec4(st.xyz, 1.0));
                            gl_Position = c; gl_PointSize = 2.0;
                            vSlab = clamp(c.z * 0.5 + 0.5, 0.0, 0.9999) * 4.0;
                        }`,
                    fragmentShader: `
                        varying float vSlab;
                        void main() { gl_FragColor = vec4(equal(vec4(floor(vSlab)), vec4(0.0, 1.0, 2.0, 3.0))); }`,
                    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
                    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
                    depthTest: false, depthWrite: false, transparent: true
                });
                this.shadowScene = new THREE.Scene();
            }
            if (this.shadowSide !== side) {
                if (this.shadowPts) { this.shadowScene.remove(this.shadowPts); this.shadowPts.geometry.dispose(); }
                const ref = new Float32Array(side * side * 2);
                for (let i = 0; i < side * side; i++) { ref[i * 2] = ((i % side) + 0.5) / side; ref[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side; }
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(side * side * 3), 3));
                g.setAttribute('aRef', new THREE.BufferAttribute(ref, 2));
                this.shadowPts = new THREE.Points(g, this.shadowMat);
                this.shadowPts.frustumCulled = false;
                this.shadowScene.add(this.shadowPts);
                this.shadowSide = side;
            }
            shared.uShadowTex.value = this.shadowRT.texture;
        },

        renderShadow() {
            if (shared.uShadowInfo.value.x < 0.5 || shared.uSmokeA.value.x < 0.5 || !this.shadowRT || !targets) return;
            const r = DP.stage.renderer, R = this.shadowR;
            // Свет сверху-спереди-слева, неподвижен в мире; сцена вращается под ним.
            const c = this.shadowCenter.clone().applyMatrix4(shared.uStageMatrix.value);
            const cam = this.lightCam;
            cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = R * 0.5; cam.far = R * 3.5;
            cam.position.copy(c).add(new THREE.Vector3(-0.35, 1, 0.45).normalize().multiplyScalar(R * 2));
            cam.lookAt(c); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
            this.shadowMat.uniforms.uLight.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
            shared.uShadowLight.value.copy(this.shadowMat.uniforms.uLight.value);
            this.shadowMat.uniforms.uState.value = targets[cur].texture;
            const prev = r.getRenderTarget(), prevClear = r.autoClear, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
            r.setRenderTarget(this.shadowRT);
            r.setClearColor(0x000000, 0); r.clear(true, false, false);
            r.autoClear = false;
            r.render(this.shadowScene, cam);
            r.autoClear = prevClear;
            r.setClearColor(cc, ca);
            r.setRenderTarget(prev);
        }
    };
})(window.DP);
