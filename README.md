# Sheet Music for AI

An MCP App that lets an AI turn a musical idea into **readable, playable sheet music directly inside the conversation**.

## MVP

The first version deliberately does one job well:

> The AI sends ABC notation to one MCP tool, and the user gets an inline score with playback, tempo control, loop, and playback highlighting.

The MVP is **not** a full notation editor, DAW, music-generation model, or practice-analysis product.

## Target stack

- **Frontend / MCP view:** React + TypeScript + Vite
- **Score rendering + browser synth:** abcjs
- **Backend / MCP server:** NestJS + TypeScript
- **Protocol:** Model Context Protocol over stateless HTTP + MCP Apps UI resource
- **Hosting:** Vercel
- **Repository:** pnpm workspace monorepo
- **Persistence:** none in MVP

## Product docs

The detailed product and technical specifications are being prepared in the `spec/mvp-v1` branch:

- `docs/PRD.md`
- `docs/MCP_SPEC.md`
- `docs/TECHNICAL_ARCHITECTURE.md`
- `docs/DELIVERY_PLAN.md`
- `docs/adr/001-abc-as-mvp-notation.md`

## Product principle

**The LLM writes music; the product renders and plays it.**

That boundary keeps the MCP deterministic, fast, stateless, and useful across different AI hosts.
