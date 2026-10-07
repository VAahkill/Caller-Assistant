"""Run the server: ``python -m opencall`` (or the ``opencall`` script)."""

from __future__ import annotations

import logging


def main() -> None:
    import uvicorn

    from .api import create_app
    from .config import Settings

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    # One line per model file download otherwise; keep the log readable.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = Settings()
    if settings.api_token == "change-me":
        logging.warning("OPENCALL_API_TOKEN is the default. Set a long random value before exposing the server.")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
