# Enabling Tool Calling for Weave: vLLM + litellm Configuration

## Problem

Weave sends 31 tool definitions (7 file/shell tools + 24 FABlib tools) to the LLM via
the OpenAI `tools` parameter. When the model or server doesn't properly support function
calling, errors like this occur:

```
litellm.ServiceUnavailableError: litellm.MidStreamFallbackError: ...
OpenAIException - unexpected tokens remaining in message header:
Some("...<|end|><|start|>assistant<|channel|>commentary")
Received Model Group=gpt-oss-20b
```

The model tries to reason about which tool to call but outputs raw internal tokens
instead of structured tool calls. This happens because:

1. vLLM isn't configured to parse tool calls from the model's output
2. litellm doesn't know the model supports function calling
3. The model may not support tool calling at all

## Architecture

```
Browser (Weave UI)
    |
    v
Backend (weave.py) -- OpenAI Python client, stream=True
    |                  native mode: tools=TOOLS (OpenAI function calling)
    |                  prompt mode: tools in system prompt, <tool_call> XML in text
    |
    v
litellm proxy (ai.fabric-testbed.net/v1) -- routes to model groups
    |
    v
vLLM server(s) -- serves the actual models
```

Weave supports two tool-calling modes per model. In **native** mode, tool schemas are
passed via the OpenAI `tools` parameter — requires vLLM + litellm configuration. In
**prompt** mode, tool descriptions are embedded in the system prompt and the model
outputs `<tool_call>` XML tags in regular text — works with any model, no server
changes needed.

## Tool Schema Footprint

| Category | Count | JSON Schema Size |
|----------|-------|-----------------|
| Core tools (read_file, write_file, etc.) | 7 | ~2,000 tokens |
| FABlib tools (fabric_list_slices, etc.) | 24 | ~5,200 tokens |
| **Total** | **31** | **~7,200 tokens** |

This is significant context. Models with small context windows (8K) may struggle.
Models with 32K+ context handle it fine.

---

## 1. vLLM Configuration

### Enable tool calling on each vLLM instance

Add these flags to every `vllm serve` command for models that should support
native tool calling:

```bash
--enable-auto-tool-choice \
--tool-call-parser <PARSER>
```

`--enable-auto-tool-choice` lets the model decide when to call tools (required for
`tool_choice="auto"`, which is what Weave uses in native mode).

### Parser selection by model family

| Model | Parser | Min vLLM Version |
|-------|--------|-------------------|
| **Qwen3-Coder** (30B, 480B) | `qwen3_coder` | v0.10.0 |
| **Qwen3-Instruct** (non-coder) | `hermes` | v0.6.0 |
| **Qwen2.5** (all sizes) | `hermes` | v0.6.0 |
| Llama 3.1 / 3.2 / 3.3 | `llama3_json` | v0.6.0 |
| Llama 4 | `llama4_json` | v0.8.0 |
| Mistral / Mixtral | `mistral` | v0.6.0 |
| DeepSeek V3 | `deepseek_v3` | v0.7.0 |
| DeepSeek V3.1 | `deepseek_v31` | v0.9.0 |
| Hermes 2 Pro | `hermes` | v0.6.0 |
| InternLM | `internlm` | v0.6.0 |
| GLM-4.5 | `glm45` | v0.8.0 |

Full list of parsers:
`hermes`, `mistral`, `llama3_json`, `llama4_json`, `internlm`, `jamba`, `xlam`,
`qwen`, `qwen3_coder` (aka `qwen3_xml`), `minimax_m1`, `deepseek_v3`, `deepseek_v31`,
`openai`, `kimi_k2`, `hunyuan_a13b`, `longcat`, `glm45`, `glm47`, `functiongemma`,
`olmo3`, `gigachat3`, `pythonic`

### Example: Qwen3-Coder-30B (recommended for Weave)

```bash
vllm serve Qwen/Qwen3-Coder-30B-A3B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.90
```

Or with FP8 quantization:

```bash
vllm serve Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.90
```

### Example: Qwen2.5-Coder or Qwen3-Instruct (non-coder)

```bash
vllm serve Qwen/Qwen2.5-Coder-32B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --max-model-len 32768
```

### Enabling tool calling for gpt-oss-20b

The error came from model group `gpt-oss-20b`. The leaked tokens
`<|end|><|start|>assistant<|channel|>commentary` suggest this may be a Phi-3/Phi-4
model. To determine if native tool calling is possible:

**Step 1: Identify the actual model**

Check what HuggingFace model ID is being served by the gpt-oss-20b vLLM instance:

```bash
# Check the vLLM process or startup script
ps aux | grep vllm
# Or check the vLLM /v1/models endpoint
curl http://<vllm-gpt-oss-host>:8000/v1/models
```

**Step 2: Check if a parser exists**

Look up the model family in the parser table above. If the model is:

- **Phi-3 / Phi-4**: No dedicated parser in vLLM. Try `hermes` — some Phi models
  support Hermes-style tool calling if their chat template includes it:
  ```bash
  vllm serve <phi-model> \
    --enable-auto-tool-choice \
    --tool-call-parser hermes
  ```
  Test with the curl command in Section 5. If the response contains `tool_calls`,
  it works. If you still get leaked tokens, the model doesn't support it.

- **Any model in the parser table**: Add the corresponding `--tool-call-parser` flag.

- **Unknown / unsupported model**: Use Weave's prompt-based mode (automatic —
  see Section 4). The model will still be able to call all 31 FABlib tools via
  `<tool_call>` XML tags in its text output, without any vLLM configuration.

**Step 3: If no parser works**

Some models simply don't support structured tool calling. For these, Weave's
**auto** tool mode (the default) automatically uses prompt-based tool calling,
which works with any instruction-following model. No vLLM or litellm changes needed.

---

## 2. litellm Proxy Configuration

### Model config with function calling support

In your litellm `config.yaml`, mark each model according to its capabilities:

```yaml
model_list:
  # Qwen3-Coder — native tool calling (vLLM has --enable-auto-tool-choice)
  - model_name: qwen3-coder-30b
    litellm_params:
      model: hosted_vllm/Qwen/Qwen3-Coder-30B-A3B-Instruct
      api_base: http://<vllm-qwen3-coder-host>:8000/v1
      api_key: os.environ/VLLM_API_KEY
      stream: true
    model_info:
      supports_function_calling: true
      supports_parallel_function_calling: false

  # gpt-oss-20b — if native tool calling is enabled on its vLLM instance
  - model_name: gpt-oss-20b
    litellm_params:
      model: hosted_vllm/<model-id>
      api_base: http://<vllm-gpt-oss-host>:8000/v1
      api_key: os.environ/VLLM_API_KEY
      stream: true
    model_info:
      # Set to true ONLY if vLLM has --enable-auto-tool-choice for this model
      # Set to false if the model doesn't support tool calling — Weave will
      # automatically use prompt-based mode instead
      supports_function_calling: false
```

### Global settings

```yaml
litellm_settings:
  # Drop unsupported params instead of erroring.
  # CRITICAL: When supports_function_calling is false and Weave sends tools
  # in native mode, this prevents a crash by silently dropping the tools param.
  # In auto mode, Weave won't send tools to unsupported models, but this is
  # a safety net.
  drop_params: true

  # Timeout for streaming responses (tool calls can take time)
  stream_timeout: 120
```

### Key points

- **`supports_function_calling: true`** in `model_info` tells litellm this model
  can handle `tools` in requests. Without it, litellm may strip tools or error.

- **`supports_function_calling: false`** tells litellm to NOT pass tools through.
  Combined with `drop_params: true`, tools are silently dropped. Weave's auto mode
  detects this isn't a native-tool model and uses prompt-based calling instead.

- **`supports_parallel_function_calling: false`** is safer for OSS models. Parallel
  tool calling requires the model to output multiple tool calls in a single response,
  which many OSS models don't do reliably.

- **`drop_params: true`** means if tools are accidentally sent to a model that doesn't
  support them, litellm silently drops the `tools` parameter instead of crashing.
  This is a safety net for model groups with mixed capabilities.

- **`hosted_vllm/` prefix** tells litellm to use the vLLM-compatible provider,
  which properly handles tool call responses from vLLM.

---

## 3. Model Routing Strategy

For multi-model deployments, route tool-calling requests to capable models:

### Option A: Separate model names (recommended)

Use different model names in Weave for tool-capable vs. non-tool models:

```yaml
model_list:
  # Tool-capable (Weave default)
  - model_name: qwen3-coder-30b
    litellm_params:
      model: hosted_vllm/Qwen/Qwen3-Coder-30B-A3B-Instruct
      api_base: http://vllm-tools:8000/v1
    model_info:
      supports_function_calling: true

  # General chat (no native tools — Weave uses prompt-based mode)
  - model_name: gpt-oss-20b
    litellm_params:
      model: hosted_vllm/<model>
      api_base: http://vllm-chat:8000/v1
    model_info:
      supports_function_calling: false
```

Weave users select the model in the UI. With `WEAVE_TOOL_MODE=auto` (the default),
Weave automatically uses native tool calling for `qwen3-coder-30b` and prompt-based
mode for `gpt-oss-20b`. Both models can call all 31 FABlib tools.

### Option B: Fallback groups

litellm can route with fallbacks for high availability:

```yaml
model_list:
  - model_name: weave-default
    litellm_params:
      model: hosted_vllm/Qwen/Qwen3-Coder-30B-A3B-Instruct
      api_base: http://vllm-primary:8000/v1
    model_info:
      supports_function_calling: true

  - model_name: weave-default
    litellm_params:
      model: hosted_vllm/Qwen/Qwen3-Coder-30B-A3B-Instruct
      api_base: http://vllm-secondary:8000/v1
    model_info:
      supports_function_calling: true

router_settings:
  routing_strategy: least-busy
  num_retries: 2
  timeout: 120
```

---

## 4. Weave Client-Side Configuration

Weave supports three tool-calling modes, controlled by environment variables in
docker-compose:

### WEAVE_TOOL_MODE

| Value | Behavior | When to use |
|-------|----------|-------------|
| `"auto"` (default) | Native for models in `WEAVE_NATIVE_TOOL_MODELS`, prompt-based for all others | Mixed deployments — some models have vLLM tool calling, others don't |
| `"native"` | Always passes `tools=TOOLS` to the API | All models have vLLM `--enable-auto-tool-choice` configured |
| `"prompt"` | Always embeds tools in the system prompt | No server config needed, works with any model |

### WEAVE_NATIVE_TOOL_MODELS

Comma-separated list of model names that support native tool calling. Only used
when `WEAVE_TOOL_MODE=auto`. Models NOT in this list automatically get prompt-based
tool calling.

### Recommended configuration: auto mode with per-model routing

This is the recommended setup for deployments with a mix of tool-capable and
non-tool-capable models:

```yaml
# docker-compose.yml, docker-compose.dev.yml, or docker-compose.tailscale.yml
environment:
  - WEAVE_TOOL_MODE=auto
  - WEAVE_NATIVE_TOOL_MODELS=qwen3-coder-30b
```

How it works:
- User selects **qwen3-coder-30b** in Weave UI -> native tool calling via the API
  (structured `tool_calls` in the response, parsed by vLLM)
- User selects **gpt-oss-20b** (or any other model) -> prompt-based tool calling
  (tools described in system prompt, model outputs `<tool_call>` XML in text)
- **Both models can call all 31 FABlib tools** — create slices, submit, SSH, etc.

### Alternative: all native

If ALL your models have vLLM tool calling configured:

```yaml
environment:
  - WEAVE_TOOL_MODE=native
```

### Alternative: all prompt-based

If you don't want to configure vLLM tool calling at all:

```yaml
environment:
  - WEAVE_TOOL_MODE=prompt
```

This works immediately with zero server changes. The trade-off is that prompt-based
mode uses ~500 extra tokens in the system prompt for tool descriptions, and relies
on the model outputting well-formed `<tool_call>` JSON (which most instruction-tuned
models do reliably).

---

## 5. Verification Checklist

After making changes, verify each layer:

### Test vLLM directly (bypass litellm)

```bash
curl http://<vllm-host>:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "messages": [
      {"role": "user", "content": "What is 2+2? Use the calculator tool."}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "Evaluate a math expression",
        "parameters": {
          "type": "object",
          "properties": {
            "expression": {"type": "string"}
          },
          "required": ["expression"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
```

Expected: Response contains `tool_calls` array with `calculator` function call.
If you get raw text with `<tool_call>` tags instead, the parser isn't working.

### Test litellm proxy

```bash
curl https://ai.fabric-testbed.net/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-30b",
    "messages": [
      {"role": "user", "content": "List my FABRIC slices."}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "fabric_list_slices",
        "description": "List all FABRIC slices",
        "parameters": {"type": "object", "properties": {}, "required": []}
      }
    }],
    "tool_choice": "auto"
  }'
```

Expected: Response contains `tool_calls` with `fabric_list_slices`.

### Test gpt-oss-20b with prompt-based mode

No server test needed — prompt-based mode is handled entirely by Weave. Just:

1. Ensure `WEAVE_TOOL_MODE=auto` and `gpt-oss-20b` is NOT in `WEAVE_NATIVE_TOOL_MODELS`
2. Open Weave, select gpt-oss-20b as the model
3. Ask: "list my slices"
4. Verify: model outputs `<tool_call>` XML, Weave parses it, executes the tool,
   and the model summarizes results

### Test Weave end-to-end (native mode)

1. Set `WEAVE_TOOL_MODE=auto` and `WEAVE_NATIVE_TOOL_MODELS=qwen3-coder-30b`
2. Rebuild and restart
3. Open Weave with qwen3-coder-30b selected, ask: "list my slices"
4. Verify: tool call appears in the chat, executes, model summarizes results

---

## 6. Recommended Model for Weave

**Qwen3-Coder-30B-A3B-Instruct** is the best fit because:

- Purpose-built for agentic coding tasks (tool calling is core to its training)
- Dedicated `qwen3_coder` parser in vLLM handles its XML-based tool format
- 30B total params / 3B active (MoE) — efficient inference on a single GPU
- Already your default model (`qwen3-coder-30b`)
- Supports up to 262K context (more than enough for 31 tools + conversation)

For `gpt-oss-20b` and other models without a vLLM tool parser, Weave's prompt-based
mode enables full FABlib tool access without any server changes. The model can still
create, modify, delete slices, SSH to nodes, and perform all 31 tool operations.

---

## 7. Complete Example Configuration

### vLLM instances

```bash
# Instance 1: Qwen3-Coder with native tool calling
vllm serve Qwen/Qwen3-Coder-30B-A3B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --max-model-len 65536 \
  --gpu-memory-utilization 0.90 \
  --port 8001

# Instance 2: gpt-oss-20b (no tool calling flags needed — Weave handles it)
vllm serve <gpt-oss-20b-model-id> \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.90 \
  --port 8002
```

### litellm config.yaml

```yaml
model_list:
  - model_name: qwen3-coder-30b
    litellm_params:
      model: hosted_vllm/Qwen/Qwen3-Coder-30B-A3B-Instruct
      api_base: http://localhost:8001/v1
      api_key: os.environ/VLLM_API_KEY
      stream: true
    model_info:
      supports_function_calling: true
      supports_parallel_function_calling: false

  - model_name: gpt-oss-20b
    litellm_params:
      model: hosted_vllm/<gpt-oss-20b-model-id>
      api_base: http://localhost:8002/v1
      api_key: os.environ/VLLM_API_KEY
      stream: true
    model_info:
      supports_function_calling: false

litellm_settings:
  drop_params: true
  stream_timeout: 120
```

### Weave docker-compose environment

```yaml
environment:
  - WEAVE_TOOL_MODE=auto
  - WEAVE_NATIVE_TOOL_MODELS=qwen3-coder-30b
```

### Result

| Model | Tool Mode | Server Config Needed | FABlib Tools Work? |
|-------|-----------|---------------------|-------------------|
| qwen3-coder-30b | Native (OpenAI function calling) | vLLM `--enable-auto-tool-choice --tool-call-parser qwen3_coder` | Yes |
| gpt-oss-20b | Prompt-based (`<tool_call>` XML) | None | Yes |
| Any future model | Prompt-based (default) | None | Yes |

Both models can create, modify, and delete FABRIC slices. The difference is how
tool calls are communicated — native uses the API's structured format, prompt-based
uses XML tags in the model's text output.

---

## Quick Start Summary

1. **vLLM**: Add `--enable-auto-tool-choice --tool-call-parser qwen3_coder` to
   the Qwen3-Coder serve command. No changes needed for gpt-oss-20b.
2. **litellm**: Set `supports_function_calling: true` for qwen3-coder-30b,
   `false` for gpt-oss-20b. Add `drop_params: true` to litellm_settings.
3. **Weave**: Set `WEAVE_TOOL_MODE=auto` and
   `WEAVE_NATIVE_TOOL_MODELS=qwen3-coder-30b` in docker-compose environment.
4. **Test**: curl vLLM directly with a simple tool for qwen3-coder. Test both
   models in Weave — both should be able to "list my slices" successfully.
