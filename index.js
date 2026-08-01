const express = require('express');
const app = express();
app.use(express.json());

let waitingQueue = [];
let lastCallPairs = new Map(); 

// 1. REGULAR MATCHMAKING
app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender, language, targetLanguage } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    const userGender = (gender || "any").toLowerCase();
    const userTargetGender = (targetGender || "any").toLowerCase();
    const userLanguage = (language || "any").toLowerCase();
    const userTargetLanguage = (targetLanguage || "any").toLowerCase();

    // CRITICAL: Completely strip this user out of the queue first so they never duplicate or ghost
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);

    let matchIndex = -1;

    for (let i = 0; i < waitingQueue.length; i++) {
        const queuedUser = waitingQueue[i];
        
        // Prevent matching a user with themselves if a ghost entry lingered
        if (queuedUser.userId === userId) continue;

        const qGender = (queuedUser.gender || "any").toLowerCase();
        const qTargetGender = (queuedUser.targetGender || "any").toLowerCase();
        const qLanguage = (queuedUser.language || "any").toLowerCase();
        const qTargetLanguage = (queuedUser.targetLanguage || "any").toLowerCase();

        // Gender Compatibility Check
        const genderWantsThem = (userTargetGender === "any" || userTargetGender === qGender);
        const theyWantGender = (qTargetGender === "any" || qTargetGender === userGender);
        const isGenderCompatible = genderWantsThem && theyWantGender;

        // Language Compatibility Check
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

    console.log(`[Queue] User ${userId} waiting. Total in queue: ${waitingQueue.length}`);
    return res.json({ status: "waiting" });
});

// 2. CANCEL MATCHMAKING (Ensures user is completely purged from queue)
app.post('/cancel-match', (req, res) => {
    const { userId } = req.body;
    if (userId) {
        waitingQueue = waitingQueue.filter(user => user.userId !== userId);
        console.log(`[Cancelled] User ${userId} removed from queue.`);
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

    // Remove both from queue so they don't accidentally match with strangers
    waitingQueue = waitingQueue.filter(user => user.userId !== userId && user.userId !== previousPartnerId);

    const roomId = `Room_Re_${Math.floor(10000 + Math.random() * 90000)}`;

    console.log(`[Reconnect Success] User ${userId} reconnected with ${previousPartnerId} in ${roomId}`);

    return res.json({ status: "matched", roomId: roomId, partnerId: previousPartnerId });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Matchmaker running on port ${PORT}`));
