from homeassistant.helpers.storage import Store

from .const import DOMAIN


class BannerStore:
    def __init__(self, hass):
        self._store = Store(hass, 1, DOMAIN)
        self.data = {"channels": [], "rules": []}

    async def async_load(self):
        loaded = await self._store.async_load()
        self.data = loaded or {"channels": [], "rules": []}
        self.data.setdefault("channels", [])
        self.data.setdefault("rules", [])
        return self.data

    async def async_save(self):
        await self._store.async_save(self.data)
