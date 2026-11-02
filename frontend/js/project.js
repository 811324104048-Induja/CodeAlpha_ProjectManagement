document.addEventListener("DOMContentLoaded", async () => {
    const $ = id => document.getElementById(id);
    const params = new URLSearchParams(window.location.search);
    const projectId = Number(params.get("id"));

    if (!TaskoraAPI.getToken() || !TaskoraAPI.getUser()) {
        window.location.href = "login.html";
        return;
    }

    if (!Number.isInteger(projectId) || projectId <= 0) {
        window.location.href = "dashboard.html";
        return;
    }

    const taskDialog = $("taskDialog");
    const commentDialog = $("commentDialog");
    const memberDialog = $("memberDialog");

    let tasks = [];
    let members = [];
    let editingTask = null;
    let activeCommentTask = null;

    function showMessage(id, text) {
        $(id).textContent = text || "";
    }

    function makeButton(label, className, callback) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        button.addEventListener("click", callback);
        return button;
    }

    async function loadProject() {
        const projects = await TaskoraAPI.request("/projects");
        const project = projects.find(p => Number(p.id) === projectId);

        if (!project) {
            throw new Error("Project not found or access denied");
        }

        $("projectTitle").textContent = project.name;
        $("projectDescription").textContent = project.description || "";
    }

    async function loadMembers() {
        members = await TaskoraAPI.request(
            `/projects/${projectId}/members`
        );

        const memberList = $("memberList");
        const assignee = $("taskAssignee");

        memberList.replaceChildren();
        assignee.replaceChildren();

        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = "Unassigned";
        assignee.append(emptyOption);

        members.forEach(member => {
            const chip = document.createElement("span");
            chip.className = "member-chip";
            chip.textContent = member.name;
            memberList.append(chip);

            const option = document.createElement("option");
            option.value = member.id;
            option.textContent = member.name;
            assignee.append(option);
        });
    }

    async function loadTasks() {
        tasks = await TaskoraAPI.request(
            `/tasks/project/${projectId}`
        );
        renderTasks();
    }

    function renderTasks() {
        const columns = {
            TODO: $("todoTasks"),
            IN_PROGRESS: $("progressTasks"),
            IN_REVIEW: $("reviewTasks"),
            DONE: $("doneTasks")
        };

        Object.values(columns).forEach(column => column.replaceChildren());

        const counts = {
            TODO: 0,
            IN_PROGRESS: 0,
            IN_REVIEW: 0,
            DONE: 0
        };

        tasks.forEach(task => {
            counts[task.status]++;

            const card = document.createElement("article");
            card.className = "task-card";

            const priority = document.createElement("span");
            priority.className = `priority-label priority-${task.priority.toLowerCase()}`;
            priority.textContent = task.priority;

            const title = document.createElement("h3");
            title.textContent = task.title;

            const description = document.createElement("p");
            description.textContent = task.description || "";

            const assignee = document.createElement("small");
            assignee.textContent = task.assignee_name
                ? `Assigned to ${task.assignee_name}`
                : "Unassigned";

            const date = document.createElement("small");
            date.textContent = task.due_date
                ? `Due: ${String(task.due_date).slice(0, 16)}`
                : "";

            const statusSelect = document.createElement("select");

            [
                ["TODO", "To Do"],
                ["IN_PROGRESS", "In Progress"],
                ["IN_REVIEW", "In Review"],
                ["DONE", "Done"]
            ].forEach(([value, label]) => {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = label;
                statusSelect.append(option);
            });

            statusSelect.value = task.status;
            statusSelect.setAttribute(
                "aria-label",
                `Status for ${task.title}`
            );

            statusSelect.addEventListener("change", async () => {
                statusSelect.disabled = true;

                try {
                    await TaskoraAPI.request(
                        `/tasks/${task.id}/status`,
                        {
                            method: "PATCH",
                            body: JSON.stringify({
                                status: statusSelect.value
                            })
                        }
                    );
                    await loadTasks();
                } catch (error) {
                    showMessage("boardMessage", error.message);
                    statusSelect.value = task.status;
                } finally {
                    statusSelect.disabled = false;
                }
            });

            const actions = document.createElement("div");
            actions.className = "task-actions";

            actions.append(
                makeButton("Comments", "btn btn-outline", () => {
                    openComments(task);
                }),
                makeButton("Edit", "btn btn-outline", () => {
                    openEditTask(task);
                }),
                makeButton("Delete", "btn btn-danger", async () => {
                    if (!confirm(`Delete "${task.title}"?`)) return;

                    try {
                        await TaskoraAPI.request(`/tasks/${task.id}`, {
                            method: "DELETE"
                        });
                        await loadTasks();
                    } catch (error) {
                        showMessage("boardMessage", error.message);
                    }
                })
            );

            card.append(priority, title, description, assignee, date,
                statusSelect, actions);

            columns[task.status].append(card);
        });

        $("todoCount").textContent = counts.TODO;
        $("progressTasksCount").textContent = counts.IN_PROGRESS;
        $("reviewCount").textContent = counts.IN_REVIEW;
        $("doneCount").textContent = counts.DONE;

        Object.entries(columns).forEach(([status, column]) => {
            if (!counts[status]) {
                const empty = document.createElement("p");
                empty.className = "empty-state";
                empty.textContent = "No tasks yet";
                column.append(empty);
            }
        });
    }

    function openNewTask() {
        editingTask = null;
        $("taskForm").reset();
        $("taskPriority").value = "MEDIUM";
        $("taskDialogTitle").textContent = "Create a task";
        showMessage("taskMessage", "");
        taskDialog.showModal();
    }

    function openEditTask(task) {
        editingTask = task;
        $("taskForm").reset();
        $("taskTitle").value = task.title;
        $("taskDescription").value = task.description || "";
        $("taskAssignee").value = task.assigned_to || "";
        $("taskPriority").value = task.priority;
        $("taskDueDate").value = task.due_date
            ? String(task.due_date).replace(" ", "T").slice(0, 16)
            : "";

        $("taskDialogTitle").textContent = "Edit task";
        showMessage("taskMessage", "");
        taskDialog.showModal();
    }

    $("createTaskButton").addEventListener("click", openNewTask);

    $("closeTaskDialog").addEventListener("click", () => {
        taskDialog.close();
    });

    $("taskForm").addEventListener("submit", async event => {
        event.preventDefault();

        const button = $("taskForm").querySelector(
            'button[type="submit"]'
        );
        button.disabled = true;

        try {
            const assignedValue = $("taskAssignee").value;
            const dueValue = $("taskDueDate").value;

            const body = {
                title: $("taskTitle").value.trim(),
                description: $("taskDescription").value.trim(),
                assigned_to: assignedValue ? Number(assignedValue) : null,
                priority: $("taskPriority").value,
                due_date: dueValue
                    ? dueValue.replace("T", " ") + ":00"
                    : null
            };

            if (editingTask) {
                await TaskoraAPI.request(`/tasks/${editingTask.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(body)
                });
            } else {
                await TaskoraAPI.request("/tasks", {
                    method: "POST",
                    body: JSON.stringify({
                        ...body,
                        project_id: projectId
                    })
                });
            }

            taskDialog.close();
            await loadTasks();
            showMessage("boardMessage", "Task saved successfully.");
        } catch (error) {
            showMessage("taskMessage", error.message);
        } finally {
            button.disabled = false;
        }
    });

    async function openComments(task) {
        activeCommentTask = task;
        $("commentTaskTitle").textContent = task.title;
        $("commentText").value = "";
        showMessage("commentMessage", "");

        await loadComments();
        commentDialog.showModal();
    }

    async function loadComments() {
        const comments = await TaskoraAPI.request(
            `/comments/${activeCommentTask.id}`
        );

        const list = $("commentList");
        list.replaceChildren();

        if (!comments.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "No comments yet. Start the discussion!";
            list.append(empty);
        }

        comments.forEach(comment => {
            const item = document.createElement("article");
            item.className = "comment-item";

            const author = document.createElement("strong");
            author.textContent = comment.author;

            const text = document.createElement("p");
            text.textContent = comment.comment_text;

            const date = document.createElement("small");
            date.textContent = new Date(
                comment.created_at
            ).toLocaleString();

            item.append(author, text, date);
            list.append(item);
        });
    }

    $("closeCommentDialog").addEventListener("click", () => {
        commentDialog.close();
    });

    $("commentForm").addEventListener("submit", async event => {
        event.preventDefault();

        try {
            await TaskoraAPI.request(
                `/comments/${activeCommentTask.id}`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        comment_text: $("commentText").value.trim()
                    })
                }
            );

            $("commentText").value = "";
            await loadComments();
            showMessage("commentMessage", "Comment posted successfully.");
        } catch (error) {
            showMessage("commentMessage", error.message);
        }
    });

    $("addMemberButton").addEventListener("click", () => {
        $("memberForm").reset();
        showMessage("memberMessage", "");
        memberDialog.showModal();
    });

    $("closeMemberDialog").addEventListener("click", () => {
        memberDialog.close();
    });

    $("memberForm").addEventListener("submit", async event => {
        event.preventDefault();

        try {
            await TaskoraAPI.request(
                `/projects/${projectId}/members`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        email: $("memberEmail").value.trim(),
                        role: $("memberRole").value
                    })
                }
            );

            memberDialog.close();
            await loadMembers();
            showMessage("boardMessage", "Member added successfully.");
        } catch (error) {
            showMessage("memberMessage", error.message);
        }
    });

    try {
        await loadProject();
        await loadMembers();
        await loadTasks();
    } catch (error) {
        showMessage("boardMessage", error.message);
    }
});