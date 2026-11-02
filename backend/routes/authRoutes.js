
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const router = express.Router();

// SIGNUP — every new user is an EMPLOYEE by default
router.post("/signup", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !email.trim() ||
            password.length < 8
        ) {
            return res.status(400).json({
                message:
                    "Enter valid details. Password must be at least 8 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const [existing] = await db.execute(
            "SELECT id FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        // Do not accept global_role from the signup request.
        // The database default assigns EMPLOYEE.
        const [result] = await db.execute(
            `INSERT INTO users (name, email, password)
             VALUES (?, ?, ?)`,
            [name.trim(), normalizedEmail, hashedPassword]
        );

        res.status(201).json({
            message: "Account created successfully",
            user: {
                id: result.insertId,
                name: name.trim(),
                email: normalizedEmail,
                global_role: "EMPLOYEE"
            }
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        console.error("Signup error:", error);

        res.status(500).json({
            message: "Server error"
        });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const [users] = await db.execute(
            `SELECT id, name, email, password,
                    is_active, global_role
             FROM users
             WHERE email = ?`,
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const user = users[0];

        if (!user.is_active) {
            return res.status(403).json({
                message: "Account is disabled"
            });
        }

        const valid = await bcrypt.compare(
            password,
            user.password
        );

        if (!valid) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d"
            }
        );

        res.json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                global_role: user.global_role
            }
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            message: "Server error"
        });
    }
});

module.exports = router;
