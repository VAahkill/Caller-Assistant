"""A small JSON-file store. One user per server, so no database is needed."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Generic, TypeVar

from pydantic import BaseModel

from .models import CallerMessage, CallRecord, Profile, Task

T = TypeVar("T", bound=BaseModel)


class _Collection(Generic[T]):
    def __init__(self, path: Path, model: type[T], limit: int = 500):
        self.path = path
        self.model = model
        self.limit = limit
        self._lock = threading.Lock()
        self._items: dict[str, T] = {}
        if path.exists():
            for raw in json.loads(path.read_text() or "[]"):
                item = model.model_validate(raw)
                self._items[item.id] = item  # type: ignore[attr-defined]

    def get(self, item_id: str) -> T | None:
        return self._items.get(item_id)

    def list(self) -> list[T]:
        return sorted(self._items.values(), key=lambda i: getattr(i, "created_at", 0) or getattr(i, "started_at", 0), reverse=True)

    def put(self, item: T) -> T:
        with self._lock:
            self._items[item.id] = item  # type: ignore[attr-defined]
            if len(self._items) > self.limit:
                for old in self.list()[self.limit :]:
                    self._items.pop(old.id, None)  # type: ignore[attr-defined]
            _atomic_write(self.path, json.dumps([i.model_dump(mode="json") for i in self._items.values()]))
        return item

    def delete(self, item_id: str) -> None:
        with self._lock:
            self._items.pop(item_id, None)
            _atomic_write(self.path, json.dumps([i.model_dump(mode="json") for i in self._items.values()]))


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        data_dir.mkdir(parents=True, exist_ok=True)
        (data_dir / "recordings").mkdir(exist_ok=True)
        (data_dir / "voices").mkdir(exist_ok=True)
        self._profile_path = data_dir / "profile.json"
        self._profile_lock = threading.Lock()
        self.profile = (
            Profile.model_validate_json(self._profile_path.read_text())
            if self._profile_path.exists()
            else Profile()
        )
        self.calls: _Collection[CallRecord] = _Collection(data_dir / "calls.json", CallRecord)
        self.messages: _Collection[CallerMessage] = _Collection(data_dir / "messages.json", CallerMessage)
        self.tasks: _Collection[Task] = _Collection(data_dir / "tasks.json", Task)

    def save_profile(self, profile: Profile | None = None) -> Profile:
        with self._profile_lock:
            if profile is not None:
                self.profile = profile
            _atomic_write(self._profile_path, self.profile.model_dump_json(indent=2))
        return self.profile
