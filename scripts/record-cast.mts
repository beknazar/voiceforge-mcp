#!/usr/bin/env node
/**
 * Generates an asciinema .cast v2 file showing VoiceForge MCP in Claude Code.
 * Simulates: install → recommend → compare → scaffold → validate
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = path.resolve(import.meta.dirname, "..", "dist", "index.js");
const outPath = path.resolve(import.meta.dirname, "..", "demo.cast");

const client = new Client({ name: "voiceforge-demo", version: "0.2.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe",
});
await client.connect(transport);

const COLS = 120;
const ROWS = 55;

const events: [number, string, string][] = [];
let cursor = 0;

const emit = (text: string) => {
  events.push([cursor, "o", text]);
};

const wait = (seconds: number) => {
  cursor += seconds;
};

const printLine = (text: string) => {
  emit(text + "\r\n");
};

const typeChars = (text: string, speed = 0.035) => {
  for (const ch of text) {
    emit(ch);
    cursor += speed;
  }
};

const callTool = async (tool: string, args: Record<string, unknown>) => {
  // Show the tool call like Claude Code does
  emit("\x1b[2m  \u25cf " + tool + "\x1b[0m");
  cursor += 0.3;
  emit("\r\x1b[K");

  const result = await client.callTool({ name: tool, arguments: args });
  const content = (result as any).content?.[0]?.text ?? "";

  for (const line of content.split("\n")) {
    emit("  " + line + "\r\n");
    cursor += 0.012;
  }

  return content;
};

// ─── Simulated Claude Code session ───────────────────────────────────

// Shell prompt
const prompt = "\x1b[1m\x1b[34m~/my-voice-app\x1b[0m \x1b[2m$\x1b[0m ";

// Step 0: Show install
printLine("");
emit(prompt);
wait(0.5);
typeChars("claude mcp add voiceforge-mcp -- npx -y voiceforge-mcp", 0.03);
emit("\r\n");
wait(0.4);
printLine("\x1b[32m\u2713\x1b[0m Added voiceforge-mcp MCP server");
wait(1);

// Launch Claude Code
printLine("");
emit(prompt);
wait(0.3);
typeChars("claude", 0.05);
emit("\r\n");
wait(0.8);

// Claude Code header
printLine("");
printLine("\x1b[1m\x1b[35m\u2588\x1b[0m \x1b[1mClaude Code\x1b[0m \x1b[2mv1.0.22\x1b[0m");
printLine("\x1b[2m  Using: claude-sonnet-4-5 with voiceforge-mcp\x1b[0m");
printLine("");
wait(1);

// ─── User message 1: Recommend ──────────────────────────────────────

emit("\x1b[1m\x1b[32m>\x1b[0m ");
typeChars("I'm building a Thai customer support voice agent. What's the best stack?", 0.03);
emit("\r\n");
wait(1);

// Claude's response with tool call
printLine("");
printLine("  I'll check our production benchmarks for Thai customer support stacks.");
printLine("");
wait(0.5);

await callTool("voiceforge_recommend", {
  language: "Thai",
  use_case: "customer support",
  optimize_for: "quality",
  max_results: 5,
});
wait(0.5);

printLine("");
printLine("  The top pick is \x1b[1mDeepgram nova-3 + Google Gemini Flash + Cartesia sonic-3\x1b[0m at");
printLine("  148ms latency and just $0.004/min. 5 providers compete \u2014 you can see how");
printLine("  each trades off speed, quality, and cost above.");
wait(3);

// ─── User message 2: Compare ────────────────────────────────────────

printLine("");
emit("\x1b[1m\x1b[32m>\x1b[0m ");
typeChars("Compare the OpenAI stack vs the Claude stack for this", 0.03);
emit("\r\n");
wait(1);

printLine("");
printLine("  Let me pull up a side-by-side comparison.");
printLine("");
wait(0.5);

await callTool("voiceforge_compare", {
  combo_a: "Deepgram nova-3 + OpenAI gpt-4.1-mini + Cartesia sonic-3",
  combo_b: "Deepgram nova-3 + Anthropic claude-sonnet-4-5 + Cartesia sonic-3",
});
wait(0.5);

printLine("");
printLine("  OpenAI wins on latency (30ms faster) and cost. Anthropic edges out on");
printLine("  quality (4.6 vs 4.5) and excels at nuanced conversations. OpenAI also");
printLine("  covers 2 extra languages (Vietnamese, Indonesian).");
wait(3);

// ─── User message 3: Scaffold ───────────────────────────────────────

printLine("");
emit("\x1b[1m\x1b[32m>\x1b[0m ");
typeChars("Scaffold a LiveKit agent with the best stack", 0.03);
emit("\r\n");
wait(1);

printLine("");
printLine("  Generating a complete LiveKit Agents project for Thai customer support.");
printLine("");
wait(0.5);

await callTool("voiceforge_scaffold", {
  language: "Thai",
  use_case: "customer support",
  framework: "livekit",
  agent_name: "thai-support-agent",
});
wait(0.5);

printLine("");
printLine("  Your project is ready at \x1b[1m./thai-support-agent/\x1b[0m with 5 files:");
printLine("  \x1b[2magent.py, requirements.txt, voiceforge.yaml, .env.example, README.md\x1b[0m");
printLine("  Fill in your API keys and run \x1b[1mpython agent.py dev\x1b[0m to start.");
wait(3);

// ─── User message 4: Validate ───────────────────────────────────────

printLine("");
emit("\x1b[1m\x1b[32m>\x1b[0m ");
typeChars("Validate the Deepgram + OpenAI + Cartesia stack", 0.03);
emit("\r\n");
wait(1);

printLine("");
printLine("  Checking this stack against our benchmark data and scaffold compatibility.");
printLine("");
wait(0.5);

await callTool("voiceforge_validate", {
  stt_provider: "Deepgram",
  stt_model: "nova-3",
  llm_provider: "OpenAI",
  llm_model: "gpt-4.1-mini",
  tts_provider: "Cartesia",
  tts_model: "sonic-3",
  framework: "livekit",
});
wait(0.5);

printLine("");
printLine("  \x1b[32m\u2713 Stack validated.\x1b[0m Benchmark-matched at 168ms, 4.5/5 quality, $0.007/min.");
printLine("  LiveKit scaffold is fully supported. Ready for your demo.");
wait(3);

// ─── Footer ──────────────────────────────────────────────────────────

printLine("");
printLine("\x1b[2m" + "\u2500".repeat(80) + "\x1b[0m");
printLine("");
printLine("  \x1b[1mVoiceForge MCP\x1b[0m \x1b[2m\u2014 DevOps for voice AI agents\x1b[0m");
printLine("  \x1b[2m12 tested combos \u00b7 10 languages \u00b7 Production data from enterprise deployments\x1b[0m");
printLine("");
printLine("  \x1b[1mInstall:\x1b[0m claude mcp add voiceforge-mcp -- npx -y voiceforge-mcp");
printLine("  \x1b[2mhttps://getvoiceforge.com \u00b7 Built by Beknazar Abdikamalov\x1b[0m");
printLine("");
wait(4);

// ─── Write .cast file ────────────────────────────────────────────────

const header = {
  version: 2,
  width: COLS,
  height: ROWS,
  timestamp: Math.floor(Date.now() / 1000),
  title: "VoiceForge MCP \u2014 Claude Code Demo",
  env: { TERM: "xterm-256color", SHELL: "/bin/zsh" },
};

const lines: string[] = [JSON.stringify(header)];
for (const [ts, type, data] of events) {
  lines.push(JSON.stringify([ts, type, data]));
}
writeFileSync(outPath, lines.join("\n") + "\n");

await client.close();

console.log(`Done: ${events.length} events, ${cursor.toFixed(1)}s \u2192 ${outPath}`);
