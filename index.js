const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);

let waitingQueue = [];
let activeMatches = new Map(); 
let roomExtensions = new Map(); 
let userDatabase = new Map(); 
let activeDuelInvites = new Map(); // roomId -> { senderId, isCoOp, status, forfeitedBy }

app.get('/', (req, res) => res.status(200).send("Talk2Me Progressive Engine Operational"));

const cleanStr = (str) => (str || "any").toString().trim().toLowerCase();

// -------------------------------------------------------------
// 0. HARDWARE SECURITY & COIN SYNC ENDPOINTS
// -------------------------------------------------------------
app.get('/user-data', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    if (userDatabase.has(userId)) {
        const userData = userDatabase.get(userId);
        return res.json({ coins: userData.coins });
    }

    const newUser = { userId, coins: 100, createdAt: Date.now() };
    userDatabase.set(userId, newUser);
    return res.json({ coins: 100 });
});

app.post('/update-coins', (req, res) => {
    const { userId, amountChange } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    let user = userDatabase.get(userId);
    if (!user) {
        user = { userId, coins: 100, createdAt: Date.now() };
    }

    user.coins = Math.max(0, user.coins + parseInt(amountChange || 0));
    userDatabase.set(userId, user);

    return res.json({ status: "success", coins: user.coins });
});

app.post('/sync-offline-coins', (req, res) => {
    const { userId, pendingCoins } = req.body;
    if (!userId || pendingCoins === undefined) {
        return res.status(400).json({ error: "userId and pendingCoins required" });
    }

    const validatedCoins = Math.min(Math.max(0, parseInt(pendingCoins || 0)), 50);

    let user = userDatabase.get(userId);
    if (!user) {
        user = { userId, coins: 100, createdAt: Date.now() };
    }

    user.coins += validatedCoins;
    userDatabase.set(userId, user);

    return res.json({ status: "success", addedCoins: validatedCoins, totalCoins: user.coins });
});

// -------------------------------------------------------------
// 0.2 REAL-TIME DUEL HANDSHAKE & FORFEIT BROADCAST
// -------------------------------------------------------------
app.post('/send-duel-invite', (req, res) => {
    const { roomId, senderId, isCoOp } = req.body;
    if (!roomId || !senderId) return res.status(400).json({ error: "Missing required fields" });

    activeDuelInvites.set(roomId, { 
        senderId, 
        isCoOp: Boolean(isCoOp), 
        status: "pending", 
        forfeitedBy: null,
        timestamp: Date.now() 
    });

    return res.json({ status: "sent" });
});

app.post('/accept-duel-invite', (req, res) => {
    const { roomId } = req.body;
    if (!roomId) return res.status(400).json({ error: "Missing roomId" });

    let invite = activeDuelInvites.get(roomId);
    if (invite) {
        invite.status = "accepted";
        activeDuelInvites.set(roomId, invite);
    }

    return res.json({ status: "accepted" });
});

app.post('/forfeit-duel-invite', (req, res) => {
    const { roomId, senderId } = req.body;
    if (!roomId || !senderId) return res.status(400).json({ error: "Missing fields" });

    let invite = activeDuelInvites.get(roomId);
    if (!invite) {
        invite = { senderId: "", isCoOp: false, timestamp: Date.now() };
    }

    invite.status = "forfeited";
    invite.forfeitedBy = senderId;
    activeDuelInvites.set(roomId, invite);

    console.log(`[Duel Forfeit] User ${senderId} forfeited match in ${roomId}`);
    return res.json({ status: "forfeited" });
});

app.get('/check-duel-invite', (req, res) => {
    const { roomId, userId } = req.query;
    if (!roomId || !userId) return res.status(400).json({ error: "Missing fields" });

    if (activeMatches.has(userId)) {
        let m = activeMatches.get(userId);
        m.lastHeartbeat = Date.now();
        activeMatches.set(userId, m);
    }

    const invite = activeDuelInvites.get(roomId);

    const partnerId = activeMatches.get(userId)?.partnerUserId;
    if (partnerId && !activeMatches.has(partnerId)) {
        return res.json({ status: "call_ended" });
    }

    if (!invite) return res.json({ status: "none" });

    if (invite.status === "forfeited" && invite.forfeitedBy !== userId) {
        return res.json({ status: "partner_forfeited" });
    }

    if (invite.senderId === userId) {
        if (invite.status === "accepted") {
            return res.json({ status: "start_game", isCoOp: invite.isCoOp });
        }
        return res.json({ status: "waiting_for_partner" });
    }

    if (invite.status === "pending") {
        return res.json({ status: "invited", senderId: invite.senderId, isCoOp: invite.isCoOp });
    }

    return res.json({ status: "none" });
});

app.post('/clear-duel-invite', (req, res) => {
    const { roomId } = req.body;
    if (roomId && activeDuelInvites.has(roomId)) {
        activeDuelInvites.delete(roomId);
    }
    return res.json({ status: "cleared" });
});

// -------------------------------------------------------------
// 1. MATCHMAKING ENDPOINT WITH GENDER & LANGUAGE SYNC
// -------------------------------------------------------------
app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender, language, targetLanguage } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    if (activeMatches.has(userId)) {
        const matchInfo = activeMatches.get(userId);
        return res.json({ 
            status: "matched", 
            roomId: matchInfo.roomId, 
            partnerUserId: matchInfo.partnerUserId,
            partnerGender: matchInfo.partnerGender,
            partnerLanguage: matchInfo.partnerLanguage
        });
    }

    const uGender = cleanStr(gender);
    const uTargetGender = cleanStr(targetGender);
    const uLang = cleanStr(language);
    const uTargetLang = cleanStr(targetLanguage);

    waitingQueue = waitingQueue.filter(u => u.userId !== userId);

    let matchIndex = -1;
    for (let i = 0; i < waitingQueue.length; i++) {
        const q = waitingQueue[i];
        if (q.userId === userId) continue;

        const isGenderCompatible = (uTargetGender === "any" || uTargetGender === q.gender) && (q.targetGender === "any" || q.targetGender === uGender);
        const isLanguageCompatible = (uTargetLang === "any" || uTargetLang === "any language" || uTargetLang === q.language) && (q.targetLanguage === "any" || q.targetLanguage === "any language" || uLang);

        if (isGenderCompatible && isLanguageCompatible) {
            matchIndex = i;
            break;
        }
    }

    if (matchIndex !== -1) {
        const partner = waitingQueue.splice(matchIndex, 1)[0];
        const roomId = `Room_${Math.floor(100000 + Math.random() * 900000)}`;

        activeMatches.set(userId, { 
            roomId, 
            partnerUserId: partner.userId, 
            partnerGender: partner.gender,
            partnerLanguage: partner.language,
            lastHeartbeat: Date.now() 
        });

        activeMatches.set(partner.userId, { 
            roomId, 
            partnerUserId: userId, 
            partnerGender: uGender,
            partnerLanguage: uLang,
            lastHeartbeat: Date.now() 
        });

        roomExtensions.set(roomId, { requesterId: null, status: "none", consumedBy: new Set() });

        return res.json({ 
            status: "matched", 
            roomId, 
            partnerUserId: partner.userId,
            partnerGender: partner.gender,
            partnerLanguage: partner.language
        });
    }

    waitingQueue.push({ userId, gender: uGender, targetGender: uTargetGender, language: uLang, targetLanguage: uTargetLang, timestamp: Date.now() });
    return res.json({ status: "waiting" });
});

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
    if (ext) { ext.status = "accepted"; ext.consumedBy = new Set(); }
    return res.json({ status: "accepted" });
});

app.post('/call-extension/decline', (req, res) => {
    const { roomId } = req.body;
    let ext = roomExtensions.get(roomId);
    if (ext) { ext.status = "declined"; }
    return res.json({ status: "declined" });
});

app.get('/call-extension/status', (req, res) => {
    const { roomId, userId } = req.query;
    const ext = roomExtensions.get(roomId);
    if (!ext) return res.json({ status: "none" });

    const currentStatus = ext.status;
    if (currentStatus === "accepted") {
        ext.consumedBy.add(userId);
        if (ext.consumedBy.size >= 2) { ext.status = "none"; }
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
            activeDuelInvites.delete(matchInfo.roomId);
            activeMatches.delete(matchInfo.partnerUserId);
        }
        activeMatches.delete(userId);
    }
    return res.json({ status: "cancelled" });
});

setInterval(() => {
    const now = Date.now();
    waitingQueue = waitingQueue.filter(u => (now - u.timestamp) < 45000);

    for (let [userId, matchInfo] of activeMatches.entries()) {
        if (now - matchInfo.lastHeartbeat > 6000) {
            console.log(`[Timeout] Player ${userId} lost connection.`);
            activeMatches.delete(userId);
        }
    }
}, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Talk2Me Engine] Server running on port ${PORT}`));
