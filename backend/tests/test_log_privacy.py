"""The server log never shows the API token, which the app sends in websocket URLs
and uvicorn logs in full. Owners paste this log when asking for help."""

import io
import logging

from uvicorn.logging import AccessFormatter

from opencall.__main__ import _HideToken


def _logger(name: str, formatter: logging.Formatter) -> tuple[logging.Logger, io.StringIO]:
    out = io.StringIO()
    handler = logging.StreamHandler(out)
    handler.setFormatter(formatter)
    log = logging.getLogger(name)
    log.handlers, log.propagate, log.filters = [handler], False, []
    log.setLevel(logging.INFO)
    log.addFilter(_HideToken())
    return log, out


def test_websocket_lines_hide_the_token():
    log, out = _logger("test.uvicorn.error", logging.Formatter("%(message)s"))
    # How uvicorn logs an accepted websocket.
    log.info('%s - "WebSocket %s" [accepted]', "127.0.0.1:5000", "/ws/events?token=s3cret-Token_1")
    log.info('%s - "WebSocket %s" [accepted]', "127.0.0.1:5001", "/ws/simulate?number=%2B91&goal=Ask%20price&token=s3cret-Token_1")
    log.info("Already formatted: /ws/events?token=s3cret-Token_1 403")
    text = out.getvalue()
    assert "s3cret" not in text
    assert '"WebSocket /ws/events?token=***" [accepted]' in text
    assert "goal=Ask%20price&token=***" in text
    assert "/ws/events?token=*** 403" in text


def test_access_lines_still_format_with_the_token_hidden():
    log, out = _logger("test.uvicorn.access", AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False))
    log.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET", "/health?token=s3cret&x=1", "1.1", 200)
    assert out.getvalue().strip() == '127.0.0.1:5000 - "GET /health?token=***&x=1 HTTP/1.1" 200 OK'


def test_lines_without_a_token_are_unchanged():
    log, out = _logger("test.plain", logging.Formatter("%(message)s"))
    log.info("Speech models loaded, %s", "ready for calls.")
    assert out.getvalue().strip() == "Speech models loaded, ready for calls."
