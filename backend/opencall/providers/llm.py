"""Chat LLMs. One client covers Ollama, Groq, LM Studio, vLLM and llama.cpp,
since they all speak the OpenAI chat-completions protocol."""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Callable
from typing import Protocol

import httpx

Message = dict[str, str]


class LLM(Protocol):
    def stream(self, messages: list[Message]) -> AsyncIterator[str]: ...


class LLMError(Exception):
    """The LLM couldn't answer. The message is written for the user to read."""


class LLMTimeout(LLMError):
    pass


class OpenAICompatLLM:
    """Streams a chat completion.

    A local model on a CPU can take minutes to load and read a long prompt before
    the first word, so the first token gets a long timeout of its own; after that,
    a stalled stream fails fast. Connecting fails fast too, so a server that isn't
    running is reported at once.
    """

    def __init__(self, base_url: str, api_key: str, model: str, temperature: float = 0.4,
                 connect_timeout: float = 5.0, first_token_timeout: float = 180.0, idle_timeout: float = 30.0,
                 max_tokens: int = 300):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.first_token_timeout = first_token_timeout
        self.idle_timeout = idle_timeout
        self.max_tokens = max_tokens
        read = max(first_token_timeout, idle_timeout)
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(read, connect=connect_timeout))

    def _payload(self, messages: list[Message], **extra) -> dict:
        return {"model": self.model, "messages": messages, "temperature": self.temperature,
                "max_tokens": self.max_tokens, **extra}

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def stream(self, messages: list[Message]) -> AsyncIterator[str]:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.first_token_timeout
        got_text = False
        try:
            async with contextlib.AsyncExitStack() as stack:
                request = self._client.stream("POST", f"{self.base_url}/chat/completions",
                                              json=self._payload(messages, stream=True), headers=self._headers)
                try:
                    # Some servers send nothing, not even headers, until the first word.
                    resp = await asyncio.wait_for(stack.enter_async_context(request), max(0.0, deadline - loop.time()))
                except asyncio.TimeoutError:
                    raise LLMTimeout(self._timeout_text(False)) from None
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode(errors="replace")[:300]
                    raise LLMError(f"The language model at {self.base_url} answered HTTP {resp.status_code}: {body}")
                lines = resp.aiter_lines()
                while True:
                    wait = self.idle_timeout if got_text else max(0.0, deadline - loop.time())
                    try:
                        line = await asyncio.wait_for(anext(lines), wait)
                    except StopAsyncIteration:
                        break
                    except asyncio.TimeoutError:
                        raise LLMTimeout(self._timeout_text(got_text)) from None
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
                        got_text = True
                        yield delta
        except httpx.TimeoutException as e:
            raise LLMTimeout(self._timeout_text(got_text)) from e
        except httpx.TransportError as e:
            raise LLMError(f"Couldn't reach the language model at {self.base_url} ({e.__class__.__name__}).") from e

    def _timeout_text(self, got_text: bool) -> str:
        if got_text:
            return f"The language model stopped answering for {self.idle_timeout:g} s."
        return (f"The language model ({self.model}) didn't start answering within"
                f" {self.first_token_timeout:g} s. It may still be loading.")

    async def warm_up(self, messages: list[Message]) -> None:
        """Loads the model and fills the server's prompt cache with this prompt."""
        try:
            resp = await self._client.post(
                f"{self.base_url}/chat/completions", headers=self._headers,
                json={**self._payload(messages, stream=False), "max_tokens": 1},
                timeout=httpx.Timeout(max(self.first_token_timeout, 300.0), connect=self._client.timeout.connect),
            )
        except httpx.TimeoutException as e:
            raise LLMTimeout(self._timeout_text(False)) from e
        except httpx.TransportError as e:
            raise LLMError(f"Couldn't reach the language model at {self.base_url} ({e.__class__.__name__}).") from e
        if resp.status_code >= 400:
            raise LLMError(f"The language model at {self.base_url} answered HTTP {resp.status_code}: {resp.text[:300]}")


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
