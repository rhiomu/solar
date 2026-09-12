"""Background sync service to fetch data from remote Solar Mock API and persist to SQLite.

Protects against HTTP 504 Gateway Timeouts by making all user-facing reads local (<10ms).
Background synchronization runs periodically or on-demand without blocking the user.
"""
import asyncio
import logging
from typing import Any, Dict, Optional

from src.solar_dashboard import db
from src.solar_dashboard.api_client import SolarAPIClient

logger = logging.getLogger("solar_sync")


class SolarSyncService:
    def __init__(self, client: SolarAPIClient):
        self.client = client
        self._sync_lock = asyncio.Lock()
        self._bg_task: Optional[asyncio.Task] = None
        self._running = False

    async def sync_all(self, force: bool = False) -> Dict[str, Any]:
        """Perform a full sync: sites, live telemetry, daily history (30d), and monthly history (12m)."""
        async with self._sync_lock:
            db.update_sync_status("syncing", "Synchronizing with solar mock server...")
            try:
                # 1. Fetch sites & telemetry
                sites, telemetry = await asyncio.gather(
                    self.client.get_sites(),
                    self.client.get_telemetry(),
                )
                if sites:
                    db.save_sites_cache(sites)
                if telemetry:
                    db.save_telemetry_cache(telemetry)

                # 2. Fetch history (30 days daily and 12 months monthly across fleet)
                hist_daily, hist_monthly = await asyncio.gather(
                    self.client.get_history_last_days(30),
                    self.client.get_history_monthly(12),
                )
                if hist_daily:
                    db.save_history_daily_cache(hist_daily)
                if hist_monthly:
                    db.save_history_monthly_cache(hist_monthly)

                msg = f"Successfully synced {len(sites)} sites, telemetry, {len(hist_daily)} daily and {len(hist_monthly)} monthly records."
                db.update_sync_status("success", msg)
                logger.info(msg)
                return {"status": "success", "message": msg, "sites_count": len(sites)}
            except Exception as exc:
                err_msg = f"Upstream API warning: {exc}. Using existing local cached data."
                logger.warning(err_msg)
                # Check if we already have local cache
                cached_sites = db.get_sites_cache()
                if cached_sites and len(cached_sites) > 0:
                    db.update_sync_status("warning", f"Using cached data (upstream warning: {exc})")
                    return {"status": "warning", "message": err_msg, "sites_count": len(cached_sites)}
                else:
                    db.update_sync_status("failed", str(exc))
                    return {"status": "failed", "message": str(exc), "sites_count": 0}

    async def sync_telemetry_only(self) -> None:
        """Fast periodic sync of live telemetry only."""
        if self._sync_lock.locked():
            return
        async with self._sync_lock:
            try:
                telemetry = await self.client.get_telemetry()
                if telemetry:
                    db.save_telemetry_cache(telemetry)
                    db.update_sync_status("success", "Live telemetry updated.")
            except Exception as exc:
                logger.warning(f"Telemetry periodic sync skipped: {exc}")
                db.update_sync_status("warning", f"Live telemetry delay ({exc})")

    async def _background_loop(self) -> None:
        """Periodic background task that keeps local database updated."""
        # Initial full sync
        await self.sync_all()

        cycle_count = 0
        while self._running:
            try:
                await asyncio.sleep(60)  # Check every 60 seconds
                cycle_count += 1
                if cycle_count % 15 == 0:
                    # Every 15 minutes, perform full sync of daily and monthly history
                    await self.sync_all()
                else:
                    # Every 60 seconds, sync live telemetry
                    await self.sync_telemetry_only()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Error in sync background loop: {exc}")

    def start_background_sync(self) -> None:
        if self._bg_task is None or self._bg_task.done():
            self._running = True
            self._bg_task = asyncio.create_task(self._background_loop())
            logger.info("Solar background sync worker started.")

    def stop_background_sync(self) -> None:
        self._running = False
        if self._bg_task and not self._bg_task.done():
            self._bg_task.cancel()
            logger.info("Solar background sync worker stopped.")
