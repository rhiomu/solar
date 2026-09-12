import math
from typing import Any, Dict, List, Optional
import httpx

from src.solar_dashboard.config import Settings


class SolarAPIClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.solar_api_base_url.rstrip("/")
        self.headers = {
            "x-api-key": settings.solar_api_key.get_secret_value(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        self.group_id = settings.group_id

    async def _get(self, path: str, timeout: float = 15.0) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def _post(self, path: str, json_data: dict | None = None, timeout: float = 15.0) -> Any:
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, headers=self.headers, json=json_data or {})
            resp.raise_for_status()
            return resp.json()

    async def get_sites(self) -> List[Dict[str, Any]]:
        return await self._get(f"/api/v1/{self.group_id}/sites")

    async def get_telemetry(self) -> List[Dict[str, Any]]:
        return await self._get(f"/api/v1/{self.group_id}/telemetry")

    async def get_site_telemetry(self, site_id: str) -> Dict[str, Any]:
        return await self._get(f"/api/v1/{self.group_id}/telemetry/{site_id}")

    async def get_history_last_days(self, days: int = 7, site_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if site_id:
            return await self._get(f"/api/v1/{self.group_id}/history/last/{days}/{site_id}")
        return await self._get(f"/api/v1/{self.group_id}/history/last/{days}")

    async def get_history_monthly(self, months_count: int = 12, site_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if site_id:
            return await self._get(f"/api/v1/{self.group_id}/history/monthly/{months_count}/{site_id}")
        return await self._get(f"/api/v1/{self.group_id}/history/monthly/{months_count}")

    async def clean_site(self, site_id: str, team: str = "Team A", notes: str = "") -> Dict[str, Any]:
        payload = {"team": team, "notes": notes}
        return await self._post(f"/api/v1/{self.group_id}/telemetry/{site_id}/clean", json_data=payload)

    async def trigger_dust_storm(self) -> Dict[str, Any]:
        return await self._post(f"/api/v1/simulate/dust-storm/{self.group_id}")

    @staticmethod
    def calculate_soiling_loss(expected_kwh: float, actual_kwh: float) -> float:
        if expected_kwh <= 0:
            return 0.0
        loss = ((expected_kwh - actual_kwh) / expected_kwh) * 100.0
        return round(max(0.0, loss), 2)

    @staticmethod
    def get_soiling_status(loss_pct: float) -> Dict[str, str]:
        if loss_pct < 5.0:
            return {
                "level": "clean",
                "label": "🟢 Normal (< 5%)",
                "badge_class": "badge-clean",
                "status_text": "NORMAL",
                "advice": "Panel clean. No cleaning required.",
                "roi": "Optimal",
            }
        elif loss_pct < 15.0:
            return {
                "level": "warning",
                "label": f"🟡 Warning ({loss_pct:.1f}%)",
                "badge_class": "badge-warning",
                "status_text": "WARNING",
                "advice": "Moderate dust buildup. Schedule cleaning soon or wait for rain.",
                "roi": "Medium",
            }
        else:
            return {
                "level": "critical",
                "label": f"🔴 Critical ({loss_pct:.1f}%)",
                "badge_class": "badge-critical",
                "status_text": "CRITICAL",
                "advice": "Heavy soiling detected! Immediate team dispatch recommended.",
                "roi": "High (Immediate Action)",
            }

