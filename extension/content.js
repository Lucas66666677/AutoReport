(() => {
  const AI_PROVIDERS = [
    {
      id: "chatgpt",
      label: "ChatGPT",
      hosts: ["chatgpt.com", "www.chatgpt.com"],
      responseSelectors: [
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"]',
        "div.markdown",
      ],
      inputSelectors: [
        "textarea#prompt-textarea",
        "#prompt-textarea[contenteditable='true']",
        "[contenteditable='true'][data-testid='prompt-textarea']",
        "div.ProseMirror[contenteditable='true']",
      ],
      sendSelectors: [
        "button[data-testid='send-button']",
        "button[aria-label*='Send']",
        "button[aria-label*='送出']",
        "form button[type='submit']",
      ],
    },
    {
      id: "gemini",
      label: "Gemini",
      hosts: ["gemini.google.com"],
      responseSelectors: [
        "message-content",
        ".model-response-text",
        "[data-test-id='response']",
        ".markdown",
      ],
      inputSelectors: [
        "rich-textarea div[contenteditable='true']",
        "div.ql-editor[contenteditable='true']",
        "div[contenteditable='true'][role='textbox']",
        "textarea",
      ],
      sendSelectors: [
        "button[aria-label*='Send']",
        "button[aria-label*='送出']",
        "button[data-test-id*='send']",
        "button[mat-icon-button]",
      ],
    },
    {
      id: "claude",
      label: "Claude",
      hosts: ["claude.ai"],
      responseSelectors: [
        "[data-testid='conversation-turn-Assistant']",
        ".font-claude-message",
        ".prose",
      ],
      inputSelectors: [
        "div.ProseMirror[contenteditable='true']",
        "div[contenteditable='true'][role='textbox']",
        "textarea",
      ],
      sendSelectors: [
        "button[aria-label*='Send']",
        "button[aria-label*='送出']",
        "button[type='submit']",
      ],
    },
    {
      id: "grok",
      label: "Grok",
      hosts: ["grok.com", "x.com"],
      responseSelectors: [
        "[data-testid='message-bubble']",
        "[data-testid='tweetText']",
        ".markdown",
        "article",
      ],
      inputSelectors: [
        "textarea",
        "div[contenteditable='true'][role='textbox']",
        "div.ProseMirror[contenteditable='true']",
      ],
      sendSelectors: [
        "button[aria-label*='Send']",
        "button[aria-label*='Post']",
        "button[data-testid*='send']",
        "button[type='submit']",
      ],
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      hosts: ["chat.deepseek.com", "www.deepseek.com"],
      responseSelectors: [".ds-markdown", ".markdown", "[class*='markdown']", "[class*='message']"],
      inputSelectors: [
        "textarea",
        "div[contenteditable='true'][role='textbox']",
        "div.ProseMirror[contenteditable='true']",
      ],
      sendSelectors: [
        "button[aria-label*='Send']",
        "button[aria-label*='送出']",
        "button[type='submit']",
        "button[class*='send']",
      ],
    },
    {
      id: "perplexity",
      label: "Perplexity",
      hosts: ["perplexity.ai", "www.perplexity.ai"],
      responseSelectors: ["[data-testid='answer']", ".prose", ".markdown", "[class*='answer']"],
      inputSelectors: ["textarea", "div[contenteditable='true'][role='textbox']"],
      sendSelectors: ["button[aria-label*='Submit']", "button[aria-label*='Send']", "button[type='submit']"],
    },
    {
      id: "copilot",
      label: "Copilot",
      hosts: ["copilot.microsoft.com"],
      responseSelectors: [".ac-textBlock", ".markdown", "[class*='message']"],
      inputSelectors: ["textarea", "div[contenteditable='true'][role='textbox']"],
      sendSelectors: ["button[aria-label*='Submit']", "button[aria-label*='Send']", "button[type='submit']"],
    },
  ];

  const DEFAULT_SETTINGS = {
    autoReturn: false,
    rewritePrompt:
      "請幫我潤飾重寫以下實驗報告片段。請保留原意、修正語氣與結構，只回傳 Markdown 純文字：\n\n{{text}}",
    expandPrompt:
      "請幫我擴寫以下實驗報告片段。請補強學術語氣、邏輯銜接與必要細節，只回傳 Markdown 純文字：\n\n{{text}}",
    customPrompt:
      "請根據我的要求處理以下實驗報告片段，只回傳 Markdown 純文字：\n\n{{text}}",
  };

  const currentProvider = AI_PROVIDERS.find((provider) =>
    provider.hosts.includes(window.location.hostname),
  );
  const isAiPage = Boolean(currentProvider);

  function getSelectedText() {
    return window.getSelection()?.toString().trim() || "";
  }

  function getTextFromNode(node) {
    return node?.innerText?.trim() || node?.textContent?.trim() || "";
  }

  function querySelectorList(selectors) {
    return selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  }

  function getLatestAiResponse() {
    const selectedText = getSelectedText();
    if (selectedText) return selectedText;

    const selectors = currentProvider?.responseSelectors || [
      ".markdown",
      ".prose",
      "[class*='message']",
      "article",
    ];

    const latest = querySelectorList(selectors)
      .map(getTextFromNode)
      .filter((text) => text && text.length > 8)
      .at(-1);

    return latest || "";
  }

  function showToast(message, isError = false) {
    const previous = document.getElementById("autolabreport-bridge-toast");
    previous?.remove();

    const toast = document.createElement("div");
    toast.id = "autolabreport-bridge-toast";
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
      "border-radius:10px",
      "box-shadow:0 10px 30px rgba(0,0,0,.22)",
      "max-width:360px",
    ].join(";");
    document.documentElement.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  function sendLatestContent() {
    const text = getLatestAiResponse();
    if (!text) {
      showToast(`找不到可傳送的 ${currentProvider?.label || "AI"} 內容`, true);
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "AUTOLABREPORT_CAPTURED_TEXT",
        text,
        provider: currentProvider?.id || "generic",
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
      },
    );
  }

  function fillTemplate(template, text, action) {
    return String(template || DEFAULT_SETTINGS.rewritePrompt)
      .replaceAll("{{text}}", text)
      .replaceAll("{{action}}", action);
  }

  function buildPrompt(text, action, settings = {}) {
    const activeSettings = { ...DEFAULT_SETTINGS, ...settings };
    if (action === "expand") return fillTemplate(activeSettings.expandPrompt, text, "擴寫內容");
    if (action === "custom") return fillTemplate(activeSettings.customPrompt, text, "自訂處理");
    return fillTemplate(activeSettings.rewritePrompt, text, "潤飾重寫");
  }

  function setNativeTextAreaValue(textarea, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    descriptor?.set?.call(textarea, value);
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  function setEditableValue(editable, value) {
    editable.focus();
    document.execCommand?.("selectAll", false);
    document.execCommand?.("insertText", false, value);

    if (!getTextFromNode(editable).includes(value.slice(0, 20))) {
      editable.textContent = value;
    }

    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  function findPromptInput() {
    const selectors = currentProvider?.inputSelectors || [
      "textarea",
      "div[contenteditable='true'][role='textbox']",
      "div.ProseMirror[contenteditable='true']",
    ];
    return querySelectorList(selectors).find((node) => {
      if (node instanceof HTMLTextAreaElement) return !node.disabled;
      if (node instanceof HTMLElement) return node.isContentEditable;
      return false;
    });
  }

  function findSendButton() {
    const selectors = currentProvider?.sendSelectors || [
      "button[aria-label*='Send']",
      "button[aria-label*='Submit']",
      "button[aria-label*='送出']",
      "button[type='submit']",
    ];
    return querySelectorList(selectors).find((node) => {
      if (!(node instanceof HTMLButtonElement)) return node instanceof HTMLElement;
      return !node.disabled;
    });
  }

  function startAutoReturnWatcher(settings) {
    if (!settings?.autoReturn) return;

    let settleTimer = null;
    const startedAt = Date.now();
    const observer = new MutationObserver(() => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        observer.disconnect();
        if (Date.now() - startedAt < 1800) return;
        sendLatestContent();
      }, 3200);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), 90000);
  }

  function sendAiCommand(text, action, settings, promptOverride) {
    const cleanText = String(text || "").trim();
    if (!cleanText) {
      showToast("沒有可送往 AI 的文字", true);
      return false;
    }

    const prompt = String(promptOverride || "").trim() || buildPrompt(cleanText, action, settings);
    const input = findPromptInput();
    if (!input) {
      showToast(`找不到 ${currentProvider?.label || "AI"} 輸入框`, true);
      return false;
    }

    if (input instanceof HTMLTextAreaElement) {
      setNativeTextAreaValue(input, prompt);
    } else {
      setEditableValue(input, prompt);
    }

    window.setTimeout(() => {
      const button = findSendButton();
      if (!button) {
        showToast(`找不到 ${currentProvider?.label || "AI"} 發送按鈕`, true);
        return;
      }

      button.click();
      startAutoReturnWatcher(settings);
      showToast(`已送出至 ${currentProvider?.label || "AI"}`);
    }, 350);

    return true;
  }

  function injectFloatingButton() {
    if (document.getElementById("autolabreport-bridge-panel")) return;

    const panel = document.createElement("div");
    panel.id = "autolabreport-bridge-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:20px",
      "z-index:2147483647",
      "display:flex",
      "gap:8px",
      "align-items:center",
      "padding:8px",
      "border-radius:999px",
      "background:rgba(255,255,255,.92)",
      "border:1px solid rgba(24,24,27,.12)",
      "box-shadow:0 16px 44px rgba(0,0,0,.16)",
      "backdrop-filter:blur(12px)",
    ].join(";");

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "送到 AutoLabReport";
    button.style.cssText = [
      "border:0",
      "border-radius:999px",
      "padding:9px 13px",
      "background:#18181b",
      "color:white",
      "font:650 13px system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
      "cursor:pointer",
    ].join(";");
    button.addEventListener("click", sendLatestContent);

    const label = document.createElement("span");
    label.textContent = currentProvider?.label || "AI";
    label.style.cssText = "padding:0 8px 0 4px;color:#71717a;font:600 12px system-ui,sans-serif";

    panel.append(button, label);
    document.documentElement.appendChild(panel);
  }

  function insertIntoAutoLabReport(text) {
    window.postMessage(
      {
        type: "AUTOLABREPORT_EXTENSION_TEXT",
        text,
      },
      window.location.origin,
    );

    localStorage.setItem("autoLabReport_bridge_payload", text);
    window.dispatchEvent(
      new CustomEvent("AutoLabReport_Insert", {
        detail: { text },
      }),
    );

    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      textarea.value = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }

    return true;
  }

  function requestAiFromAutoLabReport(event) {
    const detail = event.detail || {};
    const text = String(detail.text || "").trim();
    const action = detail.action === "expand" ? "expand" : detail.action === "custom" ? "custom" : "rewrite";
    if (!text) return;

    chrome.runtime.sendMessage(
      {
        type: "SEND_TO_CHATGPT",
        text,
        action,
        prompt: detail.prompt,
        autoReturn: detail.autoReturn,
        sourceUrl: window.location.href,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast(chrome.runtime.lastError.message || "送往 AI 失敗", true);
          return;
        }

        if (response?.ok) {
          showToast("已切換至 AI 頁籤並送出請求");
        } else {
          showToast(response?.error || "找不到支援的 AI 頁籤", true);
        }
      },
    );
  }

  if (isAiPage) {
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        sendLatestContent();
      }
    });

    injectFloatingButton();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "AUTOLABREPORT_AI_COMMAND") {
        const ok = sendAiCommand(message.text, message.action, message.settings, message.prompt);
        sendResponse({ ok });
        return true;
      }

      if (message?.type === "AUTOLABREPORT_SEND_LATEST") {
        sendLatestContent();
        sendResponse({ ok: true });
        return true;
      }

      return false;
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
