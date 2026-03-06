name: compact
description: Summarize the conversation to save context space
---
Summarize the current conversation into a concise context block. This replaces
the full conversation history to save context window space.

Create a summary that captures:
1. What the user has been working on
2. Key files that were created or modified (with paths)
3. Important decisions or configurations made
4. Current state and any pending work

Format as a brief, structured summary that preserves all actionable context while
discarding verbose tool outputs and intermediate steps.

After generating the summary, inform the user that you've compacted the context
and are ready to continue.
