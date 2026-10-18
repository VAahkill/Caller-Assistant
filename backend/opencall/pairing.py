"""Connecting the app without typing the API token: the app asks for a pairing code
(POST /pair/start), the server writes a 6-digit code to its log, and the user types
it into the app, which trades it for the token (POST /pair/finish).

Both calls need no token, so they are guarded: a code lasts 5 minutes and allows 5
tries, after which it is void; asking again while a code is waiting gives the same
code; at most a few codes are made per hour; codes are compared in constant time
and every wrong try is logged."""

from __future__ import annotations

import hmac
import logging
import re
import secrets
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

log = logging.getLogger("opencall.pairing")


class PairingError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class _Code:
    value: str
    expires: float
    tries_left: int


class Pairing:
    def __init__(self, token: Callable[[], str], valid_s: float = 300.0, tries: int = 5,
                 codes_per_hour: int = 5, clock: Callable[[], float] = time.monotonic):
        self._token = token
        self.valid_s = valid_s
        self.tries = tries
        self.codes_per_hour = codes_per_hour
        self._clock = clock
        self._code: _Code | None = None
        self._made: deque[float] = deque()

    def _waiting(self) -> _Code | None:
        code = self._code
        if code is not None and (code.expires <= self._clock() or code.tries_left <= 0):
            self._code = code = None
        return code

    def start(self) -> int:
        """Writes the pairing code to the server log; returns how many seconds it lasts."""
        now = self._clock()
        code = self._waiting()
        if code is None:
            while self._made and self._made[0] <= now - 3600:
                self._made.popleft()
            if len(self._made) >= self.codes_per_hour:
                raise PairingError(429, "Too many pairing codes were asked for. Try again in an hour, or enter the"
                                        " token from the server's settings instead.")
            self._made.append(now)
            code = self._code = _Code(f"{secrets.randbelow(10**6):06d}", now + self.valid_s, self.tries)
        minutes = round(self.valid_s / 60)
        log.warning("Pairing code for the OpenCall app: %s (valid %d minute%s)", code.value, minutes,
                    "" if minutes == 1 else "s")
        return max(1, round(code.expires - now))

    def finish(self, entered: str) -> str:
        """The API token for the right code. Raises PairingError otherwise."""
        code = self._waiting()
        if code is None:
            raise PairingError(410, "No pairing code is waiting (it may have run out). Ask for a new one.")
        digits = re.sub(r"\D", "", entered or "")
        if hmac.compare_digest(digits.encode(), code.value.encode()):
            self._code = None  # one use
            log.info("The OpenCall app was paired.")
            return self._token()
        code.tries_left -= 1
        log.warning("Wrong pairing code entered (%d tries left for this code).", code.tries_left)
        if code.tries_left <= 0:
            self._code = None
            raise PairingError(410, "That code is void after too many wrong tries. Ask for a new one.")
        word = "try" if code.tries_left == 1 else "tries"
        raise PairingError(403, f"That code didn't match. Check the server log for the latest one"
                                f" ({code.tries_left} {word} left).")
