"""The OpenAI-compatible client: a slow first word is allowed, a stalled stream or an
unreachable server fails fast with a message the user can act on."""

import asyncio
import json

import httpx
import pytest

from opencall.providers.llm import LLMError, LLMTimeout, OpenAICompatLLM


def sse(*words):
    return [f"data: {json.dumps({'choices': [{'delta': {'content': w}}]})}\n\n".encode() for w in words] + [
        b"data: [DONE]\n\n"]


def client(handler, **kw) -> OpenAICompatLLM:
    llm = OpenAICompatLLM("http://llm.test/v1", "key", "test-model", **kw)
    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=llm._client.timeout)
    return llm


def streaming(chunks, first_delay=0.0, gap=0.0):
    async def body():
        await asyncio.sleep(first_delay)
        for c in chunks:
            yield c
            await asyncio.sleep(gap)

    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())


async def collect(llm):
    return "".join([c async for c in llm.stream([{"role": "user", "content": "hi"}])])


async def test_streams_words():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return streaming(sse("Sure, ", "come in."))

    assert await collect(client(handler)) == "Sure, come in."
    assert seen["stream"] is True and seen["max_tokens"] == 300 and seen["model"] == "test-model"


async def test_a_slow_first_word_is_waited_for():
    llm = client(lambda r: streaming(sse("Hello."), first_delay=0.3), first_token_timeout=2, idle_timeout=0.1)
    assert await collect(llm) == "Hello."


async def test_no_first_word_in_time_is_a_timeout():
    llm = client(lambda r: streaming(sse("Hello."), first_delay=1.0), first_token_timeout=0.2, idle_timeout=5)
    with pytest.raises(LLMTimeout, match="didn.t start answering within 0.2 s"):
        await collect(llm)


async def test_a_server_that_holds_back_its_headers_times_out_on_the_first_word_limit():
    async def handler(request):
        await asyncio.sleep(2.0)  # sends nothing until its first word, like llama.cpp
        return streaming(sse("Hello."))

    llm = client(handler, first_token_timeout=0.2, idle_timeout=5)
    start = asyncio.get_running_loop().time()
    with pytest.raises(LLMTimeout, match="within 0.2 s"):
        await collect(llm)
    assert asyncio.get_running_loop().time() - start < 1.0


async def test_a_stalled_stream_is_a_timeout():
    llm = client(lambda r: streaming(sse("One", " two"), gap=1.0), first_token_timeout=5, idle_timeout=0.2)
    with pytest.raises(LLMTimeout, match="stopped answering"):
        await collect(llm)


async def test_unreachable_server_is_reported():
    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(LLMError, match="Couldn't reach the language model at http://llm.test/v1"):
        await collect(client(handler))


async def test_http_errors_are_reported_with_the_body():
    llm = client(lambda r: httpx.Response(404, json={"error": "model 'test-model' not found, try pulling it first"}))
    with pytest.raises(LLMError, match="HTTP 404.*try pulling it first"):
        await collect(llm)


async def test_warm_up_sends_one_token_request():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "Hi"}}]})

    await client(handler).warm_up([{"role": "system", "content": "prompt"}, {"role": "user", "content": "Hello?"}])
    assert seen["max_tokens"] == 1 and seen["stream"] is False and seen["messages"][0]["content"] == "prompt"


async def test_warm_up_failure_is_an_llm_error():
    with pytest.raises(LLMError, match="HTTP 500"):
        await client(lambda r: httpx.Response(500, text="loading")).warm_up([{"role": "user", "content": "x"}])


async def test_extra_body_fields_are_sent_but_cannot_replace_the_clients_own():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return streaming(sse("Hi."))

    llm = client(handler, extra_body={"reasoning_effort": "none", "top_k": 20, "model": "other", "stream": False})
    assert await collect(llm) == "Hi."
    assert seen["reasoning_effort"] == "none" and seen["top_k"] == 20
    assert seen["model"] == "test-model" and seen["stream"] is True


def test_extra_body_setting_is_checked():
    from opencall.providers.llm import parse_extra_body

    assert parse_extra_body("") == {}
    assert parse_extra_body('{"reasoning_effort": "low"}') == {"reasoning_effort": "low"}
    with pytest.raises(ValueError, match="JSON object"):
        parse_extra_body("reasoning_effort=none")
    with pytest.raises(ValueError, match="JSON object"):
        parse_extra_body('["none"]')
    with pytest.raises(ValueError, match="can't set model"):
        parse_extra_body('{"model": "x"}')


def test_thinking_is_off_by_default():
    from opencall.config import Settings
    from opencall.providers import build_llm

    llm = build_llm(Settings(_env_file=None))
    assert llm.extra_body == {"reasoning_effort": "none"}


async def test_a_thinking_model_is_reported_and_its_reasoning_never_returned(caplog):
    def handler(request):
        chunks = [f"data: {json.dumps({'choices': [{'delta': {'reasoning_content': 'Let me see...'}}]})}\n\n".encode(),
                  *sse("Sure.")]
        return streaming(chunks)

    with caplog.at_level("WARNING", logger="opencall.llm"):
        assert await collect(client(handler)) == "Sure."
    assert "thinking before it answers" in caplog.text and "reasoning_effort" in caplog.text
