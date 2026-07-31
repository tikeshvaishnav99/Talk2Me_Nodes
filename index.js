const express = require('express');
const app = express();
app.use(express.json());

let waitingQueue = [];
let activeMatches = {}; // Store room IDs for waiting users who got matched

app.post('/find-match', (req, res) => {
    const { userId, gender, targetGender } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    const userGender = (gender || "any").toLowerCase();
    const userTarget = (targetGender || "any").toLowerCase();

    // 1. If this user was already matched, return their assigned room immediately
    if (activeMatches[userId]) {
        const roomId = activeMatches[userId];
        delete activeMatches[userId];
        return res.json({ status: "matched", roomId: roomId });
    }

    // Remove user if already in queue to prevent duplicate entries
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);

    // 2. Scan the waiting queue to find a valid partner based on gender rules
    let matchIndex = -1;

    for (let i = 0; i < waitingQueue.length; i++) {
        const queuedUser = waitingQueue[i];
        const qGender = (queuedUser.gender || "any").toLowerCase();
        const qTarget = (queuedUser.targetGender || "any").toLowerCase();

        // Check mutual compatibility
        const currentWantsThem = (userTarget === "any" || userTarget === qGender);
        const theyWantCurrent = (qTarget === "any" || qTarget === userGender);

        if (currentWantsThem && theyWantCurrent) {
            matchIndex = i;
            break;
        }
    }

    // 3. If a compatible partner is found, pair them up
    if (matchIndex !== -1) {
        const partner = waitingQueue.splice(matchIndex, 1)[0];
        const roomId = `Room_${Math.floor(10000 + Math.random() * 90000)}`;

        console.log(`[Matched] ${userId} (${userGender} -> ${userTarget}) <-> ${partner.userId} (${partner.gender} -> ${partner.targetGender}) in ${roomId}`);

        // Save the room ID for the partner so their next poll picks it up
        activeMatches[partner.userId] = roomId;

        return res.json({
            status: "matched",
            roomId: roomId
        });
    }

    // 4. Otherwise, add this player to the waiting queue
    waitingQueue.push({ userId, gender: userGender, targetGender: userTarget, timestamp: Date.now() });
    console.log(`[Queue] User ${userId} (${userGender}) waiting. Total in queue: ${waitingQueue.length}`);

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
