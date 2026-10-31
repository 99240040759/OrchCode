# Orch orchestrator

> **Orch** is an autonomous AI desktop development environment and coding agent built with **Tauri v2**, **Rust**, and **React 19**. It couples deep local workspace access (file operations, PTY terminals, document viewers, voice dictation) with an intelligent reasoning engine and cloud gateway.

---

## Features

- **Autonomous Coding Agent**
  - Multi-turn conversational loop powered by [Rig](https://github.com/0xPlaygrounds/rig) and Google Gemini / Vertex AI.
  - Streaming responses with real-time reasoning / chain-of-thought blocks, token usage, and status updates.
  - **Context Compaction**: Automated rolling summarization using `rig-memory` when token usage approaches context window limits.

- **Workspace & File System Tools**
  - **Surgical File Edits**: Safe exact multi-replacement (`multi_replace_file_content`), whole file writes, and chunked reads.
  - **High-Performance Search**: Fast workspace search powered by `grep-regex`, `ignore`, and fuzzy matching (`nucleo-matcher`).
  - **Process Lifecycle Management**: Asynchronous command execution (`run_command`, `get_command_status`, `stop_command`) with process-tree cleanup via `command-group`.
  - **Web Search**: Real-time web search integration powered by Tavily via the cloud gateway.
  - **Agent Skills**: Custom procedural guides loaded on-demand from `.agents/skills`.

- **Comprehensive Artifact Viewers**
  - **Code Viewer**: File explorer and editor preview with syntax highlighting (PrismJS).
  - **Document & Spreadsheet Viewers**: Native rendering for PDF (`pdfjs-dist`), Word documents (`docx-preview`), Excel spreadsheets (`calamine`), and PowerPoint presentations (`pptxviewjs`).
  - **Interactive Terminal**: Real OS pseudo-terminals managed via `portable-pty` and rendered using `xterm.js`.
  - **Auxiliary Browser**: Embedded native browser webviews for live previewing web applications.

- **Voice Dictation**
  - In-app microphone capture using `cpal`, high-quality resampling to 16 kHz using `rubato`, WAV-encoding (`hound`), and cloud-accelerated transcription via Groq Whisper.

- **SaaS Connectors**
  - Dynamic tool schema generation for third-party services (GitHub, Slack, Linear, Jira, etc.) via Composio integrations.

- **Enterprise-Grade Local Storage & Security**
  - SQLite session store (`Orch.db` via `sqlx`) for session history, reasoning duration metrics, and token accounting.
  - Append-only conversation logs stored per session via `rig-memory`.
  - Sensitive credentials and OAuth tokens protected via native OS Keychains (Apple Keychain, Windows Credential Manager, Secret Service).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   React 19 Frontend (Vite)                  │
│  Zustand Stores · TipTap · Xterm.js · Resizable Panels      │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri IPC (Commands & Channels)
┌──────────────────────────────▼──────────────────────────────┐
│                      Tauri v2 (Rust Core)                   │
│  Rig Agent Engine · PTY Terminal · Audio Dictation (cpal)   │
│  SQLite (Persistence) · DirStore (Conversations) · Keyring  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS (Authenticated)
┌──────────────────────────────▼──────────────────────────────┐
│              Google Cloud Functions Gateway (Node.js)       │
│  Vertex AI / Gemini · Tavily Search · Groq · Composio · DB  │
└─────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
├── .agents/               # Procedural agent skills and workflows
├── gcp-functions/         # Cloud gateway (Firebase Auth, Vertex AI, Tavily, Groq)
│   └── api/               # Express API and Composio integration routes
├── src/                   # React 19 Frontend
│   ├── components/        # ChatPanel, ArtifactPanel, Sidebar, InputBar, Viewers
│   │   ├── composer/      # TipTap editor with file mentions and audio input
│   │   └── viewers/       # Code, PDF, DOCX, XLSX, PPTX, Browser, Terminal
│   └── lib/               # Zustand state stores, API bridges, and utility helpers
├── src-tauri/             # Rust Backend
│   ├── src/
│   │   ├── lib.rs         # Tauri initialization, plugins, and IPC registrations
│   │   ├── llm.rs         # Rig agent orchestrator, streaming, and tool loop
│   │   ├── tools.rs       # Agent tool definitions (file I/O, search, execution)
│   │   ├── terminal.rs    # PTY session management (portable-pty)
│   │   ├── dictation.rs   # Audio recording and resampling (cpal + rubato)
│   │   ├── persistence.rs # SQLite storage for sessions and metrics
│   │   └── auth.rs        # OAuth deep linking and OS keyring credential storage
│   ├── Cargo.toml         # Rust crate dependencies
│   └── tauri.conf.json    # Tauri application configuration
└── package.json           # Frontend dependencies and build scripts
```

---

## Prerequisites

Before building Orch, ensure you have the following installed:

1. **Node.js**: v18.0.0 or higher (v20+ recommended) and `npm`
2. **Rust**: Latest stable toolchain (`rustup update stable`)
3. **C Compiler & System Dependencies**:
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   - **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libasound2-dev`
   - **Windows**: Microsoft Visual Studio C++ Build Tools

---

## Configuration

Copy `.env.example` to `.env` in the project root and configure your backend credentials:

```bash
cp .env.example .env
```

| Variable | Description |
| :--- | :--- |
| `GCP_FUNCTIONS_URL` | Base URL of the deployed Google Cloud Functions gateway (must start with `https://`) |
| `FIREBASE_API_KEY` | Firebase Web API key for authentication |
| `FIREBASE_AUTH_DOMAIN` | Firebase authentication domain (e.g., `your-project.firebaseapp.com`) |
| `SENTRY_DSN` | *(Optional)* Sentry DSN for crash reporting and error tracing |

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Run in Development Mode

Run both the Vite development server and the Tauri desktop window:

```bash
npm run tauri dev
```

If you only want to test the React frontend in a browser:

```bash
npm run dev
```

### 3. Verification & Type Checking

To verify the TypeScript frontend and Rust backend:

```bash
# Type-check TypeScript frontend
npm run build

# Check Rust backend
cd src-tauri
cargo check
```

### 4. Build for Production

To package Orch into a native desktop installer (`.dmg` on macOS, `.msi` / `.exe` on Windows, `.deb` / `.AppImage` on Linux):

```bash
npm run tauri build
```

The resulting installers will be located in `src-tauri/target/release/bundle/`.

---

## License

This project is licensed under the terms described in the repository. See [LICENSE](LICENSE) for details.
