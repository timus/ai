# AI Labs — Practical LLM Engineering

A series of hands-on CLI apps that teach real AI engineering concepts by making them **visible and measurable** — actual token counts, real costs, live API calls.

Each day is a self-contained branch. Clone once, checkout the day you want.

---

## The Series

| Branch | Topic | What you build | Key concepts |
|---|---|---|---|
| `day-1` | LLM Basics | Property buying advisor CLI | Tokens, context window, hallucination, prompt grounding |
| `day-2` | Embeddings & RAG | Amenity analyser with naive vs RAG comparison | Embeddings, vector search, NeDB, cost comparison |

---

## Quick Start

```bash
git clone <repo-url>

# Day 1
git checkout day-1
npm install
cp .env.example .env   # add your OpenAI API key
npm start

# Day 2
git checkout day-2
npm install
cp .env.example .env
npm run naive          # approach 1 — no RAG
npm run rag            # approach 2 — embeddings + NeDB
```

You need an [OpenAI API key](https://platform.openai.com/api-keys).
A full session costs well under $0.01.

---

## How the series works

Each day **builds on the previous one conceptually** but is independent in code.
Start at Day 1. The README on each branch explains what you'll learn and how to run it.

The domain is property buying throughout — real calculations, real APIs, real data —
so the examples stay practical rather than toy-level.

---

## Prerequisites

- Node.js 18+
- An OpenAI API key
- No Docker, no databases to set up (Day 2 uses NeDB — embedded, zero config)
