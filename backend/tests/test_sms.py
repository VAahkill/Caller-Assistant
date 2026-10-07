"""Texting the delivery partner a map link, on lines that can send SMS."""

import asyncio

from opencall.telephony.ami import ami_command, sms_command
from opencall.telephony.queue_bridge import QueueBridge


class SmsBridge(QueueBridge):
    def __init__(self, *a):
        super().__init__(*a)
        self.can_sms = True

    async def send_sms(self, text):
        self.sms.append(text)
        return True


async def run_delivery_call(engine, llm, bridge):
    llm.responder = lambda m: "Sending you the map link now. Come past Apollo Pharmacy. [SEND_LOCATION]"
    task = asyncio.create_task(engine.handle_call(bridge))
    for _ in range(100):
        if bridge.call_id in engine.sessions:
            break
        await asyncio.sleep(0.01)
    session = engine.sessions[bridge.call_id]
    await session.handle_text("Zomato delivery here, where should I come?")
    await bridge.hangup()
    await task
    return session


async def test_map_link_is_texted_when_the_line_supports_sms(engine, llm):
    bridge = SmsBridge("c1", "+919876543210")
    session = await run_delivery_call(engine, llm, bridge)
    assert "[SEND_LOCATION]" in session.conv.system_prompt
    assert bridge.sms and "google.com/maps" in bridge.sms[0] and "Apollo Pharmacy" in bridge.sms[0]
    assert any("Texted the map link" in l.text for l in session.record.transcript)


async def test_no_texting_promised_on_lines_without_sms(engine, llm):
    bridge = QueueBridge("c2", "+919876543210")
    session = await run_delivery_call(engine, llm, bridge)
    assert "[SEND_LOCATION]" not in session.conv.system_prompt
    assert any("cannot send texts" in m["content"] for m in session.conv.history if m["role"] == "system")


def test_sms_command_is_one_safe_cli_line():
    cmd = sms_command('quectel sms quectel0 {number} "{text}"', "+91 98765-43210", 'Gate "B"\nFloor 4')
    assert cmd == "quectel sms quectel0 +919876543210 \"Gate 'B' | Floor 4\""


async def test_ami_command_round_trip():
    seen = []

    async def handle(reader, writer):
        writer.write(b"Asterisk Call Manager/9.0.0\r\n")
        while True:
            block = b""
            while not block.endswith(b"\r\n\r\n"):
                chunk = await reader.readline()
                if not chunk:
                    return
                block += chunk
            seen.append(block.decode())
            if b"Logoff" in block:
                writer.close()
                return
            writer.write(b"Response: Success\r\nMessage: ok\r\n\r\n")
            await writer.drain()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    assert await ami_command("127.0.0.1", port, "opencall", "pw", 'quectel sms quectel0 +91 "hi"')
    assert "Username: opencall" in seen[0] and 'Command: quectel sms quectel0 +91 "hi"' in seen[1]
    server.close()
