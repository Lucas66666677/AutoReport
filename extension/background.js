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

const AI_TARGET_PATTERNS = [
  { id: "chatgpt", label: "ChatGPT", patterns: ["chatgpt.com", "www.chatgpt.com"] },
  { id: "gemini", label: "Gemini", patterns: ["gemini.google.com"] },
  { id: "claude", label: "Claude", patterns: ["claude.ai"] },
  { id: "grok", label: "Grok", patterns: ["grok.com", "x.com"] },
  { id: "deepseek", label: "DeepSeek", patterns: ["chat.deepseek.com", "deepseek.com"] },
  { id: "perplexity", label: "Perplexity", patterns: ["perplexity.ai"] },
  { id: "copilot", label: "Copilot", patterns: ["copilot.microsoft.com"] },
];

async function getSettings() {
  const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...saved };
}

async function saveSettings(nextSettings) {
  await chrome.storage.sync.set(nextSettings);
  return getSettings();
}

function getAiProviderForUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return AI_TARGET_PATTERNS.find((provider) =>
      provider.patterns.some(
        (pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`),
      ),
    );
  } catch (_error) {
    return undefined;
  }
}

async function queryAllTabs() {
  return chrome.tabs.query({});
}

function isAutoLabTargetUrl(url, configuredTargets) {
  try {
    const candidate = new URL(url);
    return configuredTargets.some((configuredTarget) => {
      const value = String(configuredTarget || "").trim();
      if (!value || value.startsWith(".")) return false;
      if (value.includes("://")) {
        try {
          return candidate.origin === new URL(value).origin;
        } catch (_error) {
          return false;
        }
      }
      return candidate.host === value || candidate.hostname === value;
    });
  } catch (_error) {
    return false;
  }
}

async function findAutoLabReportTab(settings = undefined) {
  const activeSettings = settings || (await getSettings());
  const tabs = await queryAllTabs();
  return tabs.find((tab) =>
    isAutoLabTargetUrl(tab.url || "", activeSettings.targetUrlPatterns || []),
  );
}

async function findAiTab(settings = undefined) {
  const activeSettings = settings || (await getSettings());
  const tabs = await queryAllTabs();
  const candidates = tabs
    .map((tab) => ({ tab, provider: getAiProviderForUrl(tab.url || "") }))
    .filter((item) => item.provider);

  if (activeSettings.preferredAiHost && activeSettings.preferredAiHost !== "auto") {
    const preferred = candidates.find((item) => item.provider.id === activeSettings.preferredAiHost);
    if (preferred) return preferred;
  }

  const active = candidates.find((item) => item.tab.active);
  return active || candidates[0] || null;
}

async function getStatus() {
  const settings = await getSettings();
  const autoLabTab = await findAutoLabReportTab(settings);
  const aiTab = await findAiTab(settings);
  return {
    settings,
    autoLab: autoLabTab
      ? { ok: true, title: autoLabTab.title || "AutoLabReport", url: autoLabTab.url || "" }
      : { ok: false },
    ai: aiTab
      ? {
          ok: true,
          provider: aiTab.provider,
          title: aiTab.tab.title || aiTab.provider.label,
          url: aiTab.tab.url || "",
        }
      : { ok: false },
  };
}

async function deliverTextToTab(tab, text) {
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "AUTOLABREPORT_DELIVER_TEXT",
      text,
    });
    return { ok: true };
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => {
        window.postMessage(
          {
            type: "AUTOLABREPORT_EXTENSION_TEXT",
            text: payload,
          },
          window.location.origin,
        );
        localStorage.setItem("autoLabReport_bridge_payload", payload);
        window.dispatchEvent(
          new CustomEvent("AutoLabReport_Insert", {
            detail: { text: payload },
          }),
        );
      },
      args: [text],
    });
    return { ok: true };
  }
}

async function sendAiCommandToTab(tab, text, action, settings, prompt) {
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: "AUTOLABREPORT_AI_COMMAND",
    text,
    action,
    settings,
    prompt,
  });

  return { ok: true };
}

async function requestLatestFromAiTab(tab) {
  return chrome.tabs.sendMessage(tab.id, {
    type: "AUTOLABREPORT_SEND_LATEST",
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "send-latest-to-autolab") return;

  const aiTab = await findAiTab();
  if (aiTab?.tab?.id) {
    await requestLatestFromAiTab(aiTab.tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const allowedTypes = new Set([
    "AUTOLABREPORT_CAPTURED_TEXT",
    "AUTOLABREPORT_GET_STATUS",
    "AUTOLABREPORT_POPUP_SEND_LATEST",
    "AUTOLABREPORT_SAVE_SETTINGS",
    "SEND_TO_CHATGPT",
  ]);

  if (!allowedTypes.has(message?.type)) return false;

  (async () => {
    if (
      message.type === "AUTOLABREPORT_CAPTURED_TEXT" &&
      !getAiProviderForUrl(sender.tab?.url || "")
    ) {
      sendResponse({ ok: false, error: "拒絕未授權的訊息來源" });
      return;
    }

    if (message.type === "AUTOLABREPORT_GET_STATUS") {
      sendResponse(await getStatus());
      return;
    }

    if (message.type === "AUTOLABREPORT_SAVE_SETTINGS") {
      sendResponse({ ok: true, settings: await saveSettings(message.settings || {}) });
      return;
    }

    if (message.type === "AUTOLABREPORT_POPUP_SEND_LATEST") {
      const aiTab = await findAiTab();
      if (!aiTab?.tab?.id) {
        sendResponse({ ok: false, error: "找不到支援的 AI 頁籤" });
        return;
      }
      sendResponse(await requestLatestFromAiTab(aiTab.tab));
      return;
    }

    const text = String(message.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "沒有可傳送的文字" });
      return;
    }

    if (message.type === "SEND_TO_CHATGPT") {
      const settings = await getSettings();
      const effectiveSettings = {
        ...settings,
        autoReturn:
          typeof message.autoReturn === "boolean" ? message.autoReturn : settings.autoReturn,
      };
      const aiTab = await findAiTab(settings);
      if (!aiTab?.tab?.id) {
        sendResponse({
          ok: false,
          error: "找不到支援的 AI 頁籤，請先開啟 ChatGPT、Gemini、Claude、Grok 或 DeepSeek",
        });
        return;
      }

      const result = await sendAiCommandToTab(
        aiTab.tab,
        text,
        message.action === "expand" ? "expand" : message.action === "custom" ? "custom" : "rewrite",
        effectiveSettings,
        message.prompt,
      );
      sendResponse(result);
      return;
    }

    const settings = await getSettings();
    const targetTab = await findAutoLabReportTab(settings);
    if (!targetTab?.id) {
      sendResponse({
        ok: false,
        error: "找不到 AutoLabReport 頁籤，請先開啟本機或部署頁面",
      });
      return;
    }

    const result = await deliverTextToTab(targetTab, text);
    sendResponse(result);
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "傳送失敗",
    });
  });

  return true;
});
