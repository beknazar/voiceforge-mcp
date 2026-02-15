# voiceforge-mcp

MCP server for voice AI development. Recommend, benchmark, and scaffold STT+LLM+TTS stacks — powered by production data from 4 years of voice AI at enterprise scale.

## Install

```bash
claude mcp add voiceforge-mcp -- npx -y voiceforge-mcp
```

That's it. Claude Code will now have access to all VoiceForge tools.

## Tools

### `voiceforge_recommend`

Get the optimal STT+LLM+TTS combination for your language and use case.
You can request structured output with `output_format: "json"` for automation.

```
"What's the best voice stack for Thai debt collections?"
→ Deepgram nova-3 → ElevenLabs eleven-turbo → ElevenLabs eleven_v3
  142ms latency | 4.1/5 quality | $0.004/min
```

### `voiceforge_benchmark`

Browse all tested combinations with latency, quality, and cost data. Filter by language or provider.
Supports `output_format: "markdown" | "json"` for automation.

### `voiceforge_compare`

Compare two stacks side-by-side: latency, quality, cost, and language coverage.
`combo_a`/`combo_b` support provider-only or provider+model syntax.
When provider-only is used and multiple benchmark rows match, the highest-scoring match is selected.

Examples:

- `combo_a`: `"Deepgram + OpenAI + Cartesia"`
- `combo_b`: `"Deepgram nova-3 + OpenAI gpt-4.1-mini + Cartesia sonic-3"`

### `voiceforge_scaffold`

Generate a complete voice AI project with the recommended stack.

- **LiveKit Agents** (Python) — `agent.py`, `requirements.txt`, `voiceforge.yaml`, `.env`
- **Next.js + ElevenLabs** (TypeScript) — voice widget component, env config (currently ElevenLabs-based for MVP)

### `voiceforge_validate`

Validate a custom stack (provider + model tuple) against benchmark coverage and scaffoldability.
Model names are validated against known provider catalogs; unsupported values return clear suggestions.

Use this before pitching/live demos so YC reviewers can verify a candidate stack is real and runnable.

### `voiceforge_providers`

List all supported providers: Deepgram, ElevenLabs, Cartesia, OpenAI, Anthropic, Google, Groq, AssemblyAI, Speechmatics, PlayHT, Rime.

### `voiceforge_config`

Generate a production-ready YAML config with pipeline settings, quality targets, and monitoring thresholds.
Supports `output_format: "markdown" | "json"` and provider/model sanitization.

### `voiceforge_health`

Use before interviews to show readiness at a glance:

- total benchmark rows available
- language support and framework coverage
- top performer summary (fastest, best quality, cheapest)
- health output includes `data_snapshot` for reproducible demo evidence

## YC Demo Checklist

1. Run `voiceforge_health` and save the output.
2. Keep `voiceforge_health {"output_format":"json"}` output in your final submission folder for YC review screenshots.
3. Run `voiceforge_recommend` for your top use case with `output_format: "json"`.
4. Run `voiceforge_validate` on your final stack before recording.
5. Run `voiceforge_scaffold` and share generated starter files/screenshots.
6. Run `voiceforge_providers` and `voiceforge_config` for one-page evidence before submission.

## YC Demo Script

```bash
voiceforge_health {"output_format":"json"}
voiceforge_recommend {"language":"English","use_case":"customer-support","output_format":"json"}
voiceforge_validate {"stt_provider":"Deepgram","stt_model":"nova-3","llm_provider":"OpenAI","llm_model":"gpt-4.1-mini","tts_provider":"Cartesia","tts_model":"sonic-3","framework":"livekit","output_format":"json"}
voiceforge_scaffold {"language":"English","use_case":"customer-support","framework":"livekit","output_format":"json"}
```

## Stability Improvements

- Canonical normalization now handles provider aliases and avoids ambiguous partial matches.
- Use-case aliases are normalized (`customer support`, `debt collections`, etc.).
- Scaffold output is now safe for filesystem-friendly agent names.
- Unknown provider/language filters return actionable supported-value hints.
- `voiceforge_compare` now parses provider+model tuples and returns ambiguity metadata when needed.

## Benchmark Data

12 tested STT+LLM+TTS combinations across 10 languages, from production enterprise deployments.

| Metric | Range |
|--------|-------|
| Latency | 142ms — 287ms |
| Quality | 4.0 — 4.8 UTMOS |
| Cost | $0.004 — $0.022/min |
| Languages | 10 (English, Thai, Vietnamese, Japanese, Korean, ...) |

## Why VoiceForge?

Every team building voice agents does trial and error with provider combinations. ElevenLabs benchmarks itself. Deepgram benchmarks itself. **Nobody benchmarks combinations.** We do.

Built by [Beknazar Abdikamalov](https://linkedin.com/in/abdik) — 4 years building production voice AI across 8 languages for enterprise clients.

## License

MIT
