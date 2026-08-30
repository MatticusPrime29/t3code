# Agent Browser Automation

Agents can open and control a browser in both desktop and web-connected environments. The browser
tools support navigation, responsive viewport sizes, screenshots, semantic page snapshots, clicks,
typing, keyboard input, scrolling, JavaScript evaluation, console messages, and network diagnostics.

## Desktop App

The desktop app uses its built-in Chromium runtime. Browser tabs can be shown inline and controlled
by either you or the agent.

## Web and Headless Environments

When no desktop browser host is connected, the T3 Code server runs the agent browser beside the
coding environment. This is important for remote work: `localhost` refers to the environment that
owns the project rather than the phone or browser displaying T3 Code.

The server starts this browser only when an agent first uses a browser tool. Google Chrome or
Microsoft Edge must be installed on the environment machine. To use another Chromium-compatible
binary, start T3 Code with its absolute path:

```bash
T3CODE_PREVIEW_BROWSER_EXECUTABLE=/path/to/chromium npx t3
```

The server-hosted browser is headless, so the web client does not embed the live page. Agent
snapshots still include the rendered PNG, visible text, interactive elements, accessibility data,
console output, network results, and action history.

## Access Control

Open **Settings** → **Integrations** → **Browser** and enable **Allow agent browser access**. The
setting applies to newly started agent sessions. Existing sessions keep the tools they received
when they started.
