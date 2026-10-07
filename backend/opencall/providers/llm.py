"""Chat LLMs. One client covers Ollama, Groq, LM Studio, vLLM and llama.cpp,
since they all speak the OpenAI chat-completions protocol."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Protocol

import httpx

Message = dict[str, str]


class LLM(Protocol):
    def stream(self, messages: list[Message]) -> AsyncIterator[str]: ...


class OpenAICompatLLM:
    def __init__(self, base_url: str, api_key: str, model: str, temperature: float = 0.4):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60, connect=5))

    async def stream(self, messages: list[Message]) -> AsyncIterator[str]:
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "temperature": self.temperature,
            "max_tokens": 300,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with self._client.stream(
            "POST", f"{self.base_url}/chat/completions", json=payload, headers=headers
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0]["delta"].get("content")
                except (KeyError, IndexError, json.JSONDecodeError):
                    continue
                if delta:
                    yield delta


class ScriptedLLM:
    """Deterministic stand-in used by tests and the offline demo.

    ``responder`` gets the message list and returns the full reply; the reply
    is streamed back in small chunks to exercise the streaming code paths.
    """

    def __init__(self, responder: Callable[[list[Message]], str] | None = None):
        self.responder = responder or (lambda m: "Sure, I'll pass that on. [MESSAGE: caller asked to be called back]")
        self.calls: list[list[Message]] = []

    async def stream(self, messages: list[Message]) -> AsyncIterator[str]:
        self.calls.append([dict(m) for m in messages])
        reply = self.responder(messages)
        for i in range(0, len(reply), 7):
            yield reply[i : i + 7]
