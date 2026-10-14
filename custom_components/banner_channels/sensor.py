from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import EntityPlatformState

from .const import DOMAIN, UNRECORDED


async def async_setup_entry(hass, entry, async_add_entities):
    hass.data[DOMAIN][entry.entry_id].bind_sensors(async_add_entities)


class BannerChannelSensor(SensorEntity):
    _attr_should_poll = False
    _attr_icon = "mdi:billboard"
    _unrecorded_attributes = UNRECORDED

    def __init__(self, runtime, channel):
        self._runtime = runtime
        self.channel_id = channel["id"]
        self._requested_entity_id = channel["entity_id"]
        self._attr_unique_id = f"banner_channel_{channel['id']}"
        self._attr_name = channel["name"]
        self.entity_id = channel["entity_id"]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, runtime.entry.entry_id)},
            name="Banner Channels",
        )
        self._attr_native_value = "0"
        self._attr_extra_state_attributes = {
            "rotate_interval": channel["rotate_interval"],
            "show_badge": channel["show_badge"],
            "empty": channel["empty"],
            "all_clear": None,
            "alerts": [],
        }

    def _added_to_platform(self):
        return self.hass is not None and self._platform_state == EntityPlatformState.ADDED

    def set_feed(self, feed):
        self._attr_native_value = str(len(feed["alerts"]))
        self._attr_extra_state_attributes = feed
        if self._added_to_platform():
            self.async_write_ha_state()

    def apply_channel(self, channel):
        self._attr_name = channel["name"]
        if self._added_to_platform():
            self.async_write_ha_state()

    async def async_added_to_hass(self):
        await super().async_added_to_hass()
        if self.entity_id != self._requested_entity_id:
            self._runtime.adopt_entity_id(self.channel_id, self.entity_id)
        self.async_write_ha_state()
