import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
};

type HealthPayload = {
  status: string;
  timestamp: string;
  total_benchmarks: number;
  data_snapshot: string;
  supported_languages: number;
  coverage_by_language: Array<{ language: string; count: number }>;
  verbose: boolean;
};

type ComparePayload = {
  status: string;
  reason?: string;
  candidate_counts?: { a: number; b: number };
  matches_found?: { a: number; b: number };
  winners?: { latency: string; quality: string; cost: string };
};

const serverPath = path.resolve(process.cwd(), "dist", "index.js");

let client: Client;

const parseToolPayload = (result: ToolResult): Record<string, unknown> => {
  const first = result?.content?.[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Tool response missing text payload");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
};

beforeAll(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
  });

  client = new Client({
    name: "voiceforge-mcp-e2e",
    version: "0.2.0",
  });

  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
});

test("exposes all expected tools", async () => {
  const toolsResult = await client.listTools();
  const names = toolsResult.tools.map((tool) => tool.name).sort();
  expect(names).toEqual([
    "voiceforge_benchmark",
    "voiceforge_compare",
    "voiceforge_config",
    "voiceforge_health",
    "voiceforge_providers",
    "voiceforge_recommend",
    "voiceforge_scaffold",
    "voiceforge_validate",
  ].sort());
});

test("health endpoint returns reproducible status payload", async () => {
  const result = await client.callTool({
    name: "voiceforge_health",
    arguments: {
      output_format: "json",
      verbose: false,
    },
  });

  const payload = parseToolPayload(result as ToolResult) as HealthPayload;
  expect(payload.status).toBe("ok");
  expect(payload.data_snapshot).toBe("2026-02-15T00:00:00Z");
  expect(payload.total_benchmarks).toBeGreaterThan(0);
  expect(payload.supported_languages).toBe(10);
  expect(payload.coverage_by_language).toHaveLength(10);
  expect(payload.verbose).toBe(false);
  expect(payload.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
});

test("benchmark rejects unknown language with recoverable suggestions", async () => {
  const result = await client.callTool({
    name: "voiceforge_benchmark",
    arguments: {
      language: "Nigerian",
      output_format: "json",
    },
  });

  const payload = parseToolPayload(result as ToolResult);
  expect(payload).toMatchObject({
    status: "error",
    reason: "unsupported-language",
  });
  expect(Array.isArray(payload.suggestions)).toBe(true);
});

test("benchmark rejects unknown provider with sorted provider list", async () => {
  const result = await client.callTool({
    name: "voiceforge_benchmark",
    arguments: {
      provider: "NopeAI",
      output_format: "json",
    },
  });

  const payload = parseToolPayload(result as ToolResult);
  expect(payload).toMatchObject({
    status: "error",
    reason: "unsupported-provider",
  });

  const providers = payload.supported_providers as string[];
  expect(Array.isArray(providers)).toBe(true);
  const sorted = [...providers].sort();
  expect(providers).toEqual(sorted);

  expect(providers).toHaveLength(11);
});

test("compare accepts alias-heavy provider input and returns structured winners", async () => {
  const result = await client.callTool({
    name: "voiceforge_compare",
    arguments: {
      combo_a: "deepgram nova-3 + open ai gpt-4.1-mini + cartesia sonic-3",
      combo_b: "AssemblyAI universal-3-pro + OpenAI gpt-4.1-mini + Cartesia sonic-3",
      output_format: "json",
    },
  });

  const payload = parseToolPayload(result as ToolResult) as ComparePayload;
  expect(payload.status).toBe("ok");
  expect(payload.winners).toEqual({
    latency: expect.any(String),
    quality: expect.any(String),
    cost: expect.any(String),
  });
  expect(payload.candidate_counts?.a).toBe(1);
  expect(payload.candidate_counts?.b).toBe(1);
});

test("compare returns clear no-matching-combo error for invalid model", async () => {
  const result = await client.callTool({
    name: "voiceforge_compare",
    arguments: {
      combo_a: "Deepgram nova-3 + OpenAI gpt-4.1-mini + Cartesia sonic-3",
      combo_b: "Deepgram nova-3 + OpenAI gpt-4.999 + Cartesia sonic-3",
      output_format: "json",
    },
  });

  const payload = parseToolPayload(result as ToolResult) as ComparePayload;
  expect(payload.status).toBe("error");
  expect(payload.reason).toBe("no-matching-combo");
  expect(payload.matches_found).toEqual({
    a: 1,
    b: 0,
  });
});

test("validate returns warning payload for unknown model but keeps guidance", async () => {
  const result = await client.callTool({
    name: "voiceforge_validate",
    arguments: {
      stt_provider: "Deepgram",
      stt_model: "nova-3",
      llm_provider: "OpenAI",
      llm_model: "gpt-not-a-real-model",
      tts_provider: "Cartesia",
      tts_model: "sonic-3",
      output_format: "json",
    },
  });

  const payload = parseToolPayload(result as ToolResult);
  expect(payload).toMatchObject({
    status: "warning",
    reason: "unsupported-model",
  });
  expect((payload.unknown_models as string[])).toContain("llm");
});

test("config generates valid YAML scaffold payload with quality targets", async () => {
  const result = await client.callTool({
    name: "voiceforge_config",
    arguments: {
      agent_name: "yc-demo-agent",
      stt_provider: "deepgram",
      stt_model: "nova-3",
      llm_provider: "open ai",
      llm_model: "gpt-4.1-mini",
      tts_provider: "cartesia",
      tts_model: "sonic-3",
      language: "English",
      use_case: "customer support",
      output_format: "json",
    },
  });

  const payload = parseToolPayload(result as ToolResult);
  expect(payload.status).toBe("ok");
  expect(payload.unknown_models).toEqual({
    stt: false,
    llm: false,
    tts: false,
  });
  expect(payload.config).toMatchObject({
    stt_provider: "Deepgram",
    llm_provider: "OpenAI",
    tts_provider: "Cartesia",
  });

  const yaml = payload.yaml as string;
  expect(typeof yaml).toBe("string");
  expect(yaml).toMatch(/quality_targets:\n\s{4}latency_p95_ms: 250/);
  expect(yaml).toMatch(/min_utmos: 4\.0/);
});
