
document.addEventListener("DOMContentLoaded", async () => {
    const token = TaskoraAPI.getToken();
    const user = TaskoraAPI.getUser();

    // Redirect users who are not logged in
    if (!token || !user) {
        window.location.href = "login.html";
        return;
    }

    const $ = id => document.getElementById(id);

    const dashboardMessage = $("dashboardMessage");
    const projectGrid = $("projectGrid");
    const projectDialog = $("projectDialog");
    const projectForm = $("projectForm");
    const createProjectButton = $("createProjectButton");

    // Display user details
    $("welcomeHeading").textContent =
        `Welcome back, ${user.name}!`;

    $("sidebarUser").textContent =
        `${user.name} · ${user.email}`;

    // Only the global Project Manager can create projects.
    // The backend must enforce this permission too.
    const isManager =
        String(user.global_role || "").toUpperCase() === "MANAGER";

    if (createProjectButton) {
        createProjectButton.hidden = !isManager;

        createProjectButton.addEventListener("click", () => {
            if (isManager) {
                $("projectMessage").textContent = "";
                projectDialog.showModal();
            }
        });
    }

    // Logout
    $("logoutButton").addEventListener("click", () => {
        TaskoraAPI.logout();
    });

    // Close create-project dialog
    $("closeProjectDialog").addEventListener("click", () => {
        projectDialog.close();
    });

    let projects = [];

    // Load projects and dashboard statistics
    async function loadDashboard() {
        dashboardMessage.textContent = "";

        try {
            projects = await TaskoraAPI.request("/projects");

            projectGrid.replaceChildren();

            $("projectCount").textContent = projects.length;

            let totalTasks = 0;
            let inProgressTasks = 0;
            let completedTasks = 0;

            for (const project of projects) {
                let tasks = [];

                // Only project members can load the task board.
                // All logged-in users can see project cards.
                if (project.is_member) {
                    try {
                        tasks = await TaskoraAPI.request(
                            `/tasks/project/${project.id}`
                        );

                        if (!Array.isArray(tasks)) {
                            tasks = [];
                        }
                    } catch (error) {
                        console.error(
                            `Could not load tasks for project ${project.id}:`,
                            error.message
                        );
                    }

                    totalTasks += tasks.length;

                    inProgressTasks += tasks.filter(
                        task => task.status === "IN_PROGRESS"
                    ).length;

                    completedTasks += tasks.filter(
                        task => task.status === "DONE"
                    ).length;
                }

                // Project card
                const card = document.createElement("article");
                card.className = "project-card";

                const heading = document.createElement("h3");
                heading.textContent = project.name;

                const description = document.createElement("p");

                if (project.is_member) {
                    description.textContent =
                        project.description ||
                        "No description added yet.";
                } else {
                    description.textContent =
                        "Join this project to view its details and tasks.";
                }

                // Project creator / manager information
                const manager = document.createElement("p");
                manager.className = "project-manager";

                manager.textContent = project.manager_name
                    ? `Created by: ${project.manager_name}`
                    : "";

                // Card footer
                const footer = document.createElement("div");
                footer.className = "project-card-footer";

                const taskLabel = document.createElement("span");

                taskLabel.textContent = project.is_member
                    ? `${tasks.length} tasks`
                    : "Project member access required";

                const link = document.createElement("a");
                link.className = "btn btn-outline";

                if (project.is_member) {
                    link.href = `project.html?id=${encodeURIComponent(project.id)}`;
                    link.textContent = "Open board →";
                } else {
                    link.href = "#";
                    link.textContent = "Not a member";
                    link.setAttribute("aria-disabled", "true");

                    link.addEventListener("click", event => {
                        event.preventDefault();
                    });
                }

                footer.append(taskLabel, link);

                card.append(
                    heading,
                    description,
                    manager,
                    footer
                );

                projectGrid.append(card);
            }

            // Update statistics
            $("taskCount").textContent = totalTasks;
            $("progressCount").textContent = inProgressTasks;
            $("completedCount").textContent = completedTasks;

            // Empty project state
            if (projects.length === 0) {
                const empty = document.createElement("p");
                empty.className = "empty-state";

                empty.textContent = isManager
                    ? "No projects yet. Create your first project to get started!"
                    : "No projects are available yet.";

                projectGrid.append(empty);
            }
        } catch (error) {
            console.error("Dashboard loading error:", error);

            dashboardMessage.textContent =
                error.message || "Unable to load dashboard.";
        }
    }

    // Create project form
    projectForm.addEventListener("submit", async event => {
        event.preventDefault();

        if (!isManager) {
            $("projectMessage").textContent =
                "Only a Project Manager can create projects.";
            return;
        }

        const button = projectForm.querySelector(
            'button[type="submit"]'
        );

        button.disabled = true;
        $("projectMessage").textContent = "";

        try {
            const name = $("projectName").value.trim();
            const description =
                $("projectDescription").value.trim();

            if (!name) {
                $("projectMessage").textContent =
                    "Please enter a project name.";
                return;
            }

            const result = await TaskoraAPI.request("/projects", {
                method: "POST",
                body: JSON.stringify({
                    name,
                    description
                })
            });

            projectDialog.close();
            projectForm.reset();

            // Support common response formats
            const projectId =
                result.projectId ??
                result.project?.id ??
                result.id;

            if (projectId != null) {
                window.location.href =
                    `project.html?id=${encodeURIComponent(projectId)}`;
            } else {
                await loadDashboard();

                dashboardMessage.textContent =
                    "Project created successfully.";
            }
        } catch (error) {
            console.error("Project creation error:", error);

            $("projectMessage").textContent =
                error.message || "Unable to create project.";
        } finally {
            button.disabled = false;
        }
    });

    // Load notifications
    async function loadNotifications() {
        const list = $("notificationList");

        if (!list) return;

        try {
            const notifications = await TaskoraAPI.request(
                "/notifications"
            );

            list.replaceChildren();

            if (!Array.isArray(notifications) ||
                notifications.length === 0) {
                list.textContent = "You're all caught up!";
                return;
            }

            notifications.forEach(notification => {
                const item = document.createElement("article");
                item.className = "notification-item";

                const message = document.createElement("span");
                message.textContent = notification.message;

                const date = document.createElement("small");
                date.textContent = notification.created_at
                    ? new Date(
                        notification.created_at
                    ).toLocaleString()
                    : "";

                item.append(message, date);

                if (!notification.is_read) {
                    const button = document.createElement("button");

                    button.type = "button";
                    button.className = "btn btn-outline";
                    button.textContent = "Mark read";

                    button.addEventListener("click", async () => {
                        button.disabled = true;

                        try {
                            await TaskoraAPI.request(
                                `/notifications/${notification.id}/read`,
                                { method: "PATCH" }
                            );

                            await loadNotifications();
                        } catch (error) {
                            console.error(
                                "Mark notification read error:",
                                error
                            );

                            dashboardMessage.textContent =
                                error.message ||
                                "Unable to update notification.";

                            button.disabled = false;
                        }
                    });

                    item.append(button);
                }

                list.append(item);
            });
        } catch (error) {
            console.error("Notification loading error:", error);

            list.textContent =
                error.message || "Unable to load notifications.";
        }
    }

    // Mark all notifications as read
    const markAllReadButton = $("markAllRead");

    if (markAllReadButton) {
        markAllReadButton.addEventListener("click", async () => {
            markAllReadButton.disabled = true;

            try {
                await TaskoraAPI.request(
                    "/notifications/read-all",
                    { method: "PATCH" }
                );

                await loadNotifications();
            } catch (error) {
                dashboardMessage.textContent =
                    error.message ||
                    "Unable to mark notifications as read.";
            } finally {
                markAllReadButton.disabled = false;
            }
        });
    }

    // Initial page load
    await loadDashboard();
    await loadNotifications();
});
