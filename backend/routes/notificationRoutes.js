const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");

const router = express.Router();
router.use(auth);

// Get my notifications
router.get("/", async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, actor_id, type, message,
                    task_id, project_id, is_read, created_at
             FROM notifications
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT 100`,
            [req.user.id]
        );

        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// Mark one notification as read
router.patch("/:id/read", async (req, res) => {
    try {
        const id = Number(req.params.id);

        const [result] = await db.execute(
            `UPDATE notifications
             SET is_read = TRUE
             WHERE id = ? AND user_id = ?`,
            [id, req.user.id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({
                message: "Notification not found"
            });
        }

        res.json({ message: "Notification marked as read" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// Mark all notifications as read
router.patch("/read-all", async (req, res) => {
    try {
        await db.execute(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = ?",
            [req.user.id]
        );

        res.json({ message: "All notifications marked as read" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;