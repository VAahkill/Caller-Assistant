"""Voices: each sentence goes to a voice that can read its script, the user's choice
per language is honoured, recorded voices get unique ids, a playable recording, a
status and a demo, and demos are made once and served from disk."""

import asyncio
import io
import re
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from opencall.api import create_app
from opencall.providers.tts import TTSRouter, sentences

H = {"Authorization": "Bearer test-token"}
needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg is not installed")


class FakeEngine:
    def __init__(self, kind="mms"):
        self.kind = kind
        self.calls = []

    def synth(self, *args):
        self.calls.append(args)
        return b"\x01\x00" * 160

    def warm_up(self, *args):
        self.calls.append(("warm", *args))


class FakeXTTS(FakeEngine):
    def __init__(self, fail=False):
        super().__init__("xtts")
        self.fail = fail
        self.loaded = False

    def warm_up(self):
        self.loaded = True

    def unload(self):
        self.loaded = False

    def make_latents(self, reference, out):
        if self.fail:
            raise RuntimeError("no speech in the recording")
        assert reference.exists()
        out.write_bytes(b"latents")


def router(tmp_path, piper="on", indic="mms", xtts=None):
    r = TTSRouter(tmp_path / "voices", provider="kokoro", clone_provider="none", indic=indic, piper=piper)
    r.kokoro = FakeEngine("kokoro")
    r.indic = FakeEngine(indic) if r.indic is not None else None
    r.piper = FakeEngine("piper") if r.piper is not None else None
    r.xtts = xtts
    return r


def wav_bytes(seconds=8, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        t = np.arange(int(seconds * rate)) / rate
        w.writeframes((np.sin(2 * np.pi * 180 * t) * 8000).astype(np.int16).tobytes())
    return buf.getvalue()


# ----------------------------------------------------------------- routing by script
def test_each_sentence_goes_to_a_voice_that_reads_its_script(tmp_path):
    r = router(tmp_path)
    r._synth_sync("Sure. మీ ఆర్డర్ వచ్చింది. Thank you!", "kokoro:af_heart", "te")
    assert r.kokoro.calls == [("Sure.", "af_heart", "en"), ("Thank you!", "af_heart", "en")]
    assert r.piper.calls == [("మీ ఆర్డర్ వచ్చింది.", "te_IN-padmavathi-medium")]
    assert r.indic.calls == []


def test_indian_scripts_never_reach_kokoro_or_a_cloned_voice(tmp_path):
    r = router(tmp_path, xtts=FakeXTTS())
    clone = r.add_clone("Mum", wav_bytes())
    r._synth_sync("வணக்கம். नमस्ते।", clone.id, "ta")
    assert r.indic.calls == [("வணக்கம்.", "ta", "", "")]
    assert r.xtts.calls[0][0] == "नमस्ते।" and r.xtts.calls[0][2] == "hi"  # XTTS speaks Hindi
    assert r.kokoro.calls == []


def test_english_words_are_written_in_the_script_before_an_indian_voice_reads_them(tmp_path, monkeypatch):
    monkeypatch.setattr("opencall.transliterate._pronounce", lambda word: {"Swiggy": "swˈɪɡi"}[word])
    r = router(tmp_path, piper="off")
    r._synth_sync("మీ Swiggy ఆర్డర్, OTP చెప్పకండి.", "kokoro:af_heart", "te")
    assert r.indic.calls == [("మీ స్విగీ ఆర్డర్, ఓటీపీ చెప్పకండి.", "te", "female", "")]


def test_the_voice_chosen_for_a_language_is_used(tmp_path):
    r = router(tmp_path)
    r.chosen_voices = lambda: {"te": "piper:te_IN-venkatesh-medium", "hi": "kokoro:hm_psi"}
    r._synth_sync("నమస్తే. नमस्ते। Hello.", "kokoro:af_heart", "te")
    assert r.piper.calls == [("నమస్తే.", "te_IN-venkatesh-medium")]
    assert r.kokoro.calls == [("नमस्ते।", "hm_psi", "hi"), ("Hello.", "af_heart", "en")]


def test_a_chosen_voice_that_cant_speak_the_language_is_ignored(tmp_path):
    r = router(tmp_path)
    assert r.voice_for("ta", "kokoro:am_adam", {"ta": "piper:te_IN-venkatesh-medium"}) == "mms:ta"
    assert r.voice_for("te", "kokoro:am_adam", {}) == "piper:te_IN-venkatesh-medium"  # same gender
    assert r.voice_for("hi", "kokoro:am_adam", {}) == "kokoro:hm_omega"
    assert r.voice_for("en", "mms:te", {}) == "kokoro:af_heart"


def test_telugu_uses_mms_when_piper_is_off(tmp_path):
    r = router(tmp_path, piper="off")
    assert r.voice_for("te", "kokoro:af_heart") == "mms:te"
    assert not [v for v in r.list_voices() if v.engine == "piper"]
    assert router(tmp_path, piper="off", indic="none").voice_for("te", "kokoro:af_heart") == ""


def test_text_is_split_into_sentences_for_routing():
    assert sentences("Hi. How are you? నమస్తే!") == ["Hi. ", "How are you? ", "నమస్తే!"]
    assert sentences("no full stop") == ["no full stop"]
    assert sentences("  ") == []


def test_kokoro_shares_one_model_between_languages(monkeypatch):
    import sys
    import types

    from opencall.providers.tts import KokoroEngine

    made = []

    class KModel:
        def __init__(self, repo_id):
            made.append(repo_id)

        def to(self, device):
            return self

        def eval(self):
            return self

    class KPipeline:
        def __init__(self, lang_code, repo_id, model):
            self.model = model

        def __call__(self, text, voice):
            yield None, None, np.zeros(2400, dtype=np.float32)

    monkeypatch.setitem(sys.modules, "kokoro", types.SimpleNamespace(KModel=KModel, KPipeline=KPipeline))
    no_gpu = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
    monkeypatch.setitem(sys.modules, "torch", no_gpu)  # CI doesn't install PyTorch
    k = KokoroEngine()
    k.synth("Hello", "af_heart", "en")
    k.synth("नमस्ते", "hf_alpha", "hi")
    assert made == ["hexgrad/Kokoro-82M"]
    assert len(k._pipelines) == 2 and len({id(p.model) for p in k._pipelines.values()}) == 1


# ----------------------------------------------------------------- recorded voices
def test_two_recordings_with_the_same_name_are_two_voices(tmp_path):
    r = router(tmp_path, xtts=FakeXTTS())
    a, b = r.add_clone("My voice", wav_bytes()), r.add_clone("My voice", wav_bytes())
    assert a.id != b.id and re.fullmatch(r"clone:my_voice-[0-9a-f]{6}", a.id)
    assert a.status == "preparing" and a.seconds == 8.0 and a.created_at
    with wave.open(io.BytesIO(r.clone_recording(a.id).read_bytes())) as w:
        assert w.getframerate() == 24000  # XTTS listens to its references at 24 kHz


def test_a_recorded_voice_is_ready_once_its_latents_are_made(tmp_path):
    r = router(tmp_path, xtts=FakeXTTS())
    v = r.add_clone("Mum", wav_bytes())
    ready = r.prepare_clone(v.id)
    assert ready.status == "ready" and (tmp_path / "voices" / f"{v.id[6:]}.latents.pt").exists()
    assert r.speaks(v.id) >= {"en", "hi"} and "te" not in r.speaks(v.id)


def test_a_recorded_voice_that_cant_be_prepared_says_why(tmp_path):
    r = router(tmp_path, xtts=FakeXTTS(fail=True))
    v = r.add_clone("Mum", wav_bytes())
    failed = r.prepare_clone(v.id)
    assert failed.status == "failed" and "no speech" in failed.detail
    off = router(tmp_path / "off")
    v = off.add_clone("Dad", wav_bytes())
    assert off.prepare_clone(v.id).status == "failed" and "turned off" in off.get_voice(v.id).detail


def test_recorded_voices_say_clearly_what_they_need(monkeypatch):
    import sys
    import types

    from opencall.providers.tts import XTTSEngine

    monkeypatch.setitem(sys.modules, "transformers", types.SimpleNamespace(__version__="5.19.0"))
    with pytest.raises(RuntimeError, match="transformers 4"):
        XTTSEngine().warm_up()
    monkeypatch.setitem(sys.modules, "transformers", types.SimpleNamespace(__version__="4.57.6"))
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace())
    monkeypatch.setitem(sys.modules, "TTS", None)  # coqui-tts not installed
    monkeypatch.setitem(sys.modules, "TTS.api", None)
    with pytest.raises(RuntimeError, match=r"opencall\[clone\]"):
        XTTSEngine().warm_up()


def test_letting_the_recorded_voice_model_go_frees_it(monkeypatch):
    from opencall.providers import tts as tts_mod

    trimmed = []
    monkeypatch.setattr(tts_mod, "_return_freed_memory", lambda: trimmed.append(True))
    x = tts_mod.XTTSEngine()
    x.unload()  # nothing loaded: nothing to do
    assert trimmed == []
    x._tts = object()
    x.unload()
    assert x._tts is None and trimmed == [True]


def test_giving_freed_memory_back_works_on_this_system():
    from opencall.providers.tts import _return_freed_memory

    _return_freed_memory()  # glibc: trims the heap; elsewhere: does nothing


def test_a_voice_that_cant_load_its_model_is_marked_failed_with_the_reason(tmp_path, monkeypatch):
    import sys
    import types

    from opencall.providers.tts import XTTSEngine

    monkeypatch.setitem(sys.modules, "transformers", types.SimpleNamespace(__version__="5.19.0"))
    r = router(tmp_path, xtts=XTTSEngine())
    voice = r.add_clone("Mum", wav_bytes())
    info = r.prepare_clone(voice.id)
    assert info.status == "failed" and "transformers 4" in info.detail


def test_too_short_a_recording_is_refused(tmp_path):
    with pytest.raises(ValueError, match="at least 6 seconds"):
        router(tmp_path).add_clone("Me", wav_bytes(seconds=3))


def client(settings, engine):
    return TestClient(create_app(settings, engine, start_gateways=False))


def test_voice_list_has_recorded_voices_first_with_their_details(settings, engine):
    engine.tts.xtts = FakeXTTS()
    c = client(settings, engine)
    first = c.post("/voices", headers=H, data={"label": "Old"}, files={"audio": ("a.wav", wav_bytes(), "audio/wav")})
    second = c.post("/voices", headers=H, data={"label": "New"}, files={"audio": ("b.wav", wav_bytes(), "audio/wav")})
    assert first.status_code == second.status_code == 200 and first.json()["status"] == "preparing"
    voices = c.get("/voices", headers=H).json()
    assert [v["name"] for v in voices[:2]] == ["New", "Old"] and voices[2]["kind"] == "builtin"
    new = voices[0]
    assert new["engine"] == "xtts" and new["seconds"] == 8.0 and new["created_at"]
    assert new["recording_url"] == f"/voices/{new['id']}/recording"
    assert re.fullmatch(rf"/voices/{re.escape(new['id'])}/sample.wav\?lang=en&v=[0-9a-f]{{10}}", new["sample_url"])
    recording = c.get(new["recording_url"], headers=H)
    assert recording.status_code == 200 and recording.content[:4] == b"RIFF"
    assert c.get("/voices/clone:nope-123456/recording", headers=H).status_code == 404


async def test_a_new_voice_is_prepared_in_the_background(engine):
    engine.tts.xtts = FakeXTTS()
    voice = await asyncio.to_thread(engine.tts.add_clone, "Mum", wav_bytes())
    await engine.prepare_voice(voice.id)
    assert engine.tts.get_voice(voice.id).status == "ready"
    event = [e for e in engine.bus.history if e["event"] == "voice_status"][-1]
    assert event["voice_id"] == voice.id and event["status"] == "ready"
    _, _, demo = engine.samples.locate(voice.id)
    assert demo.exists()  # its demo was made too
    assert not engine.tts.xtts.loaded  # and the big model let go, as the voice isn't in use


def test_the_recorded_voice_model_is_loaded_only_while_a_recorded_voice_is_in_use(tmp_path):
    r = router(tmp_path, xtts=FakeXTTS())
    r.provider = "kokoro"
    clone = r.add_clone("Mum", wav_bytes())
    r.warm_up("kokoro:af_heart", ["te"], {})
    assert not r.xtts.loaded  # recorded, but not chosen
    r.warm_up("kokoro:af_heart", ["te"], {"hi": clone.id})
    assert r.xtts.loaded
    assert r.uses_recorded_voice(clone.id, {}) and not r.uses_recorded_voice("kokoro:af_heart", {})


async def test_choosing_a_built_in_voice_again_lets_the_recorded_voice_model_go(engine):
    engine.tts.xtts = FakeXTTS()
    engine.tts.xtts.loaded = True
    engine.store.profile.voice = "kokoro:am_adam"
    engine.store.save_profile()
    assert not engine.tts.xtts.loaded


def test_demos_are_made_once_and_cached(settings, engine):
    rendered = []
    real = engine.tts.render_sample

    def render(voice_id, lang):
        rendered.append((voice_id, lang))
        return real(voice_id, lang)

    engine.tts.render_sample = render
    c = client(settings, engine)
    voice = next(v for v in c.get("/voices", headers=H).json() if v["id"] == "mms:te")
    first = c.get(voice["sample_url"], headers=H)
    assert first.status_code == 200 and first.content[:4] == b"RIFF"
    assert "immutable" in first.headers["cache-control"]
    again = c.get(voice["sample_url"], headers=H)
    assert again.content == first.content and rendered == [("mms:te", "te")]
    etag = first.headers["etag"]
    assert c.get(voice["sample_url"], headers={**H, "If-None-Match": etag}).status_code == 304
    unversioned = c.get("/voices/mms:te/sample.wav", headers=H)
    assert unversioned.headers["etag"] == etag and unversioned.headers["cache-control"] == "no-cache"
    assert c.get("/voices/kokoro:nobody/sample.wav", headers=H).status_code == 404


def test_a_demo_in_a_language_the_voice_cant_speak_is_in_its_own(settings, engine):
    c = client(settings, engine)
    r = c.get("/voices/mms:ta/sample.wav?lang=hi", headers=H)
    assert r.status_code == 200
    assert engine.samples.locate("mms:ta", "hi")[0] == "ta"


def test_a_voice_still_preparing_has_no_demo_yet(settings, engine):
    voice = engine.tts.add_clone("Mum", wav_bytes())
    r = client(settings, engine).get(f"/voices/{voice.id}/sample.wav", headers=H)
    assert r.status_code == 409


async def test_asking_twice_at_once_makes_one_demo(engine):
    calls = []

    def slow(voice_id, lang):
        calls.append(voice_id)
        import time

        time.sleep(0.2)
        return b"\x01\x00" * 1600

    engine.tts.render_sample = slow
    (a, _), (b, _) = await asyncio.gather(engine.samples.get("mms:te"), engine.samples.get("mms:te"))
    assert a == b and calls == ["mms:te"]


def test_built_in_demos_are_made_at_startup_for_the_callers_languages(engine):
    engine.store.profile.caller_languages = ["en", "te"]
    made = engine.samples.prerender(["en", "te"])
    files = {p.name.split("-")[0] for p in engine.samples.folder.glob("*.wav")}
    assert made == len(files) and "mms_te" in files and "mms_ta" not in files


async def test_choosing_a_voice_for_a_language_prepares_its_fixed_lines_at_once(engine):
    engine.ready["tts"] = True
    engine.store.profile.caller_languages = ["en", "te"]
    engine.store.profile.voices_by_language = {"te": "mms:te"}
    engine.store.save_profile()
    while engine._background:
        await asyncio.gather(*engine._background)
    voice = engine.store.profile.voice
    one_moment = engine._speech_key(engine.fixed_line("filler", "te"), voice, "te")
    assert one_moment in engine._speech_cache and one_moment[-1] == "te=mms:te"


def test_renaming_and_deleting_a_recorded_voice(settings, engine):
    engine.tts.xtts = FakeXTTS()
    c = client(settings, engine)
    upload = {"audio": ("a.wav", wav_bytes(), "audio/wav")}
    voice = c.post("/voices", headers=H, data={"label": "Mum"}, files=upload).json()
    renamed = c.patch(f"/voices/{voice['id']}", headers=H, json={"label": "Amma"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Amma"
    assert c.patch("/voices/kokoro:af_heart", headers=H, json={"label": "x"}).status_code == 404
    c.patch("/profile", headers=H, json={"voice": voice["id"], "voices_by_language": {"hi": voice["id"]}})
    assert c.delete(f"/voices/{voice['id']}", headers=H).status_code == 200
    profile = c.get("/profile", headers=H).json()
    assert profile["voice"] == settings.default_voice and profile["voices_by_language"] == {}
    assert c.delete(f"/voices/{voice['id']}", headers=H).status_code == 404
    assert all(v["id"] != voice["id"] for v in c.get("/voices", headers=H).json())


def test_older_apps_can_still_delete_by_name(settings, engine):
    voice = engine.tts.add_clone("Mum", wav_bytes())
    assert client(settings, engine).delete(f"/voices/{voice.id[6:]}", headers=H).status_code == 200
    assert engine.tts.get_voice(voice.id) is None


@needs_ffmpeg
def test_a_phone_recording_with_its_index_at_the_end_is_accepted(settings, engine, tmp_path):
    src = tmp_path / "in.wav"
    src.write_bytes(wav_bytes(seconds=8, rate=44100))
    out = tmp_path / "rec.m4a"  # ffmpeg writes the index (moov) at the end unless told otherwise
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(src), "-c:a", "aac", str(out)], check=True)
    data = out.read_bytes()
    assert data.find(b"moov") > data.find(b"mdat")
    r = client(settings, engine).post("/voices", headers=H, data={"label": "Phone"},
                                      files={"audio": ("rec.m4a", data, "audio/mp4")})
    assert r.status_code == 200 and 7.5 <= r.json()["seconds"] <= 8.5


def test_settings_turn_piper_on_for_the_server(tmp_path):
    from opencall.config import Settings
    from opencall.engine import Engine

    on = Engine(Settings(data_dir=tmp_path, stt_provider="none", lid_provider="none", mt_provider="none",
                         clone_provider="none"))
    assert on.tts.piper is not None and on.tts.voice_for("te", "kokoro:af_heart").startswith("piper:")
    off = Engine(Settings(data_dir=tmp_path / "b", stt_provider="none", lid_provider="none", mt_provider="none",
                          clone_provider="none", piper_voices="off"))
    assert off.tts.piper is None
    assert isinstance(Path(on.samples.folder), Path)
