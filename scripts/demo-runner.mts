#!/usr/bin/env node
/**
 * VoiceForge MCP Demo Runner
 * Produces clean, polished terminal output for recording.
 */
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = path.resolve(import.meta.dirname, "..", "dist", "index.js");

const client = new Client({ name: "voiceforge-demo", version: "0.2.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe",
});

await client.connect(transport);

const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const typeText = async (text: string, speed = 30) => {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(speed);
  }
  console.log();
};

const banner = async (step: string, question: string) => {
  console.log();
  console.log(`${DIM}${"─".repeat(70)}${RESET}`);
  console.log(`${BOLD}${CYAN}${step}${RESET}`);
  await sleep(500);
  await typeText(`${YELLOW}> ${question}${RESET}`, 25);
  await sleep(300);
  console.log();
};

const call = async (tool: string, args: Record<string, unknown>) => {
  process.stdout.write(`${DIM}  calling ${tool}...${RESET}`);
  const result = await client.callTool({ name: tool, arguments: args });
  const content = (result as any).content?.[0]?.text;
  process.stdout.write(`\r${" ".repeat(40)}\r`);
  if (content) console.log(content);
  return content;
};

// ─── Header ──────────────────────────────────────────────────────────

console.log();
console.log(`${BOLD}  VoiceForge MCP${RESET} ${DIM}— DevOps for Voice AI Agents${RESET}`);
console.log(`${DIM}  npx voiceforge-mcp · https://getvoiceforge.com${RESET}`);
console.log();
await sleep(1500);

// ─── Step 1: Recommend ───────────────────────────────────────────────

await banner(
  "Step 1 — Recommend",
  "What's the best voice stack for Thai customer support?"
);
await call("voiceforge_recommend", {
  language: "Thai",
  use_case: "customer support",
  optimize_for: "quality",
  max_results: 5,
});
await sleep(3000);

// ─── Step 2: Compare ─────────────────────────────────────────────────

await banner(
  "Step 2 — Compare",
  "Compare OpenAI gpt-4.1-mini vs Anthropic Claude for this stack"
);
await call("voiceforge_compare", {
  combo_a: "Deepgram nova-3 + OpenAI gpt-4.1-mini + Cartesia sonic-3",
  combo_b: "Deepgram nova-3 + Anthropic claude-sonnet-4-5 + Cartesia sonic-3",
});
await sleep(3000);

// ─── Step 3: Scaffold ────────────────────────────────────────────────

await banner(
  "Step 3 — Scaffold",
  "Generate a LiveKit agent project with the winning stack"
);
await call("voiceforge_scaffold", {
  language: "Thai",
  use_case: "customer support",
  framework: "livekit",
  agent_name: "thai-support-agent",
});
await sleep(3000);

// ─── Step 4: Validate ────────────────────────────────────────────────

await banner(
  "Step 4 — Validate",
  "Validate the Deepgram + OpenAI + Cartesia stack before the demo"
);
await call("voiceforge_validate", {
  stt_provider: "Deepgram",
  stt_model: "nova-3",
  llm_provider: "OpenAI",
  llm_model: "gpt-4.1-mini",
  tts_provider: "Cartesia",
  tts_model: "sonic-3",
  framework: "livekit",
});
await sleep(2000);

// ─── Footer ──────────────────────────────────────────────────────────

console.log();
console.log(`${DIM}${"─".repeat(70)}${RESET}`);
console.log();
console.log(`${GREEN}${BOLD}  ✓ From question to running project in 4 steps${RESET}`);
console.log(`${DIM}  12 tested combos · 10 languages · Production data from enterprise deployments${RESET}`);
console.log();
console.log(`${BOLD}  Install:${RESET} claude mcp add voiceforge-mcp -- npx -y voiceforge-mcp`);
console.log(`${DIM}  Built by Beknazar Abdikamalov · linkedin.com/in/abdik${RESET}`);
console.log();

await client.close();
