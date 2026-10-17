"""Exercise the editor's actual request builder against HA's template websocket."""

import json
from pathlib import Path
import shutil
import subprocess

import pytest

PANEL = Path(__file__).parents[1] / "custom_components/banner_channels/frontend/banner-channels-panel.js"


@pytest.mark.skipif(shutil.which("node") is None, reason="Editor request builder requires Node")
@pytest.mark.asyncio
async def test_editor_request_renders_live_templates_and_preserves_text(hass, hass_ws_client):
    entity_id = "update.home_assistant"
    hass.states.async_set(entity_id, "on", {"friendly_name": "HA Update", "latest_version": "2026.10.3"})
    draft = {
        "id": "update-rule",
        "match": {"kind": "entity", "entity_id": entity_id},
        "headline": "{{ name }}: {{ state }} ({{ rule_id }})",
        "subtext": "{{ state_attr('update.home_assistant', 'latest_version') }}",
        "icon": "{{ 'mdi:update' }}",
        "background": "{{ '#ffffff' }}",
        "color": "{{ '0012' }} / {{ false }} / \"quoted\"",
    }
    context = {"states": {entity_id: {"state": "on", "attributes": {"friendly_name": "HA Update"}}}}
    script = (
        f"import {{ templatePreviewRequest }} from {json.dumps(PANEL.as_uri())};"
        f"process.stdout.write(JSON.stringify(templatePreviewRequest({json.dumps(draft)}, {json.dumps(context)})));"
    )
    built = subprocess.run(["node", "--input-type=module", "-e", script], check=True, capture_output=True, text=True, timeout=10)
    request = json.loads(built.stdout)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(request)
    ack = await client.receive_json()
    assert ack["success"] is True
    initial = await client.receive_json()
    assert initial["event"]["result"] == {
        "headline": "HA Update: on (update-rule)",
        "subtext": "2026.10.3", "icon": "mdi:update", "background": "#ffffff",
        "color": '0012 / False / "quoted"',
    }
    hass.states.async_set(entity_id, "on", {"friendly_name": "HA Update", "latest_version": "2026.10.4"})
    await hass.async_block_till_done()
    changed = await client.receive_json()
    assert changed["event"]["result"]["subtext"] == "2026.10.4"
    await client.send_json_auto_id({"type": "unsubscribe_events", "subscription": ack["id"]})
    assert (await client.receive_json())["success"] is True
