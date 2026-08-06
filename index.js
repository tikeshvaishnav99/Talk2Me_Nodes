const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);

let waitingQueue = [];
let activeMatches = new Map(); 
let roomExtensions = new Map(); 

app.get('/', (req, res) => res.status(200).send("Talk2Me Progressive Backend Operational"));

// 1. MATCHMAKING
app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender, language, targetLanguage } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    if (activeMatches.has(userId)) {
        const matchInfo = activeMatches.get(userId);
        return res.json({ status: "matched", roomId: matchInfo.roomId });
    }

    const userGender = (gender || "any").toLowerCase();
    const userTargetGender = (targetGender || "any").toLowerCase();
    const userLanguage = (language || "any").toLowerCase();
    const userTargetLanguage = (targetLanguage || "any").toLowerCase();

    waitingQueue = waitingQueue.filter(u => u.userId !== userId);

    let matchIndex = -1;
    for (let i = 0; i < waitingQueue.length; i++) {
        const q = waitingQueue[i];
        if (q.userId === userId) continue;

        const genderWantsThem = (userTargetGender === "any" || userTargetGender === q.gender);
        const theyWantGender = (q.targetGender === "any" || q.targetGender === userGender);
        let isLanguageCompatible = (userTargetLanguage === "any" || q.targetLanguage === "any" || userTargetLanguage === q.language || q.targetLanguage === userLanguage);

        if (genderWantsThem && theyWantGender && isLanguageCompatible) {
            matchIndex = i;
            break;
        }
    }

    if (matchIndex !== -1) {
        const partner = waitingQueue.splice(matchIndex, 1)[0];
        const roomId = `Room_${Math.floor(100000 + Math.random() * 900000)}`;

        activeMatches.set(userId, { roomId, partnerUserId: partner.userId });
        activeMatches.set(partner.userId, { roomId, partnerUserId: userId });

        roomExtensions.set(roomId, { requesterId: null, status: "none", consumedBy: new Set() });

        return res.json({ status: "matched", roomId });
    }

    waitingQueue.push({ userId, gender: userGender, targetGender: userTargetGender, language: userLanguage, targetLanguage: userTargetLanguage, timestamp: Date.now() });
    return res.json({ status: "waiting" });
});

// 2. EXTENSION HANDSHAKE WITH MULTI-EXTENSION RESET
app.post('/call-extension/request', (req, res) => {
    const { roomId, userId } = req.body;
    if (!roomId || !userId) return res.status(400).json({ error: "Missing fields" });

    let ext = roomExtensions.get(roomId);
    if (!ext) {
        ext = { requesterId: userId, status: "requested", consumedBy: new Set() };
        roomExtensions.set(roomId, ext);
        return res.json({ status: "requested" });
    }

    if (ext.status === "requested" && ext.requesterId !== userId) {
        ext.status = "accepted";
        ext.consumedBy = new Set();
        return res.json({ status: "accepted" });
    }

    ext.requesterId = userId;
    ext.status = "requested";
    ext.consumedBy = new Set();
    return res.json({ status: "requested" });
});

app.post('/call-extension/accept', (req, res) => {
    const { roomId } = req.body;
    let ext = roomExtensions.get(roomId);
    if (ext) {
        ext.status = "accepted";
        ext.consumedBy = new Set();
    }
    return res.json({ status: "accepted" });
});

app.post('/call-extension/decline', (req, res) => {
    const { roomId } = req.body;
    let ext = roomExtensions.get(roomId);
    if (ext) {
        ext.status = "declined";
    }
    return res.json({ status: "declined" });
});

app.get('/call-extension/status', (req, res) => {
    const { roomId, userId } = req.query;
    const ext = roomExtensions.get(roomId);

    if (!ext) return res.json({ status: "none" });

    const currentStatus = ext.status;

    if (currentStatus === "accepted") {
        ext.consumedBy.add(userId);
        if (ext.consumedBy.size >= 2) {
            ext.status = "none"; // Resets state so room can be extended AGAIN later!
        }
    }

    return res.json({ status: currentStatus });
});

app.post('/cancel-match', (req, res) => {
    const { userId } = req.body;
    if (userId) {
        waitingQueue = waitingQueue.filter(u => u.userId !== userId);
        const matchInfo = activeMatches.get(userId);
        if (matchInfo) {
            roomExtensions.delete(matchInfo.roomId);
            activeMatches.delete(matchInfo.partnerUserId);
        }
        activeMatches.delete(userId);
    }
    return res.json({ status: "cancelled" });
});

setInterval(() => {
    const now = Date.now();
    waitingQueue = waitingQueue.filter(u => (now - u.timestamp) < 45000);
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Talk2Me Engine] Server running on port ${PORT}`));
