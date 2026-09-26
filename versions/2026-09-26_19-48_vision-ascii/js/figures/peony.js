// ==========================================
// DARK PEONY — ФИГУРА «ПИОН» (медуза)
// ==========================================
// Геометрия и внешний вид перенесены из Gedal_web_preview_005_crossplatform (archive/).
// Изменения относительно оригинала:
//  • подключены GLSL-блоки морфинга (DP.morph.glsl.*);
//  • статичная часть изгиба лепестков (S-кривая, рюши, объёмный разброс) «запечена» в позиции
//    точек на CPU — результат тот же, а морфинг знает точное положение точки в покое;
//  • каждой точке назначен порядок распада aOrder (от дальних кончиков к низу и центру);
//  • геометрия кэшируется и общая для всех экземпляров фигуры.
(function (DP) {
    'use strict';

    const { seededRandom, noise, smoothstep } = DP.util;

    const RECEPTACLE_RADIUS = 0.48;
    const FLOWER_SCALE = 0.72;
    const FLOWER_Y_OFFSET = -0.55;
    const PI_GLSL = 3.14159; // как в шейдере — чтобы запечённые позиции совпадали

    // Точка, от которой считается расстояние для порядка распада: основание цветка.
    const ORDER_ANCHOR = new THREE.Vector3(0, -0.25, 0);
    const ORDER_NOISE = 0.3;      // неровность фронта распада
    const ORDER_JITTER = 0;       // разброс отрыва теперь задаёт планировщик (DP.config.morph.orderJitter)
    const ORDER_CURVE = 0.6;      // <1 — больше времени на плотные лепестки и центр

    // ==========================================
    // GLSL (как в оригинале)
    // ==========================================
    const petalVertexPars = `
        uniform float uTime;
        uniform float uPhase;
        uniform float uAmpFactor;
        uniform float uFlexFactor;
        uniform float uSCurveStrength;
        uniform float uLayerTier;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec2 vUv;
        varying float vTier;
    `;

    // Результат: pos — анимированная позиция, dpRest — позиция в покое.
    const petalVertexDisplacement = `
        vUv = uv;
        vTier = uLayerTier;
        vec3 pos = position;

        float hMask = smoothstep(0.01, 1.0, vUv.y);
        float vNorm = vUv.y;
        float uNorm = (vUv.x - 0.5) * 2.0;

        #ifndef DP_BAKED_REST
            float cupDeep = sin(vNorm * 3.14159 * 0.75) * 0.48 * uSCurveStrength;
            float tipOut  = -pow(vNorm, 2.1) * 0.38 * uSCurveStrength;
            float baseSCurve = cupDeep + tipOut;
            float ruffleMask = smoothstep(0.1, 1.0, vNorm) * (0.3 + 0.7 * abs(uNorm));
            float transverseSine = sin(uNorm * 12.56 + uPhase * 1.5) * 0.08 * ruffleMask;
            pos.z += baseSCurve + transverseSine;
        #endif
        vec3 dpRest = pos;

        float effectiveAmp = uAmpFactor * uFlexFactor;
        float whip = pow(vNorm, 1.25) * effectiveAmp;
        float wave1 = sin(uTime * 0.85 - vNorm * 3.8 + uPhase) * 0.35 * whip;
        float wave2 = cos(uTime * 0.62 - vNorm * 5.2 + uPhase * 1.7) * 0.18 * whip;
        float edgeDist = abs(vUv.x - 0.5) * 2.0;
        float edgeFlutter = sin(uTime * 1.1 + vUv.x * 6.28 + uPhase) * 0.10 * edgeDist * whip;

        pos.z += (wave1 + wave2 + edgeFlutter) * hMask;
    `;

    // Та же статичная часть на CPU (для запекания точек и для порядка распада поверхности).
    function petalStaticZ(v, uNorm, phase, sStr) {
        const cupDeep = Math.sin(v * PI_GLSL * 0.75) * 0.48 * sStr;
        const tipOut = -Math.pow(v, 2.1) * 0.38 * sStr;
        const ruffleMask = smoothstep(0.1, 1.0, v) * (0.3 + 0.7 * Math.abs(uNorm));
        const transverseSine = Math.sin(uNorm * 12.56 + phase * 1.5) * 0.08 * ruffleMask;
        return cupDeep + tipOut + transverseSine;
    }

    const tentVertexPars = `uniform float uTime; attribute float aSeed; varying vec3 vNormal, vViewPosition; varying vec2 vUv;`;
    const tentVertexDisplacement = `
        vUv = uv; vec3 pos = position; vec3 dpRest = position; float whip = pow(vUv.y, 1.3);
        float t1 = uTime * 1.2 - pos.y * 1.5 + aSeed * 9.1;
        float t2 = uTime * 0.9 - pos.y * 2.1 + aSeed * 4.3;
        pos.x += (sin(t1) * 0.25 + cos(t2) * 0.12) * whip;
        pos.z += (cos(t1 * 0.85) * 0.25 + sin(t2 * 1.1) * 0.12) * whip;
    `;

    const stamenVertexPars = `uniform float uTime; attribute float aSeed; varying vec2 vUv; varying vec3 vFresnelColor;`;
    const stamenVertexDisplacement = `
        vUv = uv; vec3 pos = position; vec3 dpRest = position; float whip = pow(vUv.y, 1.2);
        float t = uTime * 1.4 - pos.y * 1.8 + aSeed * 6.5;
        pos.x += sin(t) * 0.12 * whip; pos.z += cos(t * 1.1) * 0.12 * whip;
    `;

    const recepVertexPars = `uniform float uTime; varying vec3 vNormal, vViewPosition;`;
    const recepVertexDisplacement = `
        vec3 norm = normalize(position);
        float wave = (sin(norm.x*2.5+uTime*0.9)*cos(norm.y*2.0+uTime*0.7) + cos(norm.z*2.8-uTime*0.8)*sin(norm.y*3.1+uTime*0.5)) * 0.06;
        vec3 pos = position + norm * wave; pos.y *= 0.55;
        vec3 dpRest = position * vec3(1.0, 0.55, 1.0);
    `;

    // ==========================================
    // ГЕОМЕТРИЯ (кэш по уровню качества)
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

    function createPetalGeometries(length, maxWidth, seed, tier, petalUniforms) {
        const segX = tier.petalSegments, segY = tier.petalSegments;
        const baseGeo = new THREE.PlaneGeometry(maxWidth, length, segX, segY);
        baseGeo.translate(0, length / 2, 0);
        const posAttr = baseGeo.attributes.position;
        const baseCount = posAttr.count;

        for (let i = 0; i < baseCount; i++) {
            let x = posAttr.getX(i), y = posAttr.getY(i);
            const u = x / (maxWidth / 2);
            const arch = Math.sqrt(Math.max(0.0, 1.0 - Math.pow(u * 0.95, 2)));
            const organicEdge = noise(u, seed) * 0.12 * Math.pow(Math.abs(u), 0.3);
            const maxAllowedHeight = length * (0.35 + 0.65 * arch) + organicEdge;
            if (y > maxAllowedHeight || isNaN(y)) y = maxAllowedHeight;
            const realV = y / length;
            x *= (0.22 + 0.78 * Math.pow(Math.max(0.0, realV), 0.42) * (1.0 + Math.sin(u * 3.5 + seed) * 0.05));
            let cupCross = Math.cos(u * Math.PI * 0.5) * 0.14 * Math.sin(realV * Math.PI * 0.85);
            if (isNaN(x)) x = 0;
            if (isNaN(y)) y = 0;
            if (isNaN(cupCross)) cupCross = 0;
            posAttr.setXYZ(i, x, y, cupCross);
        }
        baseGeo.computeVertexNormals();

        const meshGeo = baseGeo.clone();
        const normAttr = baseGeo.attributes.normal;
        const uvAttr = baseGeo.attributes.uv;

        const multiplier = tier.petalMultiplier;
        const totalPoints = baseCount * multiplier;

        const pPositions = new Float32Array(totalPoints * 3);
        const pNormals = new Float32Array(totalPoints * 3);
        const pUvs = new Float32Array(totalPoints * 2);
        const pSizeScales = new Float32Array(totalPoints);

        const { phase, sStr } = petalUniforms;

        for (let i = 0; i < baseCount; i++) {
            const bx = posAttr.getX(i), by = posAttr.getY(i), bz = posAttr.getZ(i);
            const nx = normAttr.getX(i), ny = normAttr.getY(i), nz = normAttr.getZ(i);
            const uvU = isNaN(uvAttr.getX(i)) ? 0 : uvAttr.getX(i);
            const uvV = isNaN(uvAttr.getY(i)) ? 0 : uvAttr.getY(i);

            // Статичный изгиб (раньше считался в шейдере каждый кадр) и объёмный разброс.
            const staticZ = petalStaticZ(uvV, (uvU - 0.5) * 2.0, phase, sStr);
            const volK = 0.005 + 0.012 * smoothstep(0.0, 0.3, uvV);

            for (let m = 0; m < multiplier; m++) {
                const pIdx = i * multiplier + m;
                const subSeed = seed + pIdx * 0.137;
                const offsetX = (seededRandom(subSeed) - 0.5) * (maxWidth / segX) * 0.8;
                const offsetY = (seededRandom(subSeed + 1.0) - 0.5) * (length / segY) * 0.8;
                const volX = (seededRandom(subSeed + 3.0) - 0.5) * 0.015;
                const volY = (seededRandom(subSeed + 4.0) - 0.5) * 0.015;
                const volZ = (seededRandom(subSeed + 5.0) - 0.5) * 0.025;

                const px = isNaN(bx + offsetX) ? bx : bx + offsetX;
                const py = isNaN(by + offsetY) ? by : by + offsetY;
                const pz = isNaN(bz) ? 0 : bz;
                pPositions[pIdx * 3 + 0] = px + volX * volK;
                pPositions[pIdx * 3 + 1] = py + volY * volK;
                pPositions[pIdx * 3 + 2] = pz + staticZ + volZ * volK;
                pNormals[pIdx * 3 + 0] = isNaN(nx) ? 0 : nx;
                pNormals[pIdx * 3 + 1] = isNaN(ny) ? 1 : ny;
                pNormals[pIdx * 3 + 2] = isNaN(nz) ? 0 : nz;
                pUvs[pIdx * 2 + 0] = uvU;
                pUvs[pIdx * 2 + 1] = uvV;
                pSizeScales[pIdx] = Math.max(0.0, seededRandom(subSeed + 2.0));
            }
        }

        const pointsGeo = new THREE.BufferGeometry();
        pointsGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
        pointsGeo.setAttribute('normal', new THREE.BufferAttribute(pNormals, 3));
        pointsGeo.setAttribute('uv', new THREE.BufferAttribute(pUvs, 2));
        pointsGeo.setAttribute('aSizeScale', new THREE.BufferAttribute(pSizeScales, 1));

        // Позиции поверхности в покое (для порядка распада) — та же статичная часть.
        const meshRest = new Float32Array(baseCount * 3);
        const mPos = meshGeo.attributes.position, mUv = meshGeo.attributes.uv;
        for (let i = 0; i < baseCount; i++) {
            meshRest[i * 3] = mPos.getX(i);
            meshRest[i * 3 + 1] = mPos.getY(i);
            meshRest[i * 3 + 2] = mPos.getZ(i) + petalStaticZ(mUv.getY(i), (mUv.getX(i) - 0.5) * 2.0, phase, sStr);
        }

        return { meshGeo, pointsGeo, meshRest };
    }

    function createSymmetricTentacleGeo(height, baseRadius, seed, flareAmount) {
        const points = [];
        const segments = 90;
        for (let s = 0; s <= segments; s++) {
            const t = s / segments;
            points.push(new THREE.Vector3(Math.pow(t, 0.7) * flareAmount, t * height, Math.sin(t * Math.PI * 1.6 + seed) * 0.15 * t));
        }
        const path = new THREE.CatmullRomCurve3(points);
        const radialSegments = 16;
        const geo = new THREE.BufferGeometry();
        const posArray = [], normArray = [], uvArray = [], seedArray = [];

        for (let i = 0; i <= segments; i++) {
            const v = i / segments;
            const point = path.getPointAt(v);
            const radius = baseRadius * Math.max(0.08, Math.pow(1.0 - v * 0.88, 1.1));
            for (let j = 0; j <= radialSegments; j++) {
                const u = j / radialSegments;
                const theta = u * Math.PI * 2;
                const nx = Math.cos(theta), nz = Math.sin(theta);
                posArray.push(point.x + nx * radius, point.y, point.z + nz * radius);
                normArray.push(nx, 0, nz);
                uvArray.push(u, v);
                seedArray.push(seed);
            }
        }

        const indices = [];
        for (let i = 0; i < segments; i++) {
            for (let j = 0; j < radialSegments; j++) {
                const a = i * (radialSegments + 1) + j;
                const b = (i + 1) * (radialSegments + 1) + j;
                const c = (i + 1) * (radialSegments + 1) + (j + 1);
                const d = i * (radialSegments + 1) + (j + 1);
                indices.push(a, b, d, b, c, d);
            }
        }
        geo.setIndex(indices);
        geo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normArray, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArray, 2));
        geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seedArray, 1));
        return geo;
    }

    function createStamenGeo(height, seed) {
        const filamentGeo = new THREE.CylinderGeometry(0.01, 0.026, height, 16, 40, true);
        filamentGeo.translate(0, height / 2, 0);
        const antherGeo = new THREE.SphereGeometry(0.06, 16, 16);
        antherGeo.scale(1.0, 1.5, 0.85);
        antherGeo.translate(0, height, 0);

        const c1 = filamentGeo.attributes.position.count;
        const c2 = antherGeo.attributes.position.count;
        const merge = (name, size) => {
            const arr = new Float32Array((c1 + c2) * size);
            arr.set(filamentGeo.attributes[name].array, 0);
            arr.set(antherGeo.attributes[name].array, c1 * size);
            return new THREE.BufferAttribute(arr, size);
        };
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', merge('position', 3));
        geo.setAttribute('normal', merge('normal', 3));
        geo.setAttribute('uv', merge('uv', 2));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(c1 + c2).fill(seed), 1));
        filamentGeo.dispose(); antherGeo.dispose();
        return geo;
    }

    function buildGeometry(tier) {
        const petals = [], tentacles = [], stamens = [];

        // ---------- ЛЕПЕСТКИ ----------
        function addPetalRing(config) {
            const count = config.count || 8;
            const radius = config.radius || 0.5;
            const baseAmp = config.ampFactor !== undefined ? config.ampFactor : 1.0;
            const baseLen = config.length || 2.6;
            const baseWidth = config.maxWidth || 2.2;
            const layerTier = config.tier || 0.0;

            for (let i = 0; i < count; i++) {
                const seed = (config.layerSeed || 1.0) * 137.5 + i * 7.93;
                const isFeatured = seededRandom(seed * 1.1) > 0.62;
                const scaleBoost = isFeatured ? (1.22 + seededRandom(seed * 2.3) * 0.15) : (0.95 + seededRandom(seed * 3.1) * 0.16);
                const finalLength = baseLen * scaleBoost;
                const finalWidth = baseWidth * scaleBoost;
                const flexFactor = isFeatured ? (1.25 + seededRandom(seed * 4.2) * 0.20) : (0.90 + seededRandom(seed * 5.1) * 0.20);
                const sCurveProfile = 0.85 + seededRandom(seed * 6.3) * 0.45;

                const params = { phase: seed * 0.5, amp: baseAmp, flex: flexFactor, sStr: sCurveProfile, tier: layerTier };
                const { meshGeo, pointsGeo, meshRest } = createPetalGeometries(finalLength, finalWidth, seed, tier, params);

                const angleOffset = (seededRandom(seed * 7.4) - 0.5) * (Math.PI / count) * 0.55;
                const angle = (i / count) * Math.PI * 2 + (config.phaseOffset || 0) + angleOffset;
                const baseTilt = (config.baseTilt || 0.6) + (seededRandom(seed * 8.2) - 0.5) * 0.14;
                const rollVar = (seededRandom(seed * 9.1) - 0.5) * 0.12;
                const finalRadius = radius + (seededRandom(seed * 10.3) - 0.5) * 0.08;

                const matrix = matrixOf((pivot, obj) => {
                    pivot.rotation.y = angle;
                    pivot.position.y = config.yOffset || 0;
                    obj.position.z = finalRadius;
                    obj.rotation.x = baseTilt;
                    obj.rotation.z = rollVar;
                });

                petals.push({ pointsGeo, meshGeo, meshRest, matrix, params });
            }
        }

        addPetalRing({ count: 8, radius: RECEPTACLE_RADIUS * 0.82, yOffset: -0.22, baseTilt: 0.20, length: 2.1, maxWidth: 1.6, layerSeed: 1, ampFactor: 0.40, tier: 0.0 });
        addPetalRing({ count: 12, radius: RECEPTACLE_RADIUS * 1.05, yOffset: -0.28, baseTilt: 0.55, length: 2.5, maxWidth: 2.0, phaseOffset: Math.PI / 12, layerSeed: 2, ampFactor: 0.75, tier: 1.0 });
        addPetalRing({ count: 16, radius: RECEPTACLE_RADIUS * 1.32, yOffset: -0.36, baseTilt: 0.92, length: 3.0, maxWidth: 2.5, phaseOffset: Math.PI / 16, layerSeed: 3, ampFactor: 1.20, tier: 2.0 });

        // ---------- ЩУПАЛЬЦА ----------
        const outerTentacleCount = 8;
        const outerRadius = 0.42;
        const baseHeight = 5.2;
        for (let i = 0; i < outerTentacleCount; i++) {
            const seed = i * 2.71 + 1.2;
            const height = baseHeight + Math.sin(seed) * 0.4;
            const geo = createSymmetricTentacleGeo(height, 0.07, seed, 0.95);
            const angle = (i / outerTentacleCount) * Math.PI * 2;
            const matrix = matrixOf((p, m) => {
                m.position.set(Math.sin(angle) * outerRadius, -0.25, Math.cos(angle) * outerRadius);
                m.rotation.y = angle;
            });
            tentacles.push({ geo, matrix });
        }
        const coreHeights = [baseHeight * 1.34, baseHeight * 1.27, baseHeight * 1.39];
        for (let i = 0; i < 3; i++) {
            const seed = i * 5.13 + 8.4;
            const geo = createSymmetricTentacleGeo(coreHeights[i], 0.075, seed, 0.45);
            const angle = (i / 3) * Math.PI * 2 + 0.5;
            const coreRadius = 0.12;
            const matrix = matrixOf((p, m) => {
                m.position.set(Math.sin(angle) * coreRadius, -0.25, Math.cos(angle) * coreRadius);
                m.rotation.y = angle;
            });
            tentacles.push({ geo, matrix });
        }

        // ---------- ТЫЧИНКИ ----------
        const stamenCount = 24;
        for (let i = 0; i < stamenCount; i++) {
            const seed = i * 3.82 + 1.1;
            const height = 3.0 + (Math.sin(seed * 2.2) * 0.5 + 0.5) * 1.10;
            const geo = createStamenGeo(height, seed);
            const angle = (i / stamenCount) * Math.PI * 2 + (Math.sin(seed) * 0.15);
            const r = 0.28 + (Math.sin(seed * 1.9) * 0.5 + 0.5) * 0.25;
            const matrix = matrixOf((p, m) => {
                m.position.set(Math.sin(angle) * r, -0.25, Math.cos(angle) * r);
                m.rotation.z = Math.sin(seed * 1.4) * 0.30;
                m.rotation.x = Math.cos(seed * 1.8) * 0.30;
                m.rotation.y = angle;
            });
            stamens.push({ geo, matrix });
        }

        // ---------- ЦВЕТОЛОЖЕ ----------
        const receptacle = {
            geo: new THREE.SphereGeometry(RECEPTACLE_RADIUS, 48, 48),
            matrix: matrixOf((p, m) => { m.position.y = -0.25; })
        };

        const rootMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(0, FLOWER_Y_OFFSET, 0),
            new THREE.Quaternion(),
            new THREE.Vector3(FLOWER_SCALE, FLOWER_SCALE, FLOWER_SCALE));

        const data = { petals, tentacles, stamens, receptacle, rootMatrix };
        assignOrderAndLayout(data);
        return data;
    }

    // ==========================================
    // ПОРЯДОК РАСПАДА + LAYOUT ДЛЯ МОРФИНГА
    // ==========================================
    function orderDistance(x, y, z) {
        const dx = x - ORDER_ANCHOR.x, dy = y - ORDER_ANCHOR.y, dz = z - ORDER_ANCHOR.z;
        const n = Math.sin(x * 1.7 + y * 0.9) * Math.sin(z * 1.9 - y * 1.3) + 0.5 * Math.sin(x * 3.1 - z * 2.7 + y * 2.3);
        return Math.sqrt(dx * dx + dy * dy + dz * dz) + ORDER_NOISE * n;
    }

    function assignOrderAndLayout(data) {
        const v = new THREE.Vector3();

        // Все «источники вершин»: для точек (участвуют в морфинге) и для поверхностей лепестков.
        const pointSources = [];
        data.petals.forEach(p => pointSources.push({ geo: p.pointsGeo, matrix: p.matrix, restOf: (a, i) => v.fromBufferAttribute(a, i) }));
        data.tentacles.forEach(p => pointSources.push({ geo: p.geo, matrix: p.matrix, restOf: (a, i) => v.fromBufferAttribute(a, i) }));
        data.stamens.forEach(p => pointSources.push({ geo: p.geo, matrix: p.matrix, restOf: (a, i) => v.fromBufferAttribute(a, i) }));
        pointSources.push({ geo: data.receptacle.geo, matrix: data.receptacle.matrix, restOf: (a, i) => { v.fromBufferAttribute(a, i); v.y *= 0.55; return v; } });

        // 1) сырые расстояния + позиции в покое в пространстве сцены
        let dMin = Infinity, dMax = -Infinity;
        pointSources.forEach(src => {
            const pos = src.geo.attributes.position;
            const count = pos.count;
            src.raw = new Float32Array(count);
            src.rest = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                src.restOf(pos, i).applyMatrix4(src.matrix);        // пространство фигуры
                const d = orderDistance(v.x, v.y, v.z);
                src.raw[i] = d;
                if (d < dMin) dMin = d;
                if (d > dMax) dMax = d;
                v.applyMatrix4(data.rootMatrix);                     // пространство сцены
                src.rest[i * 3] = v.x; src.rest[i * 3 + 1] = v.y; src.rest[i * 3 + 2] = v.z;
            }
        });

        const toOrder = (d) => 1 - Math.pow(Math.min(1, Math.max(0, (d - dMin) / (dMax - dMin))), ORDER_CURVE);

        // 2) нормированный порядок для точек (с «песчинками»)
        let gi = 0;
        pointSources.forEach(src => {
            const order = new Float32Array(src.raw.length);
            for (let i = 0; i < order.length; i++, gi++) {
                const j = (seededRandom(gi * 0.7311 + 3.3) - 0.5) * 2 * ORDER_JITTER;
                order[i] = Math.min(1, Math.max(0, toOrder(src.raw[i]) + j));
            }
            src.geo.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
            src.raw = null;
        });

        // 3) порядок для поверхностей лепестков (без разброса)
        data.petals.forEach(p => {
            const count = p.meshGeo.attributes.position.count;
            const order = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                v.set(p.meshRest[i * 3], p.meshRest[i * 3 + 1], p.meshRest[i * 3 + 2]).applyMatrix4(p.matrix);
                order[i] = toOrder(orderDistance(v.x, v.y, v.z));
            }
            p.meshGeo.setAttribute('aOrder', new THREE.BufferAttribute(order, 1));
            p.meshRest = null;
        });

        data.layout = DP.morph.createLayout(pointSources.map(src => ({ geometry: src.geo, rest: src.rest })));
    }

    // ==========================================
    // МАТЕРИАЛЫ (на каждый экземпляр)
    // ==========================================
    function createMaterials(ctx, tier) {
        const G = DP.morph.glsl;
        const morphUniforms = DP.morph.uniformsFor(ctx.uniforms);
        const S = DP.shared;
        const list = [];
        const add = (m) => { list.push(m); return m; };

        // Компенсация плотности для уровней качества ниже эталона.
        const ref = DP.QUALITY_TIERS.high;
        const density = (Math.pow(ref.petalSegments + 1, 2) * ref.petalMultiplier) /
                        (Math.pow(tier.petalSegments + 1, 2) * tier.petalMultiplier);
        const uDensityAlpha = { value: Math.sqrt(density) };
        const uDensitySize = { value: Math.pow(density, 0.25) };

        const pointsBase = (extra) => Object.assign({}, DP.pointsMaterialConfig, extra);

        function petalMesh(params) {
            return add(new THREE.ShaderMaterial({
                uniforms: Object.assign({
                    uTime: S.uTime, uPhase: { value: params.phase }, uAmpFactor: { value: params.amp },
                    uFlexFactor: { value: params.flex }, uSCurveStrength: { value: params.sStr }, uLayerTier: { value: params.tier }
                }, morphUniforms),
                vertexShader: `
                    ${petalVertexPars}
                    ${G.meshVertex}
                    void main() {
                        ${petalVertexDisplacement}
                        vDpOrder = aOrder;
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        vViewPosition = -mvPosition.xyz;
                        vNormal = normalize(normalMatrix * normal);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    ${G.meshFragment}
                    varying vec3 vNormal, vViewPosition;
                    varying vec2 vUv;
                    varying float vTier;
                    void main() {
                        float dpGlow = dpMeshGlow();
                        vec3 N = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
                        vec3 V = normalize(vViewPosition);
                        float fresnel = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.5);
                        float rimBoost = 1.0 + vTier * 0.6;
                        vec3 color = mix(vec3(0.02, 0.05, 0.1), vec3(0.75, 0.9, 1.0), fresnel * 1.2 * rimBoost);
                        color += dpGlow * vec3(0.45, 0.7, 1.0);
                        gl_FragColor = vec4(color, 1.0);
                    }
                `,
                side: THREE.DoubleSide, depthWrite: true, depthTest: true
            }));
        }

        function petalPoints(params) {
            return add(new THREE.ShaderMaterial(pointsBase({
                defines: { DP_BAKED_REST: '' },
                uniforms: Object.assign({
                    uTime: S.uTime, uPhase: { value: params.phase }, uAmpFactor: { value: params.amp },
                    uFlexFactor: { value: params.flex }, uSCurveStrength: { value: params.sStr }, uLayerTier: { value: params.tier },
                    uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.2 },
                    uDensityAlpha, uDensitySize
                }, morphUniforms),
                vertexShader: `
                    ${petalVertexPars}
                    ${G.pointsVertex}
                    uniform float uViewportScale, uSize, uDensitySize;
                    attribute float aSizeScale;
                    varying float vAlpha, vFresnel, vHeight;
                    void main() {
                        ${petalVertexDisplacement}
                        vec4 mvPosition = viewMatrix * dpMorph(dpRest, pos);
                        gl_Position = projectionMatrix * mvPosition;
                        float dist = max(-mvPosition.z, 0.1);

                        vec3 N = normalize(normalMatrix * normal);
                        vec3 V = normalize(-mvPosition.xyz);
                        vFresnel = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.3);
                        vHeight = vUv.y;

                        float depthCompensation = 1.0 / (0.35 + 0.06 * dist);
                        float tierScaleBonus = 1.0 + vTier * 0.2;
                        float sScale = (0.7 + aSizeScale * 0.5) * depthCompensation * tierScaleBonus;
                        gl_PointSize = uSize * uViewportScale * sScale * uDensitySize;

                        vAlpha = (0.2 + 0.5 * vFresnel) * (0.3 + 0.7 * smoothstep(0.0, 0.35, vUv.y));
                        dpMorphFinish();
                    }
                `,
                fragmentShader: `
                    ${G.pointsFragment}
                    uniform sampler2D uTexture;
                    uniform float uDensityAlpha;
                    varying float vAlpha, vFresnel, vHeight;
                    varying float vTier;
                    void main() {
                        vec4 tex = texture2D(uTexture, gl_PointCoord);
                        if (tex.a < 0.01) discard;

                        vec3 color = mix(vec3(0.04, 0.1, 0.2), vec3(0.7, 0.88, 1.0), vFresnel * 1.1);

                        // Усиливаем видимость на периферии по vHeight (центр чистый, края ярче)
                        float edgeGlow = smoothstep(0.2, 0.9, vHeight) * 1.5;
                        float radialMultiplier = 1.0 + edgeGlow;

                        float finalAlpha = tex.a * vAlpha * 0.20 * radialMultiplier * uDensityAlpha;
                        finalAlpha = finalAlpha / (0.45 + finalAlpha * 2.2);

                        gl_FragColor = dpMorphColor(color, finalAlpha, tex.a);
                    }
                `
            })));
        }

        const tentMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${tentVertexPars} ${G.meshVertex} void main(){ ${tentVertexDisplacement} vDpOrder = aOrder; vec4 mv=modelViewMatrix*vec4(pos,1.); vViewPosition=-mv.xyz; vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*mv; }`,
            fragmentShader: `
                ${G.meshFragment}
                varying vec3 vNormal, vViewPosition;
                varying vec2 vUv;
                void main(){
                    float dpGlow = dpMeshGlow();
                    vec3 N = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
                    float fresnel = pow(clamp(1.0 - abs(dot(N, normalize(vViewPosition))), 0.0, 1.0), 1.2);

                    float baseFade = smoothstep(0.05, 0.3, vUv.y);
                    float edgeFade = 1.0 - smoothstep(0.85, 1.0, vUv.y);
                    float alpha = 0.5 * baseFade * edgeFade;

                    vec3 baseColor = mix(vec3(0.06, 0.14, 0.25), vec3(0.5, 0.7, 0.9), fresnel * 1.1);
                    vec3 tipColor = vec3(0.4, 0.7, 0.95);
                    vec3 finalColor = mix(baseColor, tipColor, smoothstep(0.4, 0.85, vUv.y));

                    gl_FragColor = vec4(finalColor + dpGlow * vec3(0.45, 0.7, 1.0), alpha);
                }
            `,
            side: THREE.DoubleSide, depthWrite: false, transparent: true
        }));

        const tentPoints = add(new THREE.ShaderMaterial(pointsBase({
            depthTest: false,
            uniforms: Object.assign({ uTime: S.uTime, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.0 } }, morphUniforms),
            vertexShader: `
                ${tentVertexPars}
                ${G.pointsVertex}
                uniform float uViewportScale, uSize;
                varying float vFresnel;
                void main(){
                    ${tentVertexDisplacement}
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
                    if(tex.a < 0.02) discard;

                    float baseFade = smoothstep(0.05, 0.3, vUv.y);
                    float edgeFade = 1.0 - smoothstep(0.85, 1.0, vUv.y);
                    float tipGlow = smoothstep(0.1, 0.85, vUv.y) * 1.4;

                    float a = tex.a * (0.12 + tipGlow * 0.2) * baseFade * edgeFade;
                    a = a / (0.45 + a * 1.2);

                    vec3 baseColor = mix(vec3(0.1, 0.22, 0.38), vec3(0.7, 0.85, 1.0), vFresnel * 1.1);
                    vec3 finalColor = mix(baseColor, vec3(0.4, 0.7, 0.95), smoothstep(0.4, 0.85, vUv.y));

                    gl_FragColor = dpMorphColor(finalColor, a, tex.a);
                }
            `
        })));

        const stamenMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${stamenVertexPars} ${G.meshVertex} void main(){ ${stamenVertexDisplacement} vDpOrder = aOrder; vec4 mv=modelViewMatrix*vec4(pos,1.);
            float fresnel=pow(clamp(1.-abs(dot(normalize(normalMatrix*normal),normalize(-mv.xyz))),0.,1.),1.3);
            vFresnelColor=mix(vec3(0.08, 0.18, 0.3), vec3(0.7, 0.85, 1.0), fresnel*1.2); gl_Position=projectionMatrix*mv; }`,
            fragmentShader: `
                ${G.meshFragment}
                varying vec2 vUv;
                varying vec3 vFresnelColor;
                void main(){
                    float dpGlow = dpMeshGlow();
                    float baseFade = smoothstep(0.02, 0.2, vUv.y);
                    float edgeFade = 1.0 - smoothstep(0.85, 1.0, vUv.y);
                    float alpha = 0.48 * baseFade * edgeFade;
                    vec3 finalCol = mix(vFresnelColor, vec3(0.75, 0.92, 1.0), smoothstep(0.7, 1.0, vUv.y));
                    gl_FragColor = vec4(finalCol + dpGlow * vec3(0.45, 0.7, 1.0), alpha);
                }
            `,
            side: THREE.DoubleSide, transparent: true, depthWrite: false
        }));

        const stamenPoints = add(new THREE.ShaderMaterial(pointsBase({
            depthTest: false,
            uniforms: Object.assign({ uTime: S.uTime, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 3.8 } }, morphUniforms),
            vertexShader: `
                ${stamenVertexPars}
                ${G.pointsVertex}
                uniform float uViewportScale, uSize;
                void main(){
                    ${stamenVertexDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos);
                    float fresnel = pow(clamp(1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))), 0.0, 1.0), 1.3);
                    vFresnelColor = mix(vec3(0.09, 0.22, 0.36), vec3(0.75, 0.9, 1.0), fresnel * 1.2);
                    float dist = max(-mv.z, 0.1);
                    gl_PointSize = uSize * uViewportScale * (0.85 / (0.4 + 0.06 * dist));
                    gl_Position = projectionMatrix * mv;
                    dpMorphFinish();
                }
            `,
            fragmentShader: `
                ${G.pointsFragment}
                uniform sampler2D uTexture;
                varying vec2 vUv;
                varying vec3 vFresnelColor;
                void main(){
                    vec4 tex = texture2D(uTexture, gl_PointCoord);
                    if(tex.a < 0.02) discard;

                    float baseFade = smoothstep(0.02, 0.2, vUv.y);
                    float edgeFade = 1.0 - smoothstep(0.85, 1.0, vUv.y);
                    float tipGlow = smoothstep(0.5, 0.98, vUv.y) * 2.0;

                    float a = tex.a * (0.06 + tipGlow * 0.15) * baseFade * edgeFade;
                    a = a / (0.5 + a * 1.5);

                    vec3 finalColor = mix(vFresnelColor, vec3(0.9, 0.96, 1.0), smoothstep(0.6, 1.0, vUv.y));

                    gl_FragColor = dpMorphColor(finalColor, a, tex.a);
                }
            `
        })));

        const recepMesh = add(new THREE.ShaderMaterial({
            uniforms: Object.assign({ uTime: S.uTime }, morphUniforms),
            vertexShader: `${recepVertexPars} ${G.meshVertex} void main(){ ${recepVertexDisplacement} vDpOrder = aOrder; vec4 mv=modelViewMatrix*vec4(pos,1.); vViewPosition=-mv.xyz;
            vec3 tN=normal; tN.y/=0.55; vNormal=normalize(normalMatrix*tN); gl_Position=projectionMatrix*mv; }`,
            fragmentShader: `${G.meshFragment} varying vec3 vNormal, vViewPosition; void main(){ float dpGlow = dpMeshGlow(); vec3 N = normalize(vNormal); float fresnel = pow(clamp(1.-abs(dot(N, normalize(vViewPosition))),0.,1.), 2.0); gl_FragColor = vec4(mix(vec3(0.02, 0.05, 0.1), vec3(0.6, 0.75, 0.95), fresnel) + dpGlow * vec3(0.45, 0.7, 1.0), 0.8); }`,
            transparent: true
        }));

        const recepPoints = add(new THREE.ShaderMaterial(pointsBase({
            uniforms: Object.assign({ uTime: S.uTime, uTexture: S.uTexture, uViewportScale: S.uViewportScale, uSize: { value: 2.0 } }, morphUniforms),
            vertexShader: `
                ${recepVertexPars}
                ${G.pointsVertex}
                uniform float uViewportScale, uSize;
                void main(){
                    ${recepVertexDisplacement}
                    vec4 mv = viewMatrix * dpMorph(dpRest, pos); gl_Position = projectionMatrix * mv;
                    float dist = max(-mv.z, 0.1); gl_PointSize = uSize * uViewportScale * (0.85 / (0.35 + 0.06 * dist));
                    vec3 tN = normal; tN.y /= 0.55; vNormal = normalize(normalMatrix * tN); vViewPosition = -mv.xyz;
                    dpMorphFinish();
                }
            `,
            fragmentShader: `${G.pointsFragment} uniform sampler2D uTexture; varying vec3 vNormal, vViewPosition; void main(){ vec4 tex=texture2D(uTexture,gl_PointCoord); if(tex.a<0.02)discard; vec3 N = normalize(vNormal); float fresnel = pow(clamp(1.-abs(dot(N, normalize(vViewPosition))),0.,1.), 2.0); float a = tex.a * 0.18; a = a / (0.5 + a * 2.0); gl_FragColor = dpMorphColor(mix(vec3(0.03, 0.08, 0.16), vec3(0.6, 0.75, 0.95), fresnel), a, tex.a); }`
        })));

        return { list, petalMesh, petalPoints, tentMesh, tentPoints, stamenMesh, stamenPoints, recepMesh, recepPoints };
    }

    // ==========================================
    // РЕГИСТРАЦИЯ
    // ==========================================
    DP.figures.register({
        name: 'peony',
        // Раскладка точек без создания экземпляра — для заблаговременной подготовки морфинга.
        getLayout(ctx) { return (cache[ctx.quality] || (cache[ctx.quality] = buildGeometry(ctx.qualityTier))).layout; },
        createInstance(ctx) {
            const tier = ctx.qualityTier;
            const data = cache[ctx.quality] || (cache[ctx.quality] = buildGeometry(tier));
            const mats = createMaterials(ctx, tier);

            const root = new THREE.Group();
            root.matrixAutoUpdate = false;
            root.matrix.copy(data.rootMatrix);
            const meshRoot = new THREE.Group();
            const pointsRoot = new THREE.Group();
            root.add(meshRoot, pointsRoot);

            const place = (group, obj, matrix) => {
                obj.matrixAutoUpdate = false;
                obj.matrix.copy(matrix);
                group.add(obj);
            };

            data.petals.forEach(p => {
                place(meshRoot, new THREE.Mesh(p.meshGeo, mats.petalMesh(p.params)), p.matrix);
                place(pointsRoot, new THREE.Points(p.pointsGeo, mats.petalPoints(p.params)), p.matrix);
            });
            data.tentacles.forEach(t => {
                place(meshRoot, new THREE.Mesh(t.geo, mats.tentMesh), t.matrix);
                place(pointsRoot, new THREE.Points(t.geo, mats.tentPoints), t.matrix);
            });
            data.stamens.forEach(s => {
                place(meshRoot, new THREE.Mesh(s.geo, mats.stamenMesh), s.matrix);
                place(pointsRoot, new THREE.Points(s.geo, mats.stamenPoints), s.matrix);
            });
            place(meshRoot, new THREE.Mesh(data.receptacle.geo, mats.recepMesh), data.receptacle.matrix);
            place(pointsRoot, new THREE.Points(data.receptacle.geo, mats.recepPoints), data.receptacle.matrix);

            return {
                root, meshRoot, pointsRoot,
                layout: data.layout,
                dispose() { mats.list.forEach(m => m.dispose()); }
            };
        }
    });
})(window.DP);
