const DEFAULT_SETTINGS = {
  targetUrlPatterns: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4174",
  ],
  preferredAiHost: "auto",
  autoReturn: false,
  rewritePrompt:
    "請幫我潤飾重寫以下實驗報告片段。請保留原意、修正語氣與結構，只回傳 Markdown 純文字：\n\n{{text}}",
  expandPrompt:
    "請幫我擴寫以下實驗報告片段。請補強學術語氣、邏輯銜接與必要細節，只回傳 Markdown 純文字：\n\n{{text}}",
  customPrompt:
    "請根據我的要求處理以下實驗報告片段，只回傳 Markdown 純文字：\n\n{{text}}",
};

const elements = {
  aiDot: document.getElementById("aiDot"),
  aiStatus: document.getElementById("aiStatus"),
  autoLabDot: document.getElementById("autoLabDot"),
  autoLabStatus: document.getElementById("autoLabStatus"),
  sendLatestButton: document.getElementById("sendLatestButton"),
  refreshButton: document.getElementById("refreshButton"),
  preferredAiHost: document.getElementById("preferredAiHost"),
  targetUrlPatterns: document.getElementById("targetUrlPatterns"),
  autoReturn: document.getElementById("autoReturn"),
  rewritePrompt: document.getElementById("rewritePrompt"),
  expandPrompt: document.getElementById("expandPrompt"),
  customPrompt: document.getElementById("customPrompt"),
  saveButton: document.getElementById("saveButton"),
  resetButton: document.getElementById("resetButton"),
  toast: document.getElementById("toast"),
};

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.style.color = isError ? "#dc2626" : "#16a34a";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.textContent = "";
  }, 2400);
}

function renderSettings(settings) {
  elements.preferredAiHost.value = settings.preferredAiHost || "auto";
  elements.targetUrlPatterns.value = (settings.targetUrlPatterns || []).join(", ");
  elements.autoReturn.checked = Boolean(settings.autoReturn);
  elements.rewritePrompt.value = settings.rewritePrompt || DEFAULT_SETTINGS.rewritePrompt;
  elements.expandPrompt.value = settings.expandPrompt || DEFAULT_SETTINGS.expandPrompt;
  elements.customPrompt.value = settings.customPrompt || DEFAULT_SETTINGS.customPrompt;
}

function collectSettings() {
  return {
    preferredAiHost: elements.preferredAiHost.value,
    targetUrlPatterns: elements.targetUrlPatterns.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    autoReturn: elements.autoReturn.checked,
    rewritePrompt: elements.rewritePrompt.value.trim() || DEFAULT_SETTINGS.rewritePrompt,
    expandPrompt: elements.expandPrompt.value.trim() || DEFAULT_SETTINGS.expandPrompt,
    customPrompt: elements.customPrompt.value.trim() || DEFAULT_SETTINGS.customPrompt,
  };
}

function renderStatus(status) {
  elements.aiDot.classList.toggle("ok", Boolean(status.ai?.ok));
  elements.autoLabDot.classList.toggle("ok", Boolean(status.autoLab?.ok));
  elements.aiStatus.textContent = status.ai?.ok
    ? `${status.ai.provider?.label || "AI"} · ${status.ai.title || "已連線"}`
    : "尚未開啟支援的 AI 網頁";
  elements.autoLabStatus.textContent = status.autoLab?.ok
    ? status.autoLab.title || "已連線"
    : "尚未開啟 AutoLabReport";
  elements.sendLatestButton.disabled = !status.ai?.ok;
}

async function refreshStatus() {
  const status = await sendMessage({ type: "AUTOLABREPORT_GET_STATUS" });
  if (status?.settings) renderSettings(status.settings);
  renderStatus(status || {});
}

async function saveSettings(settings = collectSettings()) {
  const result = await sendMessage({
    type: "AUTOLABREPORT_SAVE_SETTINGS",
    settings,
  });

  if (result?.ok) {
    renderSettings(result.settings);
    showToast("設定已儲存");
    await refreshStatus();
  } else {
    showToast(result?.error || "設定儲存失敗", true);
  }
}

elements.refreshButton.addEventListener("click", refreshStatus);

elements.sendLatestButton.addEventListener("click", async () => {
  elements.sendLatestButton.disabled = true;
  const result = await sendMessage({ type: "AUTOLABREPORT_POPUP_SEND_LATEST" });
  elements.sendLatestButton.disabled = false;

  if (result?.ok) {
    showToast("已送出最新 AI 回覆");
  } else {
    showToast(result?.error || "送出失敗", true);
  }
});

elements.saveButton.addEventListener("click", () => {
  void saveSettings();
});

elements.resetButton.addEventListener("click", () => {
  void saveSettings(DEFAULT_SETTINGS);
});

document.addEventListener("DOMContentLoaded", refreshStatus);
void refreshStatus();
