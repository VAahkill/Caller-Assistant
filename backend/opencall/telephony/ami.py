"""Minimal Asterisk Manager Interface client, used to send SMS through a GSM
modem (chan_quectel's ``quectel sms`` command) while a call is in progress."""

from __future__ import annotations

import asyncio
import re


def sms_command(template: str, number: str, text: str) -> str:
    # One CLI line: no newlines, no characters that would end the quoted text.
    clean = re.sub(r"\s*\n\s*", " | ", text).replace("\\", "/").replace('"', "'")
    return template.format(number=re.sub(r"[^\d+]", "", number), text=clean)


async def ami_command(host: str, port: int, user: str, secret: str, command: str, timeout: float = 10) -> bool:
    """Runs one CLI command through AMI's Command action. True if Asterisk accepted it."""

    async def _run() -> bool:
        reader, writer = await asyncio.open_connection(host, port)
        try:
            await reader.readline()  # banner
            writer.write(f"Action: Login\r\nUsername: {user}\r\nSecret: {secret}\r\n\r\n".encode())
            if "Success" not in await _read_block(reader):
                return False
            writer.write(f"Action: Command\r\nCommand: {command}\r\n\r\n".encode())
            reply = await _read_block(reader)
            writer.write(b"Action: Logoff\r\n\r\n")
            await writer.drain()
            return "Response: Success" in reply or "Response: Follows" in reply
        finally:
            writer.close()

    try:
        return await asyncio.wait_for(_run(), timeout)
    except (OSError, asyncio.TimeoutError):
        return False


async def _read_block(reader: asyncio.StreamReader) -> str:
    lines = []
    while True:
        line = (await reader.readline()).decode(errors="ignore")
        if not line or line in ("\r\n", "\n"):
            if lines:
                return "".join(lines)
            if not line:
                return ""
            continue
        lines.append(line)
