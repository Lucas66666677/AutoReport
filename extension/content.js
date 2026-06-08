(() => {
  const SOURCE_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com"]);
  const isChatGptPage = SOURCE_HOSTS.has(window.location.hostname);

  function getSelectedText() {
    return window.getSelection()?.toString().trim() || "";
  }

  function getLatestChatGptMarkdown() {
    const selectedText = getSelectedText();
    if (selectedText) return selectedText;

    const candidates = [
      ...document.querySelectorAll(
        '[data-message-author-role="assistant"] .markdown, [data-message-author-role="assistant"], div.markdown'
      ),
    ];

    const latest = candidates
      .map((node) => node.innerText?.trim() || node.textContent?.trim() || "")
      .filter(Boolean)
      .at(-1);

    return latest || "";
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:84px",
      "z-index:2147483647",
      `background:${isError ? "#dc2626" : "#111827"}`,
      "color:white",
      "font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
      "padding:10px 12px",
      "border-radius:8px",
      "box-shadow:0 10px 30px rgba(0,0,0,.22)",
      "max-width:320px",
    ].join(";");
    document.documentElement.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2400);
  }

  function sendLatestContent() {
    const text = getLatestChatGptMarkdown();
    if (!text) {
      showToast("找不到可傳送的 ChatGPT 內容", true);
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "AUTOLABREPORT_CAPTURED_TEXT",
        text,
        sourceUrl: window.location.href,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast(chrome.runtime.lastError.message || "傳送失敗", true);
          return;
        }

        if (response?.ok) {
          showToast("已送出至 AutoLabReport");
        } else {
          showToast(response?.error || "找不到 AutoLabReport 頁籤", true);
        }
      }
    );
  }

  function getAiActionLabel(action) {
    if (action === "expand") return "擴寫內容";
    return "潤飾重寫";
  }

  function setNativeTextAreaValue(textarea, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    descriptor?.set?.call(textarea, value);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  function setEditableValue(editable, value) {
    editable.focus();
    editable.textContent = value;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  function findChatGptPromptInput() {
    return (
      document.querySelector("textarea#prompt-textarea") ||
      document.querySelector("#prompt-textarea[contenteditable='true']") ||
      document.querySelector("[contenteditable='true'][data-testid='prompt-textarea']") ||
      document.querySelector("div.ProseMirror[contenteditable='true']")
    );
  }

  function findChatGptSendButton() {
    return (
      document.querySelector("button[data-testid='send-button']") ||
      document.querySelector("button[aria-label*='Send']") ||
      document.querySelector("button[aria-label*='送出']") ||
      document.querySelector("form button[type='submit']")
    );
  }

  function sendAiCommandToChatGpt(text, action) {
    const cleanText = String(text || "").trim();
    if (!cleanText) {
      showToast("沒有可送往 ChatGPT 的文字", true);
      return false;
    }

    const prompt = `請幫我${getAiActionLabel(action)}以下實驗報告片段，只回傳 Markdown 純文字：\n\n${cleanText}`;
    const input = findChatGptPromptInput();
    if (!input) {
      showToast("找不到 ChatGPT 輸入框", true);
      return false;
    }

    if (input instanceof HTMLTextAreaElement) {
      setNativeTextAreaValue(input, prompt);
    } else {
      setEditableValue(input, prompt);
    }

    window.setTimeout(() => {
      const button = findChatGptSendButton();
      if (!button) {
        showToast("找不到 ChatGPT 發送按鈕", true);
        return;
      }

      button.click();
      showToast("已送出 AI 重寫請求");
    }, 250);

    return true;
  }

  function injectFloatingButton() {
    if (document.getElementById("autolabreport-bridge-button")) return;

    const button = document.createElement("button");
    button.id = "autolabreport-bridge-button";
    button.type = "button";
    button.textContent = "Send to AutoLabReport";
    button.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:20px",
      "z-index:2147483647",
      "border:0",
      "border-radius:999px",
      "padding:10px 14px",
      "background:#2563eb",
      "color:white",
      "font:600 13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
      "box-shadow:0 10px 30px rgba(37,99,235,.35)",
      "cursor:pointer",
    ].join(";");
    button.addEventListener("click", sendLatestContent);
    document.documentElement.appendChild(button);
  }

  function insertIntoAutoLabReport(text) {
    window.postMessage(
      {
        type: "AUTOLABREPORT_EXTENSION_TEXT",
        text,
      },
      window.location.origin
    );

    localStorage.setItem("autoLabReport_bridge_payload", text);
    window.dispatchEvent(
      new CustomEvent("AutoLabReport_Insert", {
        detail: { text },
      })
    );

    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    }

    return true;
  }

  function requestAiFromAutoLabReport(event) {
    const detail = event.detail || {};
    const text = String(detail.text || "").trim();
    const action = detail.action === "expand" ? "expand" : "rewrite";
    if (!text) return;

    chrome.runtime.sendMessage(
      {
        type: "SEND_TO_CHATGPT",
        text,
        action,
        sourceUrl: window.location.href,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast(chrome.runtime.lastError.message || "送往 ChatGPT 失敗", true);
          return;
        }

        if (response?.ok) {
          showToast("已切換至 ChatGPT 並送出請求");
        } else {
          showToast(response?.error || "找不到 ChatGPT 頁籤", true);
        }
      }
    );
  }

  if (isChatGptPage) {
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        sendLatestContent();
      }
    });

    injectFloatingButton();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "AUTOLABREPORT_AI_COMMAND") return false;

      const ok = sendAiCommandToChatGpt(message.text, message.action);
      sendResponse({ ok });
      return true;
    });
  } else {
    window.addEventListener("AutoLabReport_RequestAI", requestAiFromAutoLabReport);

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "AUTOLABREPORT_DELIVER_TEXT") return false;

      insertIntoAutoLabReport(String(message.text || ""));
      sendResponse({ ok: true });
      return true;
    });
  }
})();
