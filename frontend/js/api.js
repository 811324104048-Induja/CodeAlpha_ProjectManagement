const API_BASE = "http://localhost:5000/api";

const TaskoraAPI = {
    getToken() {
        return localStorage.getItem("taskora_token");
    },

    getUser() {
        try {
            return JSON.parse(
                localStorage.getItem("taskora_user") || "null"
            );
        } catch {
            return null;
        }
    },

    async request(path, options = {}) {
        const headers = {
            "Content-Type": "application/json",
            ...(options.headers || {})
        };

        const token = this.getToken();

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(API_BASE + path, {
            ...options,
            headers
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 401) {
                this.logout();
            }

            throw new Error(data.message || "Request failed");
        }

        return data;
    },

    logout() {
        localStorage.removeItem("taskora_token");
        localStorage.removeItem("taskora_user");
        window.location.href = "login.html";
    }
};