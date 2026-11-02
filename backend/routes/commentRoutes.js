const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");

const router = express.Router();
router.use(auth);

async function accessibleTask(taskId, userId) {
    const [rows] = await db.execute(
        `SELECT t.id, t.project_id
         FROM tasks t
         JOIN project_members pm ON pm.project_id = t.project_id
         WHERE t.id = ? AND pm.user_id = ?`,
        [taskId, userId]
    );

    return rows.length ? rows[0] : null;
}

// ADD COMMENT
router.post("/:taskId", async (req, res) => {
    try {
        const taskId = Number(req.params.taskId);
        const { comment_text } = req.body;

        if (!Number.isInteger(taskId) || taskId <= 0) {
            return res.status(400).json({ message: "Invalid task ID" });
        }

        if (
            typeof comment_text !== "string" ||
            !comment_text.trim()
        ) {
            return res.status(400).json({
                message: "Comment cannot be empty"
            });
        }

        const task = await accessibleTask(taskId, req.user.id);

        if (!task) {
            return res.status(404).json({
                message: "Task not found or access denied"
            });
        }

        const [result] = await db.execute(
            `INSERT INTO comments (task_id, user_id, comment_text)
             VALUES (?, ?, ?)`,
            [taskId, req.user.id, comment_text.trim()]
        );

        await db.execute(
            `INSERT INTO activity_logs
             (project_id, user_id, task_id, action, details)
             VALUES (?, ?, ?, 'COMMENT_ADDED', ?)`,
            [
                task.project_id,
                req.user.id,
                taskId,
                JSON.stringify({ commentId: result.insertId })
            ]
        );

        // Notify the task creator or assignee, excluding the commenter.
        const [tasks] = await db.execute(
            "SELECT created_by, assigned_to, title FROM tasks WHERE id = ?",
            [taskId]
        );

        const recipients = new Set([
            tasks[0].created_by,
            tasks[0].assigned_to
        ].filter(id => id != null && id !== req.user.id));

        for (const recipientId of recipients) {
            await db.execute(
                `INSERT INTO notifications
                 (user_id, actor_id, type, message, task_id, project_id)
                 VALUES (?, ?, 'TASK_COMMENT', ?, ?, ?)`,
                [
                    recipientId,
                    req.user.id,
                    `New comment on task: ${tasks[0].title}`,
                    taskId,
                    task.project_id
                ]
            );
        }

        res.status(201).json({
            message: "Comment added successfully",
            commentId: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// GET COMMENTS
router.get("/:taskId", async (req, res) => {
    try {
        const taskId = Number(req.params.taskId);
        const task = await accessibleTask(taskId, req.user.id);

        if (!task) {
            return res.status(404).json({
                message: "Task not found or access denied"
            });
        }

        const [comments] = await db.execute(
            `SELECT c.id, c.comment_text, c.created_at,
                    c.edited_at, u.id AS user_id, u.name AS author
             FROM comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.task_id = ?
             ORDER BY c.created_at ASC`,
            [taskId]
        );

        res.json(comments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;