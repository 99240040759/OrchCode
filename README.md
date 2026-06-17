<h1 align="center">Orch Code</h1>
<h3 align="center">The Agentic Code Editor</h3>

<p align="center">
  <em>Copilots suggest code. Orch Code builds entire features, debugs across files, and manages your full development workflow — autonomously.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-Proprietary-blue?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/version-1.0.0-brightgreen?style=flat-square" alt="Version">
</p>

---

## Overview

Most AI coding tools operate as **autocomplete on steroids** — they predict the next token, suggest a function body, maybe complete a line. Orch Code is fundamentally different.

Orch Code is a **desktop-native agentic environment** where an AI agent with genuine tool-use capabilities lives inside your project. It doesn't just generate text — it **reads your codebase, plans multi-file modifications, executes terminal commands, runs your applications in a live browser, searches the web for documentation, generates images, and persists context across sessions**.

Behind the interface is a sophisticated multi-process architecture where a dedicated agent worker orchestrates tools, manages context windows, streams results in real time, and dynamically compacts conversation history to stay within limits — all while keeping the UI responsive and crash-isolated.

---

## The Agent — Deep Reasoning Engine

### Multi-Step, Self-Correcting Reasoning

Orch Code doesn't produce a single output and stop. It **decomposes complex requests into ordered steps**, executes them one by one, evaluates the results at each stage, and adjusts its approach when something fails.

A typical deep-reasoning flow:

1. **Analyze** — The agent reads your project structure and examines relevant files
2. **Plan** — It formulates an approach, writes a plan to the conversation artifacts, and presents it for your review
3. **Execute** — It applies changes across files using structure-aware editing
4. **Verify** — It runs syntax checks, executes test suites, or opens the browser to validate visual output
5. **Iterate** — If a step fails, the agent diagnoses the error, revises its approach, and retries

This loop continues autonomously until the goal is achieved or you intervene. Every step is streamed live — you see tool calls being constructed, arguments being resolved, results being returned, and the agent reasoning about what to do next.

### Context-Aware Orchestration

The agent dynamically selects and sequences tools based on your request. It might:
- Search your codebase for a symbol, then open the file that defines it
- Read documentation from the web, then scaffold implementation code
- Run a build command, capture the output, detect errors, and open the failing files
- Take a browser screenshot, analyze the visual state, and adjust CSS

Tools are not isolated functions — they're woven into coherent, goal-driven workflows.

### Streaming Visibility

There are no black boxes. The entire reasoning process is streamed in real time:

- **Tool calls** appear as they fire, with arguments filling in progressively
- **Command outputs** stream line by line
- **Browser screenshots** are captured and displayed inline  
- **File edits** show diff statistics (lines added/removed)
- **Context compaction** events are logged with token savings

You can interrupt mid-execution, inject new instructions while the agent is working, or stop and redirect entirely.

### Context Window Management

Conversations can grow deep. Orch Code automatically monitors context usage and triggers **intelligent compaction** when approaching the context limit. A dedicated summarization pass distills earlier conversation history into a structured summary while preserving:

- Primary goals and sub-goals
- All files created or modified
- Key architectural decisions
- Tool execution outcomes
- Pending actions and TODOs
- User preferences and style choices

The agent continues with full context restored — no loss of continuity.

---

## Code Intelligence

### Structure-Aware Editing

Orch Code edits code using **abstract syntax tree (AST) token matching** for 35+ programming languages. This means edits are resilient to whitespace changes, indentation differences, and quote style variations. The agent can apply multiple non-contiguous edits in a single operation — replacing a function signature here, updating an import there, modifying a type definition elsewhere — all in one atomic action.

After every write or edit, the agent automatically **checks for syntax errors** using language-specific parsers, catching issues before you ever see them.

### Universal Search

The agent can search your entire workspace using regular expression patterns with smart-case logic and glob-based file filtering. It finds function definitions, class references, TODO comments, configuration keys — anything across hundreds of files in milliseconds.

### Paginated File Reading

Large files are read with line-range pagination (up to 800 lines per call). The agent knows when a file is truncated and requests subsequent pages as needed — never overwhelmed by file size.

### Workspace Mapping

Opening a project folder gives the agent immediate awareness of your directory structure, file types, configuration files, and entry points. It navigates with directory listings that include file sizes and child counts, respects `.gitignore` rules, and avoids binary files automatically.

---

## Development Toolkit

### Live Terminal

The agent executes commands directly in your workspace — `npm install`, `npm run build`, `python test.py`, `cargo check`, `docker compose up` — and streams output back into the conversation in real time. It sees stdout, stderr, and exit codes, and can react to failures immediately.

The terminal is a **native pseudo-terminal** with proper shell integration, color output, resize handling, and scrollback. Each conversation gets its own terminal session.

### File Preview for Office Documents

Drop in any document — Orch Code parses it and renders it inline:

- **PDF** — Rendered in an embedded viewer
- **Microsoft Word (.docx)** — Full document rendering with formatting
- **Excel (.xlsx)** — Interactive spreadsheet viewer with sheet tabs and row/column headers
- **PowerPoint (.pptx)** — Slide-by-slide carousel viewer
- **Images** — Rendered with proper dimensions and zoom

The agent can also **extract text** from these documents for analysis — reading specifications, parsing data tables, or reviewing presentation content.

### Image Generation

Describe a visual asset in natural language — a system architecture diagram, a UI mockup concept, a logo iteration, a data visualization — and Orch Code generates it using diffusion models directly into your conversation artifacts. Useful for rapid prototyping, documentation, or brainstorming.

---

## Live Browser & Web Intelligence

### Automated Browser Control

Orch Code includes a fully interactive embedded browser that the agent controls programmatically. This is not a static web view — the agent can:

- **Navigate** to any URL (localhost dev servers, production sites, documentation)
- **Click** elements by CSS selector, Playwright-style locator, or screen coordinates (single, double, or right-click)
- **Type** text into input fields with auto-fill behavior
- **Press keyboard shortcuts** (Enter, Tab, Arrow keys, Control+A, etc.)
- **Capture screenshots** at any point for visual verification
- **Extract page content** — URL, title, visible text, and a full accessibility tree snapshot

### Browser Use Cases

**Visual Development & Testing** — Ask the agent to open your local development server, navigate through your application flow, interact with forms, and take screenshots at each step. You visually verify the output while the agent identifies issues.

**Documentation-Driven Development** — The agent researches a library's docs, reads API references, extracts code examples, and applies them directly to your project — all without leaving the conversation.

**Data Extraction** — Navigate to a page, extract structured content from tables or listings, and organize it directly into your codebase as JSON, CSV, or configuration files.

**Visual Debugging** — When a UI bug appears, the agent captures the browser state, analyzes accessibility tree data, checks console output, and correlates visual issues with code changes.

### Real-Time Web Search

When you need current information — a library's latest API, a known bug fix, a configuration syntax — Orch Code searches the web in real time and returns synthesized answers with source citations. No stale training data, no context cutoffs.

---

## Memory & Context

### Persistent Memory

Orch Code remembers what matters **across conversations**. You can save:

- **General** — Personal preferences, coding style, tool choices
- **Preference** — Framework preferences, testing patterns, naming conventions
- **Codebase** — Project architecture decisions, dependency choices, configuration patterns
- **Workflow** — Repeated processes, deployment steps, setup sequences

The agent automatically recalls relevant memories when they apply — building a deeper understanding of you and your code over time.

### Context Ring Indicator

A live visual indicator shows how much of your context window is consumed — green through red gradient — so you always know when compaction is approaching.

---

## Interface & Experience

### Three-Panel Layout

| Panel | Purpose |
|-------|---------|
| **Left Sidebar** | Conversation threads organized chronologically, new conversation button, workspace opener, user profile |
| **Central Chat** | Streaming agent workspace — messages, tool calls, reasoning blocks, file links, attachments |
| **Right Dock** | Multi-tool panel — code viewer with diff mode, terminal, browser, and overview (context stats + artifacts) |

### Rich Input

The input bar supports:
- **Multi-line rich text** with formatting
- **File mentions** with autocomplete suggestions from your workspace
- **Drag & drop attachments** — images, documents, spreadsheets (up to 10MB per file, 25MB total)
- **Image paste** directly from clipboard
- **Inline approval cards** for sensitive operations

### Tab-Based File Management

Open multiple files simultaneously in the artifact panel with quick-switch shortcuts. Each tab shows a file-type icon, supports close-on-hover, and maintains scroll position. The code viewer includes:
- **Syntax highlighting** across languages
- **Diff mode** — compare current file state against original
- **Find in file** with native search controls
- **Copy file content** with one click
- **Breadcrumb navigation** showing file path within workspace

---

## Security Model

### Workspace Isolation

The agent operates strictly within the bounds of the workspace you open. Path traversal is blocked at every level — the agent cannot read, write, or execute anything outside the designated directory.

### Command Safety

Terminal commands are checked against a **blocklist of dangerous executables** (shutdown, mkfs, dd, passwd, sudo, shell spawners, network tools) and **shell operators** (pipe chains, backgrounding, sub-shells). Blocked commands are rejected with clear explanations before execution.

### Process Isolation

The AI agent runs in a **dedicated utility process** separate from the UI renderer. If the agent crashes, the interface stays responsive. Terminal sessions run in their own process as well. Database operations are handled by a separate worker.

---

## Real-World Workflows

### Building a Feature from Scratch

```
"Build a user authentication system with email/password and Google OAuth.
Store sessions with JWT tokens and include password reset."
```

The agent:
1. Analyzes your existing project structure and tech stack
2. Researches current best practices via web search
3. Plans the file structure and writes it to artifacts
4. Creates model files, controller logic, routes, middleware
5. Installs required dependencies via terminal
6. Writes and runs tests
7. Opens the browser to verify login flows

### Debugging a Production Issue

```
"The API returns a 500 error when submitting the registration form.
Here's the stack trace: ..."
```

The agent:
1. Searches your codebase for the failing stack trace lines
2. Reads the relevant files with pagination
3. Traces the data flow from route handler to database query
4. Identifies the root cause (mismatched schema, missing validation, etc.)
5. Applies the fix using AST-aware editing
6. Runs the test suite to verify
7. Summarizes the root cause and resolution

### Large-Scale Refactoring

```
"Migrate all class components to functional components with React hooks"
```

The agent:
1. Searches the entire codebase for class component patterns
2. Identifies all files requiring changes
3. Applies transformations file by file — lifecycle → hooks, this.state → useState, this.props → destructured props
4. Validates syntax on every modified file
5. Runs the build to confirm zero errors
6. Reports a full change summary

### Learning a New Technology

```
"I need to implement real-time notifications using WebSockets in this Node.js app"
```

The agent:
1. Searches the web for current WebSocket library options
2. Reads the official documentation
3. Opens your project to understand existing structure
4. Scaffolds the WebSocket server integration
5. Creates client-side connection handling
6. Runs the app and opens the browser to verify connection
7. Explains the architecture decisions

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **OS** | Windows 10 / macOS 11 / Linux (modern distro) | Windows 11 / macOS 14 / Latest LTS |
| **Processor** | Dual-core 2.0 GHz | Quad-core 3.0 GHz+ |
| **Memory** | 8 GB RAM | 16 GB RAM |
| **Storage** | 2 GB free | 5 GB free |
| **Display** | 1280 x 800 | 1920 x 1080+ |
| **Internet** | Required for AI model access | Broadband |

---

## Getting Started

1. **Download** the latest release for your platform from the releases page
2. **Install** — standard platform installer (NSIS for Windows, DMG for macOS, AppImage/Snap/Deb for Linux)
3. **Launch** — The onboarding window guides you through sign-in
4. **Authenticate** — Sign in with your Google account
5. **Open a project** — Click the folder icon or press the shortcut to select any directory
6. **Start a conversation** — Type what you want to build, fix, or explore

The agent will immediately analyze your workspace and begin working.

This repository and its entire contents are the proprietary intellectual property of **Orch**. Unauthorized reproduction, derivation, distribution, or execution of the source code, architecture, or assets herein is strictly prohibited.


**Orch™** and the **Orch Code™** logo are registered trademarks.

