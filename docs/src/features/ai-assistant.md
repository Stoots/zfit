## Sparky Buddy (AI Assistant)

### Core AI Features

- **Food Recognition**: Analyze food photos for automatic logging and nutrition extraction
- **Nutrition Analysis**: Intelligent nutrition information extraction from text and images
- **Meal Suggestions**: AI-powered meal recommendations and recipe generation
- **Question Answering**: General nutrition and fitness guidance, personalized advice
- **Exercise Logging**: Log exercises with duration, distance, and calorie estimates
- **Measurement Logging**: Log standard and custom body measurements
- **Water Intake Logging**: Track daily water consumption

### Chat Interface

- **Image Upload**: Send photos for food analysis
- **Text Input**: Natural language food descriptions, questions, and commands
- **History**: Persistent chat conversation history with session grouping
- **Metadata Storage**: Stores structured data like food options, exercise suggestions within chat history
- **Settings**: Direct access to AI service configuration

### Training analysis (web)

In the existing chat, turn on **Training analysis (read-only)** before asking a question. Choose **Data for your next question**: a date range (up to 366 days), a Program or all Programs in that range, Cardio Test protocols, and any relevant synced Apple Health metrics. The default is 28 days of Program history; tests and health metrics are off. Collapse the data controls to leave more space for the conversation on a phone.

For example, select your Program and Cooper attempts, then ask “Summarize my completed, missed and omitted optional sessions, and suggest a focus for next week.” Select resting heart rate or HRV when asking about recovery. Each analysis question stands alone: repeat the relevant context in follow-up questions.

- Program results retain exact Workout Session IDs, current prescriptions, effective/scheduled dates, optional status, and linked completed workout/Test identities. Omitted optional sessions are distinguished from missed required sessions. Current prescriptions are not evidence of what was performed. Linked Test results are included only when their protocol is selected and the Attempt date is in range; otherwise only the completion identity is included.
- Cardio Test results use the same Cooper, sprint, 30-second power and ramp Attempt contract as the Tests screens, including optional Planned Session links.
- Selected Apple Health fields include steps, distance, active energy, resting heart rate, VO2 max, heart rate and HRV. Only already persisted HealthKit/Apple Health records are read; nothing starts a sync. Older HealthKit custom measurements and active-energy diary records are included, including the existing heart-rate and HRV SDNN daily minimum, maximum and average categories. These stored statistics stay distinct; counts of summary records are not raw sample counts. Heart rate and HRV are daily sample summaries; SDNN and RMSSD stay separate. Older check-in steps have no source provenance and are excluded, so some selected metrics may be unavailable. Records from overlapping storage paths must not be summed together.
- No training/health data is prefetched for the provider. Only the current explicit question and data returned by the selected read tools are sent to your configured service. Earlier chat messages and unrelated custom-measurement definitions are excluded. Empty results mean unavailable records, not zero activity. Large results carry a truncation flag; narrow the dates or Program when needed (500 Program sessions/Attempts, 1,000 daily metrics/active-energy records, and 3,000 daily sample/custom summaries per read).
- Analysis exposes no mutation or tool-escalation capabilities, even if a question asks for edits. Turn analysis off and make a separate explicit logging/editing request to use the normal chat tools. This does not change ordinary chat or the upstream App Store app's tool registry.
- If a reply fails, chat shows a readable error and **Retry**. Retry keeps the same question and its original dates, Program, Test and Apple Health selections, even if you change the next-question controls. It does not add another question to the conversation. Scope is remembered for the last 50 questions while chat stays open. If the original scope is unavailable after reopening chat or eviction, Retry/Refresh uses ordinary chat without Training analysis. Edit → Update always uses ordinary chat, including when the text is unchanged; its retries stay ordinary too. Chat explains this fallback when analysis is enabled. Send a new question from the main composer to use your current analysis selections.
- Training analysis is owner-only; switched-account requests are rejected. It is available in the web app, including the iPhone Home Screen app.

The repeatable phone-web acceptance procedure is in
[`agent-docs/training-chat-phone-acceptance.md`](https://github.com/Stoots/zfit/blob/main/agent-docs/training-chat-phone-acceptance.md).

### Voice input on web and mobile

In **Ask Sparky** on the web, Android, or iOS, tap the microphone, dictate a message, then stop recording. Review or edit the recognized text and tap **Send**. Dictation does not automatically send messages or add food to your diary; the existing chat handles your request after you send it.

Open **Settings → Developer & Integrations → AI Service Settings → Voice input** on the web, or **Settings → Voice settings** on mobile. The server stores these settings for both clients; reopening the screen or returning to the app/browser refreshes changes made elsewhere.

- **Voice input On/Off:** turning it off hides the microphone without clearing your selected model. Voice input is on by default, using System recognition.
- **System recognition (default):** uses the device or browser speech recognizer without a Sparky AI transcription charge. Microphone/speech permission is required. Availability, languages, offline support, and whether audio is processed by a cloud service depend on your device or browser. Some browsers and embedded webviews do not support this mode; the chat offers Voice settings, never an automatic switch to AI.
- **Optional AI transcription:** first enable audio input on a compatible configuration in the web app's AI Service Settings. Under Voice input, choose **AI transcription**, then explicitly select a **Voice model**. A compatible Chat configuration is suggested first, not automatically selected. Provider charges may apply. Voice is independent of the **Chat** and **Vision** selections; choose **System (default)** to return to system recognition.
- **Supported AI transports:** Google models accepting inline audio, or OpenAI, Mistral, and compatible `/audio/transcriptions` endpoints. Choose a transcription-capable model, not an ordinary text-chat model. OpenAI-compatible/custom endpoints can omit the API key when the server does not require one.
- **Privacy and limits:** AI mode sends the recording through your SparkyFitness server to the selected provider. Uploads are limited to 10 MB; the server buffers audio in memory and does not save audio in chat history. Temporary device recordings are deleted after completion or cancellation; browser recordings stay in memory and microphone tracks are stopped. Provider-side retention follows that provider's policy.
- **Foreground only:** leaving the chat, switching browser tabs, backgrounding the app, disabling voice, or changing recognition mode cancels capture/transcription. The web also supports Cancel and Escape. Sending and editing are temporarily disabled during capture/transcription so a late result cannot overwrite another message. Failed recognition leaves the existing draft intact.
- **Browser requirements:** microphone recording requires HTTPS (or localhost for development), microphone permission, and a supported MediaRecorder format. WebM/Opus, MP4, and Ogg/Opus are supported when offered by the browser. A missing recognizer or denied permission never enables a paid provider automatically.

AI transcription requires an updated client and server, with the database migrations applied. Native microphone/speech-recognition dependencies require a rebuilt mobile app, not just an over-the-air JavaScript update.

### Food Integration

- **Auto-Logging**: Directly add recognized foods to diary with confirmation
- **Nutrition Confirmation**: Review and edit AI suggestions before logging
- **Meal Context**: Understand meal timing and context for accurate logging
- **Brand Recognition**: Identify specific food brands and products

## Troubleshooting AI Providers

Most "OpenAI Compatible / OpenRouter isn't working" reports come from provider configuration, not from SparkyFitness itself. The most common cases:

### OpenRouter: "No allowed providers are available for the selected model" (HTTP 404)

This is an **OpenRouter account setting**, not a SparkyFitness error. OpenRouter serves each model through one or more upstream providers. If your account is restricted to a subset of providers, a model whose upstream is excluded fails with this 404 — this most often hits the free (`:free`) models, which run on providers you may not have enabled.

The error body shows the mismatch directly:

- `available_providers` — the providers that can actually serve the model
- `requested_providers` — the providers your account currently allows

**Fix:** In your OpenRouter account settings, review the allowed-providers / data-policy preferences, then either enable the provider that serves your chosen model **or** pick a model served by a provider you already allow (e.g. an `openai/`, `anthropic/`, or `google/` model if those are your allowed upstreams).

### Every request 404s (doubled URL)

If your custom URL already ends in `/chat/completions`, SparkyFitness appends its own path and the request 404s.

**Fix:** Enter only the base URL ending in `/v1` — for example `https://openrouter.ai/api/v1`. For local servers such as LM Studio or Ollama, use an admin/global AI setting or enable [`ALLOW_PRIVATE_NETWORK_AI=true`](/install/environment-variables) on a trusted self-hosted deployment. SparkyFitness adds `/chat/completions` for you.

### "Model not found" or empty/garbled responses

The model name must be one your endpoint actually hosts. OpenAI names like `gpt-4o-mini` will not exist on most compatible servers.

**Fix:** For the **OpenAI Compatible** and **Custom** service types, enable **Use custom model** and enter your server's own model name.

### Chat works, but photo analysis or label scan fails

Food-photo analysis and nutrition-label scanning request **structured JSON output**; plain chat does not. This is done to improve the quality of results. Some models and servers do not support structured output and reject those requests while chat still works.

**Fix:** Choose a model that supports structured outputs / JSON mode. On OpenRouter, a model's page lists whether it supports "structured outputs".

### Local servers (LM Studio, Ollama, llama.cpp)

These usually run without an API key — leave the **API Key** field blank. Use the OpenAI-compatible base URL the server exposes, for example `http://localhost:1234/v1` (LM Studio) or `http://localhost:11434/v1` (Ollama's OpenAI-compatible endpoint).

Local/private AI URLs are resolved from the backend server's network, not from the browser. To prevent regular users from turning the server into a private-network proxy, private AI URLs are allowed for current admins, global admin-created AI settings, or deployments that explicitly set [`ALLOW_PRIVATE_NETWORK_AI=true`](/install/environment-variables).

### Perplexity AI Setup and Troubleshooting

Perplexity has retired the legacy OpenAI-compatible Chat Completions API (`/v1/chat/completions` and `/v1/sonar`) in favor of their new Agent API (`/v1/responses`). Attempting to connect to `api.perplexity.ai` under the generic **OpenAI Compatible** type returns HTTP 403 `chat_completions_not_available`.

**How to use Perplexity models in SparkyFitness:**

1. **Direct Perplexity Setup (Recommended):**
   - In **AI Settings**, select **Perplexity AI** from the provider dropdown.
   - Enter your Perplexity API key from `console.perplexity.ai`.
   - Select your preferred preset tier (`fast`, `low`, `medium`, `high`, `xhigh`) or enter a custom model. SparkyFitness automatically connects to Perplexity's Agent API (`/v1/responses`) using the appropriate preset.

2. **Via OpenRouter (Alternative):**
   - In **AI Settings**, select **OpenRouter** as the provider.
   - Enter your OpenRouter API key.
   - Select `perplexity/sonar` or `perplexity/sonar-pro` from the model presets. OpenRouter translates requests into standard chat completions.

### Running the chatbot on small local models (Ollama)

Small local models (roughly 3B–8B, e.g. an 8 GB Mac) can drive the chatbot's tools well, but two settings make the difference between "works great" and "acts dumb":

1. **Raise Ollama's context window.** Ollama defaults to a 4096-token context and **silently truncates** anything longer — which chops the tool definitions and system prompt mid-way and produces wrong or malformed tool calls. Raise it before anything else:
   - Set `OLLAMA_CONTEXT_LENGTH=16384` on the Ollama server (e.g. `launchctl setenv OLLAMA_CONTEXT_LENGTH 16384` on macOS, then restart Ollama), **or**
   - Bake `PARAMETER num_ctx 16384` into a Modelfile (`ollama create my-model -f Modelfile`) and point the service at that model.
   - On an 8 GB machine, start at `8192` — context uses VRAM — and only go higher if responses stay fast.
2. **Use the `core` tool profile.** When you add an Ollama service, SparkyFitness now preselects the **core** tool profile (in the service's settings). Core exposes the everyday logging tools plus goals (~20 tools) instead of the full ~35, which small models select from far more reliably and which fits a smaller context window. Pick **full** only on a strong local machine with a raised context window.

The server logs a warning when an Ollama service runs the `full` profile, since that combination most often overflows the default context. Also prefer models trained for tool calling (e.g. `qwen2.5:7b-instruct`, `llama3.1:8b`) — plain small chat models make unreliable tool calls.
