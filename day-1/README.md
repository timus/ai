# Day 1 — LLM Basics: Tokens, Context, Hallucination

A property buying guide CLI that **teaches core LLM concepts by making them visible** in real time.

Every API call shows you the actual tokens, context window usage, cost, and call history — so you
learn by watching the numbers change as you type.

---

## The Teaching Approach

Most LLM tutorials explain these concepts with diagrams. This app makes you **feel** them:

| Concept | How the app teaches it |
|---|---|
| **Tokens** | Shows `["What"," if"," rates"," go"," up"]` — your actual text split into tokens |
| **Prompt tokens** | Bar chart of what you sent, counted and costed after every call |
| **Completion tokens** | Bar chart of what the model replied, with the actual token array |
| **Context window** | Breakdown: System prompt / History / This message / Remaining free space |
| **Context growth** | Call history bars — watch prompt tokens grow with every follow-up |
| **Hallucination** | Ask about interest rates — model states confidently, app fires a warning |

---

## What You'll Learn

### 1. Tokens

**What they are:**
A token is the smallest unit an LLM reads and writes. It is NOT the same as a word.
- `"property"` → 1 token
- `"unaffordable"` → 3 tokens (`un`, `afford`, `able`)
- `"$80,000"` → 3 tokens (`$`, `80`, `,000`)

Rules of thumb:
- ~1 token per 4 characters in English
- 1,000 tokens ≈ 750 words
- You pay for **both** what you send (prompt) and what the model replies (completion)

**What you see in the app — before every API call:**
```
  TOKENS — YOUR PROMPT (38 tokens)
  ["Here"," is"," my"," financial"," situation"," for"," buying"," a"," property",":"," ..."...]

  TOKENS — COMPLETION (94 tokens)
  ["Based"," on"," your"," situation",","," here"," is"," my"," verdict",":"," ..."...]
```
This is the real tiktoken output — the exact bytes the model processes.

**Where to see it in code:**

| What | File |
|---|---|
| `tokenizeText()` — splits any string into token array | [src/advisor.js](src/advisor.js#L10-L19) |
| `showTokens()` — prints the array before/after each call | [src/advisor.js](src/advisor.js#L21-L25) |
| `PRICING` — cost per 1M tokens by model | [src/advisor.js](src/advisor.js#L28-L31) |

---

### 2. Context Window

**What it is:**
The context window is the total tokens the model can "see" in a single call. It includes:
- Your system prompt
- Every previous message in the conversation
- The current message you are sending

The model has **no memory between calls** — you send the full history every time.
This is why `prompt_tokens` grows with every follow-up question.

**How it grows with each call:**
```
Call #1 — You enter your property details
┌─────────────────────────────────────────────────────┐
│ System Prompt  │  Your Financial Data                │  ~400 tokens
└─────────────────────────────────────────────────────┘

Call #2 — You ask "What if rates go up 2%?"
┌─────────────────────────────────────────────────────┐
│ System Prompt  │  Your Financial Data  │  AI Reply 1 │  ~800 tokens
│  Your Question #2                                    │
└─────────────────────────────────────────────────────┘

Call #3 — You ask "How long until I can afford this?"
┌─────────────────────────────────────────────────────┐
│ System Prompt  │  Your Financial Data  │  AI Reply 1 │
│  Your Question #2  │  AI Reply 2  │  Your Question #3│  ~1,200 tokens
└─────────────────────────────────────────────────────┘

Every call = everything above sent again from scratch.
```
The window is like a **sliding notepad** — the model reads it all every time, but can only hold so much.

| Model | Context Window |
|---|---|
| GPT-3.5-turbo | 4,096 tokens (~3,000 words) |
| GPT-4o-mini | 128,000 tokens (~96,000 words) |
| GPT-4o | 128,000 tokens |

When the context fills up, old messages must be dropped or the call fails.
Managing this efficiently is the foundation of RAG (Day 3).

**What you see in the app — after every call:**
```
  CONTEXT WINDOW — 0.64% of 128,000 token limit
  System prompt  [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░]    142 tokens
  History        [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]      0 tokens
  This message   [███░░░░░░░░░░░░░░░░░░░░░░░░░░]    680 tokens
  ─────────────────────────────────────────────────
  Total used     [███░░░░░░░░░░░░░░░░░░░░░░░░░░]    822 / 128,000
  Remaining      [█████████████████████████░░░░] 127,178 free
```
Type `history` to see every message being packed into the next call.

**Where to see it in code:**

| What | File |
|---|---|
| `conversationHistory[]` grows with every message | [src/advisor.js](src/advisor.js#L114) |
| Full history sent on every API call | [src/advisor.js](src/advisor.js#L134-L140) |
| Per-part tokenization before sending | [src/advisor.js](src/advisor.js#L127-L132) |
| Context breakdown in `showTokenStats()` | [src/advisor.js](src/advisor.js#L76-L84) |

---

### 3. Hallucination

**What it is:**
Hallucination is when the model confidently states something incorrect or made up.
LLMs are trained to produce fluent, confident-sounding text — they do not "know" when they are wrong.

Common traps in property/finance:
- **Interest rates** — trained on past data, states outdated rates as current fact
- **Government grants** — amounts change; model may cite wrong figures
- **Legal processes** — varies by state, model may generalise incorrectly

**How to trigger it — ask any of these:**
```
You: What is the current interest rate?
You: Are there any government grants I can get?
You: What is the stamp duty in my state?
```

The app fires a warning automatically:
```
⚠️  HALLUCINATION WATCH:
   The model may have stated specific rates or grant amounts.
   LLMs are trained on past data — rates change weekly.
   Always verify: RBA website, lender directly, or a broker.
```

**How we reduce it — two techniques used here:**

1. **Prompt rules** — the system prompt explicitly instructs the model:
   > *"Never state specific interest rates as fact"*
   > *"If you are unsure, say so clearly"*

2. **Grounding** — instead of letting the model guess numbers, we calculate them and send them:
   - LVR, repayment estimates, stamp duty, LMI cost → all pre-calculated in [src/calculator.js](src/calculator.js)
   - Model receives facts, not questions about facts

True grounding at scale requires real data retrieval — that is RAG (Day 3).

**Where to see it in code:**

| What | File |
|---|---|
| System prompt anti-hallucination rules | [src/prompts.js](src/prompts.js#L9-L19) |
| Pre-calculated numbers sent to model | [src/prompts.js](src/prompts.js#L21-L65) |
| Hallucination keyword detector | [index.js](index.js#L122-L135) |

---

## Project Structure

```
day-1/
├── index.js              ← CLI entry, conversation loop, hallucination detector
├── src/
│   ├── calculator.js     ← Financial math: deposit, LVR, LMI, stamp duty, repayments
│   ├── advisor.js        ← OpenAI calls, tokenizer, token stats, context breakdown
│   └── prompts.js        ← System prompt + grounded user prompt builder
├── .env                  ← OpenAI API key (git ignored)
├── .env.example          ← Key template
└── package.json          ← ES modules ("type": "module")
```

---

## How to Run

This is a **CLI app** — runs entirely in your terminal.

### 1. Install
```bash
npm install
```

### 2. API key
```bash
cp .env.example .env
# add your OpenAI key inside .env
```

### 3. Start
```bash
npm start
```

### 4. Enter your details
```
  Total Savings ($):              100000
  Property Price ($):             600000
  Annual Salary ($):              95000
  Monthly Expenses ($):           3000
  Exchange Deposit % (e.g. 10):   10
```

Accepts any format: `100k`, `1m`, `600,000`, `$80000`, `1 million`.

### 5. Watch the output

The app shows token arrays before and after every call, then the full stats panel:
```
  TOKENS — YOUR PROMPT (38 tokens)
  ["Here"," is"," my"," financial"...]

  TOKENS — COMPLETION (94 tokens)
  ["Based"," on"," your"," situation"...]

  TOKEN USAGE (Initial Analysis — Call #1)
  THIS CALL
  Prompt     [███░░░░░░░░░░░░░░░░░░░░░░░░░░░]     820
  Completion [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]     240
  Cost       $0.000267 USD

  CONTEXT WINDOW — 0.64% of 128,000 token limit
  System prompt  [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░]    142 tokens
  History        [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]      0 tokens
  This message   [███░░░░░░░░░░░░░░░░░░░░░░░░░░]    680 tokens
  Total used     [███░░░░░░░░░░░░░░░░░░░░░░░░░░]    822 / 128,000
  Remaining      [█████████████████████████░░░░] 127,178 free

  CALL HISTORY
  #1  prompt [████████░░░░░░░░]    822  reply [████░░░░░░]    240  ctx 0.64%

  SESSION TOTALS
  All tokens [████████████████████░░░░░░░░░░]   1,062
  Total cost $0.000267 USD
```

### 6. Ask follow-up questions

```
You: What if rates go up 2%?         ← watch prompt tokens grow
You: Are there government grants?     ← triggers hallucination warning
You: history                          ← see full context being sent
You: quit                             ← exit
```

| Command | What it teaches |
|---|---|
| Any question | Context grows — prompt tokens increase each call |
| Interest rate / grant questions | Hallucination in action + warning fires |
| `history` | See every message packed into the context |
| `quit` | Exit |

---

## Key Takeaway

> The model does not think. It predicts the next token based on all previous tokens.
>
> **Tokens** = cost. **Context** = memory. **Hallucination** = confident prediction without truth.
>
> Everything in AI architecture — RAG, agents, chunking, streaming — is ultimately about
> managing these three things efficiently at scale.

**Next** Embeddings and Vector Databases
