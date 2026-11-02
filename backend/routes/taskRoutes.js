
const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

router.use(auth);

async function getGlobalRole(userId) {
    const [rows] = await db.execute(
        `SELECT global_role
         FROM users
         WHERE id = ? AND is_active = TRUE`,
        [userId]
    );

    return rows.length ? rows[0].global_role : null;
}

async function getProjectRole(projectId, userId) {
    const [rows] = await db.execute(
        `SELECT role
         FROM project_members
         WHERE project_id = ? AND user_id = ?`,
        [projectId, userId]
    );

    return rows.length ? rows[0].role : null;
}

async function getTask(taskId) {
    const [rows] = await db.execute(
        "SELECT * FROM tasks WHERE id = ?",
        [taskId]
    );

    return rows.length ? rows[0] : null;
}

async function notifyProjectMembers(
    projectId,
    actorId,
    type,
    message,
    taskId
) {
    await db.execute(
        `INSERT INTO notifications
            (user_id, actor_id, type, message, task_id, project_id)
         SELECT
            pm.user_id, ?, ?, ?, ?, ?
         FROM project_members pm
         WHERE pm.project_id = ?
           AND pm.user_id <> ?`,
        [
            actorId,
            type,
            message,
            taskId,
            projectId,
            projectId,
            actorId
        ]
    );
}

async function logActivity(
    projectId,
    userId,
    taskId,
    action,
    details
) {
    await db.execute(
        `INSERT INTO activity_logs
            (project_id, user_id, task_id, action, details)
         VALUES (?, ?, ?, ?, ?)`,
        [
            projectId,
            userId,
            taskId,
            action,
            JSON.stringify(details)
        ]
    );
}

// CREATE AND ASSIGN TASK - MANAGER ONLY
router.post("/", async (req, res) => {
    try {
        const userId = Number(req.user.id);

        const {
            project_id,
            title,
            description,
            assigned_to,
            priority,
            due_date
        } = req.body;

        const projectId = Number(project_id);

        if (
            !Number.isInteger(projectId) ||
            projectId <= 0 ||
            typeof title !== "string" ||
            !title.trim()
        ) {
            return res.status(400).json({
                message: "Valid project ID and title are required"
            });
        }

        const globalRole = await getGlobalRole(userId);

        if (globalRole !== "MANAGER") {
            return res.status(403).json({
                message: "Only Project Managers can create tasks"
            });
        }

        const myRole = await getProjectRole(projectId, userId);

        if (!myRole) {
            return res.status(403).json({
                message: "You must belong to this project"
            });
        }

        if (
            assigned_to !== undefined &&
            assigned_to !== null &&
            (!Number.isInteger(Number(assigned_to)) ||
                Number(assigned_to) <= 0)
        ) {
            return res.status(400).json({
                message: "Invalid assignee"
            });
        }

        const assigneeId =
            assigned_to == null ? null : Number(assigned_to);

        if (assigneeId !== null) {
            const assigneeRole = await getGlobalRole(assigneeId);
            const memberRole = await getProjectRole(
                projectId,
                assigneeId
            );

            if (
                assigneeRole !== "EMPLOYEE" ||
                !memberRole
            ) {
                return res.status(400).json({
                    message: "Assignee must be an employee in this project"
                });
            }
        }

        const validPriorities = [
            "LOW", "MEDIUM", "HIGH", "URGENT"
        ];

        const taskPriority = priority || "MEDIUM";

        if (!validPriorities.includes(taskPriority)) {
            return res.status(400).json({
                message: "Invalid priority"
            });
        }

        const [result] = await db.execute(
            `INSERT INTO tasks
                (project_id, title, description, assigned_to,
                 created_by, priority, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                projectId,
                title.trim(),
                description || null,
                assigneeId,
                userId,
                taskPriority,
                due_date || null
            ]
        );

        const taskId = result.insertId;

        await logActivity(
            projectId,
            userId,
            taskId,
            "TASK_CREATED",
            {
                title: title.trim(),
                assignedTo: assigneeId
            }
        );

        if (assigneeId !== null) {
            await db.execute(
                `INSERT INTO notifications
                    (user_id, actor_id, type, message, task_id, project_id)
                 VALUES (?, ?, 'TASK_ASSIGNED', ?, ?, ?)`,
                [
                    assigneeId,
                    userId,
                    `You were assigned a task: ${title.trim()}`,
                    taskId,
                    projectId
                ]
            );
        }

        await notifyProjectMembers(
            projectId,
            userId,
            "TASK_UPDATED",
            `A new task was created: ${title.trim()}`,
            taskId
        );

        return res.status(201).json({
            message: "Task created successfully",
            taskId
        });
    } catch (error) {
        console.error("Create task error:", error);

        return res.status(500).json({
            message: "Unable to create task"
        });
    }
});

// LIST TASKS - PROJECT MEMBERS ONLY
router.get("/project/:projectId", async (req, res) => {
    try {
        const projectId = Number(req.params.projectId);
        const userId = Number(req.user.id);

        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const myRole = await getProjectRole(projectId, userId);

        if (!myRole) {
            return res.status(403).json({
                message: "You are not a member of this project"
            });
        }

        const [tasks] = await db.execute(
            `SELECT
                t.*,
                assignee.name AS assignee_name,
                creator.name AS creator_name
             FROM tasks t
             LEFT JOIN users assignee ON assignee.id = t.assigned_to
             JOIN users creator ON creator.id = t.created_by
             WHERE t.project_id = ?
             ORDER BY t.position ASC, t.created_at DESC`,
            [projectId]
        );

        return res.json(tasks);
    } catch (error) {
        console.error("List tasks error:", error);

        return res.status(500).json({
            message: "Unable to load tasks"
        });
    }
});

// PROJECT ACTIVITY - PROJECT MEMBERS ONLY
router.get("/project/:projectId/activity", async (req, res) => {
    try {
        const projectId = Number(req.params.projectId);
        const userId = Number(req.user.id);

        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const myRole = await getProjectRole(projectId, userId);

        if (!myRole) {
            return res.status(403).json({
                message: "You are not a member of this project"
            });
        }

        const [activities] = await db.execute(
            `SELECT
                a.id,
                a.project_id,
                a.task_id,
                a.action,
                a.details,
                a.created_at,
                u.name AS user_name,
                t.title AS task_title
             FROM activity_logs a
             LEFT JOIN users u ON u.id = a.user_id
             LEFT JOIN tasks t ON t.id = a.task_id
             WHERE a.project_id = ?
             ORDER BY a.created_at DESC
             LIMIT 100`,
            [projectId]
        );

        return res.json(activities);
    } catch (error) {
        console.error("Project activity error:", error);

        return res.status(500).json({
            message: "Unable to load project activity"
        });
    }
});

// UPDATE TASK STATUS - MANAGER OR ASSIGNED EMPLOYEE
router.patch("/:id/status", async (req, res) => {
    try {
        const taskId = Number(req.params.id);
        const userId = Number(req.user.id);
        const { status } = req.body;

        const allowedStatuses = [
            "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"
        ];

        if (!Number.isInteger(taskId) || taskId <= 0) {
            return res.status(400).json({
                message: "Invalid task ID"
            });
        }

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                message: "Invalid task status"
            });
        }

        const task = await getTask(taskId);

        if (!task) {
            return res.status(404).json({
                message: "Task not found"
            });
        }

        const myRole = await getProjectRole(
            task.project_id,
            userId
        );

        if (!myRole) {
            return res.status(403).json({
                message: "Project access denied"
            });
        }

        const globalRole = await getGlobalRole(userId);

        const isManager = globalRole === "MANAGER";
        const isAssignee = Number(task.assigned_to) === userId;

        if (!isManager && !isAssignee) {
            return res.status(403).json({
                message: "Only the assigned employee or manager can update status"
            });
        }

        const progress = status === "DONE"
            ? 100
            : task.progress_percent;

        const completedAt = status === "DONE"
            ? new Date()
            : null;

        await db.execute(
            `UPDATE tasks
             SET status = ?,
                 progress_percent = ?,
                 completed_at = ?
             WHERE id = ?`,
            [status, progress, completedAt, taskId]
        );

        await logActivity(
            task.project_id,
            userId,
            taskId,
            "TASK_STATUS_UPDATED",
            {
                from: task.status,
                to: status,
                progressPercent: progress
            }
        );

        await notifyProjectMembers(
            task.project_id,
            userId,
            "TASK_UPDATED",
            `Task "${task.title}" status changed to ${status}`,
            taskId
        );

        return res.json({
            message: "Task status updated successfully",
            status,
            progress_percent: progress
        });
    } catch (error) {
        console.error("Update task status error:", error);

        return res.status(500).json({
            message: "Unable to update task status"
        });
    }
});

// UPDATE TASK PROGRESS - MANAGER OR ASSIGNED EMPLOYEE
router.patch("/:id/progress", async (req, res) => {
    try {
        const taskId = Number(req.params.id);
        const userId = Number(req.user.id);
        const progress = req.body.progress_percent;

        if (!Number.isInteger(taskId) || taskId <= 0) {
            return res.status(400).json({
                message: "Invalid task ID"
            });
        }

        if (
            !Number.isInteger(progress) ||
            progress < 0 ||
            progress > 100
        ) {
            return res.status(400).json({
                message: "Progress must be an integer between 0 and 100"
            });
        }

        const task = await getTask(taskId);

        if (!task) {
            return res.status(404).json({
                message: "Task not found"
            });
        }

        const myRole = await getProjectRole(
            task.project_id,
            userId
        );

        if (!myRole) {
            return res.status(403).json({
                message: "Project access denied"
            });
        }

        const globalRole = await getGlobalRole(userId);

        if (
            globalRole !== "MANAGER" &&
            Number(task.assigned_to) !== userId
        ) {
            return res.status(403).json({
                message: "Only the assigned employee or manager can update progress"
            });
        }

        if (task.status === "DONE" && progress !== 100) {
            return res.status(400).json({
                message: "A completed task must have 100% progress"
            });
        }

        await db.execute(
            `UPDATE tasks
             SET progress_percent = ?
             WHERE id = ?`,
            [progress, taskId]
        );

        await logActivity(
            task.project_id,
            userId,
            taskId,
            "TASK_PROGRESS_UPDATED",
            {
                previousProgress: task.progress_percent,
                newProgress: progress
            }
        );

        await notifyProjectMembers(
            task.project_id,
            userId,
            "TASK_UPDATED",
            `Task "${task.title}" progress updated to ${progress}%`,
            taskId
        );

        return res.json({
            message: "Task progress updated successfully",
            progress_percent: progress
        });
    } catch (error) {
        console.error("Update progress error:", error);

        return res.status(500).json({
            message: "Unable to update task progress"
        });
    }
});

// EDIT TASK DETAILS / ASSIGNEE - MANAGER ONLY
router.patch("/:id", async (req, res) => {
    try {
        const taskId = Number(req.params.id);
        const userId = Number(req.user.id);

        if (!Number.isInteger(taskId) || taskId <= 0) {
            return res.status(400).json({
                message: "Invalid task ID"
            });
        }

        const task = await getTask(taskId);

        if (!task) {
            return res.status(404).json({
                message: "Task not found"
            });
        }

        const globalRole = await getGlobalRole(userId);
        const myRole = await getProjectRole(
            task.project_id,
            userId
        );

        if (!myRole) {
            return res.status(403).json({
                message: "Project access denied"
            });
        }

        if (globalRole !== "MANAGER") {
            return res.status(403).json({
                message: "Only Project Managers can edit task details"
            });
        }

        const {
            title,
            description,
            assigned_to,
            priority,
            due_date,
            position
        } = req.body;

        const nextTitle = title === undefined
            ? task.title
            : title;

        const nextDescription = description === undefined
            ? task.description
            : description;

        const nextAssignee = assigned_to === undefined
            ? task.assigned_to
            : assigned_to;

        const nextPriority = priority === undefined
            ? task.priority
            : priority;

        const nextDueDate = due_date === undefined
            ? task.due_date
            : due_date;

        const nextPosition = position === undefined
            ? task.position
            : position;

        if (
            typeof nextTitle !== "string" ||
            !nextTitle.trim()
        ) {
            return res.status(400).json({
                message: "Invalid task title"
            });
        }

        if (
            !["LOW", "MEDIUM", "HIGH", "URGENT"]
                .includes(nextPriority)
        ) {
            return res.status(400).json({
                message: "Invalid task priority"
            });
        }

        if (
            nextAssignee !== null &&
            (!Number.isInteger(Number(nextAssignee)) ||
                Number(nextAssignee) <= 0)
        ) {
            return res.status(400).json({
                message: "Invalid assignee"
            });
        }

        const assigneeId = nextAssignee == null
            ? null
            : Number(nextAssignee);

        if (assigneeId !== null) {
            const memberRole = await getProjectRole(
                task.project_id,
                assigneeId
            );

            const assigneeGlobalRole = await getGlobalRole(
                assigneeId
            );

            if (
                !memberRole ||
                assigneeGlobalRole !== "EMPLOYEE"
            ) {
                return res.status(400).json({
                    message: "Assignee must be an employee in this project"
                });
            }
        }

        if (
            !Number.isInteger(Number(nextPosition)) ||
            Number(nextPosition) < 0
        ) {
            return res.status(400).json({
                message: "Invalid task position"
            });
        }

        await db.execute(
            `UPDATE tasks
             SET title = ?,
                 description = ?,
                 assigned_to = ?,
                 priority = ?,
                 due_date = ?,
                 position = ?
             WHERE id = ?`,
            [
                nextTitle.trim(),
                nextDescription || null,
                assigneeId,
                nextPriority,
                nextDueDate || null,
                Number(nextPosition),
                taskId
            ]
        );

        await logActivity(
            task.project_id,
            userId,
            taskId,
            "TASK_DETAILS_UPDATED",
            {
                title: nextTitle.trim(),
                previousAssignee: task.assigned_to,
                newAssignee: assigneeId
            }
        );

        if (
            assigneeId !== null &&
            assigneeId !== Number(task.assigned_to)
        ) {
            await db.execute(
                `INSERT INTO notifications
                    (user_id, actor_id, type, message, task_id, project_id)
                 VALUES (?, ?, 'TASK_ASSIGNED', ?, ?, ?)`,
                [
                    assigneeId,
                    userId,
                    `You were assigned a task: ${nextTitle.trim()}`,
                    taskId,
                    task.project_id
                ]
            );
        }

        await notifyProjectMembers(
            task.project_id,
            userId,
            "TASK_UPDATED",
            `Task "${nextTitle.trim()}" details were updated`,
            taskId
        );

        return res.json({
            message: "Task updated successfully"
        });
    } catch (error) {
        console.error("Edit task error:", error);

        return res.status(500).json({
            message: "Unable to edit task"
        });
    }
});

// DELETE TASK - MANAGER ONLY
router.delete("/:id", async (req, res) => {
    try {
        const taskId = Number(req.params.id);
        const userId = Number(req.user.id);

        if (!Number.isInteger(taskId) || taskId <= 0) {
            return res.status(400).json({
                message: "Invalid task ID"
            });
        }

        const task = await getTask(taskId);

        if (!task) {
            return res.status(404).json({
                message: "Task not found"
            });
        }

        const globalRole = await getGlobalRole(userId);
        const myRole = await getProjectRole(
            task.project_id,
            userId
        );

        if (!myRole) {
            return res.status(403).json({
                message: "Project access denied"
            });
        }

        if (globalRole !== "MANAGER") {
            return res.status(403).json({
                message: "Only Project Managers can delete tasks"
            });
        }

        await db.execute(
            "DELETE FROM tasks WHERE id = ?",
            [taskId]
        );

        await logActivity(
            task.project_id,
            userId,
            null,
            "TASK_DELETED",
            {
                taskId,
                title: task.title
            }
        );

        return res.json({
            message: "Task deleted successfully"
        });
    } catch (error) {
        console.error("Delete task error:", error);

        return res.status(500).json({
            message: "Unable to delete task"
        });
    }
});

module.exports = router;
