const express = require('express');
const app = express();
app.use(express.json());

let waitingQueue = [];
let activeMatches = {}; 
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

    // Clear any pending active match to prevent ghost overlaps
    delete activeMatches[userId];

    // Remove user if already in queue
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);

    let matchIndex = -1;

    for (let i = 0; i < waitingQueue.length; i++) {
        const queuedUser = waitingQueue[i];
        
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

        console.log(`[Matched] ${userId} <-> ${partner.userId} in ${roomId}`);

        lastCallPairs.set(userId, partner.userId);
        lastCallPairs.set(partner.userId, userId);

        delete activeMatches[partner.userId];

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

// 2. RECONNECT ENDPOINT
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

    // CRITICAL: Remove both users from the waiting queue so they don't get matched into random rooms!
    waitingQueue = waitingQueue.filter(user => user.userId !== userId && user.userId !== previousPartnerId);

    const roomId = `Room_Re_${Math.floor(10000 + Math.random() * 90000)}`;

    activeMatches[userId] = roomId;
    activeMatches[previousPartnerId] = roomId;

    console.log(`[Reconnect Success] User ${userId} reconnected with ${previousPartnerId} in ${roomId}`);

    return res.json({ status: "matched", roomId: roomId });
});

// 3. CHECK-MATCH ENDPOINT
app.post('/check-match', (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    if (activeMatches[userId]) {
        const roomId = activeMatches[userId];
        delete activeMatches[userId]; 
        
        // Also remove them from waiting queue just in case they were left lingering
        waitingQueue = waitingQueue.filter(user => user.userId !== userId);

        console.log(`[Check-Match] User ${userId} retrieved reconnection room: ${roomId}`);
        return res.json({ status: "matched", roomId: roomId });
    }

    return res.json({ status: "waiting" });
});

app.post('/cancel-match', (req, res) => {
    const { userId } = req.body;
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);
    delete activeMatches[userId];
    return res.json({ status: "cancelled" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Matchmaker running on port ${PORT}`));
