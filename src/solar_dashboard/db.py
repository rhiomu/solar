"""Local SQLite database for Solar Fleet Operations & Monitoring Dashboard.

Stores:
- Per-site customizable cleaning costs (site_settings)
- Fleet-wide customizable tariffs like feed_in_tariff (fleet_settings)
- Local caches of sites, telemetry, daily history, and monthly history to eliminate 504 errors
- Sync status and timestamps
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_FILE = Path(__file__).resolve().parent.parent.parent / "solar_local.db"

DEFAULT_SITES = [
    {"site_id": "SOLAR-BKK-01", "site_name": "Bangkok Warehouse Roof", "region": "Bangkok", "cleaning_cost_thb": 15000.0, "capacity_kwp": 620.0},
    {"site_id": "SOLAR-RYG-02", "site_name": "Rayong Factory Solar", "region": "Rayong", "cleaning_cost_thb": 15000.0, "capacity_kwp": 650.0},
    {"site_id": "SOLAR-CBI-03", "site_name": "Chonburi Logistics Center", "region": "Chonburi", "cleaning_cost_thb": 15000.0, "capacity_kwp": 580.0},
    {"site_id": "SOLAR-SPK-04", "site_name": "Samut Prakan Cold Storage Hub", "region": "Samut Prakan", "cleaning_cost_thb": 15000.0, "capacity_kwp": 700.0},
    {"site_id": "SOLAR-AYA-05", "site_name": "Ayutthaya Stamping Plant", "region": "Ayutthaya", "cleaning_cost_thb": 15000.0, "capacity_kwp": 690.0},
    {"site_id": "SOLAR-CNX-06", "site_name": "Chiang Mai Data Center", "region": "Chiang Mai", "cleaning_cost_thb": 15000.0, "capacity_kwp": 560.0},
    {"site_id": "SOLAR-KKC-07", "site_name": "Khon Kaen Distribution Center", "region": "Khon Kaen", "cleaning_cost_thb": 15000.0, "capacity_kwp": 740.0},
    {"site_id": "SOLAR-NMA-08", "site_name": "Nakhon Ratchasima Factory", "region": "Nakhon Ratchasima", "cleaning_cost_thb": 15000.0, "capacity_kwp": 670.0},
    {"site_id": "SOLAR-SGK-09", "site_name": "Songkhla Port Facility", "region": "Songkhla", "cleaning_cost_thb": 15000.0, "capacity_kwp": 700.0},
    {"site_id": "SOLAR-PTM-10", "site_name": "Pathum Thani Tech Campus", "region": "Pathum Thani", "cleaning_cost_thb": 15000.0, "capacity_kwp": 550.0},
]


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(default_feed_in: float = 2.20, default_grid_import: float = 4.50, default_cleaning: float = 15000.0) -> None:
    """Initialize database tables and default configuration."""
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS site_settings (
                site_id TEXT PRIMARY KEY,
                site_name TEXT,
                region TEXT,
                cleaning_cost_thb REAL NOT NULL,
                notes TEXT,
                updated_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS fleet_settings (
                key TEXT PRIMARY KEY,
                value REAL NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sites_cache (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_cache (
                site_id TEXT PRIMARY KEY,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS history_daily_cache (
                site_id TEXT,
                date TEXT,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (site_id, date)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS history_monthly_cache (
                site_id TEXT,
                month TEXT,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (site_id, month)
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sync_meta (
                key TEXT PRIMARY KEY,
                val TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        now_str = datetime.now(timezone.utc).isoformat()

        # Seed default fleet settings if absent
        cursor.execute("INSERT OR IGNORE INTO fleet_settings (key, value, updated_at) VALUES (?, ?, ?)",
                       ("feed_in_tariff", default_feed_in, now_str))
        cursor.execute("INSERT OR IGNORE INTO fleet_settings (key, value, updated_at) VALUES (?, ?, ?)",
                       ("grid_import_tariff", default_grid_import, now_str))

        # Seed default site settings if absent
        for s in DEFAULT_SITES:
            cursor.execute("""
                INSERT OR IGNORE INTO site_settings (site_id, site_name, region, cleaning_cost_thb, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (s["site_id"], s["site_name"], s["region"], default_cleaning, "", now_str))

        conn.commit()


# --- Fleet Settings ---
def get_fleet_settings(default_feed_in: float = 2.20, default_grid_import: float = 4.50) -> Dict[str, float]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM fleet_settings")
        rows = cursor.fetchall()
        settings = {row["key"]: float(row["value"]) for row in rows}
        return {
            "feed_in_tariff": settings.get("feed_in_tariff", default_feed_in),
            "grid_import_tariff": settings.get("grid_import_tariff", default_grid_import),
        }


def set_fleet_setting(key: str, value: float) -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO fleet_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        """, (key, float(value), now_str))
        conn.commit()


# --- Site Cleaning Costs & Settings ---
def get_all_site_settings() -> List[Dict[str, Any]]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT site_id, site_name, region, cleaning_cost_thb, notes, updated_at FROM site_settings ORDER BY site_id ASC")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_site_cleaning_cost(site_id: str, default_cost: float = 15000.0) -> float:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT cleaning_cost_thb FROM site_settings WHERE site_id = ?", (site_id,))
        row = cursor.fetchone()
        if row and row["cleaning_cost_thb"] is not None:
            return float(row["cleaning_cost_thb"])
        return default_cost


def set_site_cleaning_cost(site_id: str, cost: float, notes: str = "") -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE site_settings
            SET cleaning_cost_thb = ?, notes = CASE WHEN ? != '' THEN ? ELSE notes END, updated_at = ?
            WHERE site_id = ?
        """, (float(cost), notes, notes, now_str, site_id))
        if cursor.rowcount == 0:
            cursor.execute("""
                INSERT INTO site_settings (site_id, site_name, region, cleaning_cost_thb, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (site_id, site_id, "Central", float(cost), notes, now_str))
        conn.commit()


def set_multiple_cleaning_costs(costs: Dict[str, float]) -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        cursor = conn.cursor()
        for site_id, cost in costs.items():
            cursor.execute("""
                UPDATE site_settings
                SET cleaning_cost_thb = ?, updated_at = ?
                WHERE site_id = ?
            """, (float(cost), now_str, site_id))
        conn.commit()


# --- Sites Cache ---
def save_sites_cache(sites: List[Dict[str, Any]]) -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    data_json = json.dumps(sites, ensure_ascii=False)
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sites_cache (id, data_json, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
        """, (data_json, now_str))
        for s in sites:
            sid = s.get("site_id")
            if sid:
                cursor.execute("""
                    UPDATE site_settings
                    SET site_name = COALESCE(?, site_name), region = COALESCE(?, region)
                    WHERE site_id = ?
                """, (s.get("site_name"), s.get("region"), sid))
        conn.commit()


def get_sites_cache() -> Optional[List[Dict[str, Any]]]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT data_json FROM sites_cache WHERE id = 1")
        row = cursor.fetchone()
        if row:
            try:
                return json.loads(row["data_json"])
            except Exception:
                return None
        return None


def get_site_capacity_kwp(site_id: str) -> float:
    """Return capacity in kWp for a site from cache or fallback list."""
    sites = get_sites_cache()
    if sites:
        for s in sites:
            if s.get("site_id") == site_id and s.get("capacity_kwp"):
                return float(s["capacity_kwp"])
    for s in DEFAULT_SITES:
        if s.get("site_id") == site_id and s.get("capacity_kwp"):
            return float(s["capacity_kwp"])
    return 600.0


# --- Telemetry Cache ---
def save_telemetry_cache(telemetry_list: List[Dict[str, Any]]) -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        cursor = conn.cursor()
        for item in telemetry_list:
            sid = item.get("site_id")
            if not sid:
                continue
            data_json = json.dumps(item, ensure_ascii=False)
            cursor.execute("""
                INSERT INTO telemetry_cache (site_id, data_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(site_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
            """, (sid, data_json, now_str))
        conn.commit()


def get_all_telemetry_cache() -> List[Dict[str, Any]]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT data_json FROM telemetry_cache ORDER BY site_id ASC")
        rows = cursor.fetchall()
        result = []
        for r in rows:
            try:
                result.append(json.loads(r["data_json"]))
            except Exception:
                continue
        return result


def get_site_telemetry_cache(site_id: str) -> Optional[Dict[str, Any]]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT data_json FROM telemetry_cache WHERE site_id = ?", (site_id,))
        row = cursor.fetchone()
        if row:
            try:
                return json.loads(row["data_json"])
            except Exception:
                return None
        return None


# --- History Daily Cache ---
def save_history_daily_cache(records: List[Dict[str, Any]]) -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        cursor = conn.cursor()
        for r in records:
            sid = r.get("site_id")
            date_str = r.get("date")
            if not sid or not date_str:
                continue
            data_json = json.dumps(r, ensure_ascii=False)
            cursor.execute("""
                INSERT INTO history_daily_cache (site_id, date, data_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(site_id, date) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
            """, (sid, date_str, data_json, now_str))
        conn.commit()


def get_history_daily_cache(days: int = 7, site_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        if site_id:
            cursor.execute("""
                SELECT data_json FROM history_daily_cache
                WHERE site_id = ?
                ORDER BY date DESC
                LIMIT ?
            """, (site_id, days))
        else:
            cursor.execute("""
                SELECT data_json FROM history_daily_cache
                WHERE date IN (
                    SELECT DISTINCT date FROM history_daily_cache ORDER BY date DESC LIMIT ?
                )
                ORDER BY date DESC, site_id ASC
            """, (days,))
        rows = cursor.fetchall()
        result = []
        for r in rows:
            try:
                result.append(json.loads(r["data_json"]))
            except Exception:
                continue
        return result


def get_latest_daily_record(site_id: str) -> Optional[Dict[str, Any]]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT data_json FROM history_daily_cache
            WHERE site_id = ?
            ORDER BY date DESC
            LIMIT 1
        """, (site_id,))
        row = cursor.fetchone()
        if row:
            try:
                return json.loads(row["data_json"])
            except Exception:
                return None
        return None


def get_latest_daily_records_fleet() -> Dict[str, Dict[str, Any]]:
    """Get the latest daily history record for each site."""
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT h1.site_id, h1.data_json
            FROM history_daily_cache h1
            INNER JOIN (
                SELECT site_id, MAX(date) AS max_date
                FROM history_daily_cache
                GROUP BY site_id
            ) h2 ON h1.site_id = h2.site_id AND h1.date = h2.max_date
        """)
        rows = cursor.fetchall()
        res = {}
        for r in rows:
            try:
                res[r["site_id"]] = json.loads(r["data_json"])
            except Exception:
                continue
        return res


# --- History Monthly Cache ---
def save_history_monthly_cache(records: List[Dict[str, Any]]) -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        cursor = conn.cursor()
        for r in records:
            sid = r.get("site_id")
            month_str = r.get("month")
            if not sid or not month_str:
                continue
            data_json = json.dumps(r, ensure_ascii=False)
            cursor.execute("""
                INSERT INTO history_monthly_cache (site_id, month, data_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(site_id, month) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
            """, (sid, month_str, data_json, now_str))
        conn.commit()


def get_history_monthly_cache(months: int = 12, site_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        if site_id:
            cursor.execute("""
                SELECT data_json FROM history_monthly_cache
                WHERE site_id = ?
                ORDER BY month DESC
                LIMIT ?
            """, (site_id, months))
        else:
            cursor.execute("""
                SELECT data_json FROM history_monthly_cache
                WHERE month IN (
                    SELECT DISTINCT month FROM history_monthly_cache ORDER BY month DESC LIMIT ?
                )
                ORDER BY month DESC, site_id ASC
            """, (months,))
        rows = cursor.fetchall()
        result = []
        for r in rows:
            try:
                result.append(json.loads(r["data_json"]))
            except Exception:
                continue
        return result


# --- Sync Meta ---
def update_sync_status(status: str, message: str = "") -> None:
    now_str = datetime.now(timezone.utc).isoformat()
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sync_meta (key, val, updated_at)
            VALUES ('sync_status', ?, ?)
            ON CONFLICT(key) DO UPDATE SET val=excluded.val, updated_at=excluded.updated_at
        """, (status, now_str))
        if message:
            cursor.execute("""
                INSERT INTO sync_meta (key, val, updated_at)
                VALUES ('sync_message', ?, ?)
                ON CONFLICT(key) DO UPDATE SET val=excluded.val, updated_at=excluded.updated_at
            """, (message, now_str))
        conn.commit()


def get_sync_status() -> Dict[str, str]:
    with _get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, val, updated_at FROM sync_meta WHERE key IN ('sync_status', 'sync_message')")
        rows = cursor.fetchall()
        res = {"status": "idle", "message": "Never synced", "updated_at": ""}
        for r in rows:
            if r["key"] == "sync_status":
                res["status"] = r["val"]
                res["updated_at"] = r["updated_at"]
            elif r["key"] == "sync_message":
                res["message"] = r["val"]
        return res
