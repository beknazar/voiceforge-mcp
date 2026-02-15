#!/usr/bin/env node

/**
 * VoiceForge MCP Server
 *
 * An MCP server that helps developers build voice AI applications.
 * Provides tools to recommend optimal STT+LLM+TTS combinations,
 * benchmark stacks, scaffold projects, and generate configs.
 *
 * Built by Beknazar Abdikamalov — 4 years building production voice AI.
 * https://getvoiceforge.com
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  BENCHMARK_DATA,
  USE_CASE_PRIORITIES,
  SUPPORTED_LANGUAGES,
  PROVIDER_INFO,
  type BenchmarkEntry,
} from "./data/benchmarks.js";
import { getLiveKitAgentTemplate, getNextJSTemplate } from "./data/templates.js";

const server = new McpServer({
  name: "voiceforge",
  version: "0.2.0",
});

type ScoreWeights = { latency: number; quality: number; cost: number };
type ProviderCategory = "stt" | "llm" | "tts";
type ScaffoldFramework = "livekit" | "nextjs";
type ParsedProviderModel = {
  provider: string;
  model?: string;
};
type ParsedCombo = {
  stt: ParsedProviderModel;
  llm: ParsedProviderModel;
  tts: ParsedProviderModel;
};

const MAX_RESULTS = 10;
const MIN_PROVIDER_INPUT_LENGTH = 3;
const MIN_LANGUAGE_PREFIX_LENGTH = 3;
const DEFAULT_WEIGHTS: ScoreWeights = { latency: 70, quality: 70, cost: 60 };
const DATA_SOURCE_UPDATED_AT = "2026-02-15T00:00:00Z";
type ToolOutputFormat = "markdown" | "json";

const FRAMEWORK_COMPATIBILITY: Record<ScaffoldFramework, {
  stt: ReadonlySet<string>;
  llm: ReadonlySet<string>;
  tts: ReadonlySet<string>;
}> = {
  livekit: {
    stt: new Set(["Deepgram", "OpenAI", "Google"]),
    llm: new Set(["OpenAI", "Anthropic", "Google"]),
    tts: new Set(["Cartesia", "ElevenLabs"]),
  },
  nextjs: {
    stt: new Set(),
    llm: new Set(),
    tts: new Set(["ElevenLabs"]),
  },
};

const LANGUAGE_ALIASES: Record<string, string[]> = {
  english: ["en", "eng", "american", "us", "gb"],
  thai: ["th", "thai", "thai language"],
  vietnamese: ["vi", "viet", "vietnamese"],
  indonesian: ["id", "ind"],
  filipino: ["tl", "filipino", "tagalog", "ph"],
  japanese: ["ja", "jp", "nihongo"],
  korean: ["ko", "kr", "hangul", "korean"],
  cantonese: ["zh-yue", "cantonese", "kantonees", "cn-cant"],
  mandarin: ["zh", "zh-cn", "zh-hans", "mandarin"],
  malay: ["ms", "ms-my", "malay"],
};

const PROVIDER_ALIASES: Record<string, string[]> = {
  Deepgram: ["deepgram", "deep gram"],
  AssemblyAI: ["assemblyai", "assembly ai", "assembly"],
  OpenAI: ["openai", "open ai", "open-ai", "gpt", "chatgpt"],
  Speechmatics: ["speechmatics", "speech-matics", "speech matics"],
  Google: ["google", "gemini"],
  Anthropic: ["anthropic", "claude", "claude ai"],
  Groq: ["groq", "llama", "llama 4", "llama-4", "llama4"],
  Cartesia: ["cartesia", "cartes ia"],
  ElevenLabs: ["elevenlabs", "eleven labs", "eleven", "eleven-labs"],
  PlayHT: ["playht", "play ht", "play-ht"],
  Rime: ["rime", "rime ai"],
};

const ALL_PROVIDERS = Object.keys(PROVIDER_ALIASES);

const USE_CASE_ALIASES: Record<string, string[]> = {
  "customer-support": ["customer support", "support", "cs", "customer"],
  sales: ["sale", "sales", "revenue"],
  "debt-collections": ["debt collection", "collections", "collection", "collections team"],
  scheduling: ["schedule", "calendar", "appointments", "booking"],
  "healthcare-triage": ["healthcare", "medical", "triage", "doctor", "clinic"],
  "insurance-claims": ["claims", "insurance", "insurance claim", "claims ops"],
  "lead-qualification": ["lead qualify", "leads", "qualification", "lead"],
  "appointment-reminders": ["reminder", "appointment", "notification", "nudge"],
  "banking-faq": ["banking", "faq", "finance", "compliance"],
  "recruitment-screening": ["recruiting", "recruitment", "screening", "hiring", "interviews"],
};

const normalizeTerm = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

function toSafeSlug(value: string): string {
  const normalized = normalizeTerm(value);
  return normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function normalizeUseCase(use_case: string): string {
  return normalizeTerm(use_case).replace(/\s+/g, "-");
}

function normalizeProviderInput(input: string): string {
  return normalizeTerm(input);
}

const PROVIDER_ALIAS_CATALOG = Object.entries(PROVIDER_ALIASES).flatMap(([provider, aliases]) => {
  const allAliases = [...new Set([provider, ...aliases].map(normalizeProviderInput))].filter(Boolean);
  return allAliases.map((alias) => ({ provider, alias }));
}).sort((a, b) => b.alias.length - a.alias.length);

function resolveProviderMatch(input: string): { provider: string; matchedAlias: string } | null {
  const normalized = normalizeProviderInput(input);
  if (!normalized || normalized.length < MIN_PROVIDER_INPUT_LENGTH) return null;

  for (const candidate of PROVIDER_ALIAS_CATALOG) {
    if (candidate.alias.length < MIN_PROVIDER_INPUT_LENGTH) continue;

    if (
      candidate.alias === normalized ||
      candidate.alias.startsWith(normalized) ||
      normalized.startsWith(`${candidate.alias} `)
    ) {
      return {
        provider: candidate.provider,
        matchedAlias: candidate.alias,
      };
    }
  }

  return null;
}

function resolveLanguage(input: string): string | null {
  const normalized = normalizeTerm(input);
  if (!normalized) return null;

  const direct = SUPPORTED_LANGUAGES.find((lang) => normalizeTerm(lang) === normalized);
  if (direct) return direct;

  const canonical = Object.keys(LANGUAGE_ALIASES).find((lang) => {
    const aliases = LANGUAGE_ALIASES[lang];
    return aliases.some((alias) => normalized === normalizeTerm(alias));
  });
  if (canonical) {
    return SUPPORTED_LANGUAGES.find((lang) => normalizeTerm(lang) === canonical) || canonical;
  }

  if (normalized.length >= MIN_LANGUAGE_PREFIX_LENGTH) {
    const startsWith = SUPPORTED_LANGUAGES.find(
      (lang) =>
        normalizeTerm(lang).startsWith(normalized) ||
        normalized.startsWith(normalizeTerm(lang))
    );
    if (startsWith) return startsWith;
  }

  return null;
}

function getLanguageSuggestions(input: string): string[] {
  const normalized = normalizeTerm(input);
  if (!normalized) return SUPPORTED_LANGUAGES.slice(0, 5);
  const exact = SUPPORTED_LANGUAGES.filter((lang) =>
    normalizeTerm(lang).includes(normalized) || normalized.includes(normalizeTerm(lang))
  );
  const byAlias = SUPPORTED_LANGUAGES.filter((lang) =>
    (LANGUAGE_ALIASES[normalizeTerm(lang)] ?? []).some((alias) => normalizeTerm(alias).includes(normalized))
  );
  return [...new Set([...exact, ...byAlias])].slice(0, 5);
}

function resolveProvider(input: string): string | null {
  const resolved = resolveProviderMatch(input);
  return resolved ? resolved.provider : null;
}

function parseProviderWithModel(input: string): ParsedProviderModel | null {
  const normalized = normalizeProviderInput(input);
  if (!normalized) return null;

  const resolved = resolveProviderMatch(input);
  if (!resolved) return null;

  // Extract model from normalized form for matching, but preserve original formatting
  const normalizedRemainder = normalized.slice(resolved.matchedAlias.length).trim();
  if (!normalizedRemainder) return { provider: resolved.provider };

  // Find where the model starts in the original input (after the provider alias match)
  const originalTrimmed = input.trim();
  const aliasWords = resolved.matchedAlias.split(/\s+/).length;
  const inputWords = originalTrimmed.split(/\s+/);
  const originalModel = inputWords.slice(aliasWords).join(" ").trim();

  return {
    provider: resolved.provider,
    model: originalModel || normalizedRemainder,
  };
}

function describeParsedCombo(combo: ParsedCombo): string {
  const stringifyPart = ({ provider, model }: ParsedProviderModel): string =>
    `${provider}${model ? ` ${model}` : ""}`;
  return `${stringifyPart(combo.stt)} + ${stringifyPart(combo.llm)} + ${stringifyPart(combo.tts)}`;
}

function parseComboInput(desc: string): ParsedCombo | null {
  const parts = desc
    .split(/\s*(?:\+|,|->)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 3) return null;

  const [sttInput, llmInput, ttsInput] = parts;
  const stt = parseProviderWithModel(sttInput);
  const llm = parseProviderWithModel(llmInput);
  const tts = parseProviderWithModel(ttsInput);
  if (!stt || !llm || !tts) return null;

  return { stt, llm, tts };
}

function parseComboMatches(combo: string): { parsed: ParsedCombo; entries: BenchmarkEntry[] } | null {
  const parsed = parseComboInput(combo);
  if (!parsed) return null;

  const entries = BENCHMARK_DATA.filter((entry) => {
    return (
      makeProviderMatch(parsed.stt.provider, entry.stt) &&
      (!parsed.stt.model || modelMatches(entry.sttModel, parsed.stt.model)) &&
      makeProviderMatch(parsed.llm.provider, entry.llm) &&
      (!parsed.llm.model || modelMatches(entry.llmModel, parsed.llm.model)) &&
      makeProviderMatch(parsed.tts.provider, entry.tts) &&
      (!parsed.tts.model || modelMatches(entry.ttsModel, parsed.tts.model))
    );
  });

  return { parsed, entries };
}

function normalizeModel(model: string): string {
  return normalizeTerm(model).replace(/\s+/g, "-");
}

function modelMatches(modelA: string, modelB: string): boolean {
  return normalizeModel(modelA) === normalizeModel(modelB);
}

function getProviderModels(provider: string, category: ProviderCategory): string[] {
  const resolved = resolveProvider(provider);
  if (!resolved) return [];
  const categoryMap = PROVIDER_INFO[category] as Record<string, { models: string[] }>;
  return categoryMap[resolved]?.models ?? [];
}

function isModelKnown(provider: string, category: ProviderCategory, model: string): boolean {
  const supported = getProviderModels(provider, category);
  return supported.some((knownModel) => modelMatches(knownModel, model));
}

function yamlSafe(value: string): string {
  return JSON.stringify(value);
}

function formatToolResponse(
  format: ToolOutputFormat,
  markdown: string,
  jsonPayload: unknown
) {
  return {
    content: [{
      type: "text" as const,
      text: format === "json" ? JSON.stringify(jsonPayload, null, 2) : markdown,
    }],
  };
}

function resolveProviderCategory(provider: string, category: ProviderCategory): string | null {
  const resolved = resolveProvider(provider);
  if (!resolved) return null;
  const categoryMap = PROVIDER_INFO[category] as Record<string, { url: string; models: string[]; strengths: string }>;
  return categoryMap[resolved] ? resolved : null;
}

function listKnownProviders(category?: ProviderCategory): string[] {
  const providers = category ? Object.keys(PROVIDER_INFO[category]) : ALL_PROVIDERS;
  return [...providers].sort((a, b) => a.localeCompare(b));
}

function makeProviderMatch(input: string, provider: string): boolean {
  const normalizedInput = resolveProvider(input);
  if (!normalizedInput) return false;
  return normalizeTerm(normalizedInput) === normalizeTerm(provider);
}

function getUseCaseWeights(use_case: string): ScoreWeights {
  const normalizedUseCase = resolveUseCase(use_case);
  return USE_CASE_PRIORITIES[normalizedUseCase] || DEFAULT_WEIGHTS;
}

function resolveUseCase(input: string): string {
  const normalized = normalizeUseCase(input);
  if (USE_CASE_PRIORITIES[normalized]) return normalized;

  const direct = Object.entries(USE_CASE_ALIASES).find(([useCase, aliases]) =>
    useCase === normalized ||
    aliases.some((alias) => {
      const normalizedAlias = normalizeUseCase(alias);
      return (
        normalizedAlias === normalized ||
        normalizedAlias.startsWith(normalized) ||
        normalized.startsWith(normalizedAlias)
      );
    })
  );

  return direct ? direct[0] : normalized;
}

function getObjectiveWeights(optimize_for: "balanced" | "latency" | "quality" | "cost", use_case: string): ScoreWeights {
  if (optimize_for === "latency") return { latency: 100, quality: 30, cost: 30 };
  if (optimize_for === "quality") return { latency: 30, quality: 100, cost: 30 };
  if (optimize_for === "cost") return { latency: 30, quality: 30, cost: 100 };
  return getUseCaseWeights(use_case);
}

function scoreBenchmark(entry: BenchmarkEntry, weights: ScoreWeights): number {
  const latencyScore = Math.max(0, 100 - (entry.latencyMs - 100) * 0.5);
  const qualityScore = (entry.quality / 5) * 100;
  const costScore = Math.max(0, 100 - entry.costPerMin * 5000);
  return Math.round(
    ((latencyScore * weights.latency +
      qualityScore * weights.quality +
      costScore * weights.cost) /
      (weights.latency + weights.quality + weights.cost)) *
      10
  ) / 10;
}

function rankBenchmarks(entries: BenchmarkEntry[], weights: ScoreWeights): (BenchmarkEntry & { score: number })[] {
  return entries
    .map((entry) => ({ ...entry, score: scoreBenchmark(entry, weights) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
      if (b.quality !== a.quality) return b.quality - a.quality;
      return a.costPerMin - b.costPerMin;
    });
}

function clampMaxResults(value: number): number {
  return Math.max(1, Math.min(Math.floor(value), MAX_RESULTS));
}

function isScaffoldCompatible(entry: BenchmarkEntry, framework: ScaffoldFramework): boolean {
  const policy = FRAMEWORK_COMPATIBILITY[framework];
  const sttOk = policy.stt.size === 0 || policy.stt.has(entry.stt);
  const llmOk = policy.llm.size === 0 || policy.llm.has(entry.llm);
  const ttsOk = policy.tts.has(entry.tts);
  return sttOk && llmOk && ttsOk;
}

// ─── Tool 1: Recommend ───────────────────────────────────────────────

server.tool(
  "voiceforge_recommend",
  "Recommend the optimal STT+LLM+TTS combination for a voice AI agent. Provide a language and use case to get a ranked list of tested stacks with latency, quality, and cost data from production benchmarks.",
  {
    language: z.string().describe(
      `Target language. Supported: ${SUPPORTED_LANGUAGES.join(", ")}`
    ),
    use_case: z.string().describe(
      `Use case. Options: ${Object.keys(USE_CASE_PRIORITIES).join(", ")}, or describe your own`
    ),
    optimize_for: z.enum(["balanced", "latency", "quality", "cost"]).default("balanced").describe(
      "What to optimize for: balanced (default), latency (fastest), quality (best MOS), or cost (cheapest)"
    ),
    max_results: z.number().default(5).describe("Number of results to return (default: 5)"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ language, use_case, optimize_for, max_results, output_format }) => {
    const resolvedLanguage = resolveLanguage(language);
    const resolvedUseCase = resolveUseCase(use_case);
    if (!resolvedLanguage) {
      const suggestions = getLanguageSuggestions(language);
      return {
        content: [{
          type: "text",
          text:
            `Language "${language}" is not recognized in benchmark corpus.\n` +
            `Try one of: ${suggestions.join(", ")}.`,
        }],
      };
    }

    const matching = BENCHMARK_DATA.filter((b) =>
      b.languages.some((l) => l.toLowerCase() === resolvedLanguage.toLowerCase())
    );

    if (matching.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No benchmarks found for "${language}". Supported languages: ${SUPPORTED_LANGUAGES.join(", ")}.\n\nTip: For unsupported languages, start with Deepgram nova-3 (STT) + OpenAI gpt-4.1-mini (LLM) + Cartesia sonic-3 (TTS) — this combination works well across most languages.`,
        }],
      };
    }

    const resultLimit = clampMaxResults(max_results);
    const weights = getObjectiveWeights(optimize_for, resolvedUseCase);
    const top = rankBenchmarks(matching, weights).slice(0, resultLimit);

    if (output_format === "json") {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            language: resolvedLanguage,
            use_case: resolvedUseCase,
            optimize_for,
            top,
          }, null, 2),
        }],
      };
    }

    // Format output
    const lines: string[] = [
      `## VoiceForge Recommendation`,
      `**Language:** ${resolvedLanguage} | **Use Case:** ${resolvedUseCase} | **Optimizing for:** ${optimize_for}`,
      "",
      "| Rank | STT | LLM | TTS | Latency | Quality | Cost/min | Score |",
      "|------|-----|-----|-----|---------|---------|----------|-------|",
    ];

    top.forEach((b, i) => {
      lines.push(
        `| ${i + 1} | ${b.stt} ${b.sttModel} | ${b.llm} ${b.llmModel} | ${b.tts} ${b.ttsModel} | ${b.latencyMs}ms | ${b.quality}/5 | $${b.costPerMin} | ${b.score} |`
      );
    });

    lines.push("");
    lines.push("### Top Pick Details");
    const best = top[0];
    lines.push(`**${best.stt} ${best.sttModel}** → **${best.llm} ${best.llmModel}** → **${best.tts} ${best.ttsModel}**`);
    lines.push(`- Latency: ${best.latencyMs}ms end-to-end`);
    lines.push(`- Quality: ${best.quality}/5.0 UTMOS${best.mos ? ` (MOS: ${best.mos})` : ""}`);
    lines.push(`- Cost: $${best.costPerMin}/min`);
    if (best.notes) lines.push(`- Notes: ${best.notes}`);
    lines.push("");
    lines.push(`> Use \`voiceforge_scaffold\` to generate a complete project with this stack.`);

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ─── Tool 2: Benchmark ───────────────────────────────────────────────

server.tool(
  "voiceforge_benchmark",
  "View benchmark data for all tested STT+LLM+TTS combinations. Filter by language, provider, or sort by different metrics. Data from 4 years of production voice AI across enterprise deployments.",
  {
    language: z.string().optional().describe("Filter by language (e.g., 'Thai', 'English')"),
    provider: z.string().optional().describe("Filter by any provider name (e.g., 'Deepgram', 'ElevenLabs')"),
    sort_by: z.enum(["latency", "quality", "cost"]).default("quality").describe("Sort results by metric"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ language, provider, sort_by, output_format }) => {
    const resolvedLanguage = language ? resolveLanguage(language) : null;
    const resolvedProvider = provider ? resolveProvider(provider) : null;
    if (language && !resolvedLanguage) {
      const suggestions = getLanguageSuggestions(language);
      const markdown = `Language "${language}" is not recognized.\nTry one of: ${suggestions.join(", ")}.`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "unsupported-language",
        requested_language: language,
        suggestions,
      });
    }

    if (provider && !resolvedProvider) {
      const markdown = `Provider "${provider}" is not recognized.\nTry: ${listKnownProviders().join(", ")}`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "unsupported-provider",
        requested_provider: provider,
        supported_providers: listKnownProviders(),
      });
    }

    let results = [...BENCHMARK_DATA];

    if (language) {
      results = results.filter((b) =>
        b.languages.some((l) => l.toLowerCase() === resolvedLanguage!.toLowerCase())
      );
    }

    if (provider) {
      results = results.filter(
        (b) =>
        makeProviderMatch(resolvedProvider!, b.stt) ||
        makeProviderMatch(resolvedProvider!, b.llm) ||
        makeProviderMatch(resolvedProvider!, b.tts)
      );
    }

    if (results.length === 0) {
      const markdown = `No benchmark rows match the selected filters.${language ? ` Language=${resolvedLanguage}.` : ""}${provider ? ` Provider=${resolvedProvider}.` : ""}`;
      return formatToolResponse(output_format, markdown, {
        status: "ok",
        language: resolvedLanguage,
        provider: resolvedProvider,
        sort_by,
        rows: [],
        count: 0,
      });
    }

    if (sort_by === "latency") results.sort((a, b) => a.latencyMs - b.latencyMs);
    else if (sort_by === "cost") results.sort((a, b) => a.costPerMin - b.costPerMin);
    else results.sort((a, b) => b.quality - a.quality);

    const lines: string[] = [
      `## VoiceForge Benchmarks`,
      `**${results.length} combinations**${resolvedLanguage ? ` for ${resolvedLanguage}` : ""}${resolvedProvider ? ` with ${resolvedProvider}` : ""} (sorted by ${sort_by})`,
      "",
      "| # | STT | LLM | TTS | Latency | Quality | Cost/min | Languages |",
      "|---|-----|-----|-----|---------|---------|----------|-----------|",
    ];

    results.forEach((b, i) => {
      lines.push(
        `| ${i + 1} | ${b.stt} ${b.sttModel} | ${b.llm} ${b.llmModel} | ${b.tts} ${b.ttsModel} | ${b.latencyMs}ms | ${b.quality}/5 | $${b.costPerMin} | ${b.languages.slice(0, 3).join(", ")} |`
      );
    });

    lines.push("");
    lines.push("### Key Insights");
    const fastest = [...results].sort((a, b) => a.latencyMs - b.latencyMs)[0];
    const bestQuality = [...results].sort((a, b) => b.quality - a.quality)[0];
    const cheapest = [...results].sort((a, b) => a.costPerMin - b.costPerMin)[0];

    if (fastest) lines.push(`- **Fastest:** ${fastest.stt} + ${fastest.llm} + ${fastest.tts} (${fastest.latencyMs}ms)`);
    if (bestQuality) lines.push(`- **Best quality:** ${bestQuality.stt} + ${bestQuality.llm} + ${bestQuality.tts} (${bestQuality.quality}/5)`);
    if (cheapest) lines.push(`- **Cheapest:** ${cheapest.stt} + ${cheapest.llm} + ${cheapest.tts} ($${cheapest.costPerMin}/min)`);

    return formatToolResponse(output_format, lines.join("\n"), {
      status: "ok",
      language: resolvedLanguage,
      provider: resolvedProvider,
      sort_by,
      count: results.length,
      rows: results,
      summary: {
        fastest,
        best_quality: bestQuality,
        cheapest,
      },
    });
  }
);

// ─── Tool 3: Compare ─────────────────────────────────────────────────

server.tool(
  "voiceforge_compare",
  "Compare two specific STT+LLM+TTS combinations side-by-side. Useful when deciding between two shortlisted stacks.",
  {
    combo_a: z.string().describe("First combination, e.g., 'Deepgram + OpenAI + Cartesia'"),
    combo_b: z.string().describe("Second combination, e.g., 'AssemblyAI + Anthropic + ElevenLabs'"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ combo_a, combo_b, output_format }) => {
    const resolvedA = parseComboMatches(combo_a);
    const resolvedB = parseComboMatches(combo_b);

    if (!resolvedA || !resolvedB) {
      const missing = [];
      if (!resolvedA) missing.push("A");
      if (!resolvedB) missing.push("B");
      const markdown = `Could not parse combo ${missing.join(" and ")} from benchmark rows.\n` +
        `Expected format: provider-only or provider + model per segment, separated by + or commas.\n` +
        `Examples:\n` +
        `- "Deepgram + OpenAI + Cartesia"\n` +
        `- "Deepgram nova-3 + OpenAI gpt-4.1-mini + Cartesia sonic-3"\n` +
        `- "Deepgram nova-3, OpenAI gpt-4.1-mini, Cartesia sonic-3"\n` +
        `Supported providers: ${listKnownProviders().join(", ")}`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "unparseable-combo",
        missing,
        combo_a,
        combo_b,
        supported_providers: listKnownProviders(),
      });
    }

    const noMatch: string[] = [];
    if (resolvedA.entries.length === 0) noMatch.push(`A (${describeParsedCombo(resolvedA.parsed)})`);
    if (resolvedB.entries.length === 0) noMatch.push(`B (${describeParsedCombo(resolvedB.parsed)})`);

    if (noMatch.length > 0) {
      const markdown = `No benchmark rows found for ${noMatch.join(" and ")}.\n` +
        `Use supported providers in this stack: ${listKnownProviders().join(", ")}.\n` +
        `Try adding exact model names from provider catalogs, or use provider-only input when you want the best matching benchmark for that provider trio.`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "no-matching-combo",
        combo_a: describeParsedCombo(resolvedA.parsed),
        combo_b: describeParsedCombo(resolvedB.parsed),
        matches_found: {
          a: resolvedA.entries.length,
          b: resolvedB.entries.length,
        },
      });
    }

    const rankedA = rankBenchmarks(resolvedA.entries, DEFAULT_WEIGHTS);
    const rankedB = rankBenchmarks(resolvedB.entries, DEFAULT_WEIGHTS);
    const a = rankedA[0];
    const b = rankedB[0];
    const ambiguityA = resolvedA.entries.length > 1;
    const ambiguityB = resolvedB.entries.length > 1;

    if (!a || !b) {
      const markdown = `Could not resolve benchmark matches for one or both inputs.\n` +
        `A entries: ${resolvedA.entries.length}, B entries: ${resolvedB.entries.length}.`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "unresolved-combo",
        combo_a: describeParsedCombo(resolvedA.parsed),
        combo_b: describeParsedCombo(resolvedB.parsed),
        counts: {
          a: resolvedA.entries.length,
          b: resolvedB.entries.length,
        },
      });
    }

    const formatCombo = (entry: BenchmarkEntry | undefined, label: string): string => {
      if (!entry) return `**${label}:** Not found in benchmarks`;
      return [
        `**${label}:** ${entry.stt} ${entry.sttModel} → ${entry.llm} ${entry.llmModel} → ${entry.tts} ${entry.ttsModel}`,
        `- Latency: ${entry.latencyMs}ms`,
        `- Quality: ${entry.quality}/5.0${entry.mos ? ` (MOS: ${entry.mos})` : ""}`,
        `- Cost: $${entry.costPerMin}/min`,
        `- Languages: ${entry.languages.join(", ")}`,
        entry.notes ? `- Notes: ${entry.notes}` : "",
      ].filter(Boolean).join("\n");
    };

    const lines: string[] = [
      "## VoiceForge Comparison",
      "",
      formatCombo(a, "Stack A"),
      "",
      formatCombo(b, "Stack B"),
      "",
    ];

    lines.push("### Head-to-Head");
    lines.push("");
    lines.push("| Metric | Stack A | Stack B | Winner |");
    lines.push("|--------|---------|---------|--------|");

    const latencyWinner = a.latencyMs <= b.latencyMs ? "A" : "B";
    const qualityWinner = a.quality >= b.quality ? "A" : "B";
    const costWinner = a.costPerMin <= b.costPerMin ? "A" : "B";

    const latencyDeltaMs = Math.abs(a.latencyMs - b.latencyMs);
    const costDelta = Math.abs(a.costPerMin - b.costPerMin);

    lines.push(`| Latency | ${a.latencyMs}ms | ${b.latencyMs}ms | Stack ${latencyWinner} (${latencyDeltaMs}ms faster) |`);
    lines.push(`| Quality | ${a.quality}/5 | ${b.quality}/5 | Stack ${qualityWinner} |`);
    lines.push(`| Cost | $${a.costPerMin}/min | $${b.costPerMin}/min | Stack ${costWinner} ($${costDelta.toFixed(3)} cheaper) |`);

    const aLangs = new Set(a.languages);
    const bLangs = new Set(b.languages);
    const shared = a.languages.filter((l) => bLangs.has(l));
    const aOnly = a.languages.filter((l) => !bLangs.has(l));
    const bOnly = b.languages.filter((l) => !aLangs.has(l));

    lines.push("");
    lines.push("### Language Coverage");
    lines.push(`- Both support: ${shared.join(", ") || "none"}`);
    if (aOnly.length) lines.push(`- Only Stack A: ${aOnly.join(", ")}`);
    if (bOnly.length) lines.push(`- Only Stack B: ${bOnly.join(", ")}`);

    if (ambiguityA || ambiguityB) {
      lines.push("");
      lines.push(`⚠️ Multiple benchmark matches were found for ${ambiguityA ? "Stack A" : ""}${ambiguityA && ambiguityB ? " and " : ""}${ambiguityB ? "Stack B" : ""}; selected best-scoring rows automatically.`);
    }

    return formatToolResponse(output_format, lines.join("\n"), {
      status: "ok",
      combo_a: `${a.stt} ${a.sttModel} → ${a.llm} ${a.llmModel} → ${a.tts} ${a.ttsModel}`,
      combo_b: `${b.stt} ${b.sttModel} → ${b.llm} ${b.llmModel} → ${b.tts} ${b.ttsModel}`,
      winners: {
        latency: a.latencyMs <= b.latencyMs ? "A" : "B",
        quality: a.quality >= b.quality ? "A" : "B",
        cost: a.costPerMin <= b.costPerMin ? "A" : "B",
      },
      deltas: {
        latencyMs: Math.abs(a.latencyMs - b.latencyMs),
        quality: Math.abs(a.quality - b.quality),
        costPerMin: Number((Math.abs(a.costPerMin - b.costPerMin)).toFixed(3)),
      },
      overlap_languages: {
        both: shared,
        only_a: aOnly,
        only_b: bOnly,
      },
      requested: {
        a: describeParsedCombo(resolvedA.parsed),
        b: describeParsedCombo(resolvedB.parsed),
      },
      candidate_counts: {
        a: resolvedA.entries.length,
        b: resolvedB.entries.length,
      },
      ambiguity: {
        a: ambiguityA,
        b: ambiguityB,
      },
    });
  }
);

// ─── Tool 4: Scaffold ────────────────────────────────────────────────

server.tool(
  "voiceforge_scaffold",
  "Generate a complete voice AI project with the recommended STT+LLM+TTS stack. Creates all files needed to start building: agent code, config, environment variables, and README. Supports LiveKit Agents (Python) and Next.js (TypeScript) frameworks.",
  {
    language: z.string().describe("Target language (e.g., 'Thai', 'English')"),
    use_case: z.string().describe("Use case (e.g., 'sales', 'customer-support', 'healthcare-triage')"),
    framework: z.enum(["livekit", "nextjs"]).default("livekit").describe(
      "Framework: 'livekit' for LiveKit Agents (Python), 'nextjs' for Next.js + ElevenLabs (TypeScript)"
    ),
    agent_name: z.string().optional().describe("Agent name (default: auto-generated from language + use case)"),
    output_dir: z.string().optional().describe("Output directory (default: ./<agent-name>)"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ language, use_case, framework, agent_name, output_dir, output_format }) => {
    const resolvedLanguage = resolveLanguage(language);
    const resolvedUseCase = resolveUseCase(use_case);
    if (!resolvedLanguage) {
      const suggestions = getLanguageSuggestions(language);
      const markdown = `Language "${language}" is not recognized in benchmark corpus.\n` +
        `Try one of: ${suggestions.join(", ")}.`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "unsupported-language",
        requested_language: language,
        suggestions,
      });
    }

    const matching = BENCHMARK_DATA.filter((b) =>
      b.languages.some((l) => l.toLowerCase() === resolvedLanguage.toLowerCase())
    );

    if (matching.length === 0) {
      const markdown = `No benchmarks for "${language}". Using default stack: Deepgram nova-3 + OpenAI gpt-4.1-mini + Cartesia sonic-3.`;
      return formatToolResponse(output_format, markdown, {
        status: "fallback",
        reason: "no-language-benchmarks",
        language: language,
        stack: {
          stt: "Deepgram",
          stt_model: "nova-3",
          llm: "OpenAI",
          llm_model: "gpt-4.1-mini",
          tts: "Cartesia",
          tts_model: "sonic-3",
        },
      });
    }

    const ranked = rankBenchmarks(matching, getUseCaseWeights(resolvedUseCase));
    const scaffoldable = ranked.filter((entry) => isScaffoldCompatible(entry, framework));
    const topPick = ranked[0];

    if (scaffoldable.length === 0) {
      const markdown =
        framework === "livekit"
          ? "No benchmarks currently map to a supported LiveKit scaffold for this language. Use a supported combination (Deepgram/OpenAI/Google + OpenAI/Anthropic/Google + Cartesia/ElevenLabs) or switch to nextjs."
          : "No benchmarks currently map to an ElevenLabs scaffold for this language. Next.js generation currently supports ElevenLabs TTS only.";
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "no-scaffold-compatible-stack",
        framework,
        language: resolvedLanguage,
        supported_frameworks: {
          livekit_stt: [...FRAMEWORK_COMPATIBILITY.livekit.stt],
          livekit_llm: [...FRAMEWORK_COMPATIBILITY.livekit.llm],
          livekit_tts: [...FRAMEWORK_COMPATIBILITY.livekit.tts],
          nextjs_tts: [...FRAMEWORK_COMPATIBILITY.nextjs.tts],
        },
      });
    }

    const best = scaffoldable[0];
    const isSameStack =
      `${topPick.stt} ${topPick.sttModel} ${topPick.llm} ${topPick.llmModel} ${topPick.tts} ${topPick.ttsModel}` ===
      `${best.stt} ${best.sttModel} ${best.llm} ${best.llmModel} ${best.tts} ${best.ttsModel}`;
    const scoreDelta = Math.abs(topPick.score - best.score);
    // Only show fallback notice when the difference is significant (>2 points)
    const fallbackNotice = !isSameStack && scoreDelta > 2
      ? `Note: Top-scoring stack (${topPick.stt} ${topPick.sttModel} + ${topPick.llm} ${topPick.llmModel} + ${topPick.tts} ${topPick.ttsModel}) is not scaffoldable with ${framework}. Using nearest supported stack (${scoreDelta.toFixed(1)}pt difference).`
      : "";

    const safeAgentName = toSafeSlug(agent_name || `${resolvedLanguage.toLowerCase()}-${resolvedUseCase}-agent`);
    const name = safeAgentName || `${Date.now()}-voiceforge-agent`;
    const dir = output_dir || `./${name}`;

    const config = {
      language: resolvedLanguage,
      useCase: use_case,
      stt: best.stt,
      sttModel: best.sttModel,
      llm: best.llm,
      llmModel: best.llmModel,
      tts: best.tts,
      ttsModel: best.ttsModel,
      agentName: name,
    };

    let files;
    try {
      files = framework === "livekit"
        ? getLiveKitAgentTemplate(config)
        : getNextJSTemplate(config);
    } catch (error) {
      const markdown = `Scaffold generation failed: ${error instanceof Error ? error.message : "unknown error"}. Use a supported framework/provider combination.`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "template-generation-failed",
        error: error instanceof Error ? error.message : "unknown error",
      });
    }

    const lines: string[] = [
      `## VoiceForge Scaffold: ${name}`,
      "",
      `**Stack:** ${best.stt} ${best.sttModel} → ${best.llm} ${best.llmModel} → ${best.tts} ${best.ttsModel}`,
      `**Framework:** ${framework === "livekit" ? "LiveKit Agents (Python)" : "Next.js + ElevenLabs (TypeScript)"}`,
      ...(fallbackNotice ? [`${fallbackNotice}`] : []),
      `**Expected:** ${best.latencyMs}ms latency, ${best.quality}/5 quality, $${best.costPerMin}/min`,
      "",
      `### Files to create in \`${dir}/\``,
      "",
    ];

    files.forEach((f) => {
      const lang = f.path.endsWith(".py") ? "python" : f.path.endsWith(".tsx") ? "tsx" : f.path.endsWith(".yaml") ? "yaml" : f.path.endsWith(".md") ? "markdown" : "";
      // Use quadruple backticks for files that contain triple backticks (e.g., README.md)
      const fence = f.content.includes("```") ? "````" : "```";
      lines.push(`---`);
      lines.push(`#### \`${f.path}\``);
      lines.push(fence + lang);
      lines.push(f.content);
      lines.push(fence);
      lines.push("");
    });

    lines.push("### Next Steps");
    lines.push("1. Create the directory and files above");
    lines.push("2. Fill in your API keys in `.env`");
    lines.push(`3. ${framework === "livekit" ? "Run `pip install -r requirements.txt && python agent.py dev`" : "Run `npm install && npm run dev`"}`);
    lines.push("4. Test with a real conversation");
    lines.push("");
    lines.push("> Powered by VoiceForge — https://getvoiceforge.com");

    return formatToolResponse(output_format, lines.join("\n"), {
      status: "ok",
      agent_name: name,
      framework,
      language: resolvedLanguage,
      use_case: resolvedUseCase,
      stack: {
        stt: best.stt,
        stt_model: best.sttModel,
        llm: best.llm,
        llm_model: best.llmModel,
        tts: best.tts,
        tts_model: best.ttsModel,
      },
      file_count: files.length,
      files,
      output_dir: dir,
      fallback_notice: fallbackNotice || null,
      expected: {
        latency_ms: best.latencyMs,
        quality: best.quality,
        cost_per_min: best.costPerMin,
      },
    });
  }
);

// ─── Tool 5: Validate ───────────────────────────────────────────────

server.tool(
  "voiceforge_validate",
  "Validate a custom STT+LLM+TTS stack against benchmark data and scaffold compatibility.",
  {
    stt_provider: z.string().describe("STT provider name (e.g., 'Deepgram')"),
    stt_model: z.string().describe("STT model (e.g., 'nova-3')"),
    llm_provider: z.string().describe("LLM provider name (e.g., 'OpenAI')"),
    llm_model: z.string().describe("LLM model (e.g., 'gpt-4.1-mini')"),
    tts_provider: z.string().describe("TTS provider name (e.g., 'Cartesia')"),
    tts_model: z.string().describe("TTS model (e.g., 'sonic-3')"),
    framework: z.enum(["all", "livekit", "nextjs"]).default("all").describe("Optional scaffold target"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ stt_provider, stt_model, llm_provider, llm_model, tts_provider, tts_model, framework, output_format }) => {
    const resolvedProviders = {
      stt: resolveProvider(stt_provider),
      llm: resolveProvider(llm_provider),
      tts: resolveProvider(tts_provider),
    };

    if (!resolvedProviders.stt || !resolvedProviders.llm || !resolvedProviders.tts) {
      const markdown = [
        `One or more providers could not be resolved.`,
        `Expected providers:`,
        `- STT: ${listKnownProviders("stt").join(", ")}`,
        `- LLM: ${listKnownProviders("llm").join(", ")}`,
        `- TTS: ${listKnownProviders("tts").join(", ")}`,
      ].join("\n");
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "unresolved-provider",
        expected_providers: {
          stt: listKnownProviders("stt"),
          llm: listKnownProviders("llm"),
          tts: listKnownProviders("tts"),
        },
      });
    }

    const normalizedCombo = {
      stt_provider: resolvedProviders.stt,
      stt_model: stt_model.trim().toLowerCase(),
      llm_provider: resolvedProviders.llm,
      llm_model: llm_model.trim().toLowerCase(),
      tts_provider: resolvedProviders.tts,
      tts_model: tts_model.trim().toLowerCase(),
    };

    const modelHints = {
      stt: getProviderModels(normalizedCombo.stt_provider, "stt"),
      llm: getProviderModels(normalizedCombo.llm_provider, "llm"),
      tts: getProviderModels(normalizedCombo.tts_provider, "tts"),
    };

    const modelWarnings = {
      stt: modelHints.stt.length > 0 && !isModelKnown(normalizedCombo.stt_provider, "stt", normalizedCombo.stt_model),
      llm: modelHints.llm.length > 0 && !isModelKnown(normalizedCombo.llm_provider, "llm", normalizedCombo.llm_model),
      tts: modelHints.tts.length > 0 && !isModelKnown(normalizedCombo.tts_provider, "tts", normalizedCombo.tts_model),
    };
    const unknownModels = Object.entries(modelWarnings).filter(([, isUnknown]) => isUnknown).map(([key]) => key);

    if (unknownModels.length > 0) {
      const markdown = [
        `Model validation issue for known providers: ${unknownModels.join(", ")}.`,
        `Known models by provider:`,
        `- STT (${normalizedCombo.stt_provider}): ${modelHints.stt.length ? modelHints.stt.join(", ") : "unknown"}`,
        `- LLM (${normalizedCombo.llm_provider}): ${modelHints.llm.length ? modelHints.llm.join(", ") : "unknown"}`,
        `- TTS (${normalizedCombo.tts_provider}): ${modelHints.tts.length ? modelHints.tts.join(", ") : "unknown"}`,
      ].join("\n");
      const warningPayload = {
        status: "warning",
        reason: "unsupported-model",
        unknown_models: unknownModels,
        requested_models: {
          stt: normalizedCombo.stt_model,
          llm: normalizedCombo.llm_model,
          tts: normalizedCombo.tts_model,
        },
        supported_models: {
          stt: modelHints.stt,
          llm: modelHints.llm,
          tts: modelHints.tts,
        },
      };
      if (output_format === "json") {
        return formatToolResponse(output_format, markdown, warningPayload);
      }
      if (output_format === "markdown") {
        // continue to best-effort matching, but include warning context in markdown output
        // so users still get immediate actionable hints.
      }
    }

    const matches = BENCHMARK_DATA.filter((entry) => {
      return (
        makeProviderMatch(normalizedCombo.stt_provider, entry.stt) &&
        entry.sttModel.toLowerCase() === normalizedCombo.stt_model &&
        makeProviderMatch(normalizedCombo.llm_provider, entry.llm) &&
        entry.llmModel.toLowerCase() === normalizedCombo.llm_model &&
        makeProviderMatch(normalizedCombo.tts_provider, entry.tts) &&
        entry.ttsModel.toLowerCase() === normalizedCombo.tts_model
      );
    });

    if (matches.length === 0) {
      const providerHint = {
        stt: [...new Set(BENCHMARK_DATA.map((entry) => entry.stt))].filter((entryProvider) =>
          resolveProviderCategory(entryProvider, "stt") === normalizedCombo.stt_provider
        ),
        llm: [...new Set(BENCHMARK_DATA.map((entry) => entry.llm))].filter((entryProvider) =>
          resolveProviderCategory(entryProvider, "llm") === normalizedCombo.llm_provider
        ),
        tts: [...new Set(BENCHMARK_DATA.map((entry) => entry.tts))].filter((entryProvider) =>
          resolveProviderCategory(entryProvider, "tts") === normalizedCombo.tts_provider
        ),
      };

      const markdown = [
        `No exact benchmark match found for your stack.`,
        `Try this provider combination (if available in benchmark data): STT=${providerHint.stt.join(", ") || "Deepgram, OpenAI, Google, AssemblyAI, Speechmatics"}, LLM=${providerHint.llm.join(", ") || "OpenAI, Anthropic, Google, Groq, ElevenLabs"}, TTS=${providerHint.tts.join(", ") || "Cartesia, ElevenLabs, PlayHT, Rime"}.`,
        unknownModels.length > 0
          ? `Model warning(s): ${unknownModels.join(", ")} are not in provider model catalog.`
          : "",
      ].filter(Boolean).join("\n");
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "no-exact-match",
        requested_stack: normalizedCombo,
        provider_combos: {
          stt: providerHint.stt,
          llm: providerHint.llm,
          tts: providerHint.tts,
        },
        model_warnings: unknownModels,
      });
    }

    const scored = rankBenchmarks(matches, getUseCaseWeights("customer-support"));
    const top = scored[0];
    const compatLiveKit = isScaffoldCompatible(top, "livekit");
    const compatNextjs = isScaffoldCompatible(top, "nextjs");

    const lines: string[] = [
      ...(unknownModels.length > 0 && output_format === "markdown"
        ? [
            `## VoiceForge Stack Validation`,
            `Model warnings were detected for provider model names: ${unknownModels.join(", ")}.`,
            `Known models by provider were: STT=${modelHints.stt.join(", ")}, LLM=${modelHints.llm.join(", ")}, TTS=${modelHints.tts.join(", ")}.`,
            "",
          ]
        : []),
      `## VoiceForge Stack Validation`,
      `**Matched benchmark:** ${top.stt} ${top.sttModel} → ${top.llm} ${top.llmModel} → ${top.tts} ${top.ttsModel}`,
      `**Latency:** ${top.latencyMs}ms`,
      `**Quality:** ${top.quality}/5`,
      `**Cost:** $${top.costPerMin}/min`,
      "",
      `**Benchmark matches:** ${matches.length}`,
      `- LiveKit scaffold: ${compatLiveKit ? "supported" : "not supported"}`,
      `- Next.js/ElevenLabs scaffold: ${compatNextjs ? "supported" : "not supported"}`,
    ];

    if (framework === "livekit" && !compatLiveKit) {
      lines.push("");
      lines.push("⚠️ This combination is not scaffoldable with LiveKit in current templates.");
    }
    if (framework === "nextjs" && !compatNextjs) {
      lines.push("");
      lines.push("⚠️ This combination is not scaffoldable with Next.js in current templates (ElevenLabs TTS required).");
    }

    return formatToolResponse(output_format, lines.join("\n"), {
      status: "ok",
      matched_benchmark: {
        stt: top.stt,
        stt_model: top.sttModel,
        llm: top.llm,
        llm_model: top.llmModel,
        tts: top.tts,
        tts_model: top.ttsModel,
        latency_ms: top.latencyMs,
        quality: top.quality,
        cost_per_min: top.costPerMin,
      },
      benchmark_matches: matches.length,
      framework_support: {
        livekit: compatLiveKit,
        nextjs: compatNextjs,
      },
      requested_stack: normalizedCombo,
      model_warnings: unknownModels,
    });
  }
);

server.tool(
  "voiceforge_health",
  "Show MCP benchmark health metrics and environment assumptions before a YC demo or investor-facing session.",
  {
    verbose: z.boolean().default(false).describe("Include per-language coverage counts"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ verbose, output_format }) => {
    const now = new Date().toISOString();
    const all = [...BENCHMARK_DATA];
    const byLanguage = SUPPORTED_LANGUAGES.map((language) => {
      const entries = all.filter((entry) =>
        entry.languages.some((entryLanguage) => normalizeTerm(entryLanguage) === normalizeTerm(language))
      );
      return {
        language,
        count: entries.length,
      };
    });
    const livekitCount = all.filter((entry) => isScaffoldCompatible(entry, "livekit")).length;
    const nextjsCount = all.filter((entry) => isScaffoldCompatible(entry, "nextjs")).length;
    const fastest = [...all].sort((a, b) => a.latencyMs - b.latencyMs)[0];
    const highestQuality = [...all].sort((a, b) => b.quality - a.quality)[0];
    const cheapest = [...all].sort((a, b) => a.costPerMin - b.costPerMin)[0];

    const lines: string[] = [
      "## VoiceForge MCP Health",
      `- Total benchmark rows: ${all.length}`,
      `- Supported use case profiles: ${Object.keys(USE_CASE_PRIORITIES).length}`,
      `- Supported languages: ${SUPPORTED_LANGUAGES.length}`,
      `- LiveKit scaffoldable rows: ${livekitCount}`,
      `- Next.js scaffoldable rows: ${nextjsCount}`,
      `- Fastest observed: ${fastest?.stt} + ${fastest?.llm} + ${fastest?.tts} (${fastest?.latencyMs}ms)`,
      `- Highest quality: ${highestQuality?.stt} + ${highestQuality?.llm} + ${highestQuality?.tts} (${highestQuality?.quality}/5)`,
      `- Cheapest: ${cheapest?.stt} + ${cheapest?.llm} + ${cheapest?.tts} ($${cheapest?.costPerMin}/min)`,
    ];

    if (verbose) {
      lines.push("", "### Coverage", ...byLanguage.map((entry) => `- ${entry.language}: ${entry.count}`));
    }

    lines.push("", `Last updated: ${now}`);
    lines.push(`Data snapshot: ${DATA_SOURCE_UPDATED_AT}`);
    return formatToolResponse(output_format, lines.join("\n"), {
      status: "ok",
      timestamp: now,
      total_benchmarks: all.length,
      data_snapshot: DATA_SOURCE_UPDATED_AT,
      supported_use_cases: Object.keys(USE_CASE_PRIORITIES).length,
      supported_languages: SUPPORTED_LANGUAGES.length,
      livekit_scaffoldable_rows: livekitCount,
      nextjs_scaffoldable_rows: nextjsCount,
      fastest,
      highest_quality: highestQuality,
      cheapest,
      coverage_by_language: byLanguage,
      verbose,
    });
  }
);

// ─── Tool 7: Providers

server.tool(
  "voiceforge_providers",
  "List all supported voice AI providers with their models, strengths, and links. Covers STT (speech-to-text), LLM (language models), and TTS (text-to-speech) providers.",
  {
    category: z.enum(["all", "stt", "llm", "tts"]).default("all").describe("Filter by category"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ category, output_format }) => {
    const lines: string[] = ["## VoiceForge Provider Directory", ""];
    const payloadProviders: Record<string, { provider: string; models: string[]; strengths: string; url: string }[]> = {};

    const renderCategory = (cat: string, data: Record<string, { url: string; models: string[]; strengths: string }>) => {
      lines.push(`### ${cat.toUpperCase()} Providers`);
      lines.push("");
      lines.push("| Provider | Models | Strengths |");
      lines.push("|----------|--------|-----------|");
      for (const [name, info] of Object.entries(data)) {
        lines.push(`| [${name}](${info.url}) | ${info.models.join(", ")} | ${info.strengths} |`);
      }
      lines.push("");
      payloadProviders[cat] = Object.entries(data).map(([name, info]) => ({
        provider: name,
        models: info.models,
        strengths: info.strengths,
        url: info.url,
      }));
    };

    if (category === "all" || category === "stt") renderCategory("stt", PROVIDER_INFO.stt);
    if (category === "all" || category === "llm") renderCategory("llm", PROVIDER_INFO.llm);
    if (category === "all" || category === "tts") renderCategory("tts", PROVIDER_INFO.tts);

    lines.push("> Data from production deployments across 8 languages at enterprise scale.");

    return formatToolResponse(output_format, lines.join("\n"), {
      status: "ok",
      category,
      providers: output_format === "json" && category !== "all" ? payloadProviders[category] : payloadProviders,
      total: {
        stt: Object.keys(PROVIDER_INFO.stt).length,
        llm: Object.keys(PROVIDER_INFO.llm).length,
        tts: Object.keys(PROVIDER_INFO.tts).length,
      },
    });
  }
);

// ─── Tool 8: Config Generate ─────────────────────────────────────────

server.tool(
  "voiceforge_config",
  "Generate a VoiceForge YAML configuration file for a voice agent. Includes pipeline config, quality targets, and monitoring thresholds.",
  {
    agent_name: z.string().describe("Name for the voice agent"),
    stt_provider: z.string().describe("STT provider (e.g., 'Deepgram')"),
    stt_model: z.string().describe("STT model (e.g., 'nova-3')"),
    llm_provider: z.string().describe("LLM provider (e.g., 'OpenAI')"),
    llm_model: z.string().describe("LLM model (e.g., 'gpt-4.1-mini')"),
    tts_provider: z.string().describe("TTS provider (e.g., 'Cartesia')"),
    tts_model: z.string().describe("TTS model (e.g., 'sonic-3')"),
    language: z.string().default("English").describe("Primary language"),
    use_case: z.string().default("customer-support").describe("Use case"),
    output_format: z.enum(["markdown", "json"]).default("markdown").describe("Set to json for machine-readable output"),
  },
  async ({ agent_name, stt_provider, stt_model, llm_provider, llm_model, tts_provider, tts_model, language, use_case, output_format }) => {
    const resolvedLanguage = resolveLanguage(language);
    const resolvedUseCase = resolveUseCase(use_case);
    if (!resolvedLanguage) {
      const suggestions = getLanguageSuggestions(language);
      const markdown = `Language "${language}" is not recognized in benchmark corpus.\nTry one of: ${suggestions.join(", ")}.`;
      return formatToolResponse(output_format, markdown, {
        status: "error",
        reason: "unsupported-language",
        requested_language: language,
        suggestions,
      });
    }

    const resolvedProviders = {
      stt: resolveProvider(stt_provider),
      llm: resolveProvider(llm_provider),
      tts: resolveProvider(tts_provider),
    };

    if (!resolvedProviders.stt || !resolvedProviders.llm || !resolvedProviders.tts) {
      return formatToolResponse(output_format, `One or more providers could not be resolved: ${JSON.stringify({ stt: stt_provider, llm: llm_provider, tts: tts_provider })}`, {
        status: "error",
        reason: "unresolved-provider",
        providers: {
          stt: resolvedProviders.stt,
          llm: resolvedProviders.llm,
          tts: resolvedProviders.tts,
        },
      });
    }

    const modelHints = {
      stt: getProviderModels(resolvedProviders.stt, "stt"),
      llm: getProviderModels(resolvedProviders.llm, "llm"),
      tts: getProviderModels(resolvedProviders.tts, "tts"),
    };

    const modelWarnings = {
      stt: modelHints.stt.length > 0 && !isModelKnown(resolvedProviders.stt, "stt", stt_model),
      llm: modelHints.llm.length > 0 && !isModelKnown(resolvedProviders.llm, "llm", llm_model),
      tts: modelHints.tts.length > 0 && !isModelKnown(resolvedProviders.tts, "tts", tts_model),
    };

    const markdownOutput: string[] = [];
    if (modelWarnings.stt) markdownOutput.push(`- STT model "${stt_model}" is not in known ${resolvedProviders.stt} catalog: ${modelHints.stt.join(", ")}`);
    if (modelWarnings.llm) markdownOutput.push(`- LLM model "${llm_model}" is not in known ${resolvedProviders.llm} catalog: ${modelHints.llm.join(", ")}`);
    if (modelWarnings.tts) markdownOutput.push(`- TTS model "${tts_model}" is not in known ${resolvedProviders.tts} catalog: ${modelHints.tts.join(", ")}`);

    const yaml = `# VoiceForge Agent Configuration
# Generated by VoiceForge MCP — https://getvoiceforge.com
# ${new Date().toISOString()}

agent:
  name: ${yamlSafe(agent_name)}
  version: "1.0.0"
  language: ${yamlSafe(resolvedLanguage)}
  use_case: ${yamlSafe(resolveUseCase(use_case))}

pipeline:
  vad:
    provider: silero
    threshold: 0.5
    min_speech_duration_ms: 250

  stt:
    provider: ${resolvedProviders.stt.toLowerCase()}
    model: ${yamlSafe(stt_model)}
    language: ${yamlSafe(resolvedLanguage.toLowerCase().slice(0, 2))}
    interim_results: true

  llm:
    provider: ${resolvedProviders.llm.toLowerCase()}
    model: ${yamlSafe(llm_model)}
    temperature: 0.7
    max_tokens: 150
    system_prompt: |
      You are a voice AI agent for ${resolvedUseCase.replace(/-/g, " ")}.
      Communicate in ${resolvedLanguage}. Keep responses to 1-2 sentences.
      Be natural, warm, and helpful.

  tts:
    provider: ${resolvedProviders.tts.toLowerCase()}
    model: ${yamlSafe(tts_model)}
    stability: 0.5
    similarity_boost: 0.75

  quality_targets:
    latency_p95_ms: 250
    min_utmos: 4.0
    max_wer: 0.08
    max_cost_per_min: 0.015

monitoring:
  enabled: true
  log_level: info
  metrics_interval_s: 60
  alerts:
    latency_p95_threshold_ms: 350
    error_rate_threshold: 0.02
    quality_drop_threshold: 0.3

deployment:
  replicas: 2
  region: us-east-1
  canary:
    enabled: true
    percentage: 10
    duration_min: 30
`;

    const markdown = [
      `## VoiceForge Config: ${agent_name}`,
      "",
      "```yaml",
      yaml,
      "```",
      "",
      "Save this as `voiceforge.yaml` in your project root.",
      ...(markdownOutput.length ? ["", "Model warnings:", ...markdownOutput] : []),
    ].join("\n");

  return formatToolResponse(output_format, markdown, {
      status: modelWarnings.stt || modelWarnings.llm || modelWarnings.tts ? "warning" : "ok",
      config: {
        agent_name,
        use_case: resolvedUseCase,
        stt_provider: resolvedProviders.stt,
        stt_model,
        llm_provider: resolvedProviders.llm,
        llm_model,
        tts_provider: resolvedProviders.tts,
        tts_model,
        language: resolvedLanguage,
      },
      supported_models: modelHints,
      unknown_models: modelWarnings,
      yaml,
    });
  }
);

// ─── Start Server ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("VoiceForge MCP server error:", error);
  process.exit(1);
});
