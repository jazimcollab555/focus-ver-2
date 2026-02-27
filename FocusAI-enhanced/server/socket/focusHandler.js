// server/socket/focusHandler.js
const store = require('../store');
const { FocusLog } = require('../models/Schemas');
const ONE_MINUTE = 60 * 1000;

module.exports = (io, socket) => {
    socket.on('focus_update', async (data) => {
        let focusEntry = store.focusData.get(socket.id) || { history: [], lastScore: 100 };

        // Update with rich data from new engine
        focusEntry.lastScore     = data.score;
        focusEntry.lastCause     = data.cause     || null;
        focusEntry.isLookingAway = data.isLookingAway || false;
        focusEntry.isEyesClosed  = data.isEyesClosed  || false;
        focusEntry.history.push({ time: Date.now(), score: data.score });

        // Keep only last 10 minutes
        const tenMinsAgo = Date.now() - (10 * ONE_MINUTE);
        focusEntry.history = focusEntry.history.filter(h => h.time > tenMinsAgo);

        store.focusData.set(socket.id, focusEntry);

        const studentInfo = store.studentData.get(socket.id);
        const studentName = studentInfo ? studentInfo.name : `Student ${socket.id.substr(0, 4)}`;

        // Rich cause string: prefer the client-reported cause, then derive from flags
        const cause = data.cause || (
            !data.isTabActive    ? 'Tab Switch' :
            data.isEyesClosed    ? 'Eyes Closed' :
            data.isLookingAway   ? 'Looking Away' :
            !data.isFaceDetected ? 'No Face'     : 'Unknown'
        );

        if (data.score < 50) {
            io.emit('distracted_student', {
                studentId:   socket.id,
                studentName: studentName,
                score:       data.score,
                cause:       cause,
            });
        }

        // Broadcast heatmap snapshot
        const classFocusSnapshot = Array.from(store.studentData.entries()).map(([id, s]) => {
            const fd = store.focusData.get(id);
            return {
                studentId:   id,
                name:        s.name,
                score:       fd ? fd.lastScore        : 100,
                cause:       fd ? fd.lastCause        : null,
                isLookingAway: fd ? fd.isLookingAway  : false,
                isEyesClosed:  fd ? fd.isEyesClosed   : false,
            };
        });
        io.emit('class_focus_snapshot', classFocusSnapshot);

        // Persist
        if (global.currentSessionId) {
            try {
                await FocusLog.create({
                    sessionId:     global.currentSessionId,
                    studentId:     socket.id,
                    score:         data.score,
                    isTabActive:   data.isTabActive,
                    isFaceDetected: data.isFaceDetected,
                    isLookingAway:  data.isLookingAway  || false,
                    isEyesClosed:   data.isEyesClosed   || false,
                    cause:          cause,
                });
            } catch (_) { /* suppress spam */ }
        }
    });

    socket.on('disconnect', () => {
        store.focusData.delete(socket.id);
    });
};
