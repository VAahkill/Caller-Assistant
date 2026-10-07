import asyncio
import struct
import uuid

from opencall.telephony.asterisk import KIND_AUDIO, KIND_HANGUP, KIND_UUID, AsteriskGateway


async def test_audiosocket_call(engine, settings):
    settings.asterisk_audiosocket_port = 0
    gw = AsteriskGateway(engine)
    await gw.start()
    port = gw._server.sockets[0].getsockname()[1]

    call_uuid = str(uuid.uuid4())
    assert await gw.screen(call_uuid, "+919876543210") == "answer"
    assert await gw.screen(str(uuid.uuid4()), "+442079460000") == "reject"  # international

    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(struct.pack(">BH", KIND_UUID, 16) + uuid.UUID(call_uuid).bytes)
    writer.write(struct.pack(">BH", KIND_AUDIO, 320) + b"\x00" * 320)
    await writer.drain()

    kind, length = struct.unpack(">BH", await reader.readexactly(3))
    assert kind == KIND_AUDIO and length == 320  # 20 ms of 8 kHz greeting audio
    await reader.readexactly(length)
    call_id = uuid.UUID(call_uuid).hex[:12]
    assert engine.sessions[call_id].record.number == "+919876543210"

    writer.write(struct.pack(">BH", KIND_HANGUP, 0))
    await writer.drain()
    for _ in range(100):
        if call_id not in engine.sessions:
            break
        await asyncio.sleep(0.02)
    assert engine.store.calls.get(call_id).status == "ended"
    writer.close()
    await gw.stop()
