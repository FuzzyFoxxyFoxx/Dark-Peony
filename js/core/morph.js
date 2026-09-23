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
        uVortexA: { value: new THREE.Vector4() },     // radiusMin, radiusMax, flare, turbulence
        uVortexB: { value: new THREE.Vector4() },     // flow, precession, swirlSize, swirlAlpha
        uSwirlColor: { value: new THREE.Vector3() }
    };

    function syncConfig() {
        const c = DP.config.morph;
        shared.uMorphSched.value.set(c.leaveStart, c.leaveSpread, c.arriveStart, c.arriveSpread);
        shared.uMorphSched2.value.set(c.assemble === 'outside-in' ? 0 : 1, c.meshRevealLag, c.meshFade, 0);
        shared.uVortexA.value.set(c.vortexRadiusMin, c.vortexRadiusMax, c.vortexFlare, c.turbulence);
        shared.uVortexB.value.set(c.flow, c.precession, c.swirlSize, c.swirlAlpha);
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

    const pointsVertex = `
        ${commonPars}
        uniform mat4 uStageMatrix;
        uniform mat4 uStageMatrixInv;
        uniform vec4 uVortexA;
        uniform vec4 uVortexB;
        uniform vec3 uSwirlColor;
        attribute vec4 aMorphOut;
        attribute vec4 aMorphIn;
        varying float vDpW;
        varying float vDpGlow;
        varying float vDpFade;
        varying vec3 vDpSwirlColor;
        varying float vDpSwirlAlpha;
        float dpHidden;
        float dpSizeMul;

        float dpHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
        float dpAzimuth(vec3 p) { return (abs(p.x) + abs(p.z) < 1e-5) ? 0.0 : atan(p.x, p.z); }

        // restLocal — точка в покое (без анимации), animLocal — текущая анимированная позиция.
        // Обе в локальных координатах объекта. Возвращает мировую позицию.
        vec4 dpMorph(vec3 restLocal, vec3 animLocal) {
            dpHidden = 0.0; dpSizeMul = 1.0;
            vDpW = 0.0; vDpGlow = 0.0; vDpFade = 1.0;
            vDpSwirlColor = uSwirlColor; vDpSwirlAlpha = 0.0;

            vec4 world = modelMatrix * vec4(animLocal, 1.0);
            if (uMorphActive < 0.5) return world;

            bool outRole = uMorphRole < 0.5;
            vec4 m = outRole ? aMorphOut : aMorphIn;
            float L = floor(m.x / 2048.0) * 0.01;
            float D = max(mod(m.x, 2048.0) * 0.01, 0.05);
            float arrive = L + D;
            float t = uMorphTime;
            float s = clamp((t - L) / D, 0.0, 1.0);

            // Видимость: уходящая точка живёт до середины пути, прилетающая — после.
            if (outRole) {
                if (s >= 0.5) dpHidden = 1.0;
                if (uMeshMode > 0.5 && t < L) dpHidden = 1.0;       // в MESH до отрыва видна поверхность
                vDpGlow = smoothstep(L - 0.7, L, t) * (1.0 - smoothstep(0.0, 0.3, s));
            } else {
                if (s < 0.5) dpHidden = 1.0;
                if (uMeshMode > 0.5) vDpFade = 1.0 - smoothstep(uMorphSched2.y, uMorphSched2.y + uMorphSched2.z, t - arrive);
                vDpGlow = smoothstep(0.75, 1.0, s) * (1.0 - smoothstep(0.0, 0.6, t - arrive));
            }
            if (dpHidden > 0.5) return world;

            float seed = fract(m.z);
            float extra = step(1.5, m.z);  // точка без пары: гаснет / рождается в вихре
            float delta = m.y;             // полный угол поворота пары вокруг оси
            float yMid = m.w;              // высота пары в середине вихря

            vec3 cur = (uStageMatrixInv * world).xyz;
            vec3 rest = (uStageMatrixInv * modelMatrix * vec4(restLocal, 1.0)).xyz;

            float w = sin(3.14159265 * s); w *= w;       // 0 → 1 (середина) → 0
            float g = s * s * (3.0 - 2.0 * s);            // плавный разгон и торможение по углу

            float thRest = dpAzimuth(rest);
            float dTh = dpAzimuth(cur) - thRest;
            dTh -= 6.2831853 * floor((dTh + 3.14159265) / 6.2831853);
            float thPath = outRole ? thRest + delta * g : thRest - delta * (1.0 - g);
            float th = thPath + dTh * (1.0 - w);

            float h1 = dpHash(seed * 91.7);
            float h2 = dpHash(seed * 53.3 + 1.7);
            float rMid = mix(uVortexA.x, uVortexA.y, h1) * (1.0 + uVortexA.z * max(yMid, 0.0));
            // Когерентные струи: зависят от угла/высоты пути — соседи движутся согласованно.
            rMid += uVortexB.x * (sin(3.0 * thPath + 1.7 * yMid - 1.9 * t) * 0.6 + sin(5.0 * thPath - 1.1 * yMid + 1.3 * t) * 0.4);

            float r = mix(length(cur.xz), rMid, w);
            float y = mix(cur.y, yMid, w);
            vec3 p = vec3(sin(th) * r, y, cos(th) * r);

            // Индивидуальные флуктуации.
            float ph = seed * 6.2831853;
            vec3 turb = vec3(
                sin(t * 1.7 + ph * 3.0 + yMid * 1.3) + 0.5 * sin(t * 3.3 + ph * 7.0),
                0.7 * sin(t * 1.3 + ph * 5.0 + 2.0 * thPath),
                cos(t * 1.9 + ph * 4.0 + yMid * 1.1) + 0.5 * cos(t * 2.9 + ph * 9.0));
            p += turb * uVortexA.w * w;
            p.xz += vec2(sin(t * 0.63), cos(t * 0.47)) * uVortexB.y * w;

            vDpW = w;
            vDpSwirlColor = uSwirlColor * (0.7 + 0.6 * h2);
            vDpSwirlAlpha = uVortexB.w * (0.5 + h2);
            dpSizeMul = mix(1.0, uVortexB.z * (0.7 + 0.6 * h1), w);
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
        varying float vDpW;
        varying float vDpGlow;
        varying float vDpFade;
        varying vec3 vDpSwirlColor;
        varying float vDpSwirlAlpha;

        // color/alpha — «родной» цвет точки фигуры, texA — альфа текстуры частицы.
        vec4 dpMorphColor(vec3 color, float alpha, float texA) {
            vec3 c = mix(color, vDpSwirlColor, vDpW);
            float a = mix(alpha, texA * vDpSwirlAlpha, vDpW);
            c = mix(c, vec3(0.85, 0.95, 1.0), vDpGlow * 0.6);
            a *= (1.0 + vDpGlow * 1.8) * vDpFade;
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
            }
            const part = {
                start: total, count,
                rest: p.rest,
                order: geo.attributes.aOrder.array,
                outAttr: geo.attributes.aMorphOut,
                inAttr: geo.attributes.aMorphIn
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

    // ------------------------------------------
    // ПЛАНИРОВЩИК
    // ------------------------------------------
    // Записывает расписание в aMorphOut фигуры A и aMorphIn фигуры B.
    // Возвращает длительность морфинга (сек).
    function plan(A, B) {
        const c = DP.config.morph;
        syncConfig();
        const NA = A.total, NB = B.total, N = Math.max(NA, NB);
        const insideOut = c.assemble !== 'outside-in';
        const usedA = new Uint8Array(NA), usedB = new Uint8Array(NB);
        let end = 0;

        for (let k = 0; k < N; k++) {
            const ia = A.sorted[Math.floor(k * NA / N)];
            const kb = Math.floor(k * NB / N);
            const ib = B.sorted[insideOut ? NB - 1 - kb : kb];
            const firstA = !usedA[ia], firstB = !usedB[ib];
            if (!firstA && !firstB) continue;
            usedA[ia] = 1; usedB[ib] = 1;

            const pa = A.parts[A.partOf[ia]], la = ia - pa.start;
            const pb = B.parts[B.partOf[ib]], lb = ib - pb.start;
            const ax = pa.rest[la * 3], ay = pa.rest[la * 3 + 1], az = pa.rest[la * 3 + 2];
            const bx = pb.rest[lb * 3], by = pb.rest[lb * 3 + 1], bz = pb.rest[lb * 3 + 2];

            const seed = U.seededRandom(k * 0.618 + 0.37);
            const rnd = U.seededRandom(k * 1.319 + 5.1);

            const orderA = U.clamp(pa.order[la], 0, 1);
            const orderB = U.clamp(pb.order[lb], 0, 1);
            const keyB = insideOut ? 1 - orderB : orderB;
            const L = c.leaveStart + c.leaveSpread * orderA;
            const target = c.arriveStart + c.arriveSpread * keyB + (rnd - 0.5) * c.travelJitter;
            const D = U.clamp(target - L, c.minTravel, c.maxTravel);

            // Время упаковано в одно число: шаг 10 мс, до 20.47 с на каждое поле.
            const Lq = U.clamp(Math.round(L * 100), 0, 2047);
            const Dq = U.clamp(Math.round(D * 100), 5, 2047);
            const packed = Lq * 2048 + Dq;
            end = Math.max(end, (Lq + Dq) * 0.01);

            const delta = TWO_PI + U.wrapPi(U.azimuth(bx, bz) - U.azimuth(ax, az));
            const yMid = U.clamp(0.5 * (ay + by) + c.vortexLift * (0.35 + seed), c.vortexYMin, c.vortexYMax);

            if (firstA) {
                const o = pa.outAttr.array, j = la * 4;
                o[j] = packed; o[j + 1] = delta; o[j + 2] = seed + (firstB ? 0 : 2); o[j + 3] = yMid;
            }
            if (firstB) {
                const o = pb.inAttr.array, j = lb * 4;
                o[j] = packed; o[j + 1] = delta; o[j + 2] = seed + (firstA ? 0 : 2); o[j + 3] = yMid;
            }
        }

        A.parts.forEach(p => { p.outAttr.needsUpdate = true; });
        B.parts.forEach(p => { p.inAttr.needsUpdate = true; });

        return end + c.meshRevealLag + c.meshFade + 0.1;
    }

    DP.morph = {
        shared,
        syncConfig,
        createInstanceUniforms,
        uniformsFor,
        createLayout,
        plan,
        glsl: { pointsVertex, pointsFragment, meshVertex, meshFragment }
    };
})(window.DP);
