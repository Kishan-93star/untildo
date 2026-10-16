// ==========================================================================
// UNTILDO - SMART DAILY TASKS & AI KNOWLEDGE SUITE CONTROLLER
// ==========================================================================

const API_BASE = "/api";

// --- Global State ---
let currentUser = null;
let currentToken = localStorage.getItem("untildo_token") || localStorage.getItem("aether_token") || null;
let currentTab = "planner";
let globalTheme = localStorage.getItem("untildo_theme") || localStorage.getItem("aether_theme") || "dark";

// Helper: Local date string YYYY-MM-DD
function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Data Caches (with LocalStorage Sync)
let cachedDocuments = [];
let cachedNotes = [];
let cachedTasks = [];
let cachedQuizAttempts = [];
let currentCalendarDate = new Date();

// Active Quiz Session State
let activeQuiz = null;
let currentQuestionIndex = 0;
let quizScore = 0;
let quizTimerInterval = null;
let quizSecondsElapsed = 0;
let quizAnsweredCurrent = false;

// Active Note State
let activeNoteId = null;
let activeNoteCategory = "all";

// Chart.js Instances
let chartQuizProgress = null;
let chartTaskCompletion = null;

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setupEventListeners();
    checkSession();
});

function initTheme() {
    setTheme(globalTheme);
}

function setTheme(theme) {
    globalTheme = theme;
    localStorage.setItem("aether_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-bs-theme", theme);
    document.body.className = `theme-${theme}`;

    // Update settings buttons
    const btnDark = document.getElementById("theme-btn-dark");
    const btnLight = document.getElementById("theme-btn-light");
    if (btnDark && btnLight) {
        if (theme === "dark") {
            btnDark.classList.add("active");
            btnLight.classList.remove("active");
        } else {
            btnLight.classList.add("active");
            btnDark.classList.remove("active");
        }
    }

    // Refresh charts if rendered
    if (chartQuizProgress) chartQuizProgress.update();
    if (chartTaskCompletion) chartTaskCompletion.update();
}

function toggleTheme() {
    setTheme(globalTheme === "dark" ? "light" : "dark");
}

// ==========================================
// TOAST NOTIFICATION UTILITIES
// ==========================================

function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    const icon = document.getElementById("toast-icon");
    const msgSpan = document.getElementById("toast-message");
    
    toast.className = `toast-notification ${type}`;
    if (type === "success") {
        icon.className = "fa-solid fa-circle-check toast-icon";
    } else if (type === "error") {
        icon.className = "fa-solid fa-circle-xmark toast-icon";
    } else {
        icon.className = "fa-solid fa-circle-info toast-icon";
    }
    
    msgSpan.textContent = message;
    toast.classList.remove("hidden");
    
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4500);
}

// ==========================================
// API REQUEST WRAPPER (JWT + LOCALSTORAGE FALLBACK)
// ==========================================

async function apiRequest(endpoint, options = {}) {
    const headers = options.headers || {};
    if (currentToken) {
        headers["Authorization"] = `Bearer ${currentToken}`;
    }
    
    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }
    
    options.headers = headers;
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const data = await response.json();
        
        if (!response.ok) {
            if (response.status === 401) {
                logout();
                throw new Error("Session expired. Please log in again.");
            }
            throw new Error(data.detail || "Request failed.");
        }
        return data;
    } catch (err) {
        console.warn(`API Error on ${endpoint}:`, err);
        throw err;
    }
}

function getGeminiKey() {
    return localStorage.getItem("aether_gemini_key") || "";
}

function saveGeminiKey() {
    const input = document.getElementById("settings-gemini-key");
    const key = input.value.trim();
    if (key) {
        localStorage.setItem("aether_gemini_key", key);
        showToast("Gemini API Key saved securely in LocalStorage!", "success");
    } else {
        localStorage.removeItem("aether_gemini_key");
        showToast("Gemini Key removed. Switched to offline Local NLP.", "info");
    }
    updateGeminiBadge();
}

function updateGeminiBadge() {
    const chip = document.getElementById("gemini-status-chip");
    const text = document.getElementById("gemini-status-text");
    const key = getGeminiKey();
    if (key) {
        if (text) text.textContent = "Gemini 1.5 Flash Active";
        if (chip) chip.style.borderColor = "var(--accent-purple)";
    } else {
        if (text) text.textContent = "Local NLP Engine";
        if (chip) chip.style.borderColor = "var(--border-glass)";
    }
}

// ==========================================
// AUTHENTICATION & FORM VALIDATION
// ==========================================

function checkSession() {
    if (!currentToken) {
        showAuth(true);
        return;
    }
    
    apiRequest("/auth/me")
        .then(user => {
            currentUser = user;
            updateUserUI();
            showAuth(false);
            updateGeminiBadge();
            switchTab("planner");
            fetchSavedSchedules();
            renderActiveSchedule();
        })
        .catch(() => {
            currentToken = null;
            localStorage.removeItem("aether_token");
            showAuth(true);
        });
}

function showAuth(visible) {
    const authContainer = document.getElementById("auth-container");
    const appContainer = document.getElementById("app-container");
    if (visible) {
        authContainer.style.display = "flex";
        appContainer.classList.add("hidden");
    } else {
        authContainer.style.display = "none";
        appContainer.classList.remove("hidden");
    }
}

function switchAuthForm(formType) {
    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");
    const pillLogin = document.getElementById("pill-login");
    const pillSignup = document.getElementById("pill-signup");
    
    if (formType === "login") {
        loginForm.classList.add("active");
        signupForm.classList.remove("active");
        pillLogin.classList.add("active");
        pillSignup.classList.remove("active");
    } else {
        signupForm.classList.add("active");
        loginForm.classList.remove("active");
        pillSignup.classList.add("active");
        pillLogin.classList.remove("active");
    }
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector("i");
    if (input.type === "password") {
        input.type = "text";
        icon.className = "fa-solid fa-eye-slash";
    } else {
        input.type = "password";
        icon.className = "fa-solid fa-eye";
    }
}

function checkPasswordStrength(password) {
    let score = 0;
    if (password.length >= 6) score += 25;
    if (password.length >= 10) score += 20;
    if (/[A-Z]/.test(password)) score += 20;
    if (/[0-9]/.test(password)) score += 20;
    if (/[^A-Za-z0-9]/.test(password)) score += 15;
    
    const fill = document.getElementById("strength-bar-fill");
    const label = document.getElementById("strength-text");
    
    if (!fill || !label) return;
    
    fill.style.width = `${score}%`;
    if (score < 30) {
        fill.style.backgroundColor = "var(--accent-rose)";
        label.textContent = "Weak";
        label.style.color = "var(--accent-rose)";
    } else if (score < 70) {
        fill.style.backgroundColor = "var(--accent-amber)";
        label.textContent = "Medium";
        label.style.color = "var(--accent-amber)";
    } else {
        fill.style.backgroundColor = "var(--accent-emerald)";
        label.textContent = "Strong";
        label.style.color = "var(--accent-emerald)";
    }
}

function confirmLogout() {
    const modalEl = document.getElementById("confirmModal");
    const modal = new bootstrap.Modal(modalEl);
    document.getElementById("confirm-modal-title").textContent = "Log Out";
    document.getElementById("confirm-modal-desc").textContent = "Are you sure you want to sign out?";
    
    const actionBtn = document.getElementById("confirm-modal-action-btn");
    actionBtn.onclick = () => {
        modal.hide();
        logout();
    };
    modal.show();
}

function logout() {
    currentUser = null;
    currentToken = null;
    localStorage.removeItem("untildo_token");
    localStorage.removeItem("aether_token");
    showAuth(true);
    showToast("Signed out successfully.", "info");
}

function updateUserUI() {
    if (!currentUser) return;
    const name = currentUser.username || "User";
    const userDisplay = document.getElementById("dashboard-user-name");
    const sidebarUser = document.getElementById("sidebar-username");
    const topNavUser = document.getElementById("top-nav-username");
    const profileUser = document.getElementById("profile-display-username");
    
    if (userDisplay) userDisplay.textContent = name;
    if (sidebarUser) sidebarUser.textContent = name;
    if (topNavUser) topNavUser.textContent = name;
    if (profileUser) profileUser.textContent = name;
    
    // Set dynamic greeting
    const hour = new Date().getHours();
    const greetingEl = document.getElementById("hero-greeting-time");
    if (greetingEl) {
        if (hour < 12) greetingEl.textContent = "Good morning,";
        else if (hour < 18) greetingEl.textContent = "Good afternoon,";
        else greetingEl.textContent = "Good evening,";
    }
    
    // Load profile avatar if saved
    loadUserProfile();
}

// ==========================================
// NAVIGATION & TAB CONTROLLER
// ==========================================

function openMobileSidebar() {
    document.getElementById("app-sidebar")?.classList.add("open");
    document.getElementById("sidebar-backdrop")?.classList.add("active");
}

function closeMobileSidebar() {
    document.getElementById("app-sidebar")?.classList.remove("open");
    document.getElementById("sidebar-backdrop")?.classList.remove("active");
}

function switchTab(tabId) {
    currentTab = tabId;
    
    // Close mobile sidebar and backdrop if open
    closeMobileSidebar();
    
    // Update sidebar nav link states
    document.querySelectorAll(".sidebar-nav .nav-link-item").forEach(link => {
        if (link.getAttribute("data-tab") === tabId) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // Update mobile bottom nav button states
    document.querySelectorAll("#mobile-bottom-nav .mobile-nav-btn").forEach(btn => {
        if (btn.getAttribute("data-tab") === tabId) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
    
    // Show active tab panel
    document.querySelectorAll(".content-tab-panel").forEach(panel => {
        panel.classList.remove("active");
    });
    const activePanel = document.getElementById(`tab-${tabId}`);
    if (activePanel) {
        activePanel.classList.add("active");
    }
    
    // Trigger tab specific data loaders
    switch (tabId) {
        case "dashboard":
            loadDashboardData();
            break;
        case "chat":
            loadChatContextDocuments();
            break;
        case "documents":
            loadDocuments();
            break;
        case "notes":
            loadNotes();
            break;
        case "quiz":
            loadQuizPortal();
            break;
        case "planner":
            loadPlannerData();
            break;
        case "schedule":
            loadScheduleTab();
            break;
        case "profile":
            loadUserProfile();
            break;
        case "settings":
            loadSettings();
            break;
    }
}

// ==========================================
// DASHBOARD & CHART.JS CONTROLLER
// ==========================================

async function loadDashboardData() {
    try {
        const stats = await apiRequest("/dashboard/stats");
        
        // Update Stats KPI
        const docEl = document.getElementById("dash-stat-docs");
        if (docEl) docEl.textContent = stats.documents_count || 0;
        const noteEl = document.getElementById("dash-stat-notes");
        if (noteEl) noteEl.textContent = stats.notes_count || 0;
        const quizEl = document.getElementById("dash-stat-quizzes");
        if (quizEl) quizEl.textContent = stats.quizzes_taken || 0;
        const avgEl = document.getElementById("dash-stat-avg-score");
        if (avgEl) avgEl.textContent = `${stats.average_quiz_score || 0}%`;
        
        // Update Sidebar badges
        const sDoc = document.getElementById("sidebar-doc-count");
        if (sDoc) sDoc.textContent = stats.documents_count || 0;
        const sNote = document.getElementById("sidebar-note-count");
        if (sNote) sNote.textContent = stats.notes_count || 0;
        
        // Render Chart 1: Quiz Performance Trends
        renderQuizTrendsChart(stats.quiz_trends || []);
        
        // Render Chart 2: Task Completion Ring
        renderTaskCompletionChart(stats.completed_tasks || 0, stats.total_tasks || 0);
        
        // Load quick tasks & active schedule mission
        loadDashboardQuickTasks();
        renderActiveSchedule();
    } catch (e) {
        console.warn("Failed to load dashboard stats:", e);
    }
}

function renderQuizTrendsChart(trends) {
    const ctx = document.getElementById("chart-quiz-progress");
    if (!ctx) return;
    
    const labels = trends.length ? trends.map((t, i) => `Test ${i + 1}`) : ["Attempt 1", "Attempt 2", "Attempt 3", "Attempt 4", "Attempt 5"];
    const dataPoints = trends.length ? trends.map(t => t.score_pct) : [65, 72, 85, 80, 92];
    
    if (chartQuizProgress) {
        chartQuizProgress.destroy();
    }
    
    const isDark = globalTheme === "dark";
    const textColor = isDark ? "#94a3b8" : "#64748b";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
    
    chartQuizProgress = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Score Percentage (%)",
                data: dataPoints,
                borderColor: "#2563eb",
                backgroundColor: isDark ? "rgba(37, 99, 235, 0.22)" : "rgba(37, 99, 235, 0.12)",
                fill: true,
                tension: 0.4,
                pointBackgroundColor: "#38bdf8",
                pointBorderColor: "#ffffff",
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? "#1e293b" : "#ffffff",
                    titleColor: isDark ? "#f8fafc" : "#0f172a",
                    bodyColor: isDark ? "#cbd5e1" : "#334155",
                    borderColor: "rgba(99, 102, 241, 0.3)",
                    borderWidth: 1,
                    callbacks: {
                        label: (context) => `Score: ${context.parsed.y}%`
                    }
                }
            },
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: gridColor },
                    ticks: { color: textColor, callback: v => `${v}%` }
                },
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor }
                }
            }
        }
    });
}

function renderTaskCompletionChart(completed, total) {
    const ctx = document.getElementById("chart-task-completion");
    if (!ctx) return;
    
    if (chartTaskCompletion) {
        chartTaskCompletion.destroy();
    }
    
    const pct = total > 0 ? Math.round((completed / total) * 100) : (completed > 0 ? 100 : 0);
    const pctEl = document.getElementById("chart-tasks-pct");
    if (pctEl) pctEl.textContent = `${pct}%`;
    
    const isDark = globalTheme === "dark";
    const emptyColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
    
    chartTaskCompletion = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["Completed", "Pending"],
            datasets: [{
                data: [completed || 1, Math.max(0, (total || 1) - completed)],
                backgroundColor: ["#10b981", emptyColor],
                borderWidth: 0,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "78%",
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        }
    });
}

async function loadDashboardQuickTasks() {
    try {
        const tasks = await apiRequest("/planner/tasks");
        cachedTasks = tasks;
        renderDashboardTasks();
    } catch (e) {
        console.warn("Could not load dashboard tasks:", e);
    }
}


// ==========================================
// AI COPILOT CHAT & CASUAL BUDDY CONTROLLER
// ==========================================

let chatHistoryMemory = [];
let activeChatMode = "study"; // "study" (copilot mentor) or "smalltalk" (casual buddy)

function setChatMode(mode) {
    activeChatMode = mode;
    const btnStudy = document.getElementById("chat-mode-study");
    const btnSmalltalk = document.getElementById("chat-mode-smalltalk");
    const chipsContainer = document.getElementById("chat-suggestion-chips");
    const input = document.getElementById("chat-user-input");
    
    if (mode === "smalltalk") {
        if (btnSmalltalk) btnSmalltalk.classList.add("active");
        if (btnStudy) btnStudy.classList.remove("active");
        if (input) input.placeholder = "Say hi, ask for a quick break joke, or chat with your AI productivity buddy...";
        
        // Populate Casual Buddy Prompt Chips
        if (chipsContainer) {
            chipsContainer.innerHTML = `
                <button class="chip-btn" onclick="sendSuggestedPrompt('How is your day going today?')">
                    <i class="fa-solid fa-face-smile me-1 text-accent-blue"></i> How's your day?
                </button>
                <button class="chip-btn" onclick="sendSuggestedPrompt('Tell me a quick developer or productivity joke')">
                    <i class="fa-solid fa-masks-theater me-1 text-accent-purple"></i> Quick Joke 🤖
                </button>
                <button class="chip-btn" onclick="sendSuggestedPrompt('Give me a 1-sentence focus & motivation boost!')">
                    <i class="fa-solid fa-bolt me-1 text-accent-amber"></i> Fast Motivation ⚡
                </button>
                <button class="chip-btn" onclick="sendSuggestedPrompt('Is it time for a 5-minute coffee & stretch break?')">
                    <i class="fa-solid fa-mug-hot me-1 text-accent-emerald"></i> Coffee Break ☕
                </button>
            `;
        }
        showToast("Switched to Casual AI Buddy (Concise & Bite-sized answers)", "info");
    } else {
        if (btnStudy) btnStudy.classList.add("active");
        if (btnSmalltalk) btnSmalltalk.classList.remove("active");
        if (input) input.placeholder = "Ask anything, paste notes, or ask for explanations... (Press Enter to send, Shift+Enter for new line)";
        
        // Populate Copilot Mentor Prompt Chips
        if (chipsContainer) {
            chipsContainer.innerHTML = `
                <button class="chip-btn" onclick="sendSuggestedPrompt('Break down a complex project into daily actionable milestones')">
                    <i class="fa-solid fa-list-check me-1 text-accent-blue"></i> Break Down Project
                </button>
                <button class="chip-btn" onclick="sendSuggestedPrompt('Explain the Feynman Technique and how to use it for rapid learning')">
                    <i class="fa-solid fa-brain me-1 text-accent-purple"></i> Feynman Technique
                </button>
                <button class="chip-btn" onclick="sendSuggestedPrompt('Explain the 25/5 Pomodoro routine for deep focus')">
                    <i class="fa-solid fa-stopwatch me-1 text-accent-emerald"></i> Pomodoro Routine
                </button>
                <button class="chip-btn" onclick="sendSuggestedPrompt('Create 3 active recall cards or knowledge checks for my topic')">
                    <i class="fa-solid fa-layer-group me-1 text-accent-amber"></i> Knowledge Cards
                </button>
            `;
        }
        showToast("Switched to Copilot Mentor Mode", "info");
    }
}

async function loadChatContextDocuments() {
    const select = document.getElementById("chat-doc-context");
    if (!select) return;
    
    try {
        const docs = await apiRequest("/documents");
        cachedDocuments = docs;
        
        select.innerHTML = '<option value="">Context: General Academic</option>';
        docs.forEach(doc => {
            const opt = document.createElement("option");
            opt.value = doc.id;
            opt.textContent = `Doc: ${doc.filename}`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.warn("Could not load chat doc contexts:", e);
    }
}

function sendSuggestedPrompt(promptText) {
    const input = document.getElementById("chat-user-input");
    if (input) {
        input.value = promptText;
        document.getElementById("chat-submit-form").dispatchEvent(new Event("submit"));
    }
}

async function handleChatSubmit(e) {
    e.preventDefault();
    const input = document.getElementById("chat-user-input");
    const message = input.value.trim();
    if (!message) return;
    
    input.value = "";
    const docContextId = document.getElementById("chat-doc-context").value || null;
    
    // Append User message to stream
    appendChatMessage("user", message);
    chatHistoryMemory.push({ sender: "user", message: message });
    
    // Append Thinking Indicator
    const typingId = appendTypingIndicator();
    
    try {
        const payload = {
            message: message,
            document_id: docContextId ? parseInt(docContextId) : null,
            gemini_key: getGeminiKey(),
            mode: activeChatMode,
            history: chatHistoryMemory
        };
        
        const response = await apiRequest("/chat", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        
        removeTypingIndicator(typingId);
        appendChatMessage("ai", response.reply);
        chatHistoryMemory.push({ sender: "ai", message: response.reply });
    } catch (err) {
        removeTypingIndicator(typingId);
        appendChatMessage("ai", `❌ **Error:** ${err.message || "Failed to get AI response."}`);
    }
}

function appendChatMessage(sender, text) {
    const stream = document.getElementById("chat-messages-stream");
    if (!stream) return;
    
    const row = document.createElement("div");
    row.className = `chat-message-row ${sender === "user" ? "user-row" : "ai-row"}`;
    
    const avatarHtml = sender === "user" 
        ? `<div class="msg-avatar user-avatar-chat"><i class="fa-solid fa-user"></i></div>`
        : `<div class="msg-avatar ai-avatar"><i class="fa-solid fa-robot"></i></div>`;
        
    const authorName = sender === "user" ? "You" : "UntilDo AI";
    const formattedContent = renderMarkdownSimple(text);
    
    row.innerHTML = `
        ${avatarHtml}
        <div class="msg-bubble-container">
            <div class="msg-author-tag">${authorName}</div>
            <div class="msg-bubble ${sender === "user" ? "user-bubble" : "ai-bubble"}">
                ${formattedContent}
            </div>
            <div class="msg-meta-row">
                <span class="msg-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <button class="btn-copy-msg" onclick="copyTextToClipboard(decodeURIComponent('${encodeURIComponent(text)}'), this)" title="Copy text">
                    <i class="fa-regular fa-copy"></i>
                </button>
            </div>
        </div>
    `;
    
    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;
}

function appendTypingIndicator() {
    const stream = document.getElementById("chat-messages-stream");
    const id = `typing-${Date.now()}`;
    const row = document.createElement("div");
    row.id = id;
    row.className = "chat-message-row ai-row";
    row.innerHTML = `
        <div class="msg-avatar ai-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="msg-bubble-container">
            <div class="msg-author-tag">UntilDo AI</div>
            <div class="msg-bubble ai-bubble typing-dots">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function clearChatHistory() {
    const stream = document.getElementById("chat-messages-stream");
    if (stream) {
        stream.innerHTML = `
            <div class="chat-message-row ai-row">
                <div class="msg-avatar ai-avatar"><i class="fa-solid fa-robot"></i></div>
                <div class="msg-bubble-container">
                    <div class="msg-author-tag">UntilDo AI</div>
                    <div class="msg-bubble ai-bubble">
                        <p>Chat cleared! Ready for your next task or study topic.</p>
                    </div>
                </div>
            </div>
        `;
    }
    chatHistoryMemory = [];
    showToast("Chat conversation cleared.", "info");
}

// ==========================================
// DOCUMENTS VAULT CONTROLLER
// ==========================================

async function loadDocuments() {
    const grid = document.getElementById("documents-grid-view");
    if (!grid) return;
    
    try {
        const docs = await apiRequest("/documents");
        cachedDocuments = docs;
        document.getElementById("vault-count-badge").textContent = docs.length;
        
        if (!docs.length) {
            grid.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fa-solid fa-folder-open text-muted fs-1 mb-3"></i>
                    <h4 class="text-muted">No documents uploaded yet</h4>
                    <p class="text-muted small">Upload a PDF or TXT file above to unlock instant summaries and quizzes.</p>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = docs.map(d => `
            <div class="col-12 col-md-6 col-xl-4">
                <div class="card-panel glassmorphism h-100 animate-hover d-flex flex-column justify-content-between">
                    <div>
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div class="d-flex align-items-center gap-2">
                                <i class="fa-solid ${d.filename.endsWith('.pdf') ? 'fa-file-pdf text-accent-rose' : 'fa-file-lines text-accent-blue'} fs-3"></i>
                                <h4 class="fs-6 mb-0 text-truncate" style="max-width: 200px;" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</h4>
                            </div>
                            <button class="btn btn-sm btn-danger-glass p-1 px-2" onclick="confirmDeleteDocument(${d.id}, '${escapeHtml(d.filename)}')">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                        <p class="text-muted small mb-3">Uploaded on ${new Date(d.uploaded_at).toLocaleDateString()} • ${(d.char_count / 1000).toFixed(1)}k chars</p>
                    </div>
                    <div class="d-flex gap-2 pt-2 border-top border-secondary border-opacity-10">
                        <button class="btn btn-sm btn-primary-gradient flex-fill" onclick="launchQuizForDoc(${d.id})">
                            <i class="fa-solid fa-bolt me-1"></i>Quiz
                        </button>
                        <button class="btn btn-sm btn-glass flex-fill" onclick="chatWithDoc(${d.id})">
                            <i class="fa-solid fa-robot me-1"></i>Chat
                        </button>
                    </div>
                </div>
            </div>
        `).join("");
    } catch (e) {
        console.warn("Could not load documents:", e);
    }
}

async function uploadStudyFile(file, isDashboard = false) {
    if (!file) return;
    
    const progressBox = document.getElementById(isDashboard ? "dash-upload-bar" : "docs-upload-bar");
    const progressFill = document.getElementById(isDashboard ? "dash-progress-fill" : "docs-progress-fill");
    const progressPct = document.getElementById(isDashboard ? "dash-upload-pct" : "docs-upload-pct");
    const progressStatus = document.getElementById(isDashboard ? "dash-upload-status" : "docs-upload-status");
    
    if (progressBox) progressBox.classList.remove("hidden");
    if (progressFill) progressFill.style.width = "25%";
    if (progressPct) progressPct.textContent = "25%";
    if (progressStatus) progressStatus.textContent = "Uploading & extracting text...";
    
    const formData = new FormData();
    formData.append("file", file);
    const geminiKey = getGeminiKey();
    if (geminiKey) formData.append("gemini_key", geminiKey);
    
    try {
        if (progressFill) progressFill.style.width = "65%";
        if (progressPct) progressPct.textContent = "65%";
        if (progressStatus) progressStatus.textContent = "Generating AI Summary & Key Takeaways...";
        
        const res = await apiRequest("/documents/upload", {
            method: "POST",
            body: formData
        });
        
        if (progressFill) progressFill.style.width = "100%";
        if (progressPct) progressPct.textContent = "100%";
        if (progressStatus) progressStatus.textContent = "Complete!";
        
        showToast(`Document "${res.filename}" processed and summarized!`, "success");
        setTimeout(() => {
            if (progressBox) progressBox.classList.add("hidden");
            if (isDashboard) loadDashboardData();
            else loadDocuments();
        }, 800);
    } catch (err) {
        if (progressBox) progressBox.classList.add("hidden");
        showToast(err.message || "Failed to upload document.", "error");
    }
}

function confirmDeleteDocument(id, filename) {
    const modalEl = document.getElementById("confirmModal");
    const modal = new bootstrap.Modal(modalEl);
    document.getElementById("confirm-modal-title").textContent = "Delete Document";
    document.getElementById("confirm-modal-desc").textContent = `Are you sure you want to delete "${filename}"? Associated summary notes and quizzes will remain.`;
    
    const actionBtn = document.getElementById("confirm-modal-action-btn");
    actionBtn.onclick = async () => {
        modal.hide();
        try {
            await apiRequest(`/documents/${id}`, { method: "DELETE" });
            showToast("Document deleted.", "info");
            loadDocuments();
        } catch (e) {
            showToast(e.message, "error");
        }
    };
    modal.show();
}

function chatWithDoc(docId) {
    switchTab("chat");
    setTimeout(() => {
        const select = document.getElementById("chat-doc-context");
        if (select) select.value = docId;
    }, 200);
}

function launchQuizForDoc(docId) {
    switchTab("quiz");
    setTimeout(() => {
        const select = document.getElementById("quiz-select-doc");
        if (select) select.value = docId;
    }, 200);
}

// ==========================================
// STUDY NOTES CONTROLLER
// ==========================================

async function loadNotes() {
    const container = document.getElementById("notes-items-container");
    if (!container) return;
    
    try {
        const notes = await apiRequest("/notes");
        cachedNotes = notes;
        
        renderNotesList();
    } catch (e) {
        console.warn("Could not load notes:", e);
    }
}

function renderNotesList() {
    const container = document.getElementById("notes-items-container");
    const filterText = (document.getElementById("notes-filter-input")?.value || "").toLowerCase();
    
    let filtered = cachedNotes.filter(n => {
        const matchCategory = activeNoteCategory === "all" || n.category === activeNoteCategory;
        const matchText = n.title.toLowerCase().includes(filterText) || n.content.toLowerCase().includes(filterText);
        return matchCategory && matchText;
    });
    
    if (!filtered.length) {
        container.innerHTML = `<div class="text-center text-muted small py-4">No matching notes found.</div>`;
        return;
    }
    
    container.innerHTML = filtered.map(n => `
        <div class="note-list-card ${activeNoteId === n.id ? 'active' : ''}" onclick="selectNote(${n.id})">
            <div class="d-flex justify-content-between align-items-start">
                <div class="note-card-title">${n.is_pinned ? '📌 ' : ''}${escapeHtml(n.title)}</div>
            </div>
            <div class="note-card-snippet">${escapeHtml(n.content.slice(0, 100))}</div>
            <div class="note-card-footer">
                <span class="badge bg-secondary bg-opacity-25 text-secondary px-2">${escapeHtml(n.category || 'General')}</span>
                <span>${new Date(n.updated_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join("");
}

function selectNote(noteId) {
    activeNoteId = noteId;
    const note = cachedNotes.find(n => n.id === noteId);
    if (!note) return;
    
    document.getElementById("note-editor-placeholder").classList.add("hidden");
    document.getElementById("note-editor-active").classList.remove("hidden");
    
    document.getElementById("note-input-title").value = note.title;
    document.getElementById("note-input-category").value = note.category || "General";
    document.getElementById("note-input-content").value = note.content;
    
    const pinBtn = document.getElementById("note-pin-toggle");
    if (pinBtn) {
        if (note.is_pinned) pinBtn.classList.add("active");
        else pinBtn.classList.remove("active");
    }
    
    renderNotesList();
}

function createNewNote() {
    activeNoteId = null;
    document.getElementById("note-editor-placeholder").classList.add("hidden");
    document.getElementById("note-editor-active").classList.remove("hidden");
    
    document.getElementById("note-input-title").value = "Untitled Study Note";
    document.getElementById("note-input-category").value = "General";
    document.getElementById("note-input-content").value = "";
    document.getElementById("note-pin-toggle")?.classList.remove("active");
    document.getElementById("note-input-title").focus();
}

async function saveCurrentNote() {
    const title = document.getElementById("note-input-title").value.trim() || "Untitled Note";
    const category = document.getElementById("note-input-category").value;
    const content = document.getElementById("note-input-content").value;
    const isPinned = document.getElementById("note-pin-toggle")?.classList.contains("active") ? 1 : 0;
    
    try {
        if (activeNoteId) {
            await apiRequest(`/notes/${activeNoteId}`, {
                method: "PUT",
                body: JSON.stringify({ title, content, category, is_pinned: isPinned })
            });
            showToast("Note updated successfully.", "success");
        } else {
            const res = await apiRequest("/notes", {
                method: "POST",
                body: JSON.stringify({ title, content, category, is_pinned: isPinned })
            });
            activeNoteId = res.id;
            showToast("New note created.", "success");
        }
        loadNotes();
    } catch (e) {
        showToast(e.message, "error");
    }
}

function confirmDeleteCurrentNote() {
    if (!activeNoteId) return;
    const modalEl = document.getElementById("confirmModal");
    const modal = new bootstrap.Modal(modalEl);
    document.getElementById("confirm-modal-title").textContent = "Delete Note";
    document.getElementById("confirm-modal-desc").textContent = "Are you sure you want to permanently delete this note?";
    
    const actionBtn = document.getElementById("confirm-modal-action-btn");
    actionBtn.onclick = async () => {
        modal.hide();
        try {
            await apiRequest(`/notes/${activeNoteId}`, { method: "DELETE" });
            showToast("Note deleted.", "info");
            activeNoteId = null;
            document.getElementById("note-editor-active").classList.add("hidden");
            document.getElementById("note-editor-placeholder").classList.remove("hidden");
            loadNotes();
        } catch (e) {
            showToast(e.message, "error");
        }
    };
    modal.show();
}

function exportCurrentNote() {
    const title = document.getElementById("note-input-title").value.trim() || "StudyNote";
    const content = document.getElementById("note-input-content").value;
    
    const blob = new Blob([`# ${title}\n\n${content}`], { type: "text/markdown;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    link.click();
    showToast("Note exported as Markdown file.", "success");
}

// ==========================================
// INTERACTIVE AI QUIZZES CONTROLLER
// ==========================================

async function loadQuizPortal() {
    // Populate document selector
    const select = document.getElementById("quiz-select-doc");
    if (select) {
        try {
            const docs = await apiRequest("/documents");
            select.innerHTML = '<option value="" disabled selected>Choose a study document...</option>';
            docs.forEach(doc => {
                const opt = document.createElement("option");
                opt.value = doc.id;
                opt.textContent = doc.filename;
                select.appendChild(opt);
            });
        } catch (e) {
            console.warn("Could not load quiz doc selector:", e);
        }
    }
    
    // Load past attempts
    loadQuizAttemptsHistory();
}

async function loadQuizAttemptsHistory() {
    const container = document.getElementById("quiz-history-container");
    if (!container) return;
    
    try {
        const attempts = await apiRequest("/quizzes/attempts");
        cachedQuizAttempts = attempts;
        
        if (!attempts.length) {
            container.innerHTML = `
                <div class="text-center text-muted small py-4">
                    <i class="fa-solid fa-graduation-cap fs-2 mb-2"></i>
                    <p>No assessment attempts logged yet. Complete a quiz to track progress!</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `
            <div class="table-responsive">
                <table class="table table-borderless text-start align-middle">
                    <thead>
                        <tr class="text-muted small border-bottom border-secondary border-opacity-25">
                            <th>Quiz Title</th>
                            <th>Score</th>
                            <th>Time</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${attempts.map(a => {
                            const pct = Math.round((a.score / a.total_questions) * 100);
                            const badgeColor = pct >= 80 ? "text-accent-emerald" : (pct >= 60 ? "text-accent-amber" : "text-accent-rose");
                            return `
                                <tr class="border-bottom border-secondary border-opacity-10">
                                    <td class="fw-bold">${escapeHtml(a.title)}</td>
                                    <td><span class="${badgeColor} fw-bold">${a.score}/${a.total_questions} (${pct}%)</span></td>
                                    <td class="text-muted small">${formatTimerSeconds(a.time_seconds || 0)}</td>
                                    <td class="text-muted small">${new Date(a.taken_at).toLocaleDateString()}</td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        `;
    } catch (e) {
        console.warn("Could not load quiz history:", e);
    }
}

async function startQuizSession(e) {
    e.preventDefault();
    const docId = document.getElementById("quiz-select-doc").value;
    const count = parseInt(document.getElementById("quiz-select-count").value) || 5;
    
    if (!docId) {
        showToast("Please choose a study document first.", "error");
        return;
    }
    
    const startBtn = document.getElementById("btn-start-quiz");
    startBtn.disabled = true;
    startBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Compiling AI Quiz...`;
    
    try {
        const payload = {
            document_id: parseInt(docId),
            num_questions: count,
            gemini_key: getGeminiKey()
        };
        
        const quizData = await apiRequest("/quizzes/generate", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        
        activeQuiz = quizData;
        currentQuestionIndex = 0;
        quizScore = 0;
        quizSecondsElapsed = 0;
        
        document.getElementById("quiz-setup-view").classList.add("hidden");
        document.getElementById("quiz-results-screen").classList.add("hidden");
        document.getElementById("quiz-active-screen").classList.remove("hidden");
        
        // Start timer
        clearInterval(quizTimerInterval);
        quizTimerInterval = setInterval(() => {
            quizSecondsElapsed++;
            document.getElementById("quiz-timer-display").textContent = formatTimerSeconds(quizSecondsElapsed);
        }, 1000);
        
        renderActiveQuizQuestion();
    } catch (err) {
        showToast(err.message || "Failed to generate quiz.", "error");
    } finally {
        startBtn.disabled = false;
        startBtn.innerHTML = `<i class="fa-solid fa-play me-2"></i>Compile & Start Quiz`;
    }
}

function renderActiveQuizQuestion() {
    if (!activeQuiz || !activeQuiz.questions.length) return;
    
    const q = activeQuiz.questions[currentQuestionIndex];
    const total = activeQuiz.questions.length;
    quizAnsweredCurrent = false;
    
    document.getElementById("active-quiz-title-text").textContent = activeQuiz.title;
    document.getElementById("quiz-current-num").textContent = currentQuestionIndex + 1;
    document.getElementById("quiz-total-num").textContent = total;
    
    const pct = Math.round(((currentQuestionIndex + 1) / total) * 100);
    document.getElementById("quiz-progress-bar").style.width = `${pct}%`;
    
    document.getElementById("quiz-question-prompt").textContent = q.question;
    
    // Hide feedback banner and disable next btn
    document.getElementById("quiz-feedback-banner").classList.add("hidden");
    document.getElementById("btn-next-question").disabled = true;
    
    const optionsGrid = document.getElementById("quiz-options-grid");
    const letters = ["A", "B", "C", "D", "E"];
    
    optionsGrid.innerHTML = q.options.map((opt, idx) => `
        <button type="button" class="quiz-option-btn" onclick="selectQuizOption(${idx})">
            <span class="opt-letter">${letters[idx] || (idx + 1)}</span>
            <span>${escapeHtml(opt)}</span>
        </button>
    `).join("");
}

function selectQuizOption(selectedIdx) {
    if (quizAnsweredCurrent) return;
    quizAnsweredCurrent = true;
    
    const q = activeQuiz.questions[currentQuestionIndex];
    const chosenOption = q.options[selectedIdx];
    const isCorrect = chosenOption.trim().toLowerCase() === q.correct_answer.trim().toLowerCase();
    
    if (isCorrect) {
        quizScore++;
    }
    
    // Highlight options
    const optionBtns = document.querySelectorAll(".quiz-option-btn");
    optionBtns.forEach((btn, idx) => {
        btn.disabled = true;
        const optText = q.options[idx].trim().toLowerCase();
        if (optText === q.correct_answer.trim().toLowerCase()) {
            btn.classList.add("correct");
        } else if (idx === selectedIdx && !isCorrect) {
            btn.classList.add("wrong");
        }
    });
    
    // Show feedback banner
    const banner = document.getElementById("quiz-feedback-banner");
    const badge = document.getElementById("feedback-badge");
    const title = document.getElementById("feedback-status-title");
    const desc = document.getElementById("feedback-explanation-text");
    
    badge.className = `feedback-status-badge ${isCorrect ? 'correct' : 'wrong'}`;
    title.textContent = isCorrect ? "Correct Answer!" : `Incorrect. The correct answer is: ${q.correct_answer}`;
    desc.textContent = q.explanation || "Review this topic in your notes for complete retention.";
    banner.classList.remove("hidden");
    
    // Enable Next Question
    document.getElementById("btn-next-question").disabled = false;
}

function handleNextQuizQuestion() {
    if (currentQuestionIndex < activeQuiz.questions.length - 1) {
        currentQuestionIndex++;
        renderActiveQuizQuestion();
    } else {
        finishQuizSession();
    }
}

async function finishQuizSession() {
    clearInterval(quizTimerInterval);
    document.getElementById("quiz-active-screen").classList.add("hidden");
    document.getElementById("quiz-results-screen").classList.remove("hidden");
    
    const total = activeQuiz.questions.length;
    const pct = Math.round((quizScore / total) * 100);
    
    document.getElementById("result-score-fraction").textContent = `${quizScore}/${total}`;
    document.getElementById("result-score-pct").textContent = `${pct}%`;
    document.getElementById("result-time-spent").textContent = formatTimerSeconds(quizSecondsElapsed);
    
    const rankEl = document.getElementById("result-rank-badge");
    const headingEl = document.getElementById("result-feedback-heading");
    const bodyEl = document.getElementById("result-feedback-body");
    
    if (pct >= 90) {
        rankEl.textContent = "🏆 Rank: Master Specialist (A+)";
        headingEl.textContent = "Flawless Performance!";
        bodyEl.textContent = "You demonstrated comprehensive mastery of the material!";
    } else if (pct >= 70) {
        rankEl.textContent = "⭐ Rank: Proficient Practitioner (B)";
        headingEl.textContent = "Strong Understanding!";
        bodyEl.textContent = "Good retention. Review challenging areas to reach 100%.";
    } else {
        rankEl.textContent = "🌱 Rank: Developing Knowledge";
        headingEl.textContent = "Room for Improvement";
        bodyEl.textContent = "Re-read the AI notes and take the drill again to reinforce memory!";
    }
    
    // Log attempt to backend
    try {
        await apiRequest("/quizzes/attempts", {
            method: "POST",
            body: JSON.stringify({
                quiz_id: activeQuiz.id,
                score: quizScore,
                total_questions: total,
                time_seconds: quizSecondsElapsed
            })
        });
    } catch (e) {
        console.warn("Could not log quiz attempt:", e);
    }
}

function exitQuizToPortal() {
    document.getElementById("quiz-results-screen").classList.add("hidden");
    document.getElementById("quiz-active-screen").classList.add("hidden");
    document.getElementById("quiz-setup-view").classList.remove("hidden");
    loadQuizAttemptsHistory();
}

function formatTimerSeconds(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

// ==========================================
// STUDY PLANNER (Calendar, Tasks, AI Timetable)
// ==========================================

async function loadPlannerData() {
    renderCalendar();
    loadTasks();
}

let selectedCalendarDate = getLocalDateString();

function renderCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthYearDisplay = document.getElementById("calendar-month-year-display");
    if (monthYearDisplay) monthYearDisplay.textContent = `${monthNames[month]} ${year}`;
    
    const grid = document.getElementById("calendar-days-grid");
    if (!grid) return;
    
    grid.innerHTML = "";
    
    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();
    
    const todayStr = getLocalDateString();
    
    // Prev Month Days
    for (let x = firstDayIndex; x > 0; x--) {
        const d = prevLastDay - x + 1;
        grid.innerHTML += `<div class="cal-day-cell other-month"><span class="cal-day-num">${d}</span></div>`;
    }
    
    // Current Month Days
    for (let i = 1; i <= lastDay; i++) {
        const dateStr = `${year}-${(month + 1).toString().padStart(2, "0")}-${i.toString().padStart(2, "0")}`;
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedCalendarDate;
        const hasTasks = cachedTasks.some(t => (t.due_date === dateStr || t.schedule_date === dateStr) && !t.is_completed);
        
        grid.innerHTML += `
            <div class="cal-day-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''}" onclick="openDateTasks('${dateStr}')">
                <span class="cal-day-num">${i}</span>
                ${hasTasks ? '<span class="cal-task-dot"></span>' : ''}
            </div>
        `;
    }

    renderCalendarSelectedDateTasks(selectedCalendarDate);
}

function navigateCalendarMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    renderCalendar();
}

function goToCurrentCalendarMonth() {
    currentCalendarDate = new Date();
    selectedCalendarDate = getLocalDateString();
    renderCalendar();
}

function openDateTasks(dateStr) {
    selectedCalendarDate = dateStr;
    const inputDue = document.getElementById("task-input-due");
    if (inputDue) inputDue.value = dateStr;
    renderCalendar();
}

function renderCalendarSelectedDateTasks(dateStr) {
    const titleEl = document.getElementById("cal-selected-date-title");
    const countEl = document.getElementById("cal-selected-date-count");
    const listEl = document.getElementById("cal-selected-date-list");
    if (!listEl) return;

    if (!dateStr) dateStr = getLocalDateString();
    const todayStr = getLocalDateString();
    
    // Format human readable date title
    const dObj = new Date(dateStr + "T00:00:00");
    const monthName = dObj.toLocaleDateString("en-US", { month: "short" });
    const dayNum = dObj.getDate();
    const yearNum = dObj.getFullYear();
    let dateLabel = `${monthName} ${dayNum}, ${yearNum}`;
    if (dateStr === todayStr) {
        dateLabel = `Today (${monthName} ${dayNum})`;
    } else {
        const tom = new Date();
        tom.setDate(tom.getDate() + 1);
        const tomStr = `${tom.getFullYear()}-${(tom.getMonth() + 1).toString().padStart(2, '0')}-${tom.getDate().toString().padStart(2, '0')}`;
        if (dateStr === tomStr) dateLabel = `Tomorrow (${monthName} ${dayNum})`;
    }

    if (titleEl) titleEl.textContent = `Tasks for ${dateLabel}`;

    // Filter tasks for this date
    const matchingTasks = cachedTasks.filter(t => {
        if (t.due_date === dateStr || t.schedule_date === dateStr) return true;
        if (dateStr === todayStr && !t.is_completed) {
            if (!t.due_date && (!t.schedule_date || t.schedule_date <= todayStr)) return true;
            if (t.due_date <= todayStr && (t.carry_count > 0 || t.auto_carry === 1)) return true;
        }
        return false;
    });

    if (countEl) countEl.textContent = `${matchingTasks.length} task${matchingTasks.length === 1 ? '' : 's'}`;

    if (matchingTasks.length === 0) {
        listEl.innerHTML = `<li class="cal-date-empty"><i class="fa-regular fa-calendar-xmark me-2 opacity-50"></i>No tasks scheduled for this date.</li>`;
        return;
    }

    listEl.innerHTML = matchingTasks.map(t => {
        const priority = (t.priority || "Medium").toLowerCase();
        const pClass = (priority === 'high' || priority === 'critical') ? 'priority-high' : (priority === 'low' ? 'priority-low' : 'priority-medium');
        const isDone = !!t.is_completed;
        return `
            <li class="cal-date-task-item">
                <span class="cal-task-bullet-dot ${pClass}"></span>
                <span class="cal-date-task-title ${isDone ? 'completed-text' : ''}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
                ${t.parent_title ? `<span class="badge-parent-goal-mini" title="Part of: ${escapeHtml(t.parent_title)}">${escapeHtml(t.parent_title)}</span>` : ''}
                <span class="badge-priority-mini ${pClass}">${escapeHtml(t.priority || 'Medium')}</span>
                ${isDone ? '<i class="fa-solid fa-check text-accent-emerald small me-1" title="Completed"></i>' : ''}
                <button type="button" class="cal-task-edit-btn me-1" onclick="openEditTaskModal(${t.id})" title="Edit Task">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" class="cal-task-del-btn" onclick="deleteTask(${t.id})" title="Delete Task">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </li>
        `;
    }).join("");
}

// ==========================================
// UNTILDO TASKS & DAILY CARRY CONTROLLER
// ==========================================

let activeTaskFilter = "active";

async function loadScheduleTab() {
    await fetchSavedSchedules();
    renderActiveSchedule();
}

async function loadTasks() {
    try {
        const tasks = await apiRequest("/planner/tasks");
        cachedTasks = tasks;
        renderTasksList();
        renderDashboardTasks();
        renderCalendar(); // Update calendar dots
    } catch (e) {
        console.warn("Could not load tasks:", e);
    }
}

function toggleTaskFilterPills() {
    const container = document.getElementById("task-filter-pills-container");
    const btn = document.getElementById("btn-toggle-task-filters");
    if (!container) return;
    const isHidden = container.style.display === "none";
    if (isHidden) {
        container.style.display = "flex";
        if (btn) btn.classList.add("active-opt-btn");
    } else {
        container.style.display = "none";
        if (btn) btn.classList.remove("active-opt-btn");
    }
}

function filterTasks(filterType, btn) {
    activeTaskFilter = filterType;
    document.querySelectorAll(".task-pill").forEach(p => p.classList.remove("active"));
    if (btn) {
        btn.classList.add("active");
    } else {
        // If triggered programmatically, find matching button
        document.querySelectorAll(".task-pill").forEach(p => {
            const oc = p.getAttribute("onclick") || "";
            if (oc.includes(`'${filterType}'`)) p.classList.add("active");
        });
    }
    renderTasksList();
}

function getCategoryIcon(cat) {
    const c = (cat || "General").toLowerCase();
    if (c === "study") return "fa-solid fa-graduation-cap";
    if (c === "work") return "fa-solid fa-briefcase";
    if (c === "personal") return "fa-solid fa-user";
    if (c === "project") return "fa-solid fa-diagram-project";
    if (c === "fitness" || c === "health") return "fa-solid fa-heart-pulse";
    return "fa-solid fa-thumbtack";
}

function renderTasksList() {
    const listEl = document.getElementById("planner-tasks-list");
    if (!listEl) return;
    
    const todayStr = getLocalDateString();
    
    // Active tasks: tasks available right now (due today or earlier, or ongoing). Future tasks are hidden until their date arrives!
    const activeTasks = cachedTasks.filter(t => !t.is_completed && (!t.due_date || t.due_date <= todayStr));
    const activeCount = activeTasks.length;
    
    const carriedTasks = cachedTasks.filter(t => !t.is_completed && ((t.carry_count || 0) > 0 || (t.due_date < todayStr && t.auto_carry === 1)));
    const carriedCount = carriedTasks.length;
    
    const upcomingTasks = cachedTasks.filter(t => !t.is_completed && t.due_date && t.due_date > todayStr);
    const upcomingCount = upcomingTasks.length;
    
    const countEl = document.getElementById("tasks-pending-count");
    if (countEl) countEl.textContent = `${activeCount} active`;
    
    const carriedSubEl = document.getElementById("tasks-carried-count-sub");
    if (carriedSubEl) carriedSubEl.textContent = `${carriedCount} tasks rolling over`;
    
    const carriedBadgeEl = document.getElementById("carried-tasks-badge");
    if (carriedBadgeEl) carriedBadgeEl.textContent = `${carriedCount} Carried Today`;
    
    const pillCarriedEl = document.getElementById("pill-carried-count");
    if (pillCarriedEl) pillCarriedEl.textContent = carriedCount;

    const pillUpcomingEl = document.getElementById("pill-upcoming-count");
    if (pillUpcomingEl) pillUpcomingEl.textContent = upcomingCount;
    
    const sidebarCountEl = document.getElementById("sidebar-task-count");
    if (sidebarCountEl) sidebarCountEl.textContent = activeCount;
    const mobileBottomCountEl = document.getElementById("mobile-bottom-task-count");
    if (mobileBottomCountEl) mobileBottomCountEl.textContent = activeCount;

    // Filter tasks
    let filtered = cachedTasks;
    if (activeTaskFilter === "active" || activeTaskFilter === "today") {
        // Active Tasks: ONLY tasks that are active right now (due today or earlier, or ongoing habits).
        // Future scheduled tasks (due_date > todayStr) stay hidden until that day arrives!
        filtered = cachedTasks.filter(t => !t.is_completed && (!t.due_date || t.due_date <= todayStr));
    } else if (activeTaskFilter === "upcoming") {
        // Tasks scheduled for future dates (e.g. after the 10th)
        filtered = cachedTasks.filter(t => !t.is_completed && t.due_date && t.due_date > todayStr);
    } else if (activeTaskFilter === "carried") {
        filtered = cachedTasks.filter(t => !t.is_completed && (t.carry_count || 0) > 0);
    } else if (activeTaskFilter === "critical") {
        filtered = cachedTasks.filter(t => !t.is_completed && (!t.due_date || t.due_date <= todayStr) && (t.priority === "Critical" || t.priority === "High"));
    } else if (activeTaskFilter === "all") {
        filtered = cachedTasks;
    } else if (activeTaskFilter === "completed") {
        filtered = cachedTasks.filter(t => t.is_completed);
    }
    
    // Partition into 3 Priority Groups (High includes Critical & High)
    const highTasks = filtered.filter(t => {
        const p = (t.priority || '').toLowerCase();
        return p === 'high' || p === 'critical';
    });
    const medTasks = filtered.filter(t => {
        const p = (t.priority || '').toLowerCase();
        return p === 'medium' || !p;
    });
    const lowTasks = filtered.filter(t => {
        const p = (t.priority || '').toLowerCase();
        return p === 'low';
    });

    listEl.innerHTML = `
        <!-- High Priority Category Card -->
        <div class="priority-category-card">
            <div class="priority-card-header">
                <div class="d-flex align-items-center gap-2">
                    <h4 class="priority-group-title text-accent-rose">High Priority</h4>
                </div>
                <span class="priority-count-badge count-high">${highTasks.length}</span>
            </div>
            <div class="priority-tasks-group">
                ${highTasks.length > 0 
                    ? highTasks.map(t => renderTaskItemCard(t, 'high')).join('')
                    : `<div class="priority-empty-state"><i class="fa-regular fa-circle-check me-2 opacity-50"></i>No high priority tasks found</div>`
                }
            </div>
        </div>

        <!-- Medium Priority Category Card -->
        <div class="priority-category-card">
            <div class="priority-card-header">
                <div class="d-flex align-items-center gap-2">
                    <h4 class="priority-group-title text-accent-amber">Medium Priority</h4>
                </div>
                <span class="priority-count-badge count-medium">${medTasks.length}</span>
            </div>
            <div class="priority-tasks-group">
                ${medTasks.length > 0 
                    ? medTasks.map(t => renderTaskItemCard(t, 'medium')).join('')
                    : `<div class="priority-empty-state"><i class="fa-regular fa-circle-check me-2 opacity-50"></i>No medium priority tasks found</div>`
                }
            </div>
        </div>

        <!-- Low Priority Category Card -->
        <div class="priority-category-card">
            <div class="priority-card-header">
                <div class="d-flex align-items-center gap-2">
                    <h4 class="priority-group-title text-accent-emerald">Low Priority</h4>
                </div>
                <span class="priority-count-badge count-low">${lowTasks.length}</span>
            </div>
            <div class="priority-tasks-group">
                ${lowTasks.length > 0 
                    ? lowTasks.map(t => renderTaskItemCard(t, 'low')).join('')
                    : `<div class="priority-empty-state"><i class="fa-regular fa-circle-check me-2 opacity-50"></i>No low priority tasks found</div>`
                }
            </div>
        </div>
    `;
}

function renderTaskItemCard(t, priorityTier) {
    const isCompleted = !!t.is_completed;
    const priority = t.priority || "Medium";
    const category = t.category || "General";
    const catIcon = getCategoryIcon(category);
    const autoCarry = t.auto_carry === undefined || t.auto_carry === null ? 1 : Number(t.auto_carry);
    const carryCount = Number(t.carry_count || 0);
    const todayStr = getLocalDateString();
    const hasDeadline = !!t.due_date && t.due_date.trim() !== "";
    const isOverdue = !isCompleted && hasDeadline && t.due_date < todayStr;
    const isToday = hasDeadline && t.due_date === todayStr;

    // Due date badge (clean, only shows actual deadline dates, no 'Ongoing' text clutter)
    let dueBadgeHtml = '';
    if (!hasDeadline) {
        dueBadgeHtml = '';
    } else if (isToday) {
        dueBadgeHtml = `<span class="badge-due-today"><i class="fa-solid fa-calendar-day me-1"></i>Today</span>`;
    } else if (isOverdue) {
        dueBadgeHtml = `<span class="badge-due-overdue"><i class="fa-solid fa-triangle-exclamation me-1"></i>Overdue (${t.due_date})</span>`;
    } else {
        const dueDateObj = new Date(t.due_date + "T00:00:00");
        const todayDateObj = new Date(todayStr + "T00:00:00");
        const diffDays = Math.round((dueDateObj - todayDateObj) / (1000 * 60 * 60 * 24));
        const relText = diffDays === 1 ? 'Tomorrow' : (diffDays > 1 ? `In ${diffDays} days` : t.due_date);
        dueBadgeHtml = `<span class="badge-due-future" title="Scheduled for ${t.due_date}"><i class="fa-regular fa-clock me-1 text-accent-blue"></i>${relText} (${t.due_date.slice(5)})</span>`;
    }

    // Animated title icon (placed before task title)
    let titleIconHtml = '';
    if (priority === 'Critical' || priority === 'High') {
        titleIconHtml = `<span class="task-priority-icon icon-fire" title="${priority} Priority"><i class="fa-solid fa-fire"></i></span>`;
    } else if (priority === 'Low') {
        titleIconHtml = `<span class="task-priority-icon icon-coffee" title="Low Priority"><i class="fa-solid fa-mug-hot"></i></span>`;
    } else {
        titleIconHtml = `<span class="task-priority-icon icon-lightning" title="Medium Priority"><i class="fa-solid fa-bolt"></i></span>`;
    }

    // Priority badge (text only, no icons — icons are before the title)
    let priorityHtml = '';
    if (priority === 'Critical') {
        priorityHtml = `<span class="priority-tag-critical">Critical</span>`;
    } else if (priority === 'High') {
        priorityHtml = `<span class="priority-tag-high">High</span>`;
    } else if (priority === 'Low') {
        priorityHtml = `<span class="priority-tag-low">Low</span>`;
    } else {
        priorityHtml = `<span class="priority-tag-medium">Medium</span>`;
    }

    // Animated Loop Indicator in Task Card (clean, intuitive visual rollover signal)
    const loopIndicatorHtml = autoCarry === 1
        ? `<button type="button" class="task-loop-indicator active" onclick="toggleTaskCarry(${t.id})" title="Daily Auto-Carry Active: Automatically rolls over each morning until completed (Click to pause)"><i class="fa-solid fa-arrows-rotate loop-spin-icon"></i>${carryCount > 0 ? `<span class="loop-streak-count">${carryCount}d</span>` : ''}</button>`
        : `<button type="button" class="task-loop-indicator inactive" onclick="toggleTaskCarry(${t.id})" title="Daily Rollover Paused (Click to enable)"><i class="fa-solid fa-arrows-rotate loop-spin-icon"></i></button>`;

    // Goal Tracker Box
    let goalHtml = '';
    const goalTarget = Number(t.goal_target || 0);
    const goalCurrent = Number(t.goal_current || 0);
    const goalUnit = t.goal_unit || 'units';
    const goalPeriod = t.goal_period || '';
    if (goalTarget > 0) {
        const percent = Math.min(100, Math.round((goalCurrent / goalTarget) * 100));
        goalHtml = `
            <div class="task-goal-box">
                <div class="task-goal-header">
                    <div class="task-goal-title">
                        <i class="fa-solid fa-bullseye text-accent-blue"></i>
                        <span>Goal: ${goalTarget} ${escapeHtml(goalUnit)}</span>
                    </div>
                    ${goalPeriod ? `<span class="task-goal-pace-pill"><i class="fa-regular fa-clock me-1"></i>${escapeHtml(goalPeriod)}</span>` : ''}
                </div>
                <div class="task-goal-progress-bar">
                    <div class="task-goal-progress-fill" style="width: ${percent}%;"></div>
                </div>
                <div class="task-goal-controls">
                    <span class="task-goal-stats"><strong>${goalCurrent}</strong> / ${goalTarget} ${escapeHtml(goalUnit)} (${percent}%)</span>
                    <div class="task-goal-buttons">
                        <button type="button" class="btn-goal-step" onclick="stepTaskGoal(${t.id}, -1)" title="Decrease 1">-1</button>
                        <button type="button" class="btn-goal-step" onclick="stepTaskGoal(${t.id}, 1)" title="Increase 1">+1</button>
                        <button type="button" class="btn-goal-step" onclick="stepTaskGoal(${t.id}, 5)" title="Increase 5">+5</button>
                        <button type="button" class="btn-goal-step" onclick="promptCustomGoalProgress(${t.id}, ${goalCurrent}, ${goalTarget}, '${escapeHtml(goalUnit)}')" title="Set Progress Number"><i class="fa-solid fa-pen"></i></button>
                    </div>
                </div>
            </div>
        `;
    }

    // Subtasks / Breakdown Parts
    let subtasksHtml = '';
    let subtasksList = [];
    try {
        if (typeof t.subtasks_json === 'string') {
            subtasksList = JSON.parse(t.subtasks_json || '[]');
        } else if (Array.isArray(t.subtasks_json)) {
            subtasksList = t.subtasks_json;
        }
    } catch (e) {
        subtasksList = [];
    }

    if (subtasksList.length > 0) {
        const completedParts = subtasksList.filter(s => s.completed).length;
        const totalParts = subtasksList.length;
        const subtasksItems = subtasksList.map(s => `
            <div class="subtask-item-row">
                <label class="subtask-item-label">
                    <input type="checkbox" class="subtask-item-checkbox" ${s.completed ? 'checked' : ''} onchange="toggleSubtaskDone(${t.id}, ${s.id}, this.checked)">
                    <span class="subtask-item-text ${s.completed ? 'completed-subtask' : ''}">${escapeHtml(s.title)}</span>
                </label>
                <button type="button" class="subtask-del-btn" onclick="deleteSubtask(${t.id}, ${s.id})" title="Remove Part"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `).join('');

        subtasksHtml = `
            <div class="task-subtasks-wrapper">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="small text-muted fw-semibold" style="font-size: 0.72rem;">
                        <i class="fa-solid fa-list-check me-1 text-accent-emerald"></i>Milestones (${completedParts}/${totalParts})
                    </span>
                    <button type="button" class="subtask-add-inline-btn" onclick="promptAddSubtask(${t.id})">
                        <i class="fa-solid fa-plus me-1"></i>Add Part
                    </button>
                </div>
                ${subtasksItems}
            </div>
        `;
    } else {
        subtasksHtml = `
            <div class="mt-1">
                <button type="button" class="subtask-add-inline-btn" onclick="promptAddSubtask(${t.id})">
                    <i class="fa-solid fa-plus me-1"></i>Add parts / steps
                </button>
            </div>
        `;
    }

    const boxClass = priorityTier === 'high' ? 'priority-box-high' : (priorityTier === 'low' ? 'priority-box-low' : 'priority-box-medium');

    return `
        <div class="task-item-card ${boxClass} ${isCompleted ? 'completed' : ''}">
            <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} onchange="toggleTaskDone(${t.id}, this.checked)">
            <div class="task-content-col">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    ${titleIconHtml}
                    <span class="task-title-text">${escapeHtml(t.title)}</span>
                    ${t.parent_title ? `<span class="badge-parent-goal" title="Part of: ${escapeHtml(t.parent_title)}"><i class="fa-solid fa-diagram-project me-1"></i>${escapeHtml(t.parent_title)}</span>` : ''}
                    ${loopIndicatorHtml}
                </div>
                ${t.description ? `<div class="task-desc-text small text-muted mb-1">${escapeHtml(t.description)}</div>` : ''}
                <div class="task-meta-row flex-wrap gap-2 align-items-center mt-1">
                    <span class="badge-task-category"><i class="${catIcon} me-1"></i>${escapeHtml(category)}</span>
                    ${priorityHtml}
                    ${t.schedule_date && t.due_date && t.schedule_date !== t.due_date ? `<span class="badge-task-schedule" title="Starts: ${t.schedule_date}"><i class="fa-regular fa-calendar-check me-1"></i>Start: ${t.schedule_date}</span>` : ''}
                    ${dueBadgeHtml}
                </div>
                ${goalHtml}
                ${subtasksHtml}
            </div>
            <div class="task-actions-col">
                <div class="dropdown task-action-dropdown">
                    <button class="btn-task-menu" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Task actions">
                        <i class="fa-solid fa-ellipsis-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end task-dropdown-menu">
                        <li>
                            <button class="dropdown-item d-flex align-items-center gap-2" onclick="openEditTaskModal(${t.id})">
                                <i class="fa-solid fa-pen-to-square text-accent-blue"></i>
                                <span>Edit Task</span>
                            </button>
                        </li>
                        <li>
                            <button class="dropdown-item d-flex align-items-center gap-2" onclick="toggleTaskCarry(${t.id})">
                                <i class="fa-solid fa-arrows-rotate text-accent-purple"></i>
                                <span>${(t.auto_carry === undefined || t.auto_carry === null || t.auto_carry === 1) ? 'Pause Daily Carry' : 'Enable Daily Carry'}</span>
                            </button>
                        </li>
                        <li><hr class="dropdown-divider my-1"></li>
                        <li>
                            <button class="dropdown-item d-flex align-items-center gap-2 text-accent-rose" onclick="deleteTask(${t.id})">
                                <i class="fa-solid fa-trash-can"></i>
                                <span>Delete Task</span>
                            </button>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    `;
}

function renderDashboardTasks() {
    const listEl = document.getElementById("dash-today-tasks-list");
    const legacyListEl = document.getElementById("dash-recent-tasks");
    if (!listEl && !legacyListEl) return;
    
    const todayStr = getLocalDateString();
    const pendingTasks = cachedTasks.filter(t => !t.is_completed);
    const carriedTasks = cachedTasks.filter(t => !t.is_completed && ((t.carry_count || 0) > 0 || (t.due_date && t.due_date < todayStr)));
    
    // Update dashboard KPI cards
    const dashTasksEl = document.getElementById("dash-stat-tasks");
    if (dashTasksEl) dashTasksEl.textContent = pendingTasks.length;
    
    const dashCarriedEl = document.getElementById("dash-stat-carried");
    if (dashCarriedEl) dashCarriedEl.textContent = carriedTasks.length;
    
    const dashPillEl = document.getElementById("dash-carried-pill");
    if (dashPillEl) dashPillEl.textContent = `${carriedTasks.length} Carried`;

    const sidebarCountEl = document.getElementById("sidebar-task-count");
    if (sidebarCountEl) sidebarCountEl.textContent = pendingTasks.length;
    const mobileBottomCountEl = document.getElementById("mobile-bottom-task-count");
    if (mobileBottomCountEl) mobileBottomCountEl.textContent = pendingTasks.length;

    // Filter today's tasks + carried tasks + active ongoing goals
    const todayList = cachedTasks.filter(t => !t.is_completed && (
        t.due_date === todayStr || 
        (t.carry_count || 0) > 0 || 
        (!t.due_date && t.auto_carry === 1) ||
        (t.due_date && t.due_date < todayStr)
    )).slice(0, 6);
    
    const renderHtml = (!todayList.length)
        ? `
            <div class="empty-placeholder py-4 text-center">
                <i class="fa-solid fa-circle-check text-accent-emerald mb-2 fs-3"></i>
                <p class="text-muted mb-0 fw-semibold">All targets completed for today!</p>
                <span class="text-muted small">Click "+ New Task" in the top bar to create a task.</span>
            </div>
        `
        : todayList.map(t => {
            const isCompleted = !!t.is_completed;
            const priority = t.priority || "Medium";
            const carryCount = Number(t.carry_count || 0);
            const hasDeadline = !!t.due_date && t.due_date.trim() !== "";
            const isCarried = carryCount > 0 || (hasDeadline && t.due_date < todayStr);
            const autoCarry = t.auto_carry === undefined || t.auto_carry === null ? 1 : Number(t.auto_carry);
            const goalTarget = Number(t.goal_target || 0);
            const goalCurrent = Number(t.goal_current || 0);
            const goalUnit = t.goal_unit || 'units';

            const loopIndicatorHtml = autoCarry === 1
                ? `<button type="button" class="task-loop-indicator active" onclick="toggleTaskCarry(${t.id})" title="Daily Auto-Carry Active: Automatically rolls over each morning (Click to pause)"><i class="fa-solid fa-arrows-rotate loop-spin-icon"></i>${carryCount > 0 ? `<span class="loop-streak-count">${carryCount}d</span>` : ''}</button>`
                : `<button type="button" class="task-loop-indicator inactive" onclick="toggleTaskCarry(${t.id})" title="Daily Rollover Paused (Click to enable)"><i class="fa-solid fa-arrows-rotate loop-spin-icon"></i></button>`;

            let dueBadge = '';
            if (hasDeadline) {
                dueBadge = `<span class="badge-due-today">${t.due_date === todayStr ? 'Today' : t.due_date}</span>`;
            }

            return `
                <div class="dash-task-item">
                    <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} onchange="toggleTaskDone(${t.id}, this.checked)">
                    <div class="dash-task-info">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            ${priority.toLowerCase() === 'high' || priority.toLowerCase() === 'critical' ? '<span class="task-priority-icon icon-fire"><i class="fa-solid fa-fire"></i></span>' : (priority.toLowerCase() === 'low' ? '<span class="task-priority-icon icon-coffee"><i class="fa-solid fa-mug-hot"></i></span>' : '<span class="task-priority-icon icon-lightning"><i class="fa-solid fa-bolt"></i></span>')}
                            <span class="dash-task-title ${isCompleted ? 'completed-text' : ''}">${escapeHtml(t.title)}</span>
                            ${t.parent_title ? `<span class="badge-parent-goal" style="font-size:0.68rem; padding: 1px 6px;" title="Part of: ${escapeHtml(t.parent_title)}"><i class="fa-solid fa-diagram-project me-1"></i>${escapeHtml(t.parent_title)}</span>` : ''}
                            ${loopIndicatorHtml}
                        </div>
                        <div class="dash-task-tags">
                            <span class="priority-tag-${priority.toLowerCase()}">
                                ${priority}
                            </span>
                            ${dueBadge}
                            ${goalTarget > 0 ? `<span class="task-goal-pace-pill"><i class="fa-solid fa-bullseye me-1"></i>${goalCurrent}/${goalTarget} ${escapeHtml(goalUnit)}</span>` : ''}
                        </div>
                    </div>
                    <div class="dropdown task-action-dropdown">
                        <button class="btn-task-menu" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Task actions">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end task-dropdown-menu">
                            <li>
                                <button class="dropdown-item d-flex align-items-center gap-2" onclick="openEditTaskModal(${t.id})">
                                    <i class="fa-solid fa-pen-to-square text-accent-blue"></i>
                                    <span>Edit Task</span>
                                </button>
                            </li>
                            <li>
                                <button class="dropdown-item d-flex align-items-center gap-2" onclick="toggleTaskCarry(${t.id})">
                                    <i class="fa-solid fa-arrows-rotate text-accent-purple"></i>
                                    <span>${autoCarry === 1 ? 'Pause Daily Carry' : 'Enable Daily Carry'}</span>
                                </button>
                            </li>
                            <li><hr class="dropdown-divider my-1"></li>
                            <li>
                                <button class="dropdown-item d-flex align-items-center gap-2 text-accent-rose" onclick="deleteTask(${t.id})">
                                    <i class="fa-solid fa-trash-can"></i>
                                    <span>Delete Task</span>
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            `;
        }).join("");

    if (listEl) {
        listEl.innerHTML = renderHtml;
        const upcomingCount = cachedTasks.filter(t => !t.is_completed && t.due_date && t.due_date > todayStr).length;
        if (upcomingCount > 0) {
            listEl.innerHTML += `
                <div class="dash-upcoming-hint mt-2 py-2 px-3 rounded glassmorphism d-flex justify-content-between align-items-center" style="background: rgba(56, 189, 248, 0.04); border: 1px dashed rgba(56, 189, 248, 0.25);">
                    <span class="small text-muted" style="font-size: 0.78rem;">
                        <i class="fa-regular fa-clock text-accent-blue me-2"></i><strong>${upcomingCount} upcoming task${upcomingCount > 1 ? 's' : ''}</strong> scheduled for future dates.
                    </span>
                    <button type="button" class="btn btn-sm btn-glass text-accent-blue py-0 px-2 small" onclick="switchTab('planner'); filterTasks('upcoming', null);">View Upcoming</button>
                </div>
            `;
        }
    }
    if (legacyListEl) legacyListEl.innerHTML = renderHtml;
}

function setTaskDateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    
    const dueInp = document.getElementById("task-input-due");
    if (dueInp) {
        dueInp.disabled = false;
        dueInp.value = dateStr;
    }
    const noDeadline = document.getElementById("task-no-deadline");
    if (noDeadline) noDeadline.checked = false;
    updateDateRelativeHint(dateStr);
}

function updateDateRelativeHint(dateVal) {
    const hintEl = document.getElementById("task-date-relative-hint");
    if (!hintEl) return;
    if (!dateVal) {
        hintEl.innerHTML = `<i class="fa-solid fa-circle-info me-1 opacity-50"></i>Ongoing task with no specific deadline.`;
        return;
    }
    const todayStr = getLocalDateString();
    if (dateVal === todayStr) {
        hintEl.innerHTML = `<span class="text-accent-emerald"><i class="fa-solid fa-circle-check me-1"></i>Scheduled for <strong>Today</strong>. Will appear immediately on your daily agenda.</span>`;
    } else if (dateVal < todayStr) {
        hintEl.innerHTML = `<span class="text-accent-rose"><i class="fa-solid fa-triangle-exclamation me-1"></i>Date is in the past. It will carry forward to today automatically.</span>`;
    } else {
        const dObj = new Date(dateVal + "T00:00:00");
        const tObj = new Date(todayStr + "T00:00:00");
        const diff = Math.round((dObj - tObj) / (1000 * 60 * 60 * 24));
        const label = diff === 1 ? 'Tomorrow' : `In ${diff} days`;
        hintEl.innerHTML = `<span class="text-accent-blue"><i class="fa-solid fa-moon me-1"></i><strong>Stays hidden until ${dateVal} (${label})</strong>. Once ${dateVal} arrives, it automatically appears on your daily agenda and stays active until completed.</span>`;
    }
}

function toggleOptionSection(name) {
    const sectionMap = {
        'schedule': { sec: document.getElementById('opt-section-schedule'), btn: document.getElementById('btn-toggle-schedule') },
        'deadline': { sec: document.getElementById('opt-section-deadline'), btn: document.getElementById('btn-toggle-deadline') },
        'goal': { sec: document.getElementById('opt-section-goal'), btn: document.getElementById('btn-toggle-goal') },
        'milestones': { sec: document.getElementById('opt-section-milestones'), btn: document.getElementById('btn-toggle-milestones') }
    };
    const item = sectionMap[name];
    if (!item || !item.sec) return;
    const isOpen = item.sec.style.display !== 'none';
    if (isOpen) {
        item.sec.style.display = 'none';
        if (item.btn) item.btn.classList.remove('active-opt-btn');
    } else {
        item.sec.style.display = 'block';
        if (item.btn) item.btn.classList.add('active-opt-btn');
        if (name === 'schedule') {
            const dueInp = document.getElementById('task-input-due');
            if (dueInp && !dueInp.value) {
                dueInp.value = getLocalDateString();
            }
            updateDateRelativeHint(dueInp ? dueInp.value : '');
        } else if (name === 'milestones') {
            const cont = document.getElementById('modal-subtasks-container');
            if (cont && cont.children.length === 0) {
                addModalSubtaskInput();
            }
        }
    }
}

function togglePartOptions(isChecked) {
    const container = document.getElementById("task-part-options");
    if (!container) return;
    container.style.display = isChecked ? "block" : "none";
    if (isChecked) {
        const datalist = document.getElementById("parent-goals-datalist");
        if (datalist && Array.isArray(cachedTasks)) {
            const uniqueParents = [...new Set(cachedTasks.map(t => t.parent_title).filter(p => !!p && p.trim() !== ''))];
            datalist.innerHTML = uniqueParents.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');
        }
    }
}

let activeFollowUpParentTask = null;

function openNextGoalModal(task) {
    activeFollowUpParentTask = task;
    const modalEl = document.getElementById("nextGoalModal");
    if (!modalEl) return;

    const parentTitle = task.parent_title || task.title;
    const completedEl = document.getElementById("next-goal-completed-task-title");
    if (completedEl) completedEl.textContent = task.title;
    const parentEl = document.getElementById("next-goal-parent-title");
    if (parentEl) parentEl.textContent = parentTitle;

    const suggestedTitle = generateNextStepTitle(task.title);
    const inputTitle = document.getElementById("next-goal-input-title");
    if (inputTitle) {
        inputTitle.value = suggestedTitle;
        inputTitle.placeholder = `e.g. Next step for ${parentTitle}`;
    }

    setNextGoalDateOffset(0);

    const bsModal = new bootstrap.Modal(modalEl);
    bsModal.show();
}

function generateNextStepTitle(title) {
    if (!title) return "";
    // 1. Pages X to Y or Pages X-Y
    const pagesRegex = /(pages?|pp\.?)\s*(\d+)\s*(?:to|-)\s*(\d+)/i;
    const pagesMatch = title.match(pagesRegex);
    if (pagesMatch) {
        const prefix = pagesMatch[1];
        const start = parseInt(pagesMatch[2], 10);
        const end = parseInt(pagesMatch[3], 10);
        const diff = Math.max(1, end - start + 1);
        const nextStart = end + 1;
        const nextEnd = end + diff;
        return title.replace(pagesRegex, `${prefix} ${nextStart} to ${nextEnd}`);
    }

    // 2. Chapter / Part / Section / Step / Unit / Lesson N
    const numRegex = /\b(chapter|ch\.?|part|step|section|module|lesson|unit)\s*(\d+)\b/i;
    const numMatch = title.match(numRegex);
    if (numMatch) {
        const prefix = numMatch[1];
        const currentNum = parseInt(numMatch[2], 10);
        return title.replace(numRegex, `${prefix} ${currentNum + 1}`);
    }

    // 3. Standalone trailing number e.g. "Proposal Draft 1" -> "Proposal Draft 2"
    const endNumRegex = /(\d+)$/;
    const endNumMatch = title.trim().match(endNumRegex);
    if (endNumMatch) {
        const n = parseInt(endNumMatch[1], 10);
        return title.trim().replace(endNumRegex, String(n + 1));
    }

    return `Next part of ${title}`;
}

function setNextGoalDateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dueInp = document.getElementById("next-goal-input-due");
    if (dueInp) dueInp.value = dateStr;
}

async function submitNextStepGoal() {
    if (!activeFollowUpParentTask) return;
    const title = document.getElementById("next-goal-input-title")?.value.trim();
    if (!title) {
        showToast("Please enter the next step name.", "warning");
        return;
    }
    const dueDate = document.getElementById("next-goal-input-due")?.value || getLocalDateString();
    const parentTitle = activeFollowUpParentTask.parent_title || activeFollowUpParentTask.title;

    try {
        await apiRequest("/planner/tasks", {
            method: "POST",
            body: JSON.stringify({
                title: title,
                parent_title: parentTitle,
                category: activeFollowUpParentTask.category || "Study",
                priority: activeFollowUpParentTask.priority || "Medium",
                auto_carry: 1,
                next_goal_prompt: 1,
                due_date: dueDate,
                schedule_date: dueDate
            })
        });
        const modalEl = document.getElementById("nextGoalModal");
        if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
        showToast(`🚀 Next step created: "${title}" for ${parentTitle}!`, "success");
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to schedule next step.", "error");
    }
}

function finishEntireBiggerGoal() {
    const modalEl = document.getElementById("nextGoalModal");
    if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
    const parentTitle = activeFollowUpParentTask?.parent_title || activeFollowUpParentTask?.title || "Goal";
    showToast(`🏆 Congratulations! Master Goal "${parentTitle}" marked fully accomplished!`, "success");
    activeFollowUpParentTask = null;
}

function addModalSubtaskInput(initialText = '') {
    const container = document.getElementById("modal-subtasks-container");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "modal-subtask-row";
    div.innerHTML = `
        <i class="fa-solid fa-circle-dot text-muted small"></i>
        <input type="text" class="form-control form-control-sm custom-input modal-subtask-input" placeholder="e.g. Chapter 1, or Pages 1-10..." value="${escapeHtml(initialText)}">
        <button type="button" class="btn btn-sm btn-glass text-accent-rose py-0 px-2" onclick="this.parentElement.remove()" title="Remove part"><i class="fa-solid fa-xmark"></i></button>
    `;
    container.appendChild(div);
    const input = div.querySelector('input');
    if (input) input.focus();
}

async function stepTaskGoal(taskId, delta) {
    try {
        const res = await apiRequest(`/tasks/${taskId}/goal-progress`, {
            method: "POST",
            body: JSON.stringify({ delta })
        });
        if (res.is_completed) {
            showToast("🎉 Goal completed! Great job!", "success");
        }
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to update progress.", "error");
    }
}

async function promptCustomGoalProgress(taskId, current, target, unit) {
    const val = prompt(`Set progress for this task (Goal: ${target} ${unit}):`, current);
    if (val === null) return;
    const num = parseInt(val);
    if (isNaN(num) || num < 0) return;
    try {
        const res = await apiRequest(`/tasks/${taskId}/goal-progress`, {
            method: "POST",
            body: JSON.stringify({ current: num })
        });
        if (res.is_completed) {
            showToast("🎉 Goal completed! Great job!", "success");
        }
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to update progress.", "error");
    }
}

async function toggleSubtaskDone(taskId, subtaskId, isDone) {
    const task = cachedTasks.find(t => t.id === taskId);
    if (!task) return;
    let subtasks = [];
    try {
        subtasks = typeof task.subtasks_json === 'string' ? JSON.parse(task.subtasks_json || '[]') : (task.subtasks_json || []);
    } catch (e) { subtasks = []; }
    
    const item = subtasks.find(s => s.id === subtaskId);
    if (item) {
        item.completed = isDone;
    }
    
    const allDone = subtasks.length > 0 && subtasks.every(s => s.completed);
    
    try {
        await apiRequest(`/planner/tasks/${taskId}`, {
            method: "PUT",
            body: JSON.stringify({
                subtasks_json: JSON.stringify(subtasks),
                is_completed: allDone ? 1 : task.is_completed
            })
        });
        if (allDone && !task.is_completed) {
            showToast("🎉 All parts completed!", "success");
        }
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to update milestone.", "error");
    }
}

async function promptAddSubtask(taskId) {
    const title = prompt("Enter new part / milestone (e.g. Chapter 2, or Pages 20-30):");
    if (!title || !title.trim()) return;
    const task = cachedTasks.find(t => t.id === taskId);
    if (!task) return;
    let subtasks = [];
    try {
        subtasks = typeof task.subtasks_json === 'string' ? JSON.parse(task.subtasks_json || '[]') : (task.subtasks_json || []);
    } catch (e) { subtasks = []; }
    
    const nextId = (subtasks.reduce((max, s) => Math.max(max, s.id || 0), 0) || 0) + 1;
    subtasks.push({ id: nextId, title: title.trim(), completed: false });
    
    try {
        await apiRequest(`/planner/tasks/${taskId}`, {
            method: "PUT",
            body: JSON.stringify({ subtasks_json: JSON.stringify(subtasks) })
        });
        showToast("Part added!", "success");
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to add milestone.", "error");
    }
}

async function deleteSubtask(taskId, subtaskId) {
    const task = cachedTasks.find(t => t.id === taskId);
    if (!task) return;
    let subtasks = [];
    try {
        subtasks = typeof task.subtasks_json === 'string' ? JSON.parse(task.subtasks_json || '[]') : (task.subtasks_json || []);
    } catch (e) { subtasks = []; }
    
    subtasks = subtasks.filter(s => s.id !== subtaskId);
    
    try {
        await apiRequest(`/planner/tasks/${taskId}`, {
            method: "PUT",
            body: JSON.stringify({ subtasks_json: JSON.stringify(subtasks) })
        });
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to remove milestone.", "error");
    }
}

let isCreatingTask = false;
let editingTaskId = null;

function resetTaskModal() {
    editingTaskId = null;
    const form = document.getElementById("add-task-form");
    if (form) form.reset();

    const titleEl = document.getElementById("addTaskModalLabel");
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-plus-circle text-accent-blue me-2"></i>Add Task`;

    const saveBtn = document.getElementById("btn-save-task");
    if (saveBtn) saveBtn.textContent = "Create Task";

    const deleteBtn = document.getElementById("btn-delete-task-modal");
    if (deleteBtn) {
        deleteBtn.classList.add("d-none");
        deleteBtn.style.display = "none";
    }

    ['schedule', 'deadline', 'goal', 'milestones'].forEach(sec => {
        const el = document.getElementById(`opt-section-${sec}`);
        if (el) el.style.display = "none";
        const btn = document.getElementById(`btn-toggle-${sec}`);
        if (btn) btn.classList.remove('active-opt-btn');
    });

    const subContainer = document.getElementById("modal-subtasks-container");
    if (subContainer) subContainer.innerHTML = "";

    const partCheckbox = document.getElementById("task-is-part");
    if (partCheckbox) partCheckbox.checked = false;

    const partOpts = document.getElementById("task-part-options");
    if (partOpts) partOpts.style.display = "none";
}

let pendingDeleteTaskId = null;

function promptDeleteTask(taskId) {
    if (!taskId) return;
    pendingDeleteTaskId = Number(taskId);
    const task = cachedTasks.find(t => t.id === pendingDeleteTaskId || t.id === taskId);
    const taskTitle = task && task.title ? task.title : "this task";

    const descEl = document.getElementById("confirm-delete-task-desc");
    if (descEl) {
        descEl.innerHTML = `Are you sure you want to delete <strong class="text-white">"${escapeHtml(taskTitle)}"</strong>?<br><span class="text-muted" style="font-size:0.75rem;">This action cannot be undone.</span>`;
    }

    const modalEl = document.getElementById("confirmDeleteTaskModal");
    if (modalEl) {
        const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
        bsModal.show();
    }
}

function deleteTaskFromModal(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (!editingTaskId) {
        console.warn("deleteTaskFromModal called without editingTaskId");
        return;
    }
    promptDeleteTask(editingTaskId);
}

async function executeConfirmedDelete() {
    if (!pendingDeleteTaskId) return;
    const idToDelete = pendingDeleteTaskId;
    pendingDeleteTaskId = null;

    // 1. Hide confirmation modal
    const confirmModalEl = document.getElementById("confirmDeleteTaskModal");
    if (confirmModalEl) {
        const bsModal = bootstrap.Modal.getInstance(confirmModalEl) || bootstrap.Modal.getOrCreateInstance(confirmModalEl);
        if (bsModal) bsModal.hide();
    }

    // 2. If edit modal is open, hide it too
    const editModalEl = document.getElementById("addTaskModal");
    if (editModalEl) {
        const bsEditModal = bootstrap.Modal.getInstance(editModalEl) || bootstrap.Modal.getOrCreateInstance(editModalEl);
        if (bsEditModal) bsEditModal.hide();
    }
    resetTaskModal();

    // 3. Delete the task
    await deleteTask(idToDelete, true);
}

function openEditTaskModal(taskId) {
    const task = cachedTasks.find(t => t.id === taskId);
    if (!task) {
        showToast("Task not found.", "error");
        return;
    }

    resetTaskModal();
    editingTaskId = taskId;

    // Change modal title and submit button
    const titleEl = document.getElementById("addTaskModalLabel");
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen-to-square text-accent-blue me-2"></i>Edit Task`;

    const saveBtn = document.getElementById("btn-save-task");
    if (saveBtn) saveBtn.textContent = "Save Changes";

    // Show delete button in edit mode
    const deleteBtn = document.getElementById("btn-delete-task-modal");
    if (deleteBtn) {
        deleteBtn.classList.remove("d-none");
        deleteBtn.style.display = "inline-flex";
    }

    // Fill standard fields
    const titleInput = document.getElementById("task-input-title");
    if (titleInput) titleInput.value = task.title || "";

    const categoryInput = document.getElementById("task-input-category");
    if (categoryInput) categoryInput.value = task.category || "General";

    const priorityInput = document.getElementById("task-input-priority");
    if (priorityInput) priorityInput.value = task.priority || "Medium";

    const descInput = document.getElementById("task-input-desc");
    if (descInput) descInput.value = task.description || "";

    const autoCarryInput = document.getElementById("task-input-autocarry");
    if (autoCarryInput) autoCarryInput.checked = (task.auto_carry === undefined || task.auto_carry === null || task.auto_carry === 1);

    // Schedule / Appear Date
    if (task.schedule_date) {
        const schedSec = document.getElementById("opt-section-schedule");
        const schedBtn = document.getElementById("btn-toggle-schedule");
        if (schedSec) schedSec.style.display = "block";
        if (schedBtn) schedBtn.classList.add("active-opt-btn");
        const schedInput = document.getElementById("task-input-due");
        if (schedInput) {
            schedInput.value = task.schedule_date;
            updateDateRelativeHint(task.schedule_date);
        }
    }

    // Deadline / Due Date
    if (task.due_date && task.due_date !== task.schedule_date) {
        const deadSec = document.getElementById("opt-section-deadline");
        const deadBtn = document.getElementById("btn-toggle-deadline");
        if (deadSec) deadSec.style.display = "block";
        if (deadBtn) deadBtn.classList.add("active-opt-btn");
        const deadInput = document.getElementById("task-input-deadline");
        if (deadInput) deadInput.value = task.due_date;
    } else if (task.due_date && !task.schedule_date) {
        // If only due_date is set, show schedule section for it
        const schedSec = document.getElementById("opt-section-schedule");
        const schedBtn = document.getElementById("btn-toggle-schedule");
        if (schedSec) schedSec.style.display = "block";
        if (schedBtn) schedBtn.classList.add("active-opt-btn");
        const schedInput = document.getElementById("task-input-due");
        if (schedInput) {
            schedInput.value = task.due_date;
            updateDateRelativeHint(task.due_date);
        }
    }

    // Goal Tracker
    if (task.goal_target && Number(task.goal_target) > 0) {
        const goalSec = document.getElementById("opt-section-goal");
        const goalBtn = document.getElementById("btn-toggle-goal");
        if (goalSec) goalSec.style.display = "block";
        if (goalBtn) goalBtn.classList.add("active-opt-btn");
        
        const targetInp = document.getElementById("task-goal-target");
        if (targetInp) targetInp.value = task.goal_target;
        const currentInp = document.getElementById("task-goal-current");
        if (currentInp) currentInp.value = task.goal_current || 0;
        const unitInp = document.getElementById("task-goal-unit");
        if (unitInp) unitInp.value = task.goal_unit || "";
        const periodInp = document.getElementById("task-goal-period");
        if (periodInp) periodInp.value = task.goal_period || "";
    }

    // Milestones / Subtasks
    let subtasks = [];
    try {
        subtasks = typeof task.subtasks_json === "string" ? JSON.parse(task.subtasks_json || "[]") : (task.subtasks_json || []);
    } catch (e) { subtasks = []; }

    if (subtasks && subtasks.length > 0) {
        const msSec = document.getElementById("opt-section-milestones");
        const msBtn = document.getElementById("btn-toggle-milestones");
        if (msSec) msSec.style.display = "block";
        if (msBtn) msBtn.classList.add("active-opt-btn");
        subtasks.forEach(s => addModalSubtaskInput(s.title || ""));
    }

    // Master / Bigger Goal link
    if (task.parent_title) {
        const partCheckbox = document.getElementById("task-is-part");
        if (partCheckbox) {
            partCheckbox.checked = true;
            togglePartOptions(true);
        }
        const parentInput = document.getElementById("task-parent-title");
        if (parentInput) parentInput.value = task.parent_title;
        const nextPromptInp = document.getElementById("task-next-prompt");
        if (nextPromptInp) nextPromptInp.checked = (task.next_goal_prompt === 1);
    }

    const modalEl = document.getElementById("addTaskModal");
    if (modalEl) {
        const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
        bsModal.show();
    }
}

async function handleAddTask(e) {
    if (e) e.preventDefault();
    if (isCreatingTask) return;
    isCreatingTask = true;
    
    let title = document.getElementById("task-input-title")?.value.trim() || "";
    const description = document.getElementById("task-input-desc")?.value.trim() || "";
    const priority = document.getElementById("task-input-priority")?.value || "Medium";
    const category = document.getElementById("task-input-category")?.value || "General";
    const autoCarry = document.getElementById("task-input-autocarry")?.checked ? 1 : 0;
    
    // Check collapsible date sections
    const scheduleSectionOpen = document.getElementById("opt-section-schedule")?.style.display !== "none";
    const scheduleDate = scheduleSectionOpen ? (document.getElementById("task-input-due")?.value || "") : "";
    
    const deadlineSectionOpen = document.getElementById("opt-section-deadline")?.style.display !== "none";
    const deadlineDate = deadlineSectionOpen ? (document.getElementById("task-input-deadline")?.value || "") : "";
    
    // Standard due_date used across the app
    const dueDate = deadlineDate || scheduleDate || "";

    // Bigger Task / Sub-Part Linking
    const isPart = document.getElementById("task-is-part")?.checked;
    let parentTitle = "";
    let nextGoalPrompt = 0;
    if (isPart) {
        parentTitle = document.getElementById("task-parent-title")?.value.trim() || "";
        const partDetails = document.getElementById("task-part-details")?.value.trim() || "";
        if (partDetails && !title) {
            title = partDetails;
        } else if (partDetails && title && !parentTitle) {
            parentTitle = title;
            title = partDetails;
        }
        nextGoalPrompt = document.getElementById("task-next-prompt")?.checked ? 1 : 0;
    }

    if (!title) {
        showToast("Please enter a task title.", "warning");
        isCreatingTask = false;
        return;
    }

    // Goal tracker fields
    const goalSectionOpen = document.getElementById("opt-section-goal")?.style.display !== "none";
    let goal_target = 0;
    let goal_current = 0;
    let goal_unit = "";
    let goal_period = "";
    if (goalSectionOpen) {
        goal_target = parseInt(document.getElementById("task-goal-target")?.value) || 0;
        goal_current = parseInt(document.getElementById("task-goal-current")?.value) || 0;
        goal_unit = document.getElementById("task-goal-unit")?.value.trim() || "";
        goal_period = document.getElementById("task-goal-period")?.value.trim() || "";
    }
    
    // Read subtasks
    const milestonesSectionOpen = document.getElementById("opt-section-milestones")?.style.display !== "none";
    const subtasks = [];
    if (milestonesSectionOpen) {
        const subtaskInputs = document.querySelectorAll("#modal-subtasks-container .modal-subtask-input");
        subtaskInputs.forEach((inp, idx) => {
            const val = inp.value.trim();
            if (val) {
                subtasks.push({ id: idx + 1, title: val, completed: false });
            }
        });
    }

    const payload = {
        title,
        description,
        due_date: dueDate,
        schedule_date: scheduleDate,
        parent_title: parentTitle,
        next_goal_prompt: nextGoalPrompt,
        priority,
        category,
        auto_carry: autoCarry,
        goal_target,
        goal_current,
        goal_unit,
        goal_period,
        subtasks_json: JSON.stringify(subtasks)
    };

    try {
        if (editingTaskId) {
            await apiRequest(`/planner/tasks/${editingTaskId}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            showToast("Task updated successfully!", "success");
        } else {
            await apiRequest("/planner/tasks", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            showToast("Task & Goal saved to UntilDo!", "success");
        }
        
        const modalEl = document.getElementById("addTaskModal");
        if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
        resetTaskModal();
        
        await loadTasks();
        if (typeof renderCalendar === 'function') {
            renderCalendar();
        }
    } catch (e) {
        showToast(e.message || "Failed to save task.", "error");
    } finally {
        isCreatingTask = false;
    }
}

async function toggleTaskCarry(taskId) {
    try {
        const res = await apiRequest(`/tasks/${taskId}/toggle-carry`, { method: "POST" });
        showToast(res.message || "Auto-carry setting updated.", "info");
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to toggle auto-carry.", "error");
    }
}

async function carryToToday(taskId) {
    try {
        const res = await apiRequest(`/tasks/${taskId}/carry-to-today`, { method: "POST" });
        showToast(res.message || "Task carried forward to today!", "success");
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to carry task.", "error");
    }
}

async function carryAllOverdue() {
    try {
        const res = await apiRequest('/tasks/carry-all-overdue', { method: "POST" });
        showToast(res.message || "Overdue tasks carried forward to today!", "success");
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to carry tasks.", "error");
    }
}

async function toggleTaskDone(taskId, completed) {
    try {
        const task = cachedTasks.find(t => t.id === taskId);
        await apiRequest(`/planner/tasks/${taskId}`, {
            method: "PUT",
            body: JSON.stringify({ is_completed: completed ? 1 : 0 })
        });
        await loadTasks();

        if (completed && task && (task.parent_title || task.next_goal_prompt === 1)) {
            openNextGoalModal(task);
        }
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function deleteTask(taskId, skipConfirm = false) {
    if (!taskId) return;
    if (!skipConfirm) {
        promptDeleteTask(taskId);
        return;
    }
    const numId = Number(taskId);

    // Optimistic UI update: immediately remove from cachedTasks and refresh UI components
    cachedTasks = cachedTasks.filter(t => t.id !== numId && t.id !== taskId);
    renderTasksList();
    renderDashboardTasks();
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }

    try {
        await apiRequest(`/planner/tasks/${taskId}`, { method: "DELETE" });
        showToast("Task deleted successfully.", "info");
    } catch (e) {
        showToast(e.message || "Failed to delete task.", "error");
    } finally {
        await loadTasks();
    }
}

// ==========================================
// AI SCHEDULE GENERATOR & 7-DAY WORKSPACE CONTROLLER
// ==========================================
let lastGeneratedScheduleData = null;
let scheduleDraftData = null;
let cachedSchedules = [];
let activeFollowSchedule = JSON.parse(localStorage.getItem("aether_active_schedule") || "null");
let selectedScheduleDayIndex = -1;

function getTodayScheduleDayIndex(days) {
    if (!days || !days.length) return 0;
    
    // 1. Try matching exact date string or is_today flag
    const todayStr = getLocalDateString();
    const dateMatchIdx = days.findIndex(d => (d.date && d.date === todayStr) || d.is_today === true);
    if (dateMatchIdx !== -1) return dateMatchIdx;

    // 2. Try matching weekday name (e.g. "Monday", "Mon")
    const now = new Date();
    const currentWeekdayLong = now.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const currentWeekdayShort = now.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
    
    const weekdayMatchIdx = days.findIndex(d => {
        const text = ((d.day || "") + " " + (d.topic || "")).toLowerCase();
        return text.includes(currentWeekdayLong) || text.includes(currentWeekdayShort);
    });
    if (weekdayMatchIdx !== -1) return weekdayMatchIdx;

    return 0;
}

function switchScheduleView(viewName) {
    const btnActive = document.getElementById("sched-capsule-btn-active");
    const btnImport = document.getElementById("sched-capsule-btn-import");
    const btnSaved = document.getElementById("sched-capsule-btn-saved");

    const viewActive = document.getElementById("sched-view-active");
    const viewImport = document.getElementById("sched-view-import");
    const viewSaved = document.getElementById("sched-view-saved");

    if (btnActive) btnActive.classList.toggle("active", viewName === "active");
    if (btnImport) btnImport.classList.toggle("active", viewName === "import");
    if (btnSaved) btnSaved.classList.toggle("active", viewName === "saved");

    if (viewActive) viewActive.classList.toggle("hidden", viewName !== "active");
    if (viewImport) viewImport.classList.toggle("hidden", viewName !== "import");
    if (viewSaved) viewSaved.classList.toggle("hidden", viewName !== "saved");

    const todayStr = getLocalDateString();

    if (viewName === "active") {
        renderActiveSchedule();
    } else if (viewName === "saved") {
        fetchSavedSchedules();
    } else if (viewName === "import") {
        const titleInput = document.getElementById("schedule-import-title");
        if (titleInput && !titleInput.value) {
            titleInput.value = `Study Routine (${todayStr})`;
        }
        const dateInput = document.getElementById("schedule-import-start-date");
        if (dateInput && !dateInput.value) {
            dateInput.value = todayStr;
        }
        const textInput = document.getElementById("schedule-import-text");
        if (textInput) textInput.focus();
    }
}

function setImportStartDateOffset(daysOffset) {
    const today = new Date();
    today.setDate(today.getDate() + daysOffset);
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const targetDateStr = `${yyyy}-${mm}-${dd}`;

    const importDateInput = document.getElementById("schedule-import-start-date");
    if (importDateInput) importDateInput.value = targetDateStr;

    const draftDateInput = document.getElementById("sched-draft-start-date");
    if (draftDateInput) draftDateInput.value = targetDateStr;

    if (scheduleDraftData && scheduleDraftData.length) {
        recalculateDraftDates(targetDateStr);
    }
}

function recalculateDraftDates(startDateStr) {
    if (!scheduleDraftData || !scheduleDraftData.length) return;
    const todayStr = getLocalDateString();
    const baseDateStr = startDateStr || todayStr;
    const parts = baseDateStr.split("-").map(Number);

    scheduleDraftData.forEach((d, i) => {
        const dObj = new Date(parts[0], parts[1] - 1, parts[2] + i);
        const yyyy = dObj.getFullYear();
        const mm = String(dObj.getMonth() + 1).padStart(2, "0");
        const dd = String(dObj.getDate()).padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const weekday = dObj.toLocaleDateString("en-US", { weekday: "short" });
        const monthDay = dObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

        d.date = dateStr;
        d.day = `Day ${i + 1} (${weekday}, ${monthDay})`;
        d.is_today = (dateStr === todayStr);
    });

    renderScheduleDraftPreview(scheduleDraftData, false);
}

function addDraftDay() {
    if (!scheduleDraftData) scheduleDraftData = [];
    const newIdx = scheduleDraftData.length;
    const startDateInput = document.getElementById("sched-draft-start-date") || document.getElementById("schedule-import-start-date");
    const baseDateStr = (startDateInput && startDateInput.value) || getLocalDateString();
    const todayStr = getLocalDateString();

    const parts = baseDateStr.split("-").map(Number);
    const dObj = new Date(parts[0], parts[1] - 1, parts[2] + newIdx);
    const yyyy = dObj.getFullYear();
    const mm = String(dObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dObj.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const weekday = dObj.toLocaleDateString("en-US", { weekday: "short" });
    const monthDay = dObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    scheduleDraftData.push({
        day: `Day ${newIdx + 1} (${weekday}, ${monthDay})`,
        time: "09:00 AM - 11:30 AM",
        subject: "Study Session",
        topic: "Topic to Cover",
        tasks: "Review core notes; Complete practice problems",
        date: dateStr,
        is_today: (dateStr === todayStr)
    });

    renderScheduleDraftPreview(scheduleDraftData, false);
    showToast(`Added Day ${newIdx + 1} (${monthDay}) to plan.`, "info");
}

function removeDraftDay(index) {
    if (!scheduleDraftData || !scheduleDraftData[index]) return;
    scheduleDraftData.splice(index, 1);
    const startDateInput = document.getElementById("sched-draft-start-date") || document.getElementById("schedule-import-start-date");
    const baseDateStr = (startDateInput && startDateInput.value) || getLocalDateString();
    recalculateDraftDates(baseDateStr);
    showToast("Day removed from plan.", "info");
}

function renderScheduleDraftPreview(days, shouldScroll = true) {
    const container = document.getElementById("sched-preview-container");
    const cardsEl = document.getElementById("sched-draft-cards");
    const titleInput = document.getElementById("sched-draft-title");
    const dateInput = document.getElementById("sched-draft-start-date");
    const importDateInput = document.getElementById("schedule-import-start-date");
    if (!container || !cardsEl) return;

    const todayStr = getLocalDateString();
    const activeStartDate = (dateInput && dateInput.value) || (importDateInput && importDateInput.value) || (days[0] && days[0].date) || todayStr;

    if (titleInput && !titleInput.value) {
        titleInput.value = `Study Plan (${todayStr})`;
    }
    if (dateInput) {
        dateInput.value = activeStartDate;
    }

    cardsEl.innerHTML = days.map((d, index) => {
        let dayHeader = `Day ${index + 1}`;
        let dateBadge = "";
        if (d.date) {
            const parts = d.date.split("-").map(Number);
            const dt = new Date(parts[0], parts[1] - 1, parts[2]);
            dateBadge = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        } else if (d.day) {
            dateBadge = d.day;
        }

        const isToday = (d.date && d.date === todayStr) || d.is_today;
        const currentSubject = d.subject || "";
        const currentTopic = d.topic || "";
        const currentTasks = d.tasks || "";
        const currentTime = d.time || "09:00 AM - 11:30 AM";

        return `
            <div class="col-12 col-md-6 col-lg-4">
                <div class="sched-draft-card ${isToday ? 'today-highlight' : ''}">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <div class="d-flex align-items-center gap-1">
                            <span class="sched-draft-badge"><i class="fa-regular fa-calendar-days text-accent-blue me-1"></i>${escapeHtml(dayHeader)}</span>
                            ${isToday ? '<span class="badge bg-primary text-white" style="font-size:0.62rem; padding: 2px 6px;">TODAY</span>' : ''}
                        </div>
                        <div class="d-flex align-items-center gap-1">
                            <span class="text-muted small" style="font-size:0.7rem;">${escapeHtml(dateBadge)}</span>
                            <button type="button" class="btn btn-sm btn-link text-danger p-0 ms-1 text-decoration-none" onclick="removeDraftDay(${index})" title="Delete Day">
                                <i class="fa-solid fa-trash-can" style="font-size:0.75rem;"></i>
                            </button>
                        </div>
                    </div>
                    <div class="mb-2">
                        <label class="text-muted small mb-1" style="font-size: 0.72rem;">Time Slot</label>
                        <input type="text" class="form-control sched-draft-input" value="${escapeHtml(currentTime)}" 
                            placeholder="e.g. 09:00 AM - 11:30 AM" onchange="updateDraftDayField(${index}, 'time', this.value)">
                    </div>
                    <div class="mb-2">
                        <label class="text-muted small mb-1" style="font-size: 0.72rem;">Subject</label>
                        <input type="text" class="form-control sched-draft-input" value="${escapeHtml(currentSubject)}" 
                            placeholder="e.g. Mathematics" onchange="updateDraftDayField(${index}, 'subject', this.value)">
                    </div>
                    <div class="mb-2">
                        <label class="text-muted small mb-1" style="font-size: 0.72rem;">Focus Topic (appears as task title)</label>
                        <input type="text" class="form-control sched-draft-input" value="${escapeHtml(currentTopic)}" 
                            placeholder="e.g. Linear Algebra & Matrices" onchange="updateDraftDayField(${index}, 'topic', this.value)">
                    </div>
                    <div class="mb-1 flex-grow-1">
                        <label class="text-muted small mb-1" style="font-size: 0.72rem;">Action Tasks (semicolon or line separated subtasks)</label>
                        <textarea class="form-control sched-draft-input sched-draft-textarea" rows="2" 
                            placeholder="e.g. Read chapters 3-4; Complete 5 practice questions; Review formulas" onchange="updateDraftDayField(${index}, 'tasks', this.value)">${escapeHtml(currentTasks)}</textarea>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    container.classList.remove("hidden");
    if (shouldScroll) {
        container.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function updateDraftDayField(dayIndex, field, value) {
    if (!scheduleDraftData || !scheduleDraftData[dayIndex]) return;
    scheduleDraftData[dayIndex][field] = value.trim();
}

function discardScheduleDraft() {
    scheduleDraftData = null;
    const container = document.getElementById("sched-preview-container");
    if (container) container.classList.add("hidden");
    showToast("Draft timetable discarded.", "info");
}

async function applyScheduleDraft() {
    if (!scheduleDraftData || !scheduleDraftData.length) {
        showToast("No draft schedule to apply.", "error");
        return;
    }

    const titleInput = document.getElementById("sched-draft-title");
    const startDateInput = document.getElementById("sched-draft-start-date") || document.getElementById("schedule-import-start-date");
    const planTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : `Custom Routine (${new Date().toLocaleDateString()})`;
    const startDate = (startDateInput && startDateInput.value) || getLocalDateString();

    // Ensure dates reflect latest start date choice
    const baseParts = startDate.split("-").map(Number);
    const todayStr = getLocalDateString();
    scheduleDraftData.forEach((d, i) => {
        const dObj = new Date(baseParts[0], baseParts[1] - 1, baseParts[2] + i);
        const yyyy = dObj.getFullYear();
        const mm = String(dObj.getMonth() + 1).padStart(2, "0");
        const dd = String(dObj.getDate()).padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const weekday = dObj.toLocaleDateString("en-US", { weekday: "short" });
        const monthDay = dObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        d.date = dateStr;
        d.day = `Day ${i + 1} (${weekday}, ${monthDay})`;
        d.is_today = (dateStr === todayStr);
    });

    let savedId = null;
    try {
        const saveRes = await apiRequest("/schedules", {
            method: "POST",
            body: JSON.stringify({
                title: planTitle,
                schedule_data: scheduleDraftData,
                start_date: startDate,
                convert_to_tasks: true
            })
        });
        if (saveRes && saveRes.id) savedId = saveRes.id;
    } catch (e) {
        console.warn("Could not save schedule draft to DB:", e);
    }

    activeFollowSchedule = {
        id: savedId,
        title: planTitle,
        schedule_data: scheduleDraftData,
        completedDays: [],
        completedTasksMap: {},
        created_at: new Date().toISOString()
    };
    lastGeneratedScheduleData = scheduleDraftData;
    localStorage.setItem("aether_active_schedule", JSON.stringify(activeFollowSchedule));

    selectedScheduleDayIndex = getTodayScheduleDayIndex(scheduleDraftData);

    const container = document.getElementById("sched-preview-container");
    if (container) container.classList.add("hidden");

    switchScheduleView("active");
    renderActiveSchedule();
    fetchSavedSchedules();
    loadTasks();
    showToast(`"${planTitle}" applied! Topics are now active on your Tasks page.`, "success");
}

// ==========================================
// CHATGPT & GEMINI TIMETABLE IMPORT SUITE
// ==========================================

function copySchedulePromptTemplate() {
    const text = `Create a 7-day study timetable for [my subjects]. For each day include: Day, Time slot, Subject, Focus Topic, and Action tasks checklist.`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast("Prompt copied to clipboard! Paste it into ChatGPT or Gemini.", "success");
        }).catch(() => {
            showToast("Prompt ready: Paste into Gemini or ChatGPT!", "info");
        });
    } else {
        showToast("Prompt: Paste into Gemini or ChatGPT!", "info");
    }
}

function loadSampleImportTimetable() {
    const sample = `### Day 1 (Monday)
- Time: 09:00 AM - 11:30 AM
- Subject: Python Core
- Topic: Asynchronous Programming (async/await)
- Tasks: Study Event Loop; Build async web client; Solve 3 coding drills

### Day 2 (Tuesday)
- Time: 10:00 AM - 12:30 PM
- Subject: FastAPI & Backend
- Topic: RESTful APIs & Pydantic Validation
- Tasks: Define schema models; Implement CRUD endpoints; Add error handling

### Day 3 (Wednesday)
- Time: 02:00 PM - 04:30 PM
- Subject: Database Architecture
- Topic: PostgreSQL & SQLAlchemy Async
- Tasks: Setup migrations; Write relational queries; Optimize indexes

### Day 4 (Thursday)
- Time: 09:30 AM - 12:00 PM
- Subject: Frontend & JavaScript
- Topic: Modern UI & State Architecture
- Tasks: Build responsive layout; Wire API calls; Test error states

### Day 5 (Friday)
- Time: 02:30 PM - 05:00 PM
- Subject: Machine Learning Fundamentals
- Topic: Model Evaluation & Metrics
- Tasks: Precision/Recall analysis; Train baseline classifier; Plot confusion matrix

### Day 6 (Saturday)
- Time: 10:00 AM - 01:00 PM
- Subject: Capstone Project
- Topic: End-to-End System Integration
- Tasks: Connect backend with frontend; Run test suite; Benchmark performance

### Day 7 (Sunday)
- Time: 03:00 PM - 05:00 PM
- Subject: Weekly Review & Retrospective
- Topic: Knowledge Consolidation & Planning
- Tasks: Review weekly flashcards; Identify knowledge gaps; Plan next sprint`;

    const txt = document.getElementById("schedule-import-text");
    const titleInput = document.getElementById("schedule-import-title");
    if (txt) txt.value = sample;
    if (titleInput && (!titleInput.value || titleInput.value.startsWith("Imported Routine"))) {
        titleInput.value = "Full-Stack & ML Sprint Routine";
    }
    showToast("Loaded sample 7-day timetable! Click 'Parse & Preview' or 'Direct Import' to test.", "info");
}

function normalizeScheduleItemsClient(items, startDateStr) {
    const todayStr = getLocalDateString();
    const baseDateStr = startDateStr || (document.getElementById("schedule-import-start-date")?.value) || todayStr;
    const baseParts = baseDateStr.split("-").map(Number);

    return items.map((it, i) => {
        const dObj = new Date(baseParts[0], baseParts[1] - 1, baseParts[2] + i);
        const yyyy = dObj.getFullYear();
        const mm = String(dObj.getMonth() + 1).padStart(2, "0");
        const dd = String(dObj.getDate()).padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const weekdayShort = dObj.toLocaleDateString("en-US", { weekday: "short" });
        const monthDay = dObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

        let dayStr = `Day ${i + 1} (${weekdayShort}, ${monthDay})`;

        const timeStr = String(it.time || it.time_slot || it.slot || it.hours || "09:00 AM - 11:30 AM").trim();
        const subjStr = String(it.subject || it.course || it.area || it.category || "General Study").trim();
        const topicStr = String(it.topic || it.module || it.chapter || it.focus || subjStr).trim();
        
        let tasksStr = "Review core notes; Complete practice exercises; Summarize key takeaways";
        const rawTasks = it.tasks || it.action_items || it.task || it.description || it.activities;
        if (Array.isArray(rawTasks)) {
            tasksStr = rawTasks.map(t => String(t).trim()).filter(Boolean).join("; ");
        } else if (rawTasks) {
            tasksStr = String(rawTasks).trim();
        }

        return {
            day: dayStr,
            time: timeStr,
            subject: subjStr,
            topic: topicStr,
            tasks: tasksStr,
            date: dateStr,
            is_today: (dateStr === todayStr)
        };
    });
}

function parseMarkdownTableClient(text, startDateStr) {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.includes("|"));
    if (lines.length < 2) return null;

    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split("|").slice(1, -1).map(c => c.trim().toLowerCase());
        if (cells.some(h => ["day", "time", "subject", "topic", "task", "tasks", "focus", "date"].includes(h))) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) {
        const cells = lines[0].split("|").slice(1, -1).map(c => c.trim().toLowerCase());
        if (cells.length >= 2) headerIdx = 0;
        else return null;
    }

    const headers = lines[headerIdx].split("|").slice(1, -1).map(c => c.trim().toLowerCase());
    const colMap = {};
    headers.forEach((col, idx) => {
        if (col.includes("day") || col.includes("date")) colMap.day = idx;
        else if (col.includes("time") || col.includes("hour") || col.includes("slot")) colMap.time = idx;
        else if (col.includes("subj") || col.includes("course") || col.includes("area") || col.includes("category")) colMap.subject = idx;
        else if (col.includes("top") || col.includes("chap") || col.includes("modul") || col.includes("focus") || col.includes("concept")) colMap.topic = idx;
        else if (col.includes("task") || col.includes("activ") || col.includes("desc") || col.includes("detail") || col.includes("action") || col.includes("work")) colMap.tasks = idx;
    });

    const rows = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\|?\s*:?-+:?\s*\|/.test(line)) continue;
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        if (!cells.length || cells.every(c => c === "")) continue;

        const getCell = (f, def) => (colMap[f] !== undefined && cells[colMap[f]]) ? cells[colMap[f]] : def;
        rows.push({
            day: getCell("day", `Day ${rows.length + 1}`),
            time: getCell("time", "09:00 AM - 11:30 AM"),
            subject: getCell("subject", "General Study"),
            topic: getCell("topic", getCell("subject", "General Study")),
            tasks: getCell("tasks", "Review key concepts; Complete practice problems")
        });
    }

    return rows.length ? normalizeScheduleItemsClient(rows, startDateStr) : null;
}

function parseDayBlocksClient(text, startDateStr) {
    const dayRegex = /(?:^|\n)(?:#{1,4}\s*|\*{1,2}\s*)?((?:Day\s*\d+(?:\s*\(.*?\))?|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*\(.*?\))?))[:\s\-\–]*(.*?)(?=\n(?:#{1,4}\s*|\*{1,2}\s*)?(?:Day\s*\d+|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b|$)/gis;
    
    const matches = [...text.matchAll(dayRegex)];
    if (!matches.length) return null;

    const daysData = [];
    for (const m of matches) {
        const rawDayName = m[1].trim();
        const blockContent = m[2].trim();
        const lines = blockContent.split("\n").map(l => l.trim()).filter(Boolean);

        let timeSlot = "09:00 AM - 11:30 AM";
        let subject = "";
        let topic = "";
        const tasksList = [];

        const timeMatch = blockContent.match(/(?:Time(?:\s*Slot)?\s*[:\-]\s*)?(\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b)/i);
        if (timeMatch) timeSlot = timeMatch[1].trim();

        for (const line of lines) {
            const lineClean = line.replace(/^[*\-#\s•+]+/, "").trim();
            const subM = lineClean.match(/^(?:Subject|Course|Module|Area)\s*[:\-]\s*(.*)$/i);
            if (subM) { subject = subM[1].trim(); continue; }

            const topM = lineClean.match(/^(?:Topic|Focus|Chapter)\s*[:\-]\s*(.*)$/i);
            if (topM) { topic = topM[1].trim(); continue; }

            const taskM = lineClean.match(/^(?:Tasks?|Action Items?|Checklist|Activities?)\s*[:\-]\s*(.*)$/i);
            if (taskM) { if (taskM[1].trim()) tasksList.push(taskM[1].trim()); continue; }

            if (/^[-*•+]\s/.test(line) || /^\d+\.\s/.test(line)) {
                if (!/^(?:Time|Subject|Topic)\s*:/i.test(lineClean)) {
                    if (lineClean.includes("|")) {
                        const parts = lineClean.split("|").map(p => p.trim());
                        if (parts.length >= 2) {
                            if (!subject) subject = parts[0];
                            if (!topic) topic = parts[1];
                            if (parts.length >= 3) tasksList.push(parts[2]);
                            continue;
                        }
                    }
                    tasksList.push(lineClean);
                }
            } else if (!subject && lineClean.length < 60 && !/\d{1,2}:\d{2}/.test(lineClean)) {
                if (lineClean.includes("-")) {
                    const sp = lineClean.split("-");
                    subject = sp[0].trim();
                    topic = sp.slice(1).join("-").trim();
                } else {
                    subject = lineClean;
                }
            }
        }

        if (!subject) subject = topic ? topic : "Study Session";
        if (!topic) topic = subject;
        const tasksStr = tasksList.length ? tasksList.join("; ") : "Review core concepts; Solve practice problems";

        daysData.push({
            day: rawDayName,
            time: timeSlot,
            subject: subject,
            topic: topic,
            tasks: tasksStr
        });
    }

    return daysData.length ? normalizeScheduleItemsClient(daysData, startDateStr) : null;
}

function parseCompactLinesClient(text, startDateStr) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const items = [];

    for (const line of lines) {
        const m = line.match(/^(?:[#*\-\d.]*\s*)?(Day\s*\d+(?:\s*\(.*?\))?|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*\(.*?\))?)[\s:\-\–|]+(.*)$/i);
        if (!m) continue;
        const dayName = m[1].trim();
        let rest = m[2].trim();
        if (!rest) continue;

        let timeSlot = "09:00 AM - 11:30 AM";
        const timeM = rest.match(/\(?(\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b)\)?/i);
        if (timeM) {
            timeSlot = timeM[1].trim();
            rest = rest.replace(timeM[0], " ").trim();
        }

        const chunks = rest.split(/\s*\|\s*|\s+[-–:]\s*|:\s+/).map(c => c.trim()).filter(Boolean);
        let subject = "General Study";
        let topic = "Daily Study Session";
        let tasks = "Review key concepts and complete practice exercises";

        if (chunks.length === 1) {
            subject = chunks[0];
            topic = chunks[0];
        } else if (chunks.length === 2) {
            subject = chunks[0];
            topic = chunks[1];
        } else if (chunks.length >= 3) {
            subject = chunks[0];
            topic = chunks[1];
            tasks = chunks.slice(2).join("; ");
        }

        items.push({
            day: dayName,
            time: timeSlot,
            subject: subject,
            topic: topic,
            tasks: tasks
        });
    }

    return items.length ? normalizeScheduleItemsClient(items, startDateStr) : null;
}

function parseTimetableClientSide(rawText, startDateStr) {
    if (!rawText || !rawText.trim()) return [];
    const text = rawText.trim();

    // 1. JSON candidate
    let jsonCandidate = null;
    if (text.includes("```")) {
        const m = text.match(/```(?:json)?\s*(\[\s*\{.*?\}\s*\])\s*```/s);
        if (m) jsonCandidate = m[1];
    }
    if (!jsonCandidate) {
        const m = text.match(/(\[\s*\{.*?\}\s*\])/s);
        if (m) jsonCandidate = m[1];
    }
    if (jsonCandidate) {
        try {
            const data = JSON.parse(jsonCandidate);
            if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
                return normalizeScheduleItemsClient(data, startDateStr);
            }
        } catch (e) {}
    }

    // 2. Markdown Table
    const tableRes = parseMarkdownTableClient(text, startDateStr);
    if (tableRes && tableRes.length) return tableRes;

    // 3. Sub bullets check
    const hasSubBullets = /\n\s*[-*•+]\s*(?:Time|Subject|Topic|Task|\w+)/i.test(text);
    if (hasSubBullets) {
        const blockRes = parseDayBlocksClient(text, startDateStr);
        if (blockRes && blockRes.length) return blockRes;
    }

    // 4. Compact lines
    const lineRes = parseCompactLinesClient(text, startDateStr);
    if (lineRes && lineRes.length) return lineRes;

    // 5. Day blocks fallback
    const blockFallback = parseDayBlocksClient(text, startDateStr);
    if (blockFallback && blockFallback.length) return blockFallback;

    return [];
}

async function parseAndPreviewImportedSchedule() {
    const textInput = document.getElementById("schedule-import-text");
    const titleInput = document.getElementById("schedule-import-title");
    const dateInput = document.getElementById("schedule-import-start-date");
    const rawText = textInput ? textInput.value.trim() : "";
    if (!rawText) {
        showToast("Please paste your timetable text first.", "error");
        if (textInput) textInput.focus();
        return;
    }

    const startDate = (dateInput && dateInput.value) || getLocalDateString();

    const btn = document.getElementById("btn-parse-preview");
    const originalBtnHtml = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Parsing...`;
    }

    let parsedDays = [];
    const defaultTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : `Imported Routine (${new Date().toLocaleDateString()})`;

    try {
        const payload = {
            raw_text: rawText,
            title: defaultTitle,
            gemini_key: getGeminiKey(),
            start_date: startDate,
            save_immediately: false,
            convert_to_tasks: false
        };
        const res = await apiRequest("/schedules/parse-text", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        if (res && res.schedule_data && res.schedule_data.length) {
            parsedDays = res.schedule_data;
        }
    } catch (err) {
        console.warn("Backend parse endpoint issue, attempting client-side fallback:", err);
    }

    // Client-side fallback if backend parse returned no days
    if (!parsedDays || !parsedDays.length) {
        parsedDays = parseTimetableClientSide(rawText, startDate);
    }

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
    }

    if (!parsedDays || !parsedDays.length) {
        showToast("Could not recognize a timetable format. Make sure the text includes days (e.g. Day 1, Monday), a schedule table, or bullet points.", "error");
        return;
    }

    scheduleDraftData = parsedDays;
    lastGeneratedScheduleData = parsedDays;

    const draftTitleEl = document.getElementById("sched-draft-title");
    if (draftTitleEl) {
        draftTitleEl.value = defaultTitle;
    }
    const draftDateEl = document.getElementById("sched-draft-start-date");
    if (draftDateEl) {
        draftDateEl.value = startDate;
    }

    renderScheduleDraftPreview(scheduleDraftData);
    showToast(`Parsed ${parsedDays.length} sessions starting ${startDate}! Review each day below and click "Apply Schedule".`, "success");
}

async function handleImportSchedule(e) {
    if (e && e.preventDefault) e.preventDefault();

    const textInput = document.getElementById("schedule-import-text");
    const titleInput = document.getElementById("schedule-import-title");
    const dateInput = document.getElementById("schedule-import-start-date");
    const toTasksCheck = document.getElementById("schedule-import-to-tasks");
    const convertToTasks = toTasksCheck ? toTasksCheck.checked : true;

    const rawText = textInput ? textInput.value.trim() : "";
    if (!rawText) {
        showToast("Please paste your timetable text before importing.", "error");
        if (textInput) textInput.focus();
        return;
    }

    const startDate = (dateInput && dateInput.value) || getLocalDateString();
    const planTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : `Imported Routine (${new Date().toLocaleDateString()})`;

    const submitBtn = document.getElementById("btn-import-schedule-submit");
    const origBtnHtml = submitBtn ? submitBtn.innerHTML : "";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Importing Timetable...`;
    }

    let parsedDays = [];
    let savedId = null;

    try {
        const payload = {
            raw_text: rawText,
            title: planTitle,
            gemini_key: getGeminiKey(),
            start_date: startDate,
            save_immediately: true,
            convert_to_tasks: convertToTasks
        };
        const res = await apiRequest("/schedules/parse-text", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        if (res && res.schedule_data && res.schedule_data.length) {
            parsedDays = res.schedule_data;
            savedId = res.saved_id;
        }
    } catch (err) {
        console.warn("Backend direct import error, trying client-side parse fallback:", err);
    }

    // Client-side fallback if needed
    if (!parsedDays || !parsedDays.length) {
        parsedDays = parseTimetableClientSide(rawText, startDate);
        if (parsedDays && parsedDays.length) {
            try {
                const saveRes = await apiRequest("/schedules", {
                    method: "POST",
                    body: JSON.stringify({
                        title: planTitle,
                        schedule_data: parsedDays,
                        start_date: startDate,
                        convert_to_tasks: convertToTasks
                    })
                });
                if (saveRes && saveRes.id) savedId = saveRes.id;
            } catch (err) {}
        }
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnHtml;
    }

    if (!parsedDays || !parsedDays.length) {
        showToast("Could not recognize a timetable format. Make sure the text includes days (e.g. Day 1, Monday), a schedule table, or bullet points.", "error");
        return;
    }

    // Set as active timetable
    activeFollowSchedule = {
        id: savedId,
        title: planTitle,
        schedule_data: parsedDays,
        completedDays: [],
        completedTasksMap: {},
        created_at: new Date().toISOString()
    };
    lastGeneratedScheduleData = parsedDays;
    localStorage.setItem("aether_active_schedule", JSON.stringify(activeFollowSchedule));

    selectedScheduleDayIndex = getTodayScheduleDayIndex(parsedDays);

    // Hide preview container if open
    const previewContainer = document.getElementById("sched-preview-container");
    if (previewContainer) previewContainer.classList.add("hidden");

    // Switch to active roadmap view
    switchScheduleView("active");
    renderActiveSchedule();
    fetchSavedSchedules();

    if (convertToTasks) {
        await loadTasks();
        showToast(`Imported "${planTitle}" (${parsedDays.length} days) starting ${startDate} and synced topics to your Tasks page!`, "success");
    } else {
        showToast(`Imported "${planTitle}" (${parsedDays.length} days) directly into your Roadmap!`, "success");
    }
}

async function saveGeneratedSchedule() {
    if (!lastGeneratedScheduleData && (!activeFollowSchedule || !activeFollowSchedule.schedule_data)) {
        showToast("No active timetable to save.", "error");
        return;
    }
    const scheduleData = lastGeneratedScheduleData || activeFollowSchedule.schedule_data;
    try {
        await apiRequest("/schedules", {
            method: "POST",
            body: JSON.stringify({
                title: activeFollowSchedule?.title || `Weekly Routine (${new Date().toLocaleDateString()})`,
                schedule_data: scheduleData
            })
        });
        showToast("Schedule saved to your account!", "success");
        fetchSavedSchedules();
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function fetchSavedSchedules() {
    try {
        const schedules = await apiRequest("/schedules");
        cachedSchedules = schedules || [];
        const countEl = document.getElementById("saved-schedules-count");
        if (countEl) countEl.textContent = cachedSchedules.length;
        renderSavedSchedulesList();
        return cachedSchedules;
    } catch (e) {
        console.warn("Failed to load saved schedules:", e);
        return [];
    }
}

function openSavedSchedulesModal() {
    fetchSavedSchedules().then(() => {
        const modalEl = document.getElementById("savedSchedulesModal");
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }
    });
}

function renderSavedSchedulesList() {
    const listElModal = document.getElementById("saved-schedules-list");
    const listElInline = document.getElementById("saved-schedules-inline-list");

    const htmlContent = (!cachedSchedules || cachedSchedules.length === 0) ? `
        <div class="col-12 text-center py-5">
            <i class="fa-solid fa-folder-open text-muted fs-1 mb-3"></i>
            <h5 class="text-muted">No Saved Schedules Found</h5>
            <p class="text-muted small mb-4">Generate a 7-day study timetable and click "Save Schedule" to store it for future reference.</p>
            <button class="btn btn-primary-gradient px-4" onclick="switchScheduleView('creator')">
                <i class="fa-solid fa-wand-magic-sparkles me-2"></i>Create 7-Day Timetable
            </button>
        </div>
    ` : cachedSchedules.map(s => {
        const createdDate = new Date(s.created_at || Date.now()).toLocaleDateString();
        const daysCount = s.schedule_data ? s.schedule_data.length : 7;
        const subjectsPreview = s.schedule_data ? [...new Set(s.schedule_data.map(d => d.subject))].join(", ") : "General Study";

        return `
            <div class="col-12 col-md-6">
                <div class="card-panel glassmorphism h-100 p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <h5 class="mb-1 text-accent-purple font-outfit">${escapeHtml(s.title || "Saved Timetable")}</h5>
                            <span class="text-muted small"><i class="fa-regular fa-clock me-1"></i>Saved on ${createdDate} • ${daysCount} Days</span>
                        </div>
                        <button class="btn btn-sm btn-danger-glass px-2 py-1" onclick="deleteSavedSchedule(${s.id})" title="Delete Schedule">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                    <p class="text-muted small mb-3"><strong>Subjects:</strong> ${escapeHtml(subjectsPreview)}</p>
                    <button class="btn btn-sm btn-primary-gradient w-100" onclick="openAndFollowSchedule(${s.id})">
                        <i class="fa-solid fa-play me-1"></i>Open & Follow Schedule
                    </button>
                </div>
            </div>
        `;
    }).join("");

    if (listElModal) listElModal.innerHTML = htmlContent;
    if (listElInline) listElInline.innerHTML = htmlContent;
}

function openAndFollowSchedule(scheduleId) {
    const sched = cachedSchedules.find(s => s.id === scheduleId);
    if (!sched) return;

    activeFollowSchedule = {
        id: sched.id,
        title: sched.title,
        schedule_data: sched.schedule_data,
        completedDays: [],
        created_at: sched.created_at
    };
    localStorage.setItem("aether_active_schedule", JSON.stringify(activeFollowSchedule));

    const modalEl = document.getElementById("savedSchedulesModal");
    if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
    }

    selectedScheduleDayIndex = getTodayScheduleDayIndex(sched.schedule_data);
    switchScheduleView("active");
    switchTab("schedule");
    showToast(`Opened schedule: "${sched.title}"`, "success");
}

function selectScheduleDay(index) {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data) return;
    const days = activeFollowSchedule.schedule_data;
    if (index < 0 || index >= days.length) return;
    selectedScheduleDayIndex = index;
    if (days[index] && days[index].date) {
        selectedScheduleCalendarDate = days[index].date;
        const parts = days[index].date.split("-").map(Number);
        currentScheduleCalendarDate = new Date(parts[0], parts[1] - 1, 1);
    }
    renderWeekCalendarStrip();
    renderExpandedDayWorkspace();
    renderScheduleCalendar();
    renderScheduleCalendarSelectedDate(selectedScheduleCalendarDate);
}

function navigateScheduleDay(direction) {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data) return;
    const days = activeFollowSchedule.schedule_data;
    const newIdx = selectedScheduleDayIndex + direction;
    if (newIdx >= 0 && newIdx < days.length) {
        selectScheduleDay(newIdx);
    }
}

async function syncActiveScheduleToTasks() {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data || !activeFollowSchedule.schedule_data.length) {
        showToast("No active timetable loaded to sync.", "error");
        return;
    }

    try {
        let schedId = activeFollowSchedule.id;
        // If not saved to DB yet, save it first
        if (!schedId) {
            const saveRes = await apiRequest("/schedules", {
                method: "POST",
                body: JSON.stringify({
                    title: activeFollowSchedule.title || `Study Plan (${getLocalDateString()})`,
                    schedule_data: activeFollowSchedule.schedule_data,
                    start_date: activeFollowSchedule.schedule_data[0]?.date || getLocalDateString(),
                    convert_to_tasks: false
                })
            });
            schedId = saveRes.id;
            activeFollowSchedule.id = schedId;
            localStorage.setItem("aether_active_schedule", JSON.stringify(activeFollowSchedule));
        }

        const res = await apiRequest(`/schedules/${schedId}/sync-tasks`, { method: "POST" });
        await loadTasks();
        showToast(res.message || "Schedule topics synced to Tasks page!", "success");
    } catch (e) {
        showToast(e.message || "Failed to sync schedule tasks.", "error");
    }
}

async function addSingleDayToTasks(index) {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data || !activeFollowSchedule.schedule_data[index]) return;
    const d = activeFollowSchedule.schedule_data[index];
    const taskDate = d.date || getLocalDateString();

    const subtasks = d.tasks ? d.tasks.split(/;|\n/).map(t => t.trim().replace(/^[-•*]\s*/, "")).filter(t => t.length > 0).map(t => ({ title: t, completed: false })) : [];

    try {
        await apiRequest("/planner/tasks", {
            method: "POST",
            body: JSON.stringify({
                title: `${d.subject}: ${d.topic}`,
                details: `${d.day || ''} (${d.time || "Scheduled"})\n${d.tasks || ''}`.trim(),
                due_date: taskDate,
                priority: "Medium",
                subtasks_json: JSON.stringify(subtasks),
                schedule_id: activeFollowSchedule.id || null,
                auto_carry: 1
            })
        });
        showToast(`Added "${d.subject}: ${d.topic}" (Due ${taskDate}) to Tasks page!`, "success");
        await loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to add task.", "error");
    }
}

function renderWeekCalendarStrip() {
    const strip = document.getElementById("week-calendar-strip");
    if (!strip || !activeFollowSchedule || !activeFollowSchedule.schedule_data) return;

    const days = activeFollowSchedule.schedule_data;
    const completedDays = activeFollowSchedule.completedDays || [];
    const nextIncompleteIdx = days.findIndex((_, idx) => !completedDays.includes(idx));
    const todayIdx = getTodayScheduleDayIndex(days);
    const todayStr = getLocalDateString();

    strip.innerHTML = days.map((d, index) => {
        const isDone = completedDays.includes(index);
        const isSelected = index === selectedScheduleDayIndex;
        const isFocus = index === nextIncompleteIdx;
        const isToday = (d.date && d.date === todayStr) || d.is_today === true || index === todayIdx;
        
        let dayNum = `Day ${index + 1}`;
        let dateLabel = "";
        if (d.date) {
            const parts = d.date.split("-").map(Number);
            const dt = new Date(parts[0], parts[1] - 1, parts[2]);
            dateLabel = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        } else if (d.day) {
            dateLabel = d.day;
        }

        const topicText = d.topic && d.topic.trim() ? d.topic.trim() : (d.subject || "Study Session");

        return `
            <div class="week-strip-card ${isDone ? 'completed' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today-highlight' : ''}" onclick="selectScheduleDay(${index})">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="strip-day-num">${escapeHtml(dayNum)} ${isToday ? '<span class="badge bg-primary text-white ms-1" style="font-size:0.62rem; padding: 2px 6px;">TODAY</span>' : ''}</span>
                    <span class="strip-status-icon">
                        ${isDone ? '<i class="fa-solid fa-circle-check text-accent-emerald"></i>' : (isFocus ? '<span class="pulse-dot"></span>' : '<i class="fa-regular fa-circle text-muted" style="font-size: 0.72rem; opacity: 0.6;"></i>')}
                    </span>
                </div>
                <div class="text-muted small mb-1" style="font-size: 0.7rem; font-weight: 500;">
                    <i class="fa-regular fa-calendar me-1 text-accent-blue"></i>${escapeHtml(dateLabel)}
                </div>
                <div class="strip-topic-preview" title="${escapeHtml(topicText)}">${escapeHtml(topicText)}</div>
            </div>
        `;
    }).join("");
}

function renderExpandedDayWorkspace() {
    const workspace = document.getElementById("expanded-day-workspace");
    if (!workspace || !activeFollowSchedule || !activeFollowSchedule.schedule_data) return;

    const days = activeFollowSchedule.schedule_data;
    if (selectedScheduleDayIndex < 0 || selectedScheduleDayIndex >= days.length) {
        selectedScheduleDayIndex = 0;
    }

    const d = days[selectedScheduleDayIndex];
    const completedDays = activeFollowSchedule.completedDays || [];
    const isDone = completedDays.includes(selectedScheduleDayIndex);
    const totalDays = days.length;

    let daySubtitle = d.day || `Day ${selectedScheduleDayIndex + 1}`;
    if (d.date) {
        const parts = d.date.split("-").map(Number);
        const dt = new Date(parts[0], parts[1] - 1, parts[2]);
        const fullDateStr = dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        daySubtitle = `${d.day ? d.day + ' • ' : ''}${fullDateStr}`;
    }

    const displayTitle = d.topic && d.topic.trim() ? d.topic.trim() : (d.subject || "Daily Study Session");
    const displaySubject = d.subject || "";

    const rawTasks = d.tasks ? d.tasks.split(/;|\. |\n/).map(t => t.trim().replace(/\.$/, "")).filter(t => t.length > 0) : ["Review key concept notes and fundamentals", "Work through standard practice problems", "Summarize core definitions and takeaways"];

    const completedTasksMap = activeFollowSchedule.completedTasksMap || {};
    const dayCompletedTasks = completedTasksMap[selectedScheduleDayIndex] || [];

    workspace.innerHTML = `
        <div class="day-detail-card p-4">
            <!-- Header Row: Meta + Actions -->
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
                <div>
                    <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
                        <span class="badge ${isDone ? 'badge-completed' : 'badge-in-progress'}">
                            ${isDone ? '<i class="fa-solid fa-check me-1"></i>Completed' : `Day ${selectedScheduleDayIndex + 1} of ${totalDays}`}
                        </span>
                        <span class="text-muted small"><i class="fa-regular fa-clock me-1"></i>${escapeHtml(d.time || "Scheduled")}</span>
                        ${displaySubject ? `<span class="badge badge-subject">${escapeHtml(displaySubject)}</span>` : ''}
                    </div>
                    <h2 class="day-session-title mb-1">
                        ${escapeHtml(displayTitle)}
                    </h2>
                    <p class="text-muted small mb-0"><i class="fa-regular fa-calendar-check me-1 text-accent-blue"></i>${escapeHtml(daySubtitle)}</p>
                </div>
                
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <div class="btn-group me-1">
                        <button class="btn btn-sm btn-glass px-2" onclick="navigateScheduleDay(-1)" ${selectedScheduleDayIndex === 0 ? 'disabled' : ''} title="Previous Day">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <button class="btn btn-sm btn-glass px-2" onclick="navigateScheduleDay(1)" ${selectedScheduleDayIndex === totalDays - 1 ? 'disabled' : ''} title="Next Day">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                    <button class="btn btn-sm ${isDone ? 'btn-outline-success' : 'btn-primary-gradient'} px-3" onclick="toggleScheduleDayDone(${selectedScheduleDayIndex})">
                        <i class="fa-solid ${isDone ? 'fa-rotate-left' : 'fa-circle-check'} me-1"></i>${isDone ? 'Mark Day Pending' : 'Mark Day Done'}
                    </button>
                    <button class="btn btn-sm btn-glass text-accent-purple px-3" onclick="askAiAboutSession(${selectedScheduleDayIndex})">
                        <i class="fa-solid fa-robot me-1"></i>Study with AI
                    </button>
                </div>
            </div>

            <!-- Study Checklist & Milestones -->
            <div class="day-checklist-section pt-3 border-top border-glass">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5 class="fs-6 fw-bold mb-0 text-primary-heading">
                        <i class="fa-solid fa-list-check text-accent-blue me-2"></i>Daily Action Checklist
                    </h5>
                    <button class="btn btn-sm btn-glass text-accent-emerald py-0 px-2 small" onclick="addSingleDayToTasks(${selectedScheduleDayIndex})">
                        <i class="fa-solid fa-plus me-1"></i>Add to Tasks
                    </button>
                </div>

                <div class="day-tasks-list mb-3">
                    ${rawTasks.map((task, i) => {
                        const taskDone = dayCompletedTasks.includes(i) || isDone;
                        return `
                            <label class="day-task-item ${taskDone ? 'done' : ''}" style="cursor: pointer;">
                                <input type="checkbox" class="task-checkbox" ${taskDone ? 'checked' : ''} onchange="toggleScheduleTaskDone(${selectedScheduleDayIndex}, ${i}, ${rawTasks.length})">
                                <span class="day-task-text">${escapeHtml(task)}</span>
                            </label>
                        `;
                    }).join("")}
                </div>

                <!-- AI Study Helper Prompt Bar -->
                <div class="day-ai-prompt-bar d-flex justify-content-between align-items-center flex-wrap gap-2 p-2 px-3 rounded">
                    <span class="small text-muted"><i class="fa-solid fa-lightbulb text-warning me-2"></i>Need guidance, formulas, or practice quiz questions for this session?</span>
                    <button class="btn btn-sm btn-glass text-accent-purple py-1 px-3" onclick="askAiAboutSession(${selectedScheduleDayIndex})">
                        <i class="fa-solid fa-wand-magic-sparkles me-1"></i>Ask AI Assistant
                    </button>
                </div>
            </div>
        </div>
    `;
}

let currentScheduleCalendarDate = new Date();
let selectedScheduleCalendarDate = getLocalDateString();

function navigateScheduleCalendarMonth(direction) {
    currentScheduleCalendarDate.setMonth(currentScheduleCalendarDate.getMonth() + direction);
    renderScheduleCalendar();
}

function goToCurrentScheduleCalendarMonth() {
    currentScheduleCalendarDate = new Date();
    selectedScheduleCalendarDate = getLocalDateString();
    renderScheduleCalendar();
    renderScheduleCalendarSelectedDate(selectedScheduleCalendarDate);

    if (activeFollowSchedule && activeFollowSchedule.schedule_data) {
        const todayIdx = getTodayScheduleDayIndex(activeFollowSchedule.schedule_data);
        if (todayIdx !== -1) {
            selectedScheduleDayIndex = todayIdx;
            renderWeekCalendarStrip();
            renderExpandedDayWorkspace();
        }
    }
}

function selectScheduleCalendarDate(dateStr) {
    selectedScheduleCalendarDate = dateStr;
    renderScheduleCalendar();
    renderScheduleCalendarSelectedDate(dateStr);

    if (activeFollowSchedule && activeFollowSchedule.schedule_data) {
        const idx = activeFollowSchedule.schedule_data.findIndex(d => d.date === dateStr);
        if (idx !== -1) {
            selectedScheduleDayIndex = idx;
            renderWeekCalendarStrip();
            renderExpandedDayWorkspace();
        }
    }
}

function renderScheduleCalendar() {
    const year = currentScheduleCalendarDate.getFullYear();
    const month = currentScheduleCalendarDate.getMonth();

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthYearDisplay = document.getElementById("sched-calendar-month-year-display");
    if (monthYearDisplay) monthYearDisplay.textContent = `${monthNames[month]} ${year}`;

    const grid = document.getElementById("sched-calendar-days-grid");
    if (!grid) return;

    grid.innerHTML = "";

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const prevLastDay = new Date(year, month, 0).getDate();

    const todayStr = getLocalDateString();
    const days = activeFollowSchedule ? activeFollowSchedule.schedule_data || [] : [];
    const completedDays = activeFollowSchedule ? activeFollowSchedule.completedDays || [] : [];

    const scheduleDateMap = {};
    days.forEach((d, idx) => {
        if (d.date) {
            scheduleDateMap[d.date] = {
                session: d,
                index: idx,
                isDone: completedDays.includes(idx)
            };
        }
    });

    // Prev Month Days
    for (let x = firstDayIndex; x > 0; x--) {
        const d = prevLastDay - x + 1;
        grid.innerHTML += `<div class="cal-day-cell other-month"><span class="cal-day-num">${d}</span></div>`;
    }

    // Current Month Days
    for (let i = 1; i <= lastDay; i++) {
        const dateStr = `${year}-${(month + 1).toString().padStart(2, "0")}-${i.toString().padStart(2, "0")}`;
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedScheduleCalendarDate;
        const schedItem = scheduleDateMap[dateStr];

        let indicatorHtml = "";
        if (schedItem) {
            if (schedItem.isDone) {
                indicatorHtml = `<span class="cal-sched-indicator done" title="Completed: ${escapeHtml(schedItem.session.subject || '')}"><i class="fa-solid fa-check"></i></span>`;
            } else {
                indicatorHtml = `<span class="cal-sched-indicator active" title="${escapeHtml(schedItem.session.subject || '')}: ${escapeHtml(schedItem.session.topic || '')}"></span>`;
            }
        }

        const cellClass = `cal-day-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''} ${schedItem ? 'has-schedule-session' : ''}`;

        grid.innerHTML += `
            <div class="${cellClass}" onclick="selectScheduleCalendarDate('${dateStr}')">
                <span class="cal-day-num">${i}</span>
                ${indicatorHtml}
            </div>
        `;
    }
}

function renderScheduleCalendarSelectedDate(dateStr) {
    const cardEl = document.getElementById("sched-cal-selected-card");
    const titleEl = document.getElementById("sched-cal-selected-title");
    const badgeEl = document.getElementById("sched-cal-selected-badge");
    const bodyEl = document.getElementById("sched-cal-selected-body");
    if (!cardEl || !bodyEl) return;

    if (!dateStr) dateStr = getLocalDateString();
    const todayStr = getLocalDateString();

    const parts = dateStr.split("-").map(Number);
    const dObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const monthName = dObj.toLocaleDateString("en-US", { month: "short" });
    const dayNum = dObj.getDate();
    const weekday = dObj.toLocaleDateString("en-US", { weekday: "short" });

    let dateLabel = `${weekday}, ${monthName} ${dayNum}`;
    if (dateStr === todayStr) {
        dateLabel = `Today (${weekday}, ${monthName} ${dayNum})`;
    }

    if (titleEl) titleEl.textContent = `Schedule for ${dateLabel}`;

    const days = activeFollowSchedule ? activeFollowSchedule.schedule_data || [] : [];
    const completedDays = activeFollowSchedule ? activeFollowSchedule.completedDays || [] : [];
    const dayIndex = days.findIndex(d => d.date === dateStr);

    if (dayIndex !== -1) {
        const d = days[dayIndex];
        const isDone = completedDays.includes(dayIndex);
        if (badgeEl) {
            badgeEl.className = isDone ? "badge bg-success-subtle text-success" : "badge bg-primary-subtle text-primary";
            badgeEl.textContent = isDone ? "Completed" : `Day ${dayIndex + 1}`;
        }

        const taskList = d.tasks ? d.tasks.split(/;|\n/).map(t => t.trim().replace(/^[-•*]\s*/, "")).filter(Boolean) : [];

        bodyEl.innerHTML = `
            <div class="sched-cal-selected-session p-3 rounded" style="background: var(--bg-glass-card); border: 1px solid var(--border-glass);">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <span class="badge badge-subject mb-1">${escapeHtml(d.subject || "Study")}</span>
                        <h5 class="fs-6 fw-bold mb-1 font-outfit text-primary-heading">${escapeHtml(d.topic || "Session Focus")}</h5>
                        <div class="text-muted small"><i class="fa-regular fa-clock me-1 text-accent-blue"></i>${escapeHtml(d.time || "Scheduled")}</div>
                    </div>
                    <button class="btn btn-sm ${isDone ? 'btn-outline-success' : 'btn-primary-gradient'} px-2 py-1" onclick="toggleScheduleDayDone(${dayIndex})" title="${isDone ? 'Mark Pending' : 'Mark Done'}">
                        <i class="fa-solid ${isDone ? 'fa-rotate-left' : 'fa-circle-check'}"></i>
                    </button>
                </div>
                ${taskList.length ? `
                    <div class="mt-2 pt-2 border-top border-glass small">
                        <div class="text-muted mb-1" style="font-size:0.75rem; font-weight:600;">Checklist Items:</div>
                        <ul class="list-unstyled mb-0" style="font-size:0.78rem;">
                            ${taskList.slice(0, 3).map(t => `<li class="d-flex align-items-center gap-1 text-muted"><i class="fa-solid fa-angle-right text-accent-blue" style="font-size:0.65rem;"></i><span>${escapeHtml(t)}</span></li>`).join("")}
                            ${taskList.length > 3 ? `<li class="text-muted font-italic" style="font-size:0.7rem;">+ ${taskList.length - 3} more items</li>` : ''}
                        </ul>
                    </div>
                ` : ''}
                <div class="d-flex gap-2 mt-3">
                    <button class="btn btn-sm btn-glass text-accent-blue flex-grow-1" onclick="selectScheduleDay(${dayIndex})">
                        <i class="fa-solid fa-arrow-up-right-from-square me-1"></i>Open in Workspace
                    </button>
                    <button class="btn btn-sm btn-glass text-accent-emerald" onclick="addSingleDayToTasks(${dayIndex})" title="Add to Tasks Checklist">
                        <i class="fa-solid fa-plus me-1"></i>To Tasks
                    </button>
                </div>
            </div>
        `;
    } else {
        if (badgeEl) {
            badgeEl.className = "badge bg-secondary-subtle text-muted";
            badgeEl.textContent = "No Session";
        }
        bodyEl.innerHTML = `
            <div class="text-center py-4 text-muted">
                <i class="fa-regular fa-calendar-xmark fs-2 mb-2 opacity-50"></i>
                <p class="small mb-2">No study session scheduled on ${escapeHtml(dateLabel)}.</p>
                <button class="btn btn-sm btn-glass text-accent-cyan" onclick="scheduleSessionForDate('${dateStr}')">
                    <i class="fa-solid fa-plus me-1"></i>Add Session on this Date
                </button>
            </div>
        `;
    }
}

function scheduleSessionForDate(dateStr) {
    if (!activeFollowSchedule) {
        switchScheduleView("import");
        const dateInput = document.getElementById("schedule-import-start-date");
        if (dateInput) dateInput.value = dateStr;
        return;
    }

    if (!activeFollowSchedule.schedule_data) activeFollowSchedule.schedule_data = [];
    const newIdx = activeFollowSchedule.schedule_data.length;
    const parts = dateStr.split("-").map(Number);
    const dObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const weekday = dObj.toLocaleDateString("en-US", { weekday: "short" });
    const monthDay = dObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const newSession = {
        day: `Day ${newIdx + 1} (${weekday}, ${monthDay})`,
        time: "09:00 AM - 11:30 AM",
        subject: "Study Session",
        topic: "Topic to Cover",
        tasks: "Review lecture notes; Solve practice problems",
        date: dateStr,
        is_today: (dateStr === getLocalDateString())
    };

    activeFollowSchedule.schedule_data.push(newSession);
    localStorage.setItem("aether_active_schedule", JSON.stringify(activeFollowSchedule));

    selectedScheduleDayIndex = newIdx;
    selectedScheduleCalendarDate = dateStr;
    renderActiveSchedule();
    showToast(`Added session for ${monthDay} to timetable!`, "success");
}

function renderActiveSchedule() {
    const strip = document.getElementById("week-calendar-strip");
    const workspace = document.getElementById("expanded-day-workspace");
    const activeGrid = document.getElementById("sched-active-grid");
    const progressContainer = document.getElementById("schedule-progress-container");
    const progressText = document.getElementById("schedule-progress-text");
    const progressBar = document.getElementById("schedule-progress-bar");
    const titleEl = document.getElementById("schedule-active-title");
    const emptyState = document.getElementById("schedule-empty-state");

    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data || !activeFollowSchedule.schedule_data.length) {
        if (emptyState) emptyState.classList.remove("hidden");
        if (strip) strip.classList.add("hidden");
        if (workspace) workspace.classList.add("hidden");
        if (activeGrid) activeGrid.classList.add("hidden");
        updateDashboardScheduleWidget(null);
        return;
    }

    if (emptyState) emptyState.classList.add("hidden");
    if (strip) strip.classList.remove("hidden");
    if (workspace) workspace.classList.remove("hidden");
    if (activeGrid) activeGrid.classList.remove("hidden");

    const days = activeFollowSchedule.schedule_data;
    const completedDays = activeFollowSchedule.completedDays || [];
    const totalDays = days.length;
    const doneCount = completedDays.length;
    const pct = Math.round((doneCount / totalDays) * 100);

    if (titleEl) {
        titleEl.textContent = activeFollowSchedule.title || "Weekly Study Plan";
    }

    if (progressText) {
        progressText.textContent = `${doneCount} of ${totalDays} Days (${pct}%)`;
    }
    if (progressBar) {
        progressBar.style.width = `${pct}%`;
    }

    const nextIncompleteIdx = days.findIndex((_, idx) => !completedDays.includes(idx));
    if (selectedScheduleDayIndex < 0 || selectedScheduleDayIndex >= totalDays) {
        selectedScheduleDayIndex = getTodayScheduleDayIndex(days);
    }

    if (days[selectedScheduleDayIndex] && days[selectedScheduleDayIndex].date) {
        selectedScheduleCalendarDate = days[selectedScheduleDayIndex].date;
    }

    renderWeekCalendarStrip();
    renderExpandedDayWorkspace();
    renderScheduleCalendar();
    renderScheduleCalendarSelectedDate(selectedScheduleCalendarDate);

    const currentSession = nextIncompleteIdx > -1 ? days[nextIncompleteIdx] : null;
    updateDashboardScheduleWidget(currentSession, nextIncompleteIdx);
}

function updateDashboardScheduleWidget(currentSession, sessionIndex = 0) {
    const widget = document.getElementById("dash-schedule-widget");
    if (!widget) return;

    const titleEl = document.getElementById("dash-schedule-title");
    const descEl = document.getElementById("dash-schedule-desc");
    const tagEl = document.getElementById("dash-schedule-tag");
    const btnDone = document.getElementById("dash-btn-mark-done");
    const btnAi = document.getElementById("dash-btn-ask-ai");

    if (!activeFollowSchedule || !currentSession) {
        if (!activeFollowSchedule || !activeFollowSchedule.schedule_data) {
            if (titleEl) titleEl.textContent = "No Active Study Schedule";
            if (descEl) descEl.textContent = "Open a saved timetable or generate a personalized 7-day schedule with AI.";
            if (tagEl) tagEl.textContent = "STUDY PLANNER";
            if (btnDone) btnDone.classList.add("hidden");
            if (btnAi) btnAi.classList.add("hidden");
        } else {
            // Completed all
            if (titleEl) titleEl.textContent = "🏆 All Scheduled Sessions Completed!";
            if (descEl) descEl.textContent = `You completed all ${activeFollowSchedule.schedule_data.length} sessions in "${activeFollowSchedule.title}". Ready for your exams!`;
            if (tagEl) tagEl.textContent = "GOAL REACHED";
            if (btnDone) btnDone.classList.add("hidden");
            if (btnAi) btnAi.classList.add("hidden");
        }
        return;
    }

    if (btnDone) btnDone.classList.remove("hidden");
    if (btnAi) btnAi.classList.remove("hidden");
    if (tagEl) tagEl.textContent = `DAY ${sessionIndex + 1} OF ${activeFollowSchedule.schedule_data.length}`;
    if (titleEl) titleEl.textContent = `Today's Mission: ${currentSession.subject} - ${currentSession.topic}`;
    if (descEl) descEl.textContent = `${currentSession.day} • ${currentSession.time} • ${currentSession.tasks}`;
}

function markTodaySessionDone() {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data) return;
    const completedDays = activeFollowSchedule.completedDays || [];
    const nextIncompleteIdx = activeFollowSchedule.schedule_data.findIndex((_, idx) => !completedDays.includes(idx));
    if (nextIncompleteIdx > -1) {
        toggleScheduleDayDone(nextIncompleteIdx);
        showToast("Great job! Session marked as completed.", "success");
    } else {
        showToast("All study sessions are already completed!", "info");
    }
}

function askAiAboutCurrentSession() {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data) return;
    const completedDays = activeFollowSchedule.completedDays || [];
    const nextIncompleteIdx = activeFollowSchedule.schedule_data.findIndex((_, idx) => !completedDays.includes(idx));
    const targetIdx = nextIncompleteIdx > -1 ? nextIncompleteIdx : 0;
    askAiAboutSession(targetIdx);
}

function askAiAboutSession(index) {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data || !activeFollowSchedule.schedule_data[index]) return;
    const session = activeFollowSchedule.schedule_data[index];
    const prompt = `I am currently working on my study schedule session for ${session.subject}: ${session.topic} (${session.tasks}). Please explain the key concepts simply, provide memory shortcuts, and ask me 2 practice questions.`;

    switchTab("chat");
    setTimeout(() => {
        const input = document.getElementById("chat-prompt-input");
        if (input) {
            input.value = prompt;
            input.focus();
        }
    }, 250);
}

function toggleScheduleTaskDone(dayIndex, taskIndex, totalTasks) {
    if (!activeFollowSchedule) return;
    if (!activeFollowSchedule.completedTasksMap) activeFollowSchedule.completedTasksMap = {};
    if (!activeFollowSchedule.completedTasksMap[dayIndex]) activeFollowSchedule.completedTasksMap[dayIndex] = [];

    const dayTasks = activeFollowSchedule.completedTasksMap[dayIndex];
    const taskPos = dayTasks.indexOf(taskIndex);

    if (taskPos > -1) {
        dayTasks.splice(taskPos, 1);
    } else {
        dayTasks.push(taskIndex);
    }

    if (!activeFollowSchedule.completedDays) activeFollowSchedule.completedDays = [];
    const dayCompletedIdx = activeFollowSchedule.completedDays.indexOf(dayIndex);

    // If all tasks for this day are checked, mark the day completed
    if (dayTasks.length >= totalTasks && totalTasks > 0) {
        if (dayCompletedIdx === -1) {
            activeFollowSchedule.completedDays.push(dayIndex);
        }
    } else {
        // If not all tasks are checked, remove from completedDays
        if (dayCompletedIdx > -1) {
            activeFollowSchedule.completedDays.splice(dayCompletedIdx, 1);
        }
    }

    localStorage.setItem("aether_active_schedule", JSON.stringify(activeFollowSchedule));
    renderActiveSchedule();
}

function toggleScheduleDayDone(dayIndex) {
    if (!activeFollowSchedule) return;
    if (!activeFollowSchedule.completedDays) activeFollowSchedule.completedDays = [];
    if (!activeFollowSchedule.completedTasksMap) activeFollowSchedule.completedTasksMap = {};

    const idx = activeFollowSchedule.completedDays.indexOf(dayIndex);
    const day = activeFollowSchedule.schedule_data ? activeFollowSchedule.schedule_data[dayIndex] : null;
    const taskCount = day && day.tasks ? day.tasks.split(/;|\. |\n/).filter(t => t.trim().length > 0).length : 3;

    if (idx > -1) {
        // Unmark day -> also clear all task checkmarks for this day
        activeFollowSchedule.completedDays.splice(idx, 1);
        activeFollowSchedule.completedTasksMap[dayIndex] = [];
    } else {
        // Mark whole day done -> check off all tasks for this day
        activeFollowSchedule.completedDays.push(dayIndex);
        activeFollowSchedule.completedTasksMap[dayIndex] = Array.from({ length: taskCount }, (_, i) => i);
    }

    localStorage.setItem("aether_active_schedule", JSON.stringify(activeFollowSchedule));
    renderActiveSchedule();
}

async function deleteSavedSchedule(scheduleId) {
    if (!confirm("Are you sure you want to delete this saved schedule?")) return;
    try {
        await apiRequest(`/schedules/${scheduleId}`, { method: "DELETE" });
        showToast("Schedule deleted successfully.", "info");
        if (activeFollowSchedule && activeFollowSchedule.id === scheduleId) {
            activeFollowSchedule = null;
            localStorage.removeItem("aether_active_schedule");
            renderActiveSchedule();
        }
        fetchSavedSchedules();
    } catch (e) {
        showToast(e.message || "Failed to delete schedule", "error");
    }
}

async function convertScheduleToTasks() {
    if (!activeFollowSchedule || !activeFollowSchedule.schedule_data) {
        showToast("No active schedule to convert.", "error");
        return;
    }

    try {
        let addedCount = 0;
        const days = activeFollowSchedule.schedule_data;
        const todayStr = new Date().toISOString().split("T")[0];

        for (let i = 0; i < days.length; i++) {
            const d = days[i];
            const taskTitle = `${d.subject}: ${d.topic}`;
            const taskDesc = `${d.day} (${d.time}) - ${d.tasks}`;

            await apiRequest("/planner/tasks", {
                method: "POST",
                body: JSON.stringify({
                    title: taskTitle,
                    details: taskDesc,
                    due_date: todayStr,
                    priority: i < 2 ? "High" : "Medium"
                })
            });
            addedCount++;
        }

        showToast(`Added ${addedCount} study sessions to your Task Checklist!`, "success");
        loadTasks();
    } catch (e) {
        showToast(e.message || "Failed to convert schedule to tasks.", "error");
    }
}

// ==========================================
// USER PROFILE CONTROLLER
// ==========================================

async function loadUserProfile() {
    try {
        const profile = await apiRequest("/user/profile");
        
        if (profile.avatar_id) selectAvatar(profile.avatar_id, false);
        
        const usernameEl = document.getElementById("profile-display-username");
        if (usernameEl && profile.full_name) usernameEl.textContent = profile.full_name;
        
        document.getElementById("profile-input-fullname").value = profile.full_name || "";
        document.getElementById("profile-input-email").value = profile.email || "";
        document.getElementById("profile-input-goal").value = profile.study_goal || "";
        document.getElementById("profile-display-goal").textContent = profile.study_goal || "Achieving daily priorities & master goals";
        
        if (profile.target_hours_week) {
            document.getElementById("profile-input-target-hours").value = profile.target_hours_week;
            document.getElementById("weekly-hours-label").textContent = profile.target_hours_week;
        }
        
        const streakVal = profile.streak_days || 1;
        const profileStreakEl = document.getElementById("profile-streak-count");
        if (profileStreakEl) profileStreakEl.textContent = streakVal;
        const sidebarStreakEl = document.getElementById("sidebar-streak");
        if (sidebarStreakEl) sidebarStreakEl.textContent = streakVal;
        const topNavStreakEl = document.getElementById("top-nav-streak");
        if (topNavStreakEl) topNavStreakEl.textContent = streakVal;
        const mobileNavStreakEl = document.getElementById("mobile-nav-streak");
        if (mobileNavStreakEl) mobileNavStreakEl.textContent = streakVal;

        // Populate Done Tasks & Notes / Docs Stats
        const completedTasksCount = Array.isArray(cachedTasks) ? cachedTasks.filter(t => t.is_completed).length : 0;
        const tasksStatEl = document.getElementById("profile-tasks-count");
        if (tasksStatEl) tasksStatEl.textContent = completedTasksCount;

        const totalNotesCount = Array.isArray(cachedNotes) ? cachedNotes.length : (Array.isArray(cachedDocuments) ? cachedDocuments.length : 0);
        const notesStatEl = document.getElementById("profile-notes-count");
        if (notesStatEl) notesStatEl.textContent = totalNotesCount;
    } catch (e) {
        console.warn("Could not load profile:", e);
    }
}

function selectAvatar(avatarId, saveToServer = true) {
    document.querySelectorAll(".avatar-opt-btn").forEach(btn => {
        if (btn.getAttribute("data-avatar") === avatarId) btn.classList.add("active");
        else btn.classList.remove("active");
    });
    
    const iconMap = {
        "astronaut": "fa-user-astronaut",
        "laptop-code": "fa-laptop-code",
        "briefcase": "fa-user-tie",
        "robot": "fa-robot",
        "user-ninja": "fa-user-ninja",
        "brain": "fa-brain",
        "graduation-cap": "fa-user-graduate"
    };
    
    const iconClass = iconMap[avatarId] || "fa-user-astronaut";
    const el = document.getElementById("profile-avatar-display");
    const sideAvatar = document.getElementById("sidebar-avatar-box");
    const navAvatar = document.getElementById("nav-avatar-box");
    
    if (el) el.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    if (sideAvatar) sideAvatar.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    if (navAvatar) navAvatar.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    
    if (saveToServer) {
        apiRequest("/user/profile", {
            method: "PUT",
            body: JSON.stringify({ avatar_id: avatarId })
        }).catch(err => console.warn("Failed to update avatar:", err));
    }
}

async function handleProfileSave(e) {
    e.preventDefault();
    const fullName = document.getElementById("profile-input-fullname").value.trim();
    const email = document.getElementById("profile-input-email").value.trim();
    const goal = document.getElementById("profile-input-goal").value.trim();
    const targetHours = parseFloat(document.getElementById("profile-input-target-hours").value);
    
    const activeAvatarBtn = document.querySelector(".avatar-opt-btn.active");
    const avatarId = activeAvatarBtn ? activeAvatarBtn.getAttribute("data-avatar") : "astronaut";
    
    try {
        await apiRequest("/user/profile", {
            method: "PUT",
            body: JSON.stringify({
                full_name: fullName,
                email: email,
                study_goal: goal,
                target_hours_week: targetHours,
                avatar_id: avatarId
            })
        });
        showToast("Profile settings saved successfully!", "success");
        loadUserProfile();
    } catch (e) {
        showToast(e.message, "error");
    }
}

// ==========================================
// SETTINGS CONTROLLER
// ==========================================

function loadSettings() {
    const key = getGeminiKey();
    const input = document.getElementById("settings-gemini-key");
    if (input) input.value = key;
}

// ==========================================
// EVENT LISTENERS & BINDINGS
// ==========================================

function setupEventListeners() {
    // Auth Forms
    document.getElementById("login-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const u = document.getElementById("login-username").value.trim();
        const p = document.getElementById("login-password").value;
        const submitBtn = document.getElementById("login-submit-btn");
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Authenticating...`;
        
        try {
            const data = await apiRequest("/auth/login", {
                method: "POST",
                body: JSON.stringify({ username: u, password: p })
            });
            currentToken = data.access_token;
            localStorage.setItem("aether_token", currentToken);
            showToast("Welcome back!", "success");
            checkSession();
        } catch (err) {
            showToast(err.message || "Invalid credentials.", "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Sign In</span><i class="fa-solid fa-arrow-right ms-2"></i>`;
        }
    });

    document.getElementById("signup-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const u = document.getElementById("signup-username").value.trim();
        const p = document.getElementById("signup-password").value;
        const cp = document.getElementById("signup-confirm-password").value;
        
        if (p !== cp) {
            showToast("Passwords do not match.", "error");
            return;
        }
        
        const submitBtn = document.getElementById("signup-submit-btn");
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Creating account...`;
        
        try {
            const data = await apiRequest("/auth/register", {
                method: "POST",
                body: JSON.stringify({ username: u, password: p })
            });
            currentToken = data.access_token;
            localStorage.setItem("aether_token", currentToken);
            showToast("Account created successfully!", "success");
            checkSession();
        } catch (err) {
            showToast(err.message || "Registration failed.", "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Create Account</span><i class="fa-solid fa-user-check ms-2"></i>`;
        }
    });

    // Password strength realtime
    document.getElementById("signup-password")?.addEventListener("input", (e) => {
        checkPasswordStrength(e.target.value);
    });

    // Navigation Links
    document.querySelectorAll(".sidebar-nav .nav-link-item").forEach(link => {
        link.addEventListener("click", () => {
            const tab = link.getAttribute("data-tab");
            if (tab) switchTab(tab);
        });
    });

    // Mobile Sidebar Drawer
    document.getElementById("mobile-sidebar-toggle")?.addEventListener("click", openMobileSidebar);
    document.getElementById("sidebar-close-btn")?.addEventListener("click", closeMobileSidebar);
    document.getElementById("sidebar-backdrop")?.addEventListener("click", closeMobileSidebar);

    // AI Chat
    document.getElementById("chat-submit-form")?.addEventListener("submit", handleChatSubmit);
    document.getElementById("chat-user-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            document.getElementById("chat-submit-form").dispatchEvent(new Event("submit"));
        }
    });
    document.getElementById("btn-clear-chat")?.addEventListener("click", clearChatHistory);

    // Upload Dropzones
    setupDropzone("dash-dropzone", "dash-file-input", true);
    setupDropzone("docs-dropzone", "docs-file-input", false);

    // Notes Events
    document.getElementById("btn-create-blank-note")?.addEventListener("click", createNewNote);
    document.getElementById("btn-save-note")?.addEventListener("click", saveCurrentNote);
    document.getElementById("btn-delete-note")?.addEventListener("click", confirmDeleteCurrentNote);
    document.getElementById("btn-export-note")?.addEventListener("click", exportCurrentNote);
    document.getElementById("notes-filter-input")?.addEventListener("input", renderNotesList);
    document.getElementById("note-pin-toggle")?.addEventListener("click", function() {
        this.classList.toggle("active");
    });

    // Category pills in notes
    document.querySelectorAll("#notes-cat-pills .cat-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            document.querySelectorAll("#notes-cat-pills .cat-pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            activeNoteCategory = pill.getAttribute("data-cat");
            renderNotesList();
        });
    });

    // Quiz Events
    document.getElementById("quiz-config-form")?.addEventListener("submit", startQuizSession);
    document.getElementById("btn-next-question")?.addEventListener("click", handleNextQuizQuestion);
    document.getElementById("btn-quit-quiz")?.addEventListener("click", () => {
        clearInterval(quizTimerInterval);
        exitQuizToPortal();
    });

    // Planner Tasks & Schedules
    document.getElementById("add-task-form")?.addEventListener("submit", handleAddTask);
    document.getElementById("addTaskModal")?.addEventListener("show.bs.modal", () => {
        if (!editingTaskId) {
            resetTaskModal();
        }
    });
    document.getElementById("addTaskModal")?.addEventListener("hidden.bs.modal", () => {
        resetTaskModal();
    });
    document.getElementById("schedule-planner-form")?.addEventListener("submit", handleGenerateSchedule);
    document.getElementById("btn-save-generated-schedule")?.addEventListener("click", saveGeneratedSchedule);

    // Profile Edit
    document.getElementById("profile-edit-form")?.addEventListener("submit", handleProfileSave);

    // Global Search
    document.getElementById("global-search-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const val = e.target.value.trim();
            if (val) {
                switchTab("notes");
                setTimeout(() => {
                    const filterInput = document.getElementById("notes-filter-input");
                    if (filterInput) {
                        filterInput.value = val;
                        renderNotesList();
                    }
                }, 200);
            }
        }
    });
}

function setupDropzone(dropzoneId, inputId, isDashboard) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    if (!dropzone || !input) return;
    
    input.addEventListener("change", (e) => {
        if (e.target.files.length) {
            uploadStudyFile(e.target.files[0], isDashboard);
        }
    });
    
    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length) {
            uploadStudyFile(e.dataTransfer.files[0], isDashboard);
        }
    });
}

// Simple Markdown Formatter Helper
function renderMarkdownSimple(md) {
    if (!md) return "";
    let html = escapeHtml(md);
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italic
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    // Code block
    html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Headers
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");
    // Blockquote
    html = html.replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>");
    // Bullet list items
    html = html.replace(/^- (.*$)/gim, "<li>$1</li>");
    // Paragraph breaks
    html = html.replace(/\n\n/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");
    
    return `<p>${html}</p>`;
}

function escapeHtml(str) {
    if (!str) return "";
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function copyTextToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        showToast("Copied to clipboard!", "info");
        const icon = btn.querySelector("i");
        if (icon) icon.className = "fa-solid fa-check";
        setTimeout(() => {
            if (icon) icon.className = "fa-regular fa-copy";
        }, 2000);
    });
}

// Global window bindings for task deletion actions
window.promptDeleteTask = promptDeleteTask;
window.deleteTaskFromModal = deleteTaskFromModal;
window.executeConfirmedDelete = executeConfirmedDelete;
window.deleteTask = deleteTask;
window.openMobileSidebar = openMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;

