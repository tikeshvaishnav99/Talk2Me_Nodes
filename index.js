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

    // If this user is already part of an active match, immediately return the room so they catch up!
    if (activeMatches.has(userId)) {
        const matchInfo = activeMatches.get(userId);
        return res.json({ status: "matched", roomId: matchInfo.roomId });
    }

    const userGender = (gender || "any").toLowerCase();
    const userTargetGender = (targetGender || "any").toLowerCase();
    const userLanguage = (language || "any").toLowerCase();
    const userTargetLanguage = (targetLanguage || "any").toLowerCase();

    // Clean user from queue first
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

        // Save active match state for BOTH users so whoever polls next gets it
        activeMatches.set(userId, { roomId, partnerId: partner.userId });
        activeMatches.set(partner.userId, { roomId, partnerId: userId });

        // Save mutual history for Reconnect
        lastCallPairs.set(userId, partner.userId);
        lastCallPairs.set(partner.userId, userId);

        return res.json({ status: "matched", roomId: roomId });
    }

    // Add to queue if no match found
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
        activeMatches.delete(userId); // Clear active match state on cancel
        console.log(`[Cancelled] User ${userId} removed from queue/matches.`);
    }
    return res.json({ status: "cancelled" });
});

// 3. RECONNECT ENDPOINT
app.post('/reconnect', (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    const previousPartnerId = lastCallPairs.get(userId);

    if (!previousPartnerId) {
        console.log(`[Reconnect Failed] No previous partner found for user: ${userId}`);
        return res.status(400).json({ status: "error", message: "No previous partner found." });
    }

    waitingQueue = waitingQueue.filter(user => user.userId !== userId && user.userId !== previousPartnerId);

    const roomId = `Room_Re_${Math.floor(10000 + Math.random() * 90000)}`;

    // Set active match for both so they instantly sync up on next poll or direct return
    activeMatches.set(userId, { roomId, partnerId: previousPartnerId });
    activeMatches.set(previousPartnerId, { roomId, partnerId: userId });

    console.log(`[Reconnect Success] User ${userId} reconnected with ${previousPartnerId} in ${roomId}`);

    return res.json({ status: "matched", roomId: roomId, partnerId: previousPartnerId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Matchmaker running on port ${PORT}`));
