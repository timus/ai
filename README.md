# AI Labs — Learn AI Engineering by Building

Hands-on CLI projects that teach core AI concepts by making them **visible in real time**.
Each day is a self-contained project with its own dependencies and README.

---

## Days

| Day | Topic | Use Case | Key Concepts |
|---|---|---|---|
| [Day 1](day-1/README.md) | LLM Basics | Property buying advisor | Tokens, context window, hallucination |
| [Day 2](day-2/README.md) | RAG & Embeddings | Property guide chatbot | Embeddings, vector store, chunking, retrieval |

---

## How to Use

Each day folder is a standalone Node.js project:

```bash
cd day-1 && npm install && npm start
cd day-2 && npm install && npm start
```

Each requires an OpenAI API key in a `.env` file — see the `.env.example` in each folder.

---

## The Learning Arc

```
Day 1 — Tokens & Context
  The model reads tokens, not words. You pay per token. Context is finite.
  Hallucination happens when the model has no grounding.
        ↓
Day 2 — Embeddings & RAG
  Grounding at scale: retrieve only relevant data before each call.
  Same accuracy as stuffing all data in, at a fraction of the token cost.
```
