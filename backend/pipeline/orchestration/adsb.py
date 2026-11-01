"""Route bounded live batches and update only dirty aircraft library entries."""

import asyncio
import logging

from common import adsblive
from common.auth import AUTHENTICATED_SOCKET_ROOM
from library.inventory import get_inventory

logger = logging.getLogger("adsb-publisher")


class AdsbPublisher:
    def __init__(self, sio):
        self.sio = sio
        self.pending = set()
        self.task = None

    async def publish(self, records):
        adsblive.update(records)
        await self.sio.emit("adsb.aircraft", {"aircraft": records}, room=adsblive.ROOM)

    def schedule(self, folders):
        self.pending.update(folders)
        if self.task is None:
            self.task = asyncio.create_task(self._index())

    async def _index(self):
        folders = set()
        try:
            while self.pending:
                folders, self.pending = self.pending, set()
                result = await asyncio.to_thread(get_inventory().update_adsb, folders)
                if result["changes"]:
                    await self.sio.emit("library.changed", result, room=AUTHENTICATED_SOCKET_ROOM)
        except Exception:
            # Keep the failed batch for the next announcement; periodic
            # reconciliation also recovers it if reception has stopped.
            self.pending.update(folders)
            logger.exception("Failed to index ADS-B log tails")
        finally:
            self.task = None
