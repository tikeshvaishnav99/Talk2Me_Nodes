const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let waitingQueue = [];
let activeMatches = new Map(); // userId -> { roomId, partnerId }
let roomExtensions = {};     // roomId -> { requester, status }

// 1. REGULAR MATCHMAKING (Gender & Language Filters)
app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender, language, targetLanguage } = req.body;

    if (!userId) return res.status(400).json({ error: "userId is required" });

    if (activeMatches.has(userId)) {
        const matchInfo = activeMatches.get(userId);
        return res.json({ status: "matched", roomId: matchInfo.roomId });
    }

    const userGender = (gender || "any").toLowerCase();
    const userTargetGender = (targetGender || "any").toLowerCase();
    const userLanguage = (language || "any").toLowerCase();
    const userTargetLanguage = (targetLanguage || "any").toLowerCase();

    waitingQueue = waitingQueue.filter(user => user.userId !== userId);

    let matchIndex = -1;
    for (let i = 0; i < waitingQueue.length; i++) {
        const queuedUser = waitingQueue[i];
        if (queuedUser.userId === userId) continue;

        const qGender = (queuedUser.gender || "any").toLowerCase();
        const qTargetGender = (queuedUser.targetGender || "any").toLowerCase();
        const qLanguage = (queuedUser.language || "any").toLowerCase();
        const qTargetLanguage = (queuedUser.targetLanguage || "any").toLowerCase();

        const genderWantsThem = (userTargetGender === "any" || userTargetGender === qGender);
        const theyWantGender = (qTargetGender === "any" || qTargetGender === userGender);
        const isGenderCompatible = genderWantsThem && theyWantGender;

        let isLanguageCompatible = false;
        if (userTargetLanguage === "any" && qTargetLanguage === "any") {
            isLanguageCompatible = true;
        } else if (userTargetLanguage === "any") {
            isLanguageCompatible = (qTargetLanguage === userLanguage || qLanguage === "any");
        } else if (qTargetLanguage === "any") {
            isLanguageCompatible = (userTargetLanguage === qLanguage || userLanguage === "any");
        } else {
            isLanguageCompatible = (userTargetLanguage === qLanguage && qTargetLanguage === userLanguage);
        }

        if (isGenderCompatible && isLanguageCompatible) {
            matchIndex = i;
            break;
        }
    }

    if (matchIndex !== -1) {
        const partner = waitingQueue.splice(matchIndex, 1)[0];
        const roomId = `Room_${Math.floor(10000 + Math.random() * 90000)}`;

        activeMatches.set(userId, { roomId, partnerId: partner.userId });
        activeMatches.set(partner.userId, { roomId, partnerId: userId });

        console.log(`[Matchmaking] Successfully paired ${userId} with ${partner.userId} in ${roomId}`);
        return res.json({ status: "matched", roomId: roomId });
    }

    waitingQueue.push({ 
        userId, 
        gender: userGender, 
        targetGender: userTargetGender, 
        language: userLanguage, 
        targetLanguage: userTargetLanguage, 
        timestamp: Date.now() 
    });
    
    return res.json({ status: "waiting" });
});

// 2. CANCEL MATCHMAKING
app.post('/cancel-match', (req, res) => {
    const { userId } = req.body;
    if (userId) {
        waitingQueue = waitingQueue.filter(user => user.userId !== userId);
        
        const matchInfo = activeMatches.get(userId);
        if (matchInfo) {
            delete roomExtensions[matchInfo.roomId];
            activeMatches.delete(matchInfo.partnerId);
        }
        activeMatches.delete(userId);
    }
    return res.json({ status: "cancelled" });
});

// 3. CALL EXTENSION HANDSHAKE ENDPOINTS
app.post('/call-extension/request', (req, res) => {
    const { roomId, userId } = req.body;
    if (!roomId || !userId) return res.status(400).json({ error: "Missing roomId or userId" });

    roomExtensions[roomId] = {
        requester: userId,
        status: "requested"
    };

    console.log(`[Extension] User ${userId} requested an extension for room ${roomId}`);
    return res.json({ status: "requested" });
});

app.post('/call-extension/accept', (req, res) => {
    const { roomId, userId } = req.body;
    if (!roomId || !userId) return res.status(400).json({ error: "Missing roomId or userId" });

    if (roomExtensions[roomId]) {
        roomExtensions[roomId].status = "accepted";
    } else {
        roomExtensions[roomId] = { requester: userId, status: "accepted" };
    }

    console.log(`[Extension] Extension accepted for room ${roomId} by ${userId}`);
    return res.json({ status: "accepted" });
});

app.get('/call-extension/status', (req, res) => {
    const { roomId, userId } = req.query;
    if (!roomId || !userId) return res.status(400).json({ error: "Missing roomId or userId" });

    const extensionInfo = roomExtensions[roomId];
    if (!extensionInfo) {
        return res.json({ status: "none" });
    }

    // If accepted, notify both clients so their timers reset together
    if (extensionInfo.status === "accepted") {
        return res.json({ status: "accepted" });
    }

    // If requested, trigger the extension popup only for the peer who didn't request it
    if (extensionInfo.status === "requested" && extensionInfo.requester !== userId) {
        return res.json({ status: "requested" });
    }

    return res.json({ status: "none" });
});

// 4. REAL-TIME AUTO-DELETE CHAT (Socket.io)
io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => socket.join(roomId));
    socket.on('send_message', (data) => {
        const { roomId, senderId, message } = data;
        socket.to(roomId).emit('receive_message', { senderId, message });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`))[cite: 24];
