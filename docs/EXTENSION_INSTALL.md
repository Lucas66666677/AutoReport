# AutoLabReport Bridge Extension

AutoLabReport Bridge connects AutoLabReport with mainstream AI web apps such as ChatGPT, Claude, Gemini, Grok, and DeepSeek.

## Install During Development

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project folder:

```txt
D:\AutoLabReport\extension
```

## Recommended Production Path

For non-technical users, publish the extension to Chrome Web Store and link the store page from the AutoLabReport sidebar.

Until the store version is ready, ship a ZIP package and keep the in-app installation modal enabled.

## Supported AI Sites

- ChatGPT
- Claude
- Gemini
- Grok
- DeepSeek

The extension uses prompt templates from its popup UI and sends generated text back to the open AutoLabReport editor.

