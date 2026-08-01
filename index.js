const express = require('express');
const app = express();
app.use(express.json());

let waitingQueue = [];
let activeMatches = new Map(); // userId -> { roomId, partnerId }
let lastCallPairs = new Map(); 

// 1. REGULAR MATCHMAKING
app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender, language, targetLanguage } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

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
            isLanguageCompatible = (qTargetLanguage === userLanguage); 
        } else if (qTargetLanguage === "any") {
            isLanguageCompatible = (userTargetLanguage === qLanguage); 
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

        console.log(`[Matched] ${userId} (${userGender}) <-> ${partner.userId} (${partner.gender}) in ${roomId}`);

        activeMatches.set(userId, { roomId, partnerId: partner.userId });
        activeMatches.set(partner.userId, { roomId, partnerId: userId });

        lastCallPairs.set(userId, partner.userId);
        lastCallPairs.set(partner.userId, userId);

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
        activeMatches.delete(userId);
        console.log(`[Cancelled] User ${userId} removed from queue/matches.`);
    }
    return res.json({ status: "cancelled" });
});

// 3. RECONNECT ENDPOINT (Bulletproof Synchronization)
app.post('/reconnect', (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    // If an active match / reconnect room already exists for this user, return it immediately
    if (activeMatches.has(userId)) {
        const matchInfo = activeMatches.get(userId);
        return res.json({ status: "matched", roomId: matchInfo.roomId, partnerId: matchInfo.partnerId });
    }

    const previousPartnerId = lastCallPairs.get(userId);

    if (!previousPartnerId) {
        console.log(`[Reconnect Failed] No previous partner found for user: ${userId}`);
        return res.status(400).json({ status: "error", message: "No previous partner found." });
    }

    // Check if the partner ALREADY generated a reconnect room first!
    if (activeMatches.has(previousPartnerId)) {
        const existingMatch = activeMatches.get(previousPartnerId);
        // Bind the current user to that exact same room
        activeMatches.set(userId, { roomId: existingMatch.roomId, partnerId: previousPartnerId });
        console.log(`[Reconnect Sync] User ${userId} joined existing room ${existingMatch.roomId} with ${previousPartnerId}`);
        return res.json({ status: "matched", roomId: existingMatch.roomId, partnerId: previousPartnerId });
    }

    waitingQueue = waitingQueue.filter(user => user.userId !== userId && user.userId !== previousPartnerId);

    // Otherwise, generate the new shared room right now for BOTH users
    const roomId = `Room_Re_${Math.floor(10000 + Math.random() * 90000)}`;

    activeMatches.set(userId, { roomId, partnerId: previousPartnerId });
    activeMatches.set(previousPartnerId, { roomId, partnerId: userId });

    console.log(`[Reconnect Success] User ${userId} created reconnect room with ${previousPartnerId}: ${roomId}`);

    return res.json({ status: "matched", roomId: roomId, partnerId: previousPartnerId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Matchmaker running on port ${PORT}`));
