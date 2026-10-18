"""Run the server: ``python -m opencall`` (or the ``opencall`` script)."""

from __future__ import annotations

import logging
import re


class _HideToken(logging.Filter):
    """Keeps the API token out of the log: the app sends it in websocket URLs,
    and uvicorn logs each URL in full. People paste this log when asking for help."""

    _token = re.compile(r'(token=)[^&\s"]+')

    def _hide(self, value: object) -> object:
        return self._token.sub(r"\1***", value) if isinstance(value, str) else value

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self._hide(record.msg)
        # Keep a tuple: uvicorn's access formatter unpacks record.args.
        if isinstance(record.args, tuple):
            record.args = tuple(self._hide(a) for a in record.args)
        return True


def hide_token_in_logs() -> None:
    # Logger filters survive uvicorn's own logging setup.
    for name in ("uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).addFilter(_HideToken())


def main() -> None:
    import uvicorn

    from .api import create_app
    from .config import Settings

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    # One line per model file download otherwise; keep the log readable.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    hide_token_in_logs()
    settings = Settings()
    if settings.api_token == "change-me":
        logging.warning("OPENCALL_API_TOKEN is the default. Set a long random value before exposing the server.")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
