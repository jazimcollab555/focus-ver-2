import React, { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../services/socket';
import SimplePeer from 'simple-peer';
import { startFocusTracking, stopFocusTracking } from '../services/focus';

// ─────────────────────────────────────────────────────────────
// Calibration Banner — shown during the 3-second EAR sampling
// ─────────────────────────────────────────────────────────────
const CalibrationBanner = ({ progress }) => {
    const pct = Math.round(progress * 100);
    return (
        <div style={{
            background: 'rgba(246,173,85,0.1)', border: '1px solid rgba(246,173,85,0.35)',
            borderRadius: '10px', padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: '6px',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.7em', fontWeight: 700, color: '#f6ad55' }}>
                    👁 Calibrating your eyes…
                </div>
                <div style={{ fontSize: '0.65em', color: '#f6ad55', fontFamily: 'Space Mono, monospace' }}>
                    {pct}%
                </div>
            </div>
            {/* Progress bar */}
            <div style={{ height: '3px', background: '#1e2533', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                    height: '100%', borderRadius: '3px',
                    width: `${pct}%`,
                    background: 'linear-gradient(90deg, #c05621, #f6ad55)',
                    transition: 'width 0.5s ease',
                }} />
            </div>
            <div style={{ fontSize: '0.62em', color: '#718096', lineHeight: 1.4 }}>
                Look straight at the camera. This sets your personal eye baseline.
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Focus HUD — lives inside the sidebar camera section
// ─────────────────────────────────────────────────────────────
const FocusHUD = ({ focusState }) => {
    const { score, cause, isFaceDetected, isLookingAway, isEyesClosed, isTabActive, calibration } = focusState;
    const scoreInt = Math.round(score);
    const isCalibrating = calibration?.collecting && !calibration?.done;

    const getLevel = (s) => {
        if (s >= 80) return { label: 'Focused',    color: '#68d391', bg: 'rgba(56,161,105,0.15)', emoji: '🎯' };
        if (s >= 55) return { label: 'Distracted', color: '#f6ad55', bg: 'rgba(237,137,54,0.12)', emoji: '😐' };
        if (s >= 30) return { label: 'Low Focus',  color: '#fc8181', bg: 'rgba(229,62,62,0.12)',  emoji: '😟' };
        return             { label: 'Very Low',    color: '#fc8181', bg: 'rgba(229,62,62,0.18)',  emoji: '😴' };
    };

    const level = getLevel(scoreInt);
    const radius        = 26;
    const cx = 34; const cy = 34;
    const circumference = 2 * Math.PI * radius;
    const offset        = circumference - (scoreInt / 100) * circumference;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {/* ── Calibration banner (shown during sampling) ── */}
            {isCalibrating && (
                <CalibrationBanner progress={calibration.progress} />
            )}

            {/* ── Calibration complete badge ── */}
            {calibration?.done && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '4px 9px', borderRadius: '8px',
                    background: 'rgba(56,161,105,0.1)', border: '1px solid rgba(56,161,105,0.25)',
                    fontSize: '0.62em', color: '#68d391',
                }}>
                    <span>✓</span>
                    <span>Eye baseline set (EAR {calibration.earThreshold})</span>
                </div>
            )}

            {/* ── Score gauge row (hidden while calibrating) ── */}
            {!isCalibrating && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* SVG arc gauge */}
                        <svg width="68" height="68" style={{ flexShrink: 0 }}>
                            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1e2533" strokeWidth="4" />
                            <circle
                                cx={cx} cy={cy} r={radius} fill="none"
                                stroke={level.color} strokeWidth="4"
                                strokeDasharray={circumference}
                                strokeDashoffset={offset}
                                strokeLinecap="round"
                                transform={`rotate(-90 ${cx} ${cy})`}
                                style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.5s ease' }}
                            />
                            <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                                fill={level.color} fontSize="13" fontWeight="900" fontFamily="Space Mono, monospace">
                                {scoreInt}
                            </text>
                            <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
                                fill={level.color} fontSize="7" fontWeight="700" opacity="0.7">
                                FOCUS
                            </text>
                        </svg>

                        {/* Status info */}
                        <div style={{ flex: 1 }}>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                padding: '4px 9px', borderRadius: '20px',
                                background: level.bg, border: `1px solid ${level.color}44`,
                                marginBottom: '5px'
                            }}>
                                <span style={{ fontSize: '0.9em' }}>{level.emoji}</span>
                                <span style={{ fontSize: '0.72em', fontWeight: 700, color: level.color }}>
                                    {level.label}
                                </span>
                            </div>
                            <div style={{ fontSize: '0.68em', color: '#718096', lineHeight: 1.4 }}>
                                {cause}
                            </div>
                        </div>
                    </div>

                    {/* Signal pills */}
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {[
                            { label: '👁 Face',  bad: !isFaceDetected },
                            { label: '👀 Eyes',  bad: isEyesClosed    },
                            { label: '➡️ Gaze',  bad: isLookingAway   },
                            { label: '📑 Tab',   bad: !isTabActive    },
                        ].map(sig => (
                            <div key={sig.label} style={{
                                padding: '2px 7px', borderRadius: '10px', fontSize: '0.6em', fontWeight: 700,
                                background: sig.bad ? 'rgba(229,62,62,0.15)' : 'rgba(56,161,105,0.12)',
                                color:      sig.bad ? '#fc8181'              : '#68d391',
                                border:     `1px solid ${sig.bad ? '#c53030' : '#2f855a'}44`,
                                transition: 'all 0.4s ease',
                            }}>
                                {sig.label} {sig.bad ? '✗' : '✓'}
                            </div>
                        ))}
                    </div>

                    {/* Score bar */}
                    <div style={{ height: '4px', background: '#1e2533', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%', borderRadius: '4px',
                            width: `${scoreInt}%`,
                            background: `linear-gradient(90deg, ${level.color}aa, ${level.color})`,
                            transition: 'width 0.6s ease, background 0.5s ease',
                        }} />
                    </div>
                </>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Distraction Alert Overlay (full-screen gentle nudge)
// ─────────────────────────────────────────────────────────────
const DistractionOverlay = ({ focusState }) => {
    const { score, cause, isFaceDetected, isLookingAway, isEyesClosed, calibration } = focusState;

    // Never show during calibration — scoring hasn't started
    if (!calibration?.done) return null;
    const [visible, setVisible] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const lastHighRef = useRef(Date.now());

    useEffect(() => {
        if (score >= 60) {
            lastHighRef.current = Date.now();
            setDismissed(false);
            setVisible(false);
        } else if (score < 45 && !dismissed) {
            // Only show if been low for at least 2s
            const lowDuration = Date.now() - lastHighRef.current;
            if (lowDuration > 2000) setVisible(true);
        }
    }, [score, dismissed]);

    if (!visible) return null;

    const getMessage = () => {
        if (!isFaceDetected)   return { icon: '📷', title: 'Are you still there?',      sub: 'We can\'t see your face. Move into frame!' };
        if (isEyesClosed)      return { icon: '👀', title: 'Eyes open!',                sub: 'Looks like your eyes are closed. Stay with us!' };
        if (isLookingAway)     return { icon: '🎯', title: 'Look this way!',            sub: 'Your attention seems to be elsewhere.' };
        return                        { icon: '⚡', title: 'Stay focused!',             sub: 'Your focus score is dropping.' };
    };

    const { icon, title, sub } = getMessage();

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 8888,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'overlayIn 0.3s ease-out',
        }}>
            <div style={{
                background: 'linear-gradient(135deg, #1a1e2a, #111318)',
                border: '1px solid rgba(252,129,129,0.35)',
                borderRadius: '20px', padding: '32px 40px', textAlign: 'center',
                maxWidth: '340px', width: '90%',
                boxShadow: '0 0 60px rgba(229,62,62,0.2), 0 20px 40px rgba(0,0,0,0.5)',
                animation: 'popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
            }}>
                <div style={{ fontSize: '3em', marginBottom: '14px' }}>{icon}</div>
                <div style={{ fontSize: '1.15em', fontWeight: 800, color: '#f7fafc', marginBottom: '8px' }}>{title}</div>
                <div style={{ fontSize: '0.82em', color: '#a0aec0', marginBottom: '22px', lineHeight: 1.5 }}>{sub}</div>
                <div style={{ marginBottom: '18px' }}>
                    <div style={{ fontSize: '0.65em', color: '#718096', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Focus Score</div>
                    <div style={{ height: '6px', background: '#1e2533', borderRadius: '6px', overflow: 'hidden' }}>
                        <div style={{
                            height: '100%', borderRadius: '6px',
                            width: `${Math.round(score)}%`,
                            background: 'linear-gradient(90deg, #fc8181, #e53e3e)',
                            transition: 'width 0.6s ease'
                        }} />
                    </div>
                    <div style={{ fontSize: '1.5em', fontWeight: 900, color: '#fc8181', fontFamily: 'Space Mono, monospace', marginTop: '6px' }}>
                        {Math.round(score)}%
                    </div>
                </div>
                <button onClick={() => { setDismissed(true); setVisible(false); }} style={{
                    background: 'linear-gradient(135deg, #3182ce, #2b6cb0)',
                    color: 'white', border: 'none', borderRadius: '12px',
                    padding: '10px 28px', fontWeight: 700, cursor: 'pointer',
                    fontSize: '0.88em', fontFamily: 'DM Sans, sans-serif'
                }}>
                    I'm back! 👋
                </button>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Main StudentView
// ─────────────────────────────────────────────────────────────
const StudentView = () => {
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [timer, setTimer] = useState(0);
    const [submitted, setSubmitted] = useState(false);
    const [result, setResult] = useState(null);
    const [myScore, setMyScore] = useState(0);
    const [answerText, setAnswerText] = useState('');
    const [leaderboard, setLeaderboard] = useState([]);
    const [myRank, setMyRank] = useState(null);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [prevScores, setPrevScores] = useState({});
    const [myName, setMyName] = useState('');
    const [animatingPoints, setAnimatingPoints] = useState(null);

    // Focus state — updated every 500ms by the engine
    const [focusState, setFocusState] = useState({
        score: 100, cause: 'Initialising…',
        isFaceDetected: false, isLookingAway: false,
        isEyesClosed: false, isTabActive: true,
        calibration: { done: false, collecting: false, progress: 0, earThreshold: 0.20 },
    });

    const teacherVideoRef = useRef();
    const myVideoRef      = useRef();
    const canvasRef       = useRef();       // overlay on camera feed
    const activePeer      = useRef(null);
    const outgoingPeerRef = useRef(null);
    const cameraStreamRef = useRef(null);

    // Handle focus state change from engine
    const handleFocusChange = useCallback((newState) => {
        setFocusState(newState);
    }, []);

    useEffect(() => {
        // Inject styles
        const style = document.createElement('style');
        style.id = 'focusai-student-styles';
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,700;0,9..40,900&family=Space+Mono:wght@700&display=swap');
            body { font-family: 'DM Sans', sans-serif !important; margin: 0; }
            @keyframes slideUp { from { opacity:0; transform:translate(-50%, 30px); } to { opacity:1; transform:translate(-50%, 0); } }
            @keyframes slideInFeedback { from { opacity:0; transform:translate(-50%, -20px); } to { opacity:1; transform:translate(-50%, 0); } }
            @keyframes pointsPop { 0% { opacity:0; transform:translateY(0) scale(0.5); } 50% { opacity:1; transform:translateY(-30px) scale(1.3); } 100% { opacity:0; transform:translateY(-60px) scale(1); } }
            @keyframes rankBounce { 0%,100% { transform:scale(1); } 40% { transform:scale(1.25); } 70% { transform:scale(0.95); } }
            @keyframes rowFadeIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
            @keyframes timerPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.05); } }
            @keyframes overlayIn { from { opacity:0; } to { opacity:1; } }
            @keyframes popIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }
            ::-webkit-scrollbar { width:3px; } ::-webkit-scrollbar-thumb { background:#2d3748; border-radius:2px; }
            .mcq-btn:hover { border-color:#667eea !important; background:rgba(102,126,234,0.1) !important; transform:translateY(-2px); }
            .mcq-btn:active { transform:scale(0.97); }
        `;
        if (!document.getElementById('focusai-student-styles')) document.head.appendChild(style);

        const storedName = sessionStorage.getItem('focusai_name') || '';
        setMyName(storedName);

        if (!socket.connected) socket.connect();

        // Start camera, then start focus tracking with canvas overlay
        navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(stream => {
            cameraStreamRef.current = stream;
            if (myVideoRef.current) myVideoRef.current.srcObject = stream;

            // Wait for video to be ready, then start tracking
            myVideoRef.current.onloadedmetadata = () => {
                startFocusTracking(myVideoRef.current, canvasRef.current, handleFocusChange);
            };
        }).catch(err => {
            console.warn('Cam Error:', err);
            // Start tracking anyway (tab-visibility only mode)
            startFocusTracking(null, null, handleFocusChange);
        });

        // ── Socket events ────────────────────────────────
        socket.on('new_question', (data) => {
            setCurrentQuestion(data);
            setSubmitted(false);
            setResult(null);
            setAnswerText('');
            setShowLeaderboard(false);
            const remaining = Math.ceil((data.endTime - Date.now()) / 1000);
            setTimer(remaining > 0 ? remaining : 0);
        });

        socket.on('answer_result', (data) => {
            setResult(data);
            if (data.totalScore !== undefined) {
                setMyScore(data.totalScore);
                if (data.points > 0) {
                    setAnimatingPoints(data.points);
                    setTimeout(() => setAnimatingPoints(null), 1500);
                }
            }
            setTimeout(() => setShowLeaderboard(true), 800);
        });

        socket.on('leaderboard_update', (lb) => {
            const newPrev = {};
            lb.forEach(s => { newPrev[s.id] = s.score; });
            setPrevScores(newPrev);
            setLeaderboard(lb);
            const myEntry = lb.find(s => s.id === socket.id);
            if (myEntry) setMyRank(lb.indexOf(myEntry) + 1);
        });

        socket.on('signal', (data) => {
            if (data.type === 'teacher_ready') {
                if (outgoingPeerRef.current) return;
                const stream = cameraStreamRef.current;
                if (!stream) return;
                const peer = new SimplePeer({ initiator: true, trickle: false, stream });
                peer.on('signal', signal => socket.emit('signal', { target: data.sender, signal, type: 'student_stream' }));
                outgoingPeerRef.current = peer;
            } else if (data.type === 'student_stream_ack') {
                if (outgoingPeerRef.current) outgoingPeerRef.current.signal(data.signal);
            } else {
                if (!activePeer.current) {
                    const peer = new SimplePeer({ initiator: false, trickle: false });
                    peer.on('signal', signal => socket.emit('signal', { target: data.sender, signal }));
                    peer.on('stream', stream => { if (teacherVideoRef.current) teacherVideoRef.current.srcObject = stream; });
                    activePeer.current = peer;
                }
                activePeer.current.signal(data.signal);
            }
        });

        return () => {
            stopFocusTracking();
            ['new_question','answer_result','leaderboard_update','signal'].forEach(e => socket.off(e));
            if (activePeer.current) activePeer.current.destroy();
            if (outgoingPeerRef.current) outgoingPeerRef.current.destroy();
            if (cameraStreamRef.current) cameraStreamRef.current.getTracks().forEach(t => t.stop());
            const el = document.getElementById('focusai-student-styles');
            if (el) el.remove();
        };
    }, []);

    // Sync canvas size to video size
    useEffect(() => {
        const video = myVideoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        const sync = () => {
            canvas.width  = video.videoWidth  || video.clientWidth;
            canvas.height = video.videoHeight || video.clientHeight;
        };
        video.addEventListener('loadedmetadata', sync);
        sync();
        return () => video.removeEventListener('loadedmetadata', sync);
    }, []);

    useEffect(() => {
        if (timer > 0) {
            const i = setInterval(() => setTimer(t => t - 1), 1000);
            return () => clearInterval(i);
        }
    }, [timer]);

    const handleSubmit = (val) => {
        if (submitted || timer <= 0) return;
        const finalAns = val || answerText;
        if (!finalAns) return;
        socket.emit('submit_answer', { questionId: currentQuestion.timestamp, answer: finalAns, submitTime: Date.now() });
        setAnswerText(finalAns);
        setSubmitted(true);
    };

    const getRankEmoji = (rank) => {
        if (rank === 1) return '🥇';
        if (rank === 2) return '🥈';
        if (rank === 3) return '🥉';
        return `#${rank}`;
    };

    const timerPercent = currentQuestion ? (timer / currentQuestion.timerDuration) * 100 : 100;
    const timerColor   = timer < 5 ? '#fc8181' : timer < 10 ? '#f6ad55' : '#63b3ed';

    return (
        <div style={{ height: '100vh', background: '#0d0f15', color: 'white', display: 'flex', overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" }}>

            {/* Distraction overlay — only shows when score dips low for a while */}
            <DistractionOverlay focusState={focusState} />

            {/* ====== MAIN VIDEO AREA ====== */}
            <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080a0f' }}>
                <video ref={teacherVideoRef} autoPlay playsInline style={{ maxHeight: '100%', maxWidth: '100%', width: '100%', height: '100%', objectFit: 'contain' }} />
                {!activePeer.current && (
                    <div style={{ position: 'absolute', color: '#2d3748', textAlign: 'center' }}>
                        <div style={{ fontSize: '3em', marginBottom: '10px' }}>📡</div>
                        <div style={{ fontSize: '0.9em' }}>Waiting for teacher's video feed...</div>
                    </div>
                )}

                {/* Question popup */}
                {currentQuestion && timer > 0 && !submitted && (
                    <div style={{
                        position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(15,17,23,0.97)', backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        padding: '28px 32px', borderRadius: '22px', width: '90%', maxWidth: '580px',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                        animation: 'slideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}>
                        <div style={{ height: '3px', background: '#1e2533', borderRadius: '3px', marginBottom: '18px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: `linear-gradient(90deg, ${timerColor}, ${timerColor}cc)`, width: `${timerPercent}%`, transition: 'width 1s linear, background 0.5s', borderRadius: '3px' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', gap: '16px' }}>
                            <div>
                                <div style={{ fontSize: '0.68em', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#4a5568', marginBottom: '6px', fontWeight: 700 }}>Pop Quiz</div>
                                <h2 style={{ margin: 0, fontSize: '1.25em', color: '#f7fafc', fontWeight: 700, lineHeight: 1.3 }}>{currentQuestion.questionText}</h2>
                            </div>
                            <div style={{
                                width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
                                background: `conic-gradient(${timerColor} ${timerPercent * 3.6}deg, #1e2533 0deg)`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                animation: timer <= 5 ? 'timerPulse 0.5s infinite' : 'none'
                            }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#0d0f15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span style={{ fontSize: '1em', fontWeight: 900, color: timerColor, fontFamily: "'Space Mono', monospace" }}>{timer}</span>
                                </div>
                            </div>
                        </div>

                        {currentQuestion.type === 'MCQ' ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                {currentQuestion.options.map((opt, i) => (
                                    <button key={i} onClick={() => handleSubmit(opt)} className="mcq-btn" style={{
                                        padding: '14px 16px', border: '1.5px solid #2d3748', borderRadius: '12px',
                                        background: 'rgba(255,255,255,0.03)', color: '#e2e8f0',
                                        fontSize: '1em', cursor: 'pointer', transition: 'all 0.2s',
                                        fontWeight: 600, textAlign: 'left', fontFamily: "'DM Sans', sans-serif"
                                    }}>
                                        <span style={{ color: '#4a5568', marginRight: '8px', fontSize: '0.85em' }}>{String.fromCharCode(65 + i)}.</span>
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input autoFocus placeholder="Type your answer…"
                                    value={answerText} onChange={e => setAnswerText(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                                    style={{ flex: 1, padding: '14px 16px', borderRadius: '12px', border: '1.5px solid #2d3748', background: 'rgba(255,255,255,0.05)', color: 'white', fontSize: '1em', outline: 'none', fontFamily: "'DM Sans', sans-serif" }} />
                                <button onClick={() => handleSubmit()} style={{
                                    padding: '0 24px', background: 'linear-gradient(135deg, #2b6cb0, #3182ce)', color: 'white',
                                    border: 'none', borderRadius: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif"
                                }}>Submit</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Feedback banner */}
                {(result || (submitted && !result)) && (
                    <div style={{
                        position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
                        padding: '13px 26px', borderRadius: '50px',
                        background: result ? (result.correct ? 'linear-gradient(135deg,#276749,#38a169)' : 'linear-gradient(135deg,#9b2c2c,#c53030)') : 'linear-gradient(135deg,#744210,#c05621)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.4)', fontWeight: 700,
                        display: 'flex', alignItems: 'center', gap: '10px',
                        animation: 'slideInFeedback 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        whiteSpace: 'nowrap'
                    }}>
                        {result ? (
                            <>
                                <span style={{ fontSize: '1.4em' }}>{result.correct ? '🎉' : '❌'}</span>
                                <div>
                                    <div style={{ fontSize: '0.95em' }}>{result.message}</div>
                                    <div style={{ fontSize: '0.72em', opacity: 0.85 }}>Total: {myScore} pts{myRank ? ` · Rank ${getRankEmoji(myRank)}` : ''}</div>
                                </div>
                            </>
                        ) : (
                            <><span>⏳</span><span style={{ fontSize: '0.9em' }}>Submitted! Waiting for results...</span></>
                        )}
                    </div>
                )}

                {/* Points pop animation */}
                {animatingPoints && (
                    <div style={{
                        position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)',
                        color: '#68d391', fontWeight: 900, fontSize: '1.8em',
                        animation: 'pointsPop 1.5s ease-out forwards',
                        pointerEvents: 'none', fontFamily: "'Space Mono', monospace",
                        textShadow: '0 0 20px rgba(104,211,145,0.6)'
                    }}>
                        +{animatingPoints}
                    </div>
                )}
            </div>

            {/* ====== RIGHT SIDEBAR ====== */}
            <div style={{ width: '280px', background: '#111318', borderLeft: '1px solid #1e2533', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* Score */}
                <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid #1e2533' }}>
                    <div style={{ fontSize: '0.65em', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, marginBottom: '4px' }}>Your Score</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ fontSize: '2.2em', fontWeight: 900, color: '#f7fafc', fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{myScore}</span>
                        <span style={{ fontSize: '0.75em', color: '#63b3ed', fontWeight: 700 }}>PTS</span>
                        {myRank && <span style={{ marginLeft: 'auto', fontSize: '1.2em', animation: 'rankBounce 0.5s ease' }}>{getRankEmoji(myRank)}</span>}
                    </div>
                </div>

                {/* ── Focus Analyzer ── */}
                <div style={{ padding: '12px 14px', borderBottom: '1px solid #1e2533' }}>
                    <div style={{ fontSize: '0.65em', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Focus Analyzer</span>
                        {focusState.calibration?.done
                            ? <span style={{ color: '#68d391', fontSize: '0.95em' }}>● Live</span>
                            : <span style={{ color: '#f6ad55', fontSize: '0.95em' }}>◐ Calibrating</span>
                        }
                    </div>

                    {/* Camera + canvas overlay */}
                    <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', aspectRatio: '4/3', background: '#0d0f15', border: '1px solid #1e2533', marginBottom: '10px' }}>
                        <video ref={myVideoRef} autoPlay muted playsInline
                            style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} />
                        <canvas ref={canvasRef}
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
                    </div>

                    {/* Focus HUD */}
                    <FocusHUD focusState={focusState} />
                </div>

                {/* Leaderboard */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.65em', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>🏆 Leaderboard</div>
                        {leaderboard.length > 0 && <div style={{ fontSize: '0.65em', color: '#718096' }}>{leaderboard.length} players</div>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 12px' }}>
                        {leaderboard.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#4a5568', fontSize: '0.78em', padding: '20px 10px' }}>
                                No scores yet. Answer a question to appear!
                            </div>
                        ) : leaderboard.map((s, i) => {
                            const isMe = s.id === socket.id;
                            const rankColors = ['#d69e2e', '#718096', '#b7791f'];
                            return (
                                <div key={s.id} style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '9px 10px', borderRadius: '10px', marginBottom: '5px',
                                    background: isMe ? 'rgba(99,179,237,0.12)' : i === 0 ? 'rgba(237,189,0,0.07)' : '#1a1e2a',
                                    border: `1px solid ${isMe ? 'rgba(99,179,237,0.35)' : i === 0 ? 'rgba(237,189,0,0.25)' : '#1e2533'}`,
                                    animation: `rowFadeIn 0.3s ease-out ${i * 0.05}s both`,
                                    transition: 'all 0.3s ease'
                                }}>
                                    <div style={{
                                        width: '24px', height: '24px', borderRadius: '50%',
                                        background: i < 3 ? rankColors[i] : '#1e2533',
                                        color: i < 3 ? 'white' : '#4a5568',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '0.72em', fontWeight: 900, flexShrink: 0
                                    }}>{i + 1}</div>
                                    <div style={{ flex: 1, fontSize: '0.82em', fontWeight: isMe ? 700 : 500, color: isMe ? '#90cdf4' : '#cbd5e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {s.name}{isMe ? ' (you)' : ''}
                                    </div>
                                    <div style={{ fontSize: '0.82em', fontWeight: 900, color: i === 0 ? '#f6e05e' : isMe ? '#63b3ed' : '#718096', fontFamily: "'Space Mono', monospace", flexShrink: 0 }}>
                                        {s.score}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StudentView;
