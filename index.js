const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

// CORS Configuration for Production
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000
});

// State Store
let waitingQueue = [];
let activeMatches = new Map(); // socketId -> { roomId, partnerSocketId, userId, partnerUserId }
let roomExtensions = new Map(); // roomId -> { requesterId, status: "none" | "requested" | "accepted" | "declined" }

// -------------------------------------------------------------
// HEALTH CHECK & SERVER WAKE-UP
// -------------------------------------------------------------
app.get('/', (req, res) => {
    res.status(200).send("Talk2Me Backend Engine Operational.");
});

// -------------------------------------------------------------
// SOCKET.IO REAL-TIME MATCHMAKING & EXTENSIONS
// -------------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`[Connected] Client connected: ${socket.id}`);

    // --- 1. FIND MATCH ---
    socket.on('find_match', (data) => {
        const { userId, gender, targetGender, language, targetLanguage } = data;
        if (!userId) return socket.emit('match_error', { message: "userId required" });

        // Clean user from queue if already waiting
        waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id && u.userId !== userId);

        const userGender = (gender || "any").toLowerCase();
        const userTargetGender = (targetGender || "any").toLowerCase();
        const userLanguage = (language || "any").toLowerCase();
        const userTargetLanguage = (targetLanguage || "any").toLowerCase();

        let matchIndex = -1;

        for (let i = 0; i < waitingQueue.length; i++) {
            const candidate = waitingQueue[i];

            // Gender compatibility check
            const genderWantsThem = (userTargetGender === "any" || userTargetGender === candidate.gender);
            const theyWantGender = (candidate.targetGender === "any" || candidate.targetGender === userGender);
            const isGenderCompatible = genderWantsThem && theyWantGender;

            // Language compatibility check
            let isLanguageCompatible = false;
            if (userTargetLanguage === "any" && candidate.targetLanguage === "any") {
                isLanguageCompatible = true;
            } else if (userTargetLanguage === "any") {
                isLanguageCompatible = (candidate.targetLanguage === userLanguage || candidate.language === "any");
            } else if (candidate.targetLanguage === "any") {
                isLanguageCompatible = (userTargetLanguage === candidate.language || userLanguage === "any");
            } else {
                isLanguageCompatible = (userTargetLanguage === candidate.language && candidate.targetLanguage === userLanguage);
            }

            if (isGenderCompatible && isLanguageCompatible) {
                matchIndex = i;
                break;
            }
        }

        if (matchIndex !== -1) {
            const partner = waitingQueue.splice(matchIndex, 1)[0];
            const roomId = `Room_${Math.floor(100000 + Math.random() * 900000)}`;

            socket.join(roomId);
            const partnerSocket = io.sockets.sockets.get(partner.socketId);
            if (partnerSocket) partnerSocket.join(roomId);

            activeMatches.set(socket.id, { roomId, partnerSocketId: partner.socketId, userId, partnerUserId: partner.userId });
            activeMatches.set(partner.socketId, { roomId, partnerSocketId: socket.id, userId: partner.userId, partnerUserId: userId });

            roomExtensions.set(roomId, { requesterId: null, status: "none" });

            // Notify both users instantly
            io.to(roomId).emit('match_found', { roomId });
            console.log(`[Matched] Paired ${userId} and ${partner.userId} in ${roomId}`);
        } else {
            waitingQueue.push({
                socketId: socket.id,
                userId,
                gender: userGender,
                targetGender: userTargetGender,
                language: userLanguage,
                targetLanguage: userTargetLanguage,
                timestamp: Date.now()
            });
            socket.emit('match_waiting');
        }
    });

    // --- 2. CANCEL MATCHMAKING / LEAVE CALL ---
    socket.on('cancel_match', () => {
        handleUserDisconnect(socket);
    });

    // --- 3. CALL EXTENSION HANDSHAKE ---
    socket.on('request_extension', (data) => {
        const { roomId, userId } = data;
        const ext = roomExtensions.get(roomId);

        if (!ext) return;

        // Mutual click protection: auto-accept if partner already requested
        if (ext.status === "requested" && ext.requesterId !== userId) {
            ext.status = "accepted";
            io.to(roomId).emit('extension_status', { status: "accepted" });
            
            // Clean state after broadcast to prevent infinite coin deductions
            setTimeout(() => roomExtensions.set(roomId, { requesterId: null, status: "none" }), 3000);
            return;
        }

        ext.requesterId = userId;
        ext.status = "requested";
        socket.to(roomId).emit('extension_status', { status: "requested", requesterId: userId });
    });

    socket.on('accept_extension', (data) => {
        const { roomId } = data;
        roomExtensions.set(roomId, { requesterId: null, status: "accepted" });
        io.to(roomId).emit('extension_status', { status: "accepted" });

        // Reset state after triggering timers on both ends
        setTimeout(() => roomExtensions.set(roomId, { requesterId: null, status: "none" }), 3000);
    });

    socket.on('decline_extension', (data) => {
        const { roomId } = data;
        roomExtensions.set(roomId, { requesterId: null, status: "declined" });
        socket.to(roomId).emit('extension_status', { status: "declined" });

        setTimeout(() => roomExtensions.set(roomId, { requesterId: null, status: "none" }), 3000);
    });

    // --- 4. DISCONNECT CLEANUP ---
    socket.on('disconnect', () => {
        handleUserDisconnect(socket);
    });
});

function handleUserDisconnect(socket) {
    // Remove from queue
    waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id);

    // Notify partner in active match
    const matchInfo = activeMatches.get(socket.id);
    if (matchInfo) {
        socket.to(matchInfo.roomId).emit('partner_left');
        roomExtensions.delete(matchInfo.roomId);
        activeMatches.delete(matchInfo.partnerSocketId);
        activeMatches.delete(socket.id);
    }
}

// Garbage Collection Interval for Stale Queue Entries (Sweeps every 30s)
setInterval(() => {
    const now = Date.now();
    waitingQueue = waitingQueue.filter(user => (now - user.timestamp) < 45000);
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Talk2Me Engine] Server running on port ${PORT}`));
