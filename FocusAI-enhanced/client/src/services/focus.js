/**
 * FocusAI — Advanced Focus Tracking Engine v2
 *
 * Improvements in this version:
 *   1. Per-student EAR calibration — measures each student's natural open-eye
 *      EAR for the first 3 seconds, sets a personal threshold at 72% of that.
 *      Eliminates false "eyes closed" for students with narrow eyes or glasses.
 *
 *   2. Temporal buffer for face absence — requires 3 consecutive missed
 *      detections (~1.5s) before flagging "no face" and penalising score.
 *      A single dropped frame from a blink or quick head turn is forgiven.
 *
 *   5. Blink vs sustained eye closure — tracks consecutive frames below the
 *      EAR threshold. 1 frame = blink (ignored). 2+ frames = sustained
 *      closure (drowsy / eyes closed → penalise).
 */

import { socket } from './socket';

// ─────────────────────────────────────────────
// Tunable constants
// ─────────────────────────────────────────────
const REPORT_INTERVAL_MS        = 2000;
const ANALYSIS_INTERVAL_MS      = 500;

const DECAY_HEAVY               = 14;   // score pts lost/tick — serious
const DECAY_MEDIUM              = 8;    // score pts lost/tick — mild
const RECOVERY                  = 10;  // score pts gained/tick — focused

// [1] Calibration
const CALIBRATION_FRAMES        = 6;   // ~3 s at 500 ms/frame of stable detections
const CALIBRATION_EAR_FACTOR    = 0.72; // personal threshold = mean_open_EAR × factor
const EAR_FALLBACK              = 0.20; // used until calibration is done

// [2] Temporal buffer — face absence
const MISSED_FRAMES_THRESHOLD   = 3;   // consecutive misses before "no face" fires

// [5] Blink vs sustained closure
const BLINK_FRAMES_THRESHOLD    = 2;   // frames below EAR threshold before penalising

const YAW_THRESHOLD             = 0.18;
const FACE_MODEL_URL            = 'https://justadudewhohacks.github.io/face-api.js/models';

// ─────────────────────────────────────────────
// Module-level state
// ─────────────────────────────────────────────
let modelsReady    = false;
let analysisTimer  = null;
let reportTimer    = null;
let videoEl        = null;
let canvasEl       = null;
let onStateChange  = null;

// [1] Calibration state
let calibration = {
    done:        false,
    collecting:  false,
    earSamples:  [],     // raw EAR readings during calibration window
    earThreshold: EAR_FALLBACK,
};

// [2] Temporal buffer — face absence
let missedFrames = 0;

// [5] Sustained eye closure counter
let lowEarFrames = 0;

let state = {
    score:           100,
    isTabActive:     true,
    isFaceDetected:  false,
    isLookingAway:   false,
    isEyesClosed:    false,
    cause:           'Initialising…',
    landmarks:       null,

    // Calibration progress exposed for UI
    calibration: {
        done:       false,
        collecting: false,
        progress:   0,    // 0-1
        earThreshold: EAR_FALLBACK,
    },
};

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────
export const startFocusTracking = async (video, canvas = null, onChange = null) => {
    videoEl       = video;
    canvasEl      = canvas;
    onStateChange = onChange;

    // Reset per-session tracking state
    resetTrackers();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    await loadFaceApi();

    analysisTimer = setInterval(runAnalysis, ANALYSIS_INTERVAL_MS);
    reportTimer   = setInterval(reportToServer, REPORT_INTERVAL_MS);
};

export const stopFocusTracking = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    clearInterval(analysisTimer);
    clearInterval(reportTimer);
    analysisTimer = null;
    reportTimer   = null;
    if (canvasEl) {
        const ctx = canvasEl.getContext('2d');
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
    videoEl       = null;
    canvasEl      = null;
    onStateChange = null;
};

export const getFocusState    = () => ({ ...state });
export const updateFaceDetectionStatus = () => {}; // backward-compat no-op

// ─────────────────────────────────────────────
// Internal reset
// ─────────────────────────────────────────────
const resetTrackers = () => {
    calibration  = { done: false, collecting: false, earSamples: [], earThreshold: EAR_FALLBACK };
    missedFrames = 0;
    lowEarFrames = 0;
    state = {
        score: 100, isTabActive: true, isFaceDetected: false,
        isLookingAway: false, isEyesClosed: false,
        cause: 'Initialising…', landmarks: null,
        calibration: { done: false, collecting: false, progress: 0, earThreshold: EAR_FALLBACK },
    };
};

// ─────────────────────────────────────────────
// Load face-api.js from CDN (singleton)
// ─────────────────────────────────────────────
const loadFaceApi = () => new Promise((resolve) => {
    if (window.faceapi) { loadModels().then(resolve); return; }

    const script   = document.createElement('script');
    script.src     = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
    script.onload  = () => loadModels().then(resolve);
    script.onerror = () => { console.warn('[FocusAI] face-api CDN failed'); resolve(); };
    document.head.appendChild(script);
});

const loadModels = async () => {
    try {
        const fa = window.faceapi;
        await Promise.all([
            fa.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
            fa.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_URL),
        ]);
        modelsReady  = true;
        state.cause  = 'Calibrating…';
        console.log('[FocusAI] Models loaded ✓');
    } catch (e) {
        console.warn('[FocusAI] Model load failed:', e.message);
    }
};

// ─────────────────────────────────────────────
// Tab visibility
// ─────────────────────────────────────────────
const handleVisibilityChange = () => {
    state.isTabActive = !document.hidden;
    if (!state.isTabActive) {
        state.score = Math.max(0, state.score - 25);
        state.cause = 'Tab hidden';
        notify();
    }
};

// ─────────────────────────────────────────────
// [1] EAR Calibration
// ─────────────────────────────────────────────
/**
 * Called with each successfully detected face's EAR during calibration.
 * Collects CALIBRATION_FRAMES samples, then locks in the personal threshold.
 * Returns true once calibration is complete.
 */
const runCalibration = (ear) => {
    if (calibration.done) return true;

    // Begin collecting on first good detection
    if (!calibration.collecting) {
        calibration.collecting = true;
        state.cause = 'Calibrating eyes…';
    }

    calibration.earSamples.push(ear);

    // Update progress for UI
    const progress = calibration.earSamples.length / CALIBRATION_FRAMES;
    state.calibration = { ...state.calibration, collecting: true, progress, done: false };

    if (calibration.earSamples.length >= CALIBRATION_FRAMES) {
        // Compute personal threshold
        const mean = calibration.earSamples.reduce((a, b) => a + b, 0) / calibration.earSamples.length;
        calibration.earThreshold = mean * CALIBRATION_EAR_FACTOR;
        calibration.done         = true;

        state.calibration = {
            done: true, collecting: false, progress: 1,
            earThreshold: +calibration.earThreshold.toFixed(3),
        };

        console.log(
            `[FocusAI] Calibration done — mean EAR: ${mean.toFixed(3)}, ` +
            `threshold: ${calibration.earThreshold.toFixed(3)}`
        );
        return true;
    }

    notify(); // push progress to UI
    return false;
};

// ─────────────────────────────────────────────
// Main analysis loop (every 500 ms)
// ─────────────────────────────────────────────
const runAnalysis = async () => {
    // Tab hidden — penalise continuously
    if (!state.isTabActive) {
        state.score = Math.max(0, state.score - DECAY_HEAVY);
        state.cause = 'Tab hidden';
        notify();
        return;
    }

    // Models / video not ready yet — don't penalise
    if (!modelsReady || !videoEl || videoEl.readyState < 2 || !window.faceapi) return;

    try {
        const fa        = window.faceapi;
        const detection = await fa
            .detectSingleFace(
                videoEl,
                new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })
            )
            .withFaceLandmarks(true);

        // ── [2] Temporal buffer — face absence ──────────────────
        if (!detection) {
            missedFrames++;

            if (missedFrames < MISSED_FRAMES_THRESHOLD) {
                // Grace period — don't change anything yet
                // (keeps score and isFaceDetected as they were)
                drawOverlay(null, null);
                return;
            }

            // 3+ consecutive misses: now it counts
            state.isFaceDetected = false;
            state.isLookingAway  = false;
            state.isEyesClosed   = false;
            state.landmarks      = null;
            lowEarFrames         = 0; // reset eye-closure streak
            state.cause          = 'No face detected';
            state.score          = Math.max(0, state.score - DECAY_HEAVY);
            drawOverlay(null, null);
            notify();
            return;
        }

        // Good detection — reset missed-frame counter
        missedFrames     = 0;
        state.isFaceDetected = true;
        const lm         = detection.landmarks;
        state.landmarks  = lm;

        // ── [1] Calibration phase ────────────────────────────────
        const leftEAR  = eyeAspectRatio(lm.getLeftEye());
        const rightEAR = eyeAspectRatio(lm.getRightEye());
        const ear      = (leftEAR + rightEAR) / 2;

        if (!calibration.done) {
            const finished = runCalibration(ear);
            // During calibration: don't penalise, just show the "calibrating" state
            if (!finished) {
                drawOverlay(detection, { ear, calibrating: true });
                notify();
                return;
            }
            // If just finished calibration, fall through to normal analysis below
        }

        // ── Head yaw ─────────────────────────────────────────────
        const yaw           = computeYaw(lm);
        state.isLookingAway = Math.abs(yaw) > YAW_THRESHOLD;

        // ── [5] Blink vs sustained eye closure ──────────────────
        const threshold = calibration.earThreshold; // personal threshold
        if (ear < threshold) {
            lowEarFrames++;
        } else {
            lowEarFrames = 0; // eyes open — reset streak
        }

        // Only flag as "eyes closed" after 2+ consecutive below-threshold frames
        state.isEyesClosed = lowEarFrames >= BLINK_FRAMES_THRESHOLD;

        // ── Score delta ───────────────────────────────────────────
        if (state.isEyesClosed && state.isLookingAway) {
            state.cause = 'Eyes closed & looking away';
            state.score = Math.max(0, state.score - DECAY_HEAVY);
        } else if (state.isEyesClosed) {
            state.cause = 'Eyes closed / drowsy';
            state.score = Math.max(0, state.score - DECAY_HEAVY);
        } else if (state.isLookingAway) {
            const severity = Math.min(1, Math.abs(yaw) / 0.35);
            state.cause    = 'Looking away';
            state.score    = Math.max(0, state.score - DECAY_MEDIUM * severity);
        } else {
            state.cause = 'Focused';
            state.score = Math.min(100, state.score + RECOVERY);
        }

        drawOverlay(detection, { ear, yaw, earThreshold: threshold });
        notify();

    } catch (_) { /* ignore per-frame errors */ }
};

// ─────────────────────────────────────────────
// Emit to server
// ─────────────────────────────────────────────
const reportToServer = () => {
    socket.emit('focus_update', {
        timestamp:      Date.now(),
        isTabActive:    state.isTabActive,
        isFaceDetected: state.isFaceDetected,
        isLookingAway:  state.isLookingAway,
        isEyesClosed:   state.isEyesClosed,
        cause:          state.cause,
        score:          Math.round(state.score),
    });
};

// ─────────────────────────────────────────────
// Maths helpers
// ─────────────────────────────────────────────
const eyeAspectRatio = (pts) => {
    // Vertical distances between eyelid landmarks
    const h1 = dist(pts[1], pts[5]);
    const h2 = dist(pts[2], pts[4]);
    // Horizontal distance (eye width)
    const w  = dist(pts[0], pts[3]);
    return w < 1 ? 0.3 : (h1 + h2) / (2 * w);
};

const computeYaw = (lm) => {
    const nose     = lm.getNose();
    const noseTip  = nose[3];
    const leftEye  = centroid(lm.getLeftEye());
    const rightEye = centroid(lm.getRightEye());
    const eyeSpan  = Math.abs(rightEye.x - leftEye.x);
    if (eyeSpan < 1) return 0;
    return (noseTip.x - (leftEye.x + rightEye.x) / 2) / eyeSpan;
};

const dist     = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const centroid = (pts) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

// ─────────────────────────────────────────────
// Canvas overlay drawing
// ─────────────────────────────────────────────
const drawOverlay = (detection, metrics) => {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (!detection) return;

    const lm    = detection.landmarks;
    const box   = detection.detection.box;

    // During calibration: show a neutral amber colour + progress arc
    if (metrics?.calibrating) {
        const progress = state.calibration.progress;
        ctx.strokeStyle = '#f6ad55';
        ctx.lineWidth   = 2;
        ctx.shadowColor = '#f6ad55';
        ctx.shadowBlur  = 8;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.shadowBlur  = 0;

        // Calibration progress arc on top of bounding box
        const cx   = box.x + box.width / 2;
        const cy   = box.y - 14;
        const r    = 10;
        const circ = 2 * Math.PI * r;
        ctx.strokeStyle = '#1e2533';
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#f6ad55';
        ctx.shadowColor = '#f6ad55';
        ctx.shadowBlur  = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur  = 0;

        ctx.font      = 'bold 10px sans-serif';
        ctx.fillStyle = '#f6ad55';
        ctx.textAlign = 'center';
        ctx.fillText('Calibrating…', cx, box.y - 28);
        ctx.textAlign = 'left';
        return;
    }

    const isBad = state.isLookingAway || state.isEyesClosed || !state.isFaceDetected;
    const color = isBad ? '#fc8181' : '#68d391';

    // Bounding box with glow
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.shadowBlur  = 0;

    // Eye and nose landmark dots
    const groups = [lm.getLeftEye(), lm.getRightEye(), lm.getNose().slice(0, 4)];
    ctx.fillStyle = color;
    groups.forEach(pts => pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
    }));

    // EAR debug readout (subtle, bottom of box)
    if (metrics?.ear !== undefined) {
        const earLabel = `EAR ${metrics.ear.toFixed(2)} / ${(metrics.earThreshold || calibration.earThreshold).toFixed(2)}`;
        ctx.font      = '9px monospace';
        ctx.fillStyle = color + '99';
        ctx.fillText(earLabel, box.x + 3, box.y + box.height + 11);
    }

    // Status label (only when distracted)
    if (isBad) {
        ctx.font        = 'bold 11px sans-serif';
        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 6;
        ctx.fillText(state.cause, box.x + 4, Math.max(14, box.y - 6));
        ctx.shadowBlur  = 0;
    }
};

// ─────────────────────────────────────────────
const notify = () => { if (onStateChange) onStateChange({ ...state }); };
