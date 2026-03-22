import "dotenv/config";
import readline from "readline";
import { calculate } from "./src/calculator.js";
import { SYSTEM_PROMPT, buildInitialPrompt } from "./src/prompts.js";
import { chat, showTokenStats, showTokens, getHistory } from "./src/advisor.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function parseMoney(input) {
  const s = input.trim().toLowerCase().replace(/[$,\s]/g, "");

  // match optional number + optional suffix (k, m, b, million, thousand, billion)
  const match = s.match(/^([\d.]+)\s*(k|m|b|thousand|million|billion)?$/);
  if (!match) return NaN;

  const num = parseFloat(match[1]);
  const suffix = match[2];

  const multipliers = {
    k: 1_000, thousand: 1_000,
    m: 1_000_000, million: 1_000_000,
    b: 1_000_000_000, billion: 1_000_000_000,
  };

  return suffix ? num * multipliers[suffix] : num;
}

function printBanner() {
  console.log("\n" + "═".repeat(55));
  console.log("  PROPERTY BUYING GUIDE — Powered by OpenAI");
  console.log("  Session 1: Tokens · Context · Hallucination");
  console.log("═".repeat(55) + "\n");
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY not set. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  printBanner();

  console.log("Enter your financial details (e.g. 80000 or 80,000):\n");

  const totalSavings = parseMoney(await ask("  Total Savings ($):              "));
  const propertyPrice = parseMoney(await ask("  Property Price ($):             "));
  const salary = parseMoney(await ask("  Annual Salary ($):              "));
  const expenses = parseMoney(await ask("  Monthly Expenses ($):           "));
  const exchangeDepositPct = parseFloat(await ask("  Exchange Deposit % (e.g. 10):   "));

  const inputs = { totalSavings, propertyPrice, salary, expenses, exchangeDepositPct };
  const calc = calculate(totalSavings, propertyPrice, salary, expenses, exchangeDepositPct);

  const initialPrompt = buildInitialPrompt(inputs, calc);
  showTokens(initialPrompt, "YOUR PROMPT");

  console.log("\n" + "─".repeat(55));
  console.log("  Sending to OpenAI... (watch the token stats below)");
  console.log("─".repeat(55));

  try {
    // ── FIRST CALL ─────────────────────────────────────────
    const firstResponse = await chat(SYSTEM_PROMPT, initialPrompt, true);

    console.log("\n📋 PROPERTY ADVISOR SAYS:\n");
    console.log(firstResponse.content);
    showTokens(firstResponse.content, "COMPLETION");
    showTokenStats(firstResponse.usage, "Initial Analysis — Call #1", firstResponse.contextBreakdown);

    // ── LESSON BOX ─────────────────────────────────────────
    console.log("💡 DAY 1 LESSON — What just happened:");
    console.log("   • Your prompt + financial data = PROMPT TOKENS");
    console.log("   • The advice above            = COMPLETION TOKENS");
    console.log("   • Both together               = TOTAL TOKENS (= cost)");
    console.log("   • Context window used so far shown above ^\n");

    // ── FOLLOW-UP CONVERSATION LOOP ────────────────────────
    console.log("─".repeat(55));
    console.log("  Now ask follow-up questions. Watch token count grow.");
    console.log("  Type 'quit' to exit | Type 'history' to see context");
    console.log("─".repeat(55) + "\n");

    let callCount = 1;

    while (true) {
      const userInput = await ask("You: ");

      if (userInput.toLowerCase() === "quit") break;

      if (userInput.toLowerCase() === "history") {
        const history = getHistory();
        console.log(`\n── Conversation History (${history.length} messages) ──`);
        history.forEach((m, i) => {
          const preview = m.content.slice(0, 80).replace(/\n/g, " ");
          console.log(`  [${i + 1}] ${m.role.toUpperCase()}: ${preview}...`);
        });
        console.log();

        // ── LESSON BOX ─────────────────────────────────────
        console.log("💡 DAY 1 LESSON — Context Window:");
        console.log("   • ALL messages above are sent with EVERY new request");
        console.log("   • That's why prompt_tokens keep growing each call");
        console.log("   • At the context limit, oldest messages must be dropped");
        console.log("   • RAG (Session 3) is partially about managing this efficiently\n");
        continue;
      }

      callCount++;
      showTokens(userInput, "YOUR MESSAGE");
      const response = await chat(SYSTEM_PROMPT, userInput);
      console.log(`\nAdvisor: ${response.content}\n`);
      showTokens(response.content, "COMPLETION");
      showTokenStats(response.usage, `Follow-up — Call #${callCount}`);

      // Hallucination warning on interest rate questions
      const lower = userInput.toLowerCase();
      if (
        lower.includes("interest") ||
        lower.includes("rate") ||
        lower.includes("grant") ||
        lower.includes("scheme") ||
        lower.includes("government")
      ) {
        console.log("⚠️  HALLUCINATION WATCH:");
        console.log("   The model may have stated specific rates or grant amounts.");
        console.log("   LLMs are trained on past data — rates change weekly.");
        console.log("   Always verify: RBA website, lender directly, or a broker.\n");
      }
    }
  } catch (err) {
    if (err.status === 401) {
      console.error("\nERROR: Invalid API key. Check your .env file.");
    } else if (err.status === 429) {
      console.error("\nERROR: Rate limit hit. Wait a moment and try again.");
    } else {
      console.error("\nERROR:", err.message);
    }
  }

  rl.close();
  console.log("\nSession ended. Good luck with your property search!");
}

main();
