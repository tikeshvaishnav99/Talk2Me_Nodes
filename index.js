const express = require('express');
const app = express();
app.use(express.json());

let waitingQueue = [];
let activeMatches = {}; // Store room IDs for waiting users who got matched

app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender, language, targetLanguage } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    const userGender = (gender || "any").toLowerCase();
    const userTargetGender = (targetGender || "any").toLowerCase();
    const userLanguage = (language || "any").toLowerCase();
    const userTargetLanguage = (targetLanguage || "any").toLowerCase();

    // 1. If this user was already matched, return their assigned room immediately
    if (activeMatches[userId]) {
        const roomId = activeMatches[userId];
        delete activeMatches[userId];
        return res.json({ status: "matched", roomId: roomId });
    }

    // Remove user if already in queue to prevent duplicate entries
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);

    // 2. Scan the waiting queue to find a valid partner based on BOTH gender and language rules
    let matchIndex = -1;

    for (let i = 0; i < waitingQueue.length; i++) {
        const queuedUser = waitingQueue[i];
        
        const qGender = (queuedUser.gender || "any").toLowerCase();
        const qTargetGender = (queuedUser.targetGender || "any").toLowerCase();
        const qLanguage = (queuedUser.language || "any").toLowerCase();
        const qTargetLanguage = (queuedUser.targetLanguage || "any").toLowerCase();

        // Check Gender Compatibility
        const genderWantsThem = (userTargetGender === "any" || userTargetGender === qGender);
        const theyWantGender = (qTargetGender === "any" || qTargetGender === userGender);
        const isGenderCompatible = genderWantsThem && theyWantGender;

        // Check Language Compatibility
        // (Either both want "any", or one matches the other's specific language target)
        const languageWantsThem = (userTargetLanguage === "any" || userTargetLanguage === qLanguage || qLanguage === "any");
        const theyWantLanguage = (qTargetLanguage === "any" || qTargetLanguage === userLanguage || userLanguage === "any");
        const isLanguageCompatible = languageWantsThem && theyWantLanguage;

        if (isGenderCompatible && isLanguageCompatible) {
            matchIndex = i;
            break;
        }
    }

    // 3. If a compatible partner is found, pair them up
    if (matchIndex !== -1) {
        const partner = waitingQueue.splice(matchIndex, 1)[0];
        const roomId = `Room_${Math.floor(10000 + Math.random() * 90000)}`;

        console.log(`[Matched] ${userId} (${userGender}/${userLanguage}) <-> ${partner.userId} (${partner.gender}/${partner.language}) in ${roomId}`);

        // Save the room ID for the partner so their next poll picks it up
        activeMatches[partner.userId] = roomId;

        return res.json({
            status: "matched",
            roomId: roomId
        });
    }

    // 4. Otherwise, add this player to the waiting queue with their language and gender tags
    waitingQueue.push({ 
        userId, 
        gender: userGender, 
        targetGender: userTargetGender, 
        language: userLanguage, 
        targetLanguage: userTargetLanguage, 
        timestamp: Date.now() 
    });
    
    console.log(`[Queue] User ${userId} (G:${userGender}, L:${userLanguage}) waiting. Total in queue: ${waitingQueue.length}`);

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
