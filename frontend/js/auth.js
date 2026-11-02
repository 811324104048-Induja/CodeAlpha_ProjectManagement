document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");
    const message = document.getElementById("authMessage");

    function showMessage(text, isError = true) {
        if (!message) return;

        message.textContent = text;
        message.className = isError
            ? "form-message error"
            : "form-message success";
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async event => {
            event.preventDefault();

            const button = loginForm.querySelector("button");
            button.disabled = true;

            try {
                const email = loginForm.email.value;
                const password = loginForm.password.value;

                const result = await TaskoraAPI.request(
                    "/auth/login",
                    {
                        method: "POST",
                        body: JSON.stringify({ email, password })
                    }
                );

                localStorage.setItem("taskora_token", result.token);
                localStorage.setItem(
                    "taskora_user",
                    JSON.stringify(result.user)
                );

                window.location.href = "dashboard.html";
            } catch (error) {
                showMessage(error.message);
            } finally {
                button.disabled = false;
            }
        });
    }

    if (signupForm) {
        signupForm.addEventListener("submit", async event => {
            event.preventDefault();

            const button = signupForm.querySelector("button");
            button.disabled = true;

            try {
                const name = signupForm.name.value.trim();
                const email = signupForm.email.value.trim();
                const password = signupForm.password.value;

                await TaskoraAPI.request("/auth/signup", {
                    method: "POST",
                    body: JSON.stringify({ name, email, password })
                });

                showMessage(
                    "Account created! Redirecting to login...",
                    false
                );

                window.location.href = "login.html";
            } catch (error) {
                showMessage(error.message);
            } finally {
                button.disabled = false;
            }
        });
    }
});