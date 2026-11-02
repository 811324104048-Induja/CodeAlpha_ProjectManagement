
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

// CREATE PROJECT - MANAGER ONLY
router.post("/", async (req, res) => {
    let connection;

    try {
        const userId = Number(req.user.id);
        const { name, description } = req.body;

        const globalRole = await getGlobalRole(userId);

        if (globalRole !== "MANAGER") {
            return res.status(403).json({
                message: "Only Project Managers can create projects"
            });
        }

        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                message: "Project name is required"
            });
        }

        if (
            description != null &&
            typeof description !== "string"
        ) {
            return res.status(400).json({
                message: "Invalid project description"
            });
        }

        connection = await db.getConnection();

        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO projects
                (name, description, created_by)
             VALUES (?, ?, ?)`,
            [
                name.trim(),
                description?.trim() || null,
                userId
            ]
        );

        const projectId = result.insertId;

        await connection.execute(
            `INSERT INTO project_members
                (project_id, user_id, role)
             VALUES (?, ?, 'OWNER')`,
            [projectId, userId]
        );

        await connection.execute(
            `INSERT INTO activity_logs
                (project_id, user_id, action, details)
             VALUES (?, ?, 'PROJECT_CREATED', ?)`,
            [
                projectId,
                userId,
                JSON.stringify({
                    name: name.trim()
                })
            ]
        );

        await connection.commit();

        return res.status(201).json({
            message: "Project created successfully",
            projectId
        });
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Create project error:", error);

        return res.status(500).json({
            message: "Unable to create project"
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// LIST PROJECT CARDS
// All logged-in users can see project cards.
// Only members can access project tasks/details.
router.get("/", async (req, res) => {
    try {
        const userId = Number(req.user.id);

        const [projects] = await db.execute(
            `SELECT
                p.id,
                p.name,
                p.color,
                p.status,
                p.created_at,
                p.updated_at,
                creator.name AS manager_name,
                CASE
                    WHEN pm.user_id IS NULL THEN 0
                    ELSE 1
                END AS is_member,
                pm.role AS my_role,
                CASE
                    WHEN pm.user_id IS NOT NULL
                    THEN p.description
                    ELSE NULL
                END AS description
             FROM projects p
             JOIN users creator ON creator.id = p.created_by
             LEFT JOIN project_members pm
                ON pm.project_id = p.id
               AND pm.user_id = ?
             ORDER BY p.updated_at DESC`,
            [userId]
        );

        return res.json(projects);
    } catch (error) {
        console.error("List projects error:", error);

        return res.status(500).json({
            message: "Unable to load projects"
        });
    }
});

// LIST PROJECT MEMBERS - MEMBERS ONLY
router.get("/:id/members", async (req, res) => {
    try {
        const projectId = Number(req.params.id);
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

        const [members] = await db.execute(
            `SELECT
                u.id,
                u.name,
                u.email,
                u.global_role,
                pm.role,
                pm.joined_at
             FROM project_members pm
             JOIN users u ON u.id = pm.user_id
             WHERE pm.project_id = ?
             ORDER BY pm.joined_at`,
            [projectId]
        );

        return res.json(members);
    } catch (error) {
        console.error("List members error:", error);

        return res.status(500).json({
            message: "Unable to load project members"
        });
    }
});

// ADD EXISTING EMPLOYEE TO PROJECT - MANAGER ONLY
router.post("/:id/members", async (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const userId = Number(req.user.id);
        const { email } = req.body;

        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(400).json({
                message: "Invalid project ID"
            });
        }

        const globalRole = await getGlobalRole(userId);

        if (globalRole !== "MANAGER") {
            return res.status(403).json({
                message: "Only Project Managers can add members"
            });
        }

        const myRole = await getProjectRole(projectId, userId);

        if (myRole !== "OWNER" && myRole !== "MANAGER") {
            return res.status(403).json({
                message: "You must manage this project to add members"
            });
        }

        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                message: "Member email is required"
            });
        }

        const [users] = await db.execute(
            `SELECT id, global_role
             FROM users
             WHERE email = ? AND is_active = TRUE`,
            [email.trim().toLowerCase()]
        );

        if (!users.length) {
            return res.status(404).json({
                message: "User not found. They must sign up first."
            });
        }

        // Do not add a manager as a regular employee.
        if (users[0].global_role !== "EMPLOYEE") {
            return res.status(400).json({
                message: "Only employee accounts can be added here"
            });
        }

        await db.execute(
            `INSERT IGNORE INTO project_members
                (project_id, user_id, role)
             VALUES (?, ?, 'MEMBER')`,
            [projectId, users[0].id]
        );

        await db.execute(
            `INSERT INTO activity_logs
                (project_id, user_id, action, details)
             VALUES (?, ?, 'MEMBER_ADDED', ?)`,
            [
                projectId,
                userId,
                JSON.stringify({
                    memberId: users[0].id
                })
            ]
        );

        return res.status(201).json({
            message: "Employee added to project successfully"
        });
    } catch (error) {
        console.error("Add member error:", error);

        return res.status(500).json({
            message: "Unable to add project member"
        });
    }
});

module.exports = router;
