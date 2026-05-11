import { App } from "@modelcontextprotocol/ext-apps";

const POLL_INTERVAL = 3000;

interface ModelSummary {
  name: string;
  port: number;
  source: string;
  provider: string | null;
  api_model: string | null;
  type: string;
  status: string;
}

interface HealthStatus {
  status: string;
  models: { total: number; running: number; failed: number };
}

// ---- DOM refs ----
const modelsBody = document.getElementById("models-body")!;
const totalEl = document.getElementById("total-models")!;
const runningEl = document.getElementById("running-models")!;
const failedEl = document.getElementById("failed-models")!;
const pollBtn = document.getElementById("poll-btn")!;
const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const statusBar = document.getElementById("status-bar")!;

let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ---- App connection ----
const app = new App();

async function initApp() {
  try {
    await app.connect();
    statusBar.textContent = "MCP App connected. Loading data...";
  } catch (err) {
    statusBar.textContent = "MCP App init error. Running in standalone mode.";
  }
}

// ---- Render ----
function renderDashboard(models: ModelSummary[], health: HealthStatus) {
  totalEl.textContent = String(health.models.total);
  runningEl.textContent = String(health.models.running);
  failedEl.textContent = String(health.models.failed);

  if (models.length === 0) {
    modelsBody.innerHTML = `<tr><td colspan="5" class="empty">No models configured</td></tr>`;
    return;
  }

  modelsBody.innerHTML = models
    .map(
      (m) => `
    <tr>
      <td><span class="dot ${m.status === "running" ? "green" : "red"}"></span></td>
      <td class="model-name">${m.name} <small>${m.api_model || ""}</small></td>
      <td><span class="tag ${m.source}">${m.source}</span></td>
      <td>:${m.port}</td>
      <td>${m.provider || "-"}</td>
    </tr>`
    )
    .join("");
}

function setStatus(ok: boolean, msg: string) {
  statusDot.className = `dot ${ok ? "green" : "red"}`;
  statusText.textContent = msg;
}

// ---- Data fetching ----
async function fetchData() {
  try {
    const result = await app.callServerTool({
      name: "poll-model-status",
      arguments: {},
    });

    const content = result.structuredContent || JSON.parse(result.content[0]?.text || "{}");
    renderDashboard(content.models, content.health);
    setStatus(true, "Live");
    statusBar.textContent = `${content.models.length} models · ${content.health.models.running} running`;
  } catch (err) {
    setStatus(false, "Error");
    statusBar.textContent = `Poll failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function fetchInitial() {
  try {
    const result = await app.callServerTool({
      name: "get-dashboard",
      arguments: {},
    });

    const content = result.structuredContent || JSON.parse(result.content[0]?.text || "{}");
    renderDashboard(content.models, content.health);
    setStatus(true, "Loaded");
    statusBar.textContent = `${content.models.length} models · ${content.health.models.running} running`;
  } catch (err) {
    modelsBody.innerHTML = `<tr><td colspan="5" class="error-state">Failed to load: ${err instanceof Error ? err.message : String(err)}</td></tr>`;
    setStatus(false, "Error");
    statusBar.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---- Polling controls ----
function startPolling() {
  if (polling) return;
  polling = true;
  pollBtn.textContent = "Stop Polling";
  pollBtn.classList.add("active");
  fetchData();
  pollTimer = setInterval(fetchData, POLL_INTERVAL);
}

function stopPolling() {
  polling = false;
  pollBtn.textContent = "Start Polling";
  pollBtn.classList.remove("active");
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

pollBtn.addEventListener("click", () => {
  if (polling) stopPolling();
  else startPolling();
});

// ---- Init ----
initApp().then(() => fetchInitial());
