# Day 2 — RAG & Embeddings: Property Guide Chatbot

In Day 1 we learned how LLMs read tokens, how the context window fills up, and how hallucination happens when the model has no grounding.

This session fixes the grounding problem — with real data.

You scrape live property listings from Domain.com.au, embed them into a vector store, then chat with an AI that retrieves the most relevant properties before answering. The model only ever sees what was retrieved. It cannot invent listings that don't exist.

---

## What You'll Learn

- **Embeddings** — how text becomes a list of numbers that captures meaning
- **Chunking** — why 1 listing = 1 chunk, and when you'd choose differently
- **Vector store** — cosine similarity search, in memory, no database required
- **RAG pipeline** — query → embed → retrieve → inject → LLM answers
- **Hallucination guard** — system prompt rules + structural enforcement
- **Embedding cost** — compute once, cache forever, zero cost at query time

---

## How It Works

```
npm run prepare-data              npm start
────────────────────              ──────────────────────────
Scrape Domain.com.au       →      Load cached embeddings
Convert listings to text   →      You ask a question
Embed with OpenAI          →      Embed your question
Cache vectors to disk      →      Cosine search → top 5 listings
                                  Inject listings into prompt
                                  LLM answers from real data only
```

---

## How to Run

### 1. Install

```bash
cd day-2
npm install
```

### 2. API key

```bash
cp .env.example .env
# add your OpenAI key inside .env
```

### 3. Build the knowledge base

```bash
npm run prepare-data -- --suburb toongabbie-nsw-2146
npm run prepare-data -- --suburb seven-hills-nsw-2147
```

This walks you through every step of the pipeline — scraping, chunking, embedding cost, vector preview, and file size. Add `--max-pages 3` to limit pages when testing.

### 4. Start the chatbot

```bash
npm start
```

### 5. Ask questions

```
You: show me 3 bed houses under $900k
You: any properties with a pool?
You: what's the cheapest 4 bedroom?
```

**Teaching commands:**

| Command | What it shows |
|---|---|
| `show chunks` | Which listings were retrieved + their cosine similarity scores |
| `show prompt` | The exact system prompt — persona, rules, hallucination guard |
| `tokens` | Full token breakdown: what's in the prompt and what each part costs |
| `quit` | Exit |

---

## Key Concepts

### Embeddings

An embedding converts text into a dense float vector that captures meaning, not just words.

```
"3 bed house with pool"         → [0.021, -0.043, 0.118, ...]   (1,536 numbers)
"three bedroom home, swim pool" → [0.019, -0.041, 0.121, ...]   ← nearly identical
"commercial office for lease"   → [0.103,  0.287, -0.044, ...]  ← very different
```

Texts about the same thing land close together in this 1,536-dimensional space. That closeness is what makes semantic search work — no keyword matching required.

Cost: `text-embedding-3-small` is $0.02 per million tokens. Embedding 100 listings costs under $0.001. Embeddings are computed once in `prepare-data` and cached to disk — zero cost when the chatbot runs.

### Chunking

Each property listing becomes **one chunk** containing address, beds/baths/cars, price, features, and description together.

Why not split them? Because a query like "3 bedroom house with pool under $900k" needs all those fields in the same chunk to score correctly. Splitting address from price from features breaks retrieval.

For a 100-page PDF you'd chunk differently — one paragraph per chunk. Chunk granularity is always a design decision based on how users will query.

### RAG Pipeline

```
User: "3 bed house with pool"
  ↓  embed query          → [0.021, -0.043, ...]
  ↓  cosine search        → top 5 listings by similarity score
  ↓  inject into prompt   → "Here are the relevant listings: ..."
  ↓  LLM answers          → from retrieved context only
```

The model never sees listings it wasn't given. Ask about a suburb that hasn't been scraped — it says so rather than guessing.

### Hallucination Guard

The system prompt tells the model:
- Only recommend properties that appear in the retrieved context
- Never invent addresses, prices, or features
- If no match is found, say so clearly — do not guess

The retrieved listings are also appended directly to every user message, so the model is structurally limited to real data — not just instructed to behave.

### Cosine Similarity

The search scores tell you how close the query meaning was to each listing:

- **0.85+** strong match — query and listing are about the same thing
- **0.70** moderate match — related topic, different specifics
- **0.55** weak match — loosely related

Type `show chunks` after any question to see these scores.

---

## Scraper Note

We scrape Domain.com.au directly — this is not a reliable data source. The site structure can change, pages may be blocked, and results vary. It is fine for learning purposes, but a real product would use an official API or licensed data feed.

The scraper tries Puppeteer (headless Chrome) first, then falls back to plain `fetch`. To unlock full data via Puppeteer on Ubuntu/Debian:

```bash
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2
```

---

> RAG gives the model exactly what it needs — not everything you have.
>
> Embeddings turn meaning into geometry. Retrieval finds the right slice. The model answers from facts, not predictions.

**Previous:** [Day 1 — Tokens, Context, Hallucination](../day-1/README.md)
**Next:** Day 3 — Agents and Tool Use
