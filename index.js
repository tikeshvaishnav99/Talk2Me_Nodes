const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);

let waitingQueue = [];
let activeMatches = new Map(); 
let roomExtensions = new Map(); 

app.get('/', (req, res) => res.status(200).send("Talk2Me Progressive Backend Operational"));

// Helper: Sanitize inputs safely
const cleanStr = (str) => (str || "any").toString().trim().toLowerCase();

// 1. MATCHMAKING ENDPOINT
app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender, language, targetLanguage } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    // Return active room if user is already matched
    if (activeMatches.has(userId)) {
        const matchInfo = activeMatches.get(userId);
        return res.json({ status: "matched", roomId: matchInfo.roomId });
    }

    const uGender = cleanStr(gender);
    const uTargetGender = cleanStr(targetGender);
    const uLang = cleanStr(language);
    const uTargetLang = cleanStr(targetLanguage);

    // Remove stale queue entry for this user
    waitingQueue = waitingQueue.filter(u => u.userId !== userId);

    let matchIndex = -1;
    for (let i = 0; i < waitingQueue.length; i++) {
        const q = waitingQueue[i];
        if (q.userId === userId) continue;

        // --- GENDER MATCHING CHECK ---
        const genderWantsThem = (uTargetGender === "any" || uTargetGender === q.gender);
        const theyWantGender = (q.targetGender === "any" || q.targetGender === uGender);
        const isGenderCompatible = genderWantsThem && theyWantGender;

        // --- MUTUAL LANGUAGE MATCHING CHECK (STRICT & FIXED) ---
        // User A must accept User B's native language AND User B must accept User A's native language
        const userAAcceptsUserB = (uTargetLang === "any" || uTargetLang === "any language" || uTargetLang === q.language);
        const userBAcceptsUserA = (q.targetLanguage === "any" || q.targetLanguage === "any language" || q.targetLanguage === uLang);
        const isLanguageCompatible = userAAcceptsUserB && userBAcceptsUserA;

        if (isGenderCompatible && isLanguageCompatible) {
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

    // Add user to queue if no mutual match is found
    waitingQueue.push({ 
        userId, 
        gender: uGender, 
        targetGender: uTargetGender, 
        language: uLang, 
        targetLanguage: uTargetLang, 
        timestamp: Date.now() 
    });
    
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
            ext.status = "none"; // Reset state for subsequent extension windows
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
