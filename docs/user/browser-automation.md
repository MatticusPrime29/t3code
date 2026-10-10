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

The server installs its browser on first use. That download requires an internet connection on the
environment machine. Web and mobile clients can display the server browser and share its tabs with
agents.

## Access Control

Open **Settings** → **Integrations** → **Browser** and enable **Allow agent browser access**. The
setting applies to newly started agent sessions. Existing sessions keep the tools they received
when they started.
