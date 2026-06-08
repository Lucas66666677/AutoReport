const AUTOLAB_TARGET_PATTERNS = [
  "localhost:5173",
  "127.0.0.1:5173",
  "autolabreport",
  ".vercel.app",
];

const CHATGPT_TARGET_PATTERNS = ["chatgpt.com"];

async function findAutoLabReportTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => {
    const url = tab.url || "";
    return AUTOLAB_TARGET_PATTERNS.some((pattern) => url.includes(pattern));
  });
}

async function findChatGptTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => {
    const url = tab.url || "";
    return CHATGPT_TARGET_PATTERNS.some((pattern) => url.includes(pattern));
  });
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
          window.location.origin
        );
        localStorage.setItem("autoLabReport_bridge_payload", payload);
        window.dispatchEvent(
          new CustomEvent("AutoLabReport_Insert", {
            detail: { text: payload },
          })
        );
      },
      args: [text],
    });
    return { ok: true };
  }
}

async function sendAiCommandToChatGpt(tab, text, action) {
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: "AUTOLABREPORT_AI_COMMAND",
    text,
    action,
  });

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.type !== "AUTOLABREPORT_CAPTURED_TEXT" &&
    message?.type !== "SEND_TO_CHATGPT"
  ) {
    return false;
  }

  (async () => {
    const text = String(message.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "沒有可傳送的文字" });
      return;
    }

    if (message.type === "SEND_TO_CHATGPT") {
      const chatGptTab = await findChatGptTab();
      if (!chatGptTab?.id) {
        sendResponse({
          ok: false,
          error: "找不到 ChatGPT 頁籤，請先開啟 chatgpt.com",
        });
        return;
      }

      const result = await sendAiCommandToChatGpt(
        chatGptTab,
        text,
        message.action === "expand" ? "expand" : "rewrite"
      );
      sendResponse(result);
      return;
    }

    const targetTab = await findAutoLabReportTab();
    if (!targetTab?.id) {
      sendResponse({
        ok: false,
        error: "找不到 AutoLabReport 頁籤，請先開啟 localhost:5173 或部署頁面",
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
