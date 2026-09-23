// ==========================================
// DARK PEONY — ядро: пространство имён, конфиг, утилиты, общие uniform'ы
// ==========================================
// Все модули подключаются обычными <script> (без сборки и без ES-модулей),
// поэтому сайт открывается и с GitHub Pages, и двойным кликом по index.html.
(function (global) {
    'use strict';

    const DP = global.DP = global.DP || {};
    const params = new URLSearchParams(global.location.search);
    DP.params = params;

    // ------------------------------------------
    // КОНФИГ
    // ------------------------------------------
    DP.config = {
        clearColor: 0x000102,
        maxPixelRatio: 2,
        // Размеры точек подбирались на экранах с DPR = 2 (MacBook, iPhone c ограничением до 2).
        // gl_PointSize задаётся в физических пикселях, поэтому без поправки на обычных
        // мониторах (DPR = 1) точки выглядели бы вдвое крупнее. Поправка = pixelRatio / 2.
        pointSizeRefPixelRatio: 2,
        stageRotationSpeed: 0.03,

        // Адаптивное качество: если FPS долго ниже порога — понижаем pixelRatio ступенями.
        adaptive: {
            enabled: params.get('adaptive') !== '0',
            minFps: 40,
            minPixelRatio: 1,
            step: 0.25,
            sampleSeconds: 2.5,
            warmupSeconds: 3
        },

        morph: {
            // --- расписание (секунды от начала морфинга) ---
            // Уход и посадка перекрываются: первые частицы уже садятся в новую фигуру,
            // пока последние только срываются.
            leaveStart: 0.2,       // первая частица отрывается
            leaveSpread: 6.0,      // за сколько фронт распада проходит всю фигуру
            arriveStart: 5.2,      // самая ранняя посадка в новую фигуру
            arriveSpread: 6.0,     // за сколько новая фигура собирается целиком
            minTravel: 4.6,        // минимум времени полёта одной частицы
            maxTravel: 8.0,        // максимум
            travelJitter: 2.2,     // разброс длительности полёта (неравномерность)
            turns: 2,              // оборотов вокруг оси: 2 = 720° (± разница углов старта и финиша)
            assemble: 'inside-out', // 'inside-out' — сборка от центра/низа к краям, 'outside-in' — наоборот

            // --- облако в середине пути (пространство сцены, ось Y = ось стебля) ---
            cloudRadiusMin: 0.3,
            cloudRadiusMax: 2.4,
            cloudYMin: -0.9,
            cloudYMax: 3.4,
            cloudMix: 0.6,         // 0 — частица держится высоты/радиуса своей пары, 1 — случайная точка облака
            lift: 0.4,             // подъём частиц ветром

            // --- поле течения (аналог Turbulence Field в Particular) ---
            flowAmp: 0.6,          // сила крупных струй
            flowFreq: 0.85,        // масштаб струй (больше — мельче)
            detailAmp: 0.22,       // сила мелких завихрений
            flowSpeed: 0.35,       // скорость «дыхания» поля
            flowWarp: 1.3,         // искажение координат: больше — сильнее складки и ленты
            jitter: 0.02,          // индивидуальное дрожание частиц
            precession: 0.08,      // покачивание всего вихря
            shiver: 0.012,         // дрожь частиц перед отрывом

            // --- вид частиц в полёте ---
            swirlColor: [0.55, 0.8, 1.0],
            swirlSize: 1.0,        // размер крупных частиц в полёте (к посадке все возвращаются к 100%)
            swirlSizeMin: 0.35,    // размер мелких частиц (большинство)
            swirlAlpha: 0.11,
            swirlVisible: 0.45,    // доля частиц, заметных в полёте (остальные — едва видимая пыль)

            // --- режим MESH ---
            meshRevealLag: 0.35,   // поверхность новой фигуры проявляется чуть позже посадки частиц
            meshFade: 0.9          // частицы гаснут после посадки, уступая поверхности
        }
    };

    // ------------------------------------------
    // КАЧЕСТВО
    // ------------------------------------------
    // high — эталон (1.1 млн точек; проверено на MacBook M3 Max и iPhone 15).
    // medium/low — для слабых устройств; плотность компенсируется размером и яркостью точек.
    DP.QUALITY_TIERS = {
        high:   { petalSegments: 100, petalMultiplier: 3 },
        medium: { petalSegments: 80,  petalMultiplier: 2 },
        low:    { petalSegments: 60,  petalMultiplier: 2 }
    };

    function detectQuality() {
        const forced = params.get('q');
        if (forced && DP.QUALITY_TIERS[forced]) return forced;
        const mem = navigator.deviceMemory || 8;          // нет в Safari/Firefox → считаем «достаточно»
        const cores = navigator.hardwareConcurrency || 8;
        if (mem <= 2 || cores <= 2) return 'low';
        if (mem <= 3 || cores <= 4) return 'medium';
        return 'high';
    }
    DP.quality = detectQuality();

    // ------------------------------------------
    // УТИЛИТЫ
    // ------------------------------------------
    DP.util = {
        seededRandom(seed) {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        },
        noise(u, seed = 0) {
            return Math.sin(u * 7.3 + seed) * 0.4 + Math.sin(u * 17.1 + seed * 2.0) * 0.35 + Math.cos(u * 31.7 + seed * 0.5) * 0.25;
        },
        smoothstep(e0, e1, x) {
            const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
            return t * t * (3 - 2 * t);
        },
        clamp(x, a, b) { return x < a ? a : (x > b ? b : x); },
        // Азимут вокруг оси Y; должен совпадать с dpAzimuth() в GLSL (js/core/morph.js)
        azimuth(x, z) { return (Math.abs(x) + Math.abs(z) < 1e-5) ? 0 : Math.atan2(x, z); },
        wrapPi(a) { return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2)); }
    };

    // ------------------------------------------
    // ОБЩИЕ UNIFORM'Ы
    // ------------------------------------------
    // Один и тот же объект {value} подставляется во все материалы — обновляем в одном месте.
    DP.shared = {
        uTime: { value: 0 },
        uViewportScale: { value: 1 },
        uTexture: { value: null } // текстура частицы, создаётся в stage.js
    };

    // Размер точек «как на эталоне»: логика стороны экрана — авторская (см. комментарий),
    // плюс поправка на плотность пикселей.
    DP.computeViewportScale = function (w, h, pixelRatio) {
        // Пока экран горизонтальный или квадратный (w >= h), берём меньшую сторону (h).
        // Как только экран становится вертикальным (w < h), фиксируем размер по высоте (h),
        // чтобы при дальнейшем сужении ширины масштаб не уменьшался (иначе «проваливается» центр).
        const effectiveDim = w >= h ? Math.min(w, h) : h;
        return effectiveDim * 0.0012 * (pixelRatio / DP.config.pointSizeRefPixelRatio);
    };

    // ------------------------------------------
    // ПРОСТЕЙШИЕ СОБЫТИЯ
    // ------------------------------------------
    DP.createEmitter = function () {
        const map = {};
        return {
            on(name, fn) { (map[name] = map[name] || []).push(fn); return () => this.off(name, fn); },
            off(name, fn) { map[name] = (map[name] || []).filter(f => f !== fn); },
            emit(name, data) { (map[name] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
        };
    };
})(window);
