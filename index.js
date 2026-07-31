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

    // 1. If this user was already matched, return their assigned room immediately
    if (activeMatches[userId]) {
        const roomId = activeMatches[userId];
        delete activeMatches[userId]; // Clean up after reading
        return res.json({ status: "matched", roomId: roomId });
    }

    // Remove user if already in queue to prevent duplicates
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);

    // 2. If another player is waiting, match them instantly
    if (waitingQueue.length > 0) {
        const partner = waitingQueue.shift();
        const roomId = `Room_${Math.floor(10000 + Math.random() * 90000)}`;

        console.log(`[Matched] ${userId} <-> ${partner.userId} in ${roomId}`);

        // Save the room ID for the partner so their next poll picks it up
        activeMatches[partner.userId] = roomId;

        // Return matched to the current user instantly
        return res.json({
            status: "matched",
            roomId: roomId
        });
    }

    // 3. Otherwise, add this player to the waiting queue
    waitingQueue = waitingQueue.filter(user => user.userId !== userId);
    waitingQueue.push({ userId, gender, targetGender, timestamp: Date.now() });
    console.log(`[Queue] User ${userId} waiting. Total in queue: ${waitingQueue.length}`);

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
