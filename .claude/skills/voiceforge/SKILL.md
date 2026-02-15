---
name: voiceforge
description: >
  Set up a new voice AI application with the optimal STT+LLM+TTS stack.
  Use when the user wants to build a voice agent, voice bot, conversational AI,
  or any app that needs speech-to-text, language models, and text-to-speech.
  Triggers on: "voice agent", "voice AI", "STT", "TTS", "speech", "conversational AI",
  "call center", "voice bot", "phone agent", "LiveKit", "ElevenLabs voice".
argument-hint: [language] [use-case]
allowed-tools: Bash(node *), Bash(npm *), Bash(pip *), Bash(python *)
---

# VoiceForge — Voice AI Setup Assistant

Help the developer set up a production-ready voice AI application by finding the
best provider combination and scaffolding a complete project.

## Workflow

### Step 1: Understand Requirements

Ask the developer (if not already specified via $ARGUMENTS):
- **Language**: What language will the voice agent speak? (e.g., English, Thai, Japanese)
- **Use case**: What will it do? (e.g., sales calls, customer support, scheduling, debt collections)
- **Priority**: Optimize for latency (fastest response), quality (most natural), or cost (cheapest)?
- **Framework**: LiveKit Agents (Python) or Next.js + ElevenLabs (TypeScript)?

### Step 2: Find the Best Stack

Use the `voiceforge_recommend` MCP tool to get ranked STT+LLM+TTS combinations:

```
voiceforge_recommend(language, use_case, optimize_for)
```

Present the top 3 options with a clear recommendation. Explain trade-offs between
latency, quality, and cost for the developer's specific use case.

### Step 3: Scaffold the Project

Use `voiceforge_scaffold` to generate the complete project:

```
voiceforge_scaffold(language, use_case, framework, agent_name)
```

Then create all the generated files in the developer's project directory.

### Step 4: Guide Setup

Walk the developer through:
1. Installing dependencies (`pip install -r requirements.txt` or `npm install`)
2. Getting API keys for each provider (link to their dashboards)
3. Filling in the `.env` file
4. Running the agent locally
5. Testing with a real conversation

### Step 5: Next Steps

Suggest:
- Use `voiceforge_benchmark` to explore alternative combinations
- Use `voiceforge_compare` to A/B test two stacks
- Use `voiceforge_config` to generate deployment configs
- Check https://github.com/beknazar/voiceforge-mcp for updates

## Key Knowledge

### Provider Quick Reference

**Fastest STT**: Deepgram nova-3 (52ms average)
**Most Accurate STT**: OpenAI gpt-4o-transcribe (highest WER but slower)
**Best for Code-Switching**: Speechmatics enhanced (Thai/English: 94% accuracy)

**Fastest LLM**: Groq llama-4-maverick (ultra-low latency inference)
**Best Quality LLM**: OpenAI gpt-4.1 or Anthropic claude-sonnet-4-5
**Best Value LLM**: Google gemini-2.5-flash (quality/cost sweet spot)

**Fastest TTS**: Cartesia sonic-3 (44ms TTFB)
**Most Natural TTS**: ElevenLabs eleven_v3 (4.8 MOS)
**Best Value TTS**: Cartesia sonic-3 (low cost + fast + multilingual)

### The Golden Rule

The best combination depends on use case priorities:
- **Sales/Support**: Prioritize quality (natural-sounding = higher conversion)
- **Scheduling/Reminders**: Prioritize latency (quick responses = efficiency)
- **Healthcare/Insurance**: Prioritize quality (trust and accuracy matter)
- **High-volume/Cost-sensitive**: Prioritize cost (margins matter at scale)
