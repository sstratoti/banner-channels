"""Banner Channels config entry."""

from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, PLATFORMS
from .runtime import BannerRuntime
from .store import BannerStore

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass, config):
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass, entry):
    store = BannerStore(hass)
    await store.async_load()
    runtime = BannerRuntime(hass, entry, store)
    hass.data[DOMAIN][entry.entry_id] = runtime
    await runtime.async_start()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass, entry):
    runtime = hass.data[DOMAIN].pop(entry.entry_id)
    await runtime.async_stop()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
