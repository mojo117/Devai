# DevAI Architecture Notes

This document captures the current layout and the main extension points used to grow
the assistant into a skills-driven web version.

Current Layout
- apps/api: Fastify API server, routes, LLM router, tools, actions, audit logging
- apps/web: Vite + React UI, chat UI, action approvals, provider selection
- shared: shared types (messages, tools, actions, project context)

Key Runtime Flow (Today)
- UI posts to /api/chat with messages + provider
- API uses llmRouter to generate a response
- If tool calls are present, tools are executed or converted into approval actions
- Actions are stored in memory; approvals trigger execution and audit logging

Extension Points
- LLM router: add new providers or tool-call formats
- Tool registry/executor: add new tool definitions and execution handlers
- Routes: add APIs for skills, sessions, project browsing, and history
- UI: add skill selection, terminal-like output, and multi-step planning

Near-Term Targets (from plan)
- Skills system: manifests, loader, permissions model, and discovery route
- Tool execution hardening: sandboxing, streaming, and stronger error handling
- UX upgrades: tool preview, approvals, context controls, file browser
- Persistence: chat history, skill configs, user settings, audit logs
- Hosting: auth, rate limits, secrets, deployment, observability, tests
