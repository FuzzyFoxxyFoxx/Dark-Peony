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
            vec3 vr = (uShape.x > 0.5 ? sphereFlow(q, t, uTimes.w) : ringFlow(q, t, uTimes.w)) * uNoise2.w;
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
                        uLife: { value: new THREE.Vector4() }, uTimes: { value: new THREE.Vector4() }, uMove: { value: new THREE.Vector4() }, uShape: { value: new THREE.Vector4() }, uExtra: { value: new THREE.Vector4() }
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

        stop() { shared.uSmokeA.value.x = 0; }
    };
})(window.DP);
