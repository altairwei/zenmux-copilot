# ZenMux Compatible Provider for Copilot

This extension provides a language model provider for GitHub Copilot Chat that connects to ZenMux. ZenMux is a model gateway that unifies inference APIs from different backends (for example OpenAI, Anthropic, Vertex AI) under a single, compatible API surface. For more information, visit the official ZenMux website: https://zenmux.ai

## Key points

- ZenMux is a model gateway used to route and manage requests to multiple backend inference providers.
- This extension exposes a `ZenMux Provider` to Copilot Chat so Copilot can send requests via a configured ZenMux instance.

## Overview

- Name: ZenMux Compatible Provider for Copilot
- Version: see `package.json`

## Prerequisites

- VS Code >= 1.104.0
- The `github.copilot-chat` extension installed
- Node.js (for development and building)

## Install & build

Install dependencies (if needed):

```powershell
npm install
```

Compile TypeScript:

```powershell
npm run compile
```

Package a VSIX (optional):

```powershell
npm run build
```

## Run in the Extension Development Host

- Open this repository in VS Code and press F5 (Run Extension) to launch an Extension Development Host.
- After activation in the development host, Copilot Chat should list and be able to use the `ZenMux Provider` language model provider.

## Activation & logging

- Activation events are declared in `package.json` under `activationEvents` (for example `onStartupFinished` and `onCommand:zenmux.setApikey`).
- The extension creates an Output Channel named `ZenMux`. To view logs:
  - Open the Output panel (View → Output or Ctrl+Shift+U).
  - Select `ZenMux` from the dropdown in the panel's top-right.

## Configuration (common)

- `zenmux.baseUrl`: base URL for the ZenMux gateway (example default: `https://zenmux.ai/api/v1`).
- `zenmux.anthropic.baseUrl`: Anthropic-compatible backend URL.
- `zenmux.retry`: request retry policy (enable, max attempts, interval_ms).
- `zenmux.delay`: fixed delay between requests in milliseconds.

## Commands

- `zenmux.setApikey` — Run from the Command Palette (Ctrl+Shift+P) to set or update the API key used to authenticate with ZenMux.

## Debugging tips

- If the extension does not activate or shows no logs:
  - Make sure you are viewing the Extension Development Host (start with F5) and check the host's Output panel for `ZenMux`.
  - Open Developer Tools in the host (Help → Toggle Developer Tools) to inspect console errors.
  - Reload the window (`Developer: Reload Window`) and re-check Output → ZenMux.
  - Confirm you ran `npm run compile` and that `out/extension.js` exists for VS Code to load.

## Contributing & issues

- File issues at: https://github.com/ilimei/zenmux-copilot/issues
- Contributions welcome via fork and pull request.

## License

- MIT

## Next steps

If you'd like, I can also:

- Add example configuration and request snippets for ZenMux backends.
- Add CI instructions to build & publish a VSIX to the Marketplace.
- Provide an additional README section with quick API examples.
