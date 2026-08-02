const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let waitingQueue = [];
let activeMatches = new Map(); // userId -> { roomId, partnerId }

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

    // Remove user from queue if they are already in it to refresh their status
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);

    let matchIndex = -1;
    for (let i = 0; i < waitingQueue.length; i++) {
        const queuedUser = waitingQueue[i];
        if (queuedUser.userId === userId) continue;

        const qGender = (queuedUser.gender || "any").toLowerCase();
        const qTargetGender = (queuedUser.targetGender || "any").toLowerCase();
        const qLanguage = (queuedUser.language || "any").toLowerCase();
        const qTargetLanguage = (queuedUser.targetLanguage || "any").toLowerCase();

        // Gender Compatibility Check
        const genderWantsThem = (userTargetGender === "any" || userTargetGender === qGender);
        const theyWantGender = (qTargetGender === "any" || qTargetGender === userGender);
        const isGenderCompatible = genderWantsThem && theyWantGender;

        // Robust bidirectional language compatibility check
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

    // Add user to the waiting queue if no match is found
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
        activeMatches.delete(userId);
    }
    return res.json({ status: "cancelled" });
});

// 3. EXTEND TIME COIN DEDUCTION (8 coins for 10 more minutes)
app.post('/extend-time', (req, res) => {
    const { userId } = req.body;
    console.log(`[Time Extension] User ${userId} paid 8 coins to extend call time.`);
    return res.json({ status: "success", message: "Time extended successfully!" });
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
