
CREATE DATABASE IF NOT EXISTS taskora_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE taskora_db;

-- =========================================
-- 1. USERS
-- Signup, login and user profile
-- =========================================

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(500) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- =========================================
-- 2. PROJECTS
-- Project boards created by users
-- =========================================

CREATE TABLE IF NOT EXISTS projects (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT NULL,
    created_by INT UNSIGNED NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT '#6366f1',
    status ENUM('ACTIVE', 'ARCHIVED')
        NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_projects_creator
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT,

    INDEX idx_projects_creator (created_by),
    INDEX idx_projects_status (status)
) ENGINE=InnoDB;

-- =========================================
-- 3. PROJECT MEMBERS
-- Users participating in each project
-- =========================================

CREATE TABLE IF NOT EXISTS project_members (
    project_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    role ENUM('OWNER', 'MANAGER', 'MEMBER')
        NOT NULL DEFAULT 'MEMBER',
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (project_id, user_id),
    INDEX idx_project_members_user (user_id),

    CONSTRAINT fk_pm_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_pm_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================
-- 4. TASKS
-- Task cards in project boards
-- =========================================

CREATE TABLE IF NOT EXISTS tasks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id INT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    assigned_to INT UNSIGNED NULL,
    created_by INT UNSIGNED NOT NULL,

    status ENUM('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE')
        NOT NULL DEFAULT 'TODO',

    priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT')
        NOT NULL DEFAULT 'MEDIUM',

    due_date DATETIME NULL,
    position INT NOT NULL DEFAULT 0,

    completed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_tasks_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_tasks_assignee
        FOREIGN KEY (assigned_to) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_tasks_creator
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT,

    INDEX idx_tasks_project_status (project_id, status),
    INDEX idx_tasks_assignee (assigned_to),
    INDEX idx_tasks_due_date (due_date),
    INDEX idx_tasks_position (project_id, status, position)
) ENGINE=InnoDB;

-- =========================================
-- 5. TASK COMMENTS
-- Discussion within individual task cards
-- =========================================

CREATE TABLE IF NOT EXISTS comments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    comment_text TEXT NOT NULL,
    edited_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_comments_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_comments_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT,

    INDEX idx_comments_task_created (task_id, created_at)
) ENGINE=InnoDB;

-- =========================================
-- 6. NOTIFICATIONS
-- Task assignments, comments and project updates
-- =========================================

CREATE TABLE IF NOT EXISTS notifications (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    actor_id INT UNSIGNED NULL,

    type ENUM(
        'TASK_ASSIGNED',
        'TASK_UPDATED',
        'TASK_COMMENT',
        'PROJECT_INVITATION',
        'TASK_DUE'
    ) NOT NULL,

    message VARCHAR(500) NOT NULL,
    task_id INT UNSIGNED NULL,
    project_id INT UNSIGNED NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notifications_actor
        FOREIGN KEY (actor_id) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_notifications_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_notifications_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE SET NULL,

    INDEX idx_notifications_user_read (user_id, is_read, created_at)
) ENGINE=InnoDB;

-- =========================================
-- 7. ACTIVITY LOGS
-- Track changes made within projects
-- =========================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id INT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NULL,
    task_id INT UNSIGNED NULL,
    action VARCHAR(100) NOT NULL,
    details JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_activity_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_activity_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_activity_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE SET NULL,

    INDEX idx_activity_project_created (project_id, created_at)
) ENGINE=InnoDB;

-- =========================================
-- 8. PROJECT INVITATIONS
-- Invite team members by email
-- =========================================

CREATE TABLE IF NOT EXISTS project_invitations (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    project_id INT UNSIGNED NOT NULL,
    invited_by INT UNSIGNED NOT NULL,
    email VARCHAR(150) NOT NULL,

    role ENUM('MANAGER', 'MEMBER')
        NOT NULL DEFAULT 'MEMBER',

    invitation_token_hash CHAR(64) NOT NULL UNIQUE,

    status ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')
        NOT NULL DEFAULT 'PENDING',

    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_invitation_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_invitation_sender
        FOREIGN KEY (invited_by) REFERENCES users(id)
        ON DELETE RESTRICT,

    INDEX idx_invitation_email_status (email, status)
) ENGINE=InnoDB;

-- =========================================
-- 9. USER SESSIONS
-- Optional refresh-token session management
-- Store only hashed refresh tokens
-- =========================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    refresh_token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,

    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_expiry (expires_at)
) ENGINE=InnoDB;
select *from users;





