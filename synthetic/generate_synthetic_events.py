"""Generate deterministic Yellowstone synthetic event data for GrizCam ops demos.

Example:
    python3 -m synthetic.generate_synthetic_events \
        --host localhost \
        --port 5432 \
        --admin-dbname postgres \
        --user "$USER" \
        --password "" \
        --target-dbname grizcam_synthetic_2025 \
        --drop-existing true \
        --json-output synthetic/generated_raw_events.json
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, TypeVar
from zoneinfo import ZoneInfo

try:
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extras import Json, execute_values
except ImportError:  # pragma: no cover - exercised only in export-only environments.
    psycopg2 = None
    sql = None
    Json = None
    execute_values = None


LOCAL_TZ = ZoneInfo("America/Denver")
UTC = timezone.utc
DEFAULT_SEED = 20250325
DEFAULT_JSON_OUTPUT = "synthetic/generated_raw_events.json.gz"
BLOB_ROOT = "https://grizcamprodstorage.blob.core.windows.net/events"
TIME_OF_DAY_BUCKETS = (
    ("night", 0, 5),
    ("morning", 6, 11),
    ("afternoon", 12, 16),
    ("evening", 17, 21),
    ("night", 22, 23),
)
SUBJECT_CATEGORIES = {
    "elk": "wildlife",
    "bison": "wildlife",
    "deer": "wildlife",
    "wolf": "wildlife",
    "bear": "wildlife",
    "fox_coyote": "wildlife",
    "bird": "wildlife",
    "empty_landscape": "empty_scene",
    "hiker": "human",
    "ranger": "human",
    "vehicle": "vehicle",
}
HEAT_RANGES = {
    "elk": (72, 97),
    "bison": (76, 99),
    "deer": (66, 88),
    "wolf": (55, 82),
    "bear": (68, 94),
    "fox_coyote": (48, 74),
    "bird": (20, 52),
    "empty_landscape": (0, 6),
    "hiker": (72, 95),
    "ranger": (65, 90),
    "vehicle": (8, 40),
}
BEARING_BY_SENSOR = {"F": 0, "R": 90, "B": 180, "L": 270}
SEASON_BY_MONTH = {
    12: "winter",
    1: "winter",
    2: "winter",
    3: "spring",
    4: "spring",
    5: "spring",
    6: "summer",
    7: "summer",
    8: "summer",
    9: "fall",
    10: "fall",
    11: "fall",
}
SEASON_FACTORS = {"winter": 0.72, "spring": 0.96, "summer": 1.28, "fall": 1.04}
MODEL_VARIANTS: Tuple[Tuple[str, str], ...] = (
    ("gemini-2.5-flash-lite-preview-06-17", "2025-07-10"),
    ("gemini-2.5-flash-lite-preview-06-17", "2025-06-03"),
    ("gemini-2.5-flash", "2025-08-01"),
    ("gemini-1.5-pro", "2025-05-14"),
)


ChoiceT = TypeVar("ChoiceT")


@dataclass(frozen=True)
class CameraProfile:
    mac: str
    name: str
    camera_name: str
    location_name: str
    location_code: str
    latitude: float
    longitude: float
    camera_profile: str
    notes: str
    base_event_mean: float
    pressure_base: float
    temp_offset: float
    humidity_offset: float
    battery_start: float
    battery_drain_per_day: float
    reset_days: Tuple[int, ...]
    sensor_weights: Dict[str, float]
    subject_weights: Dict[str, float]
    # Camera personalities drive persistent operational behavior rather than random one-off noise.
    voltage_bias: float
    upload_delay_bias_minutes: float
    night_lux_bias: float
    weather_volatility: float
    missing_ai_bias: float
    telemetry_stale_bias: float
    battery_glitch_bias: float


CAMERA_PROFILES: Tuple[CameraProfile, ...] = (
    CameraProfile(
        mac="F0F5BD77B201",
        name="LamarNorth1",
        camera_name="Lamar Valley North",
        location_name="Lamar Valley North",
        location_code="12T0564128E4941186N",
        latitude=44.9168,
        longitude=-110.1536,
        camera_profile="Valley-edge wildlife corridor focused on wolves, elk, and bison at dawn and dusk.",
        notes="Open sage valley with winter wind, strong predator dawn activity, and occasional bears in shoulder seasons.",
        base_event_mean=26.0,
        pressure_base=82380.0,
        temp_offset=-4.5,
        humidity_offset=-3.0,
        battery_start=98.5,
        battery_drain_per_day=0.030,
        reset_days=(132, 258),
        sensor_weights={"F": 0.42, "B": 0.14, "L": 0.24, "R": 0.20},
        subject_weights={
            "elk": 0.23,
            "bison": 0.22,
            "deer": 0.08,
            "wolf": 0.12,
            "bear": 0.05,
            "fox_coyote": 0.09,
            "bird": 0.09,
            "empty_landscape": 0.08,
            "hiker": 0.02,
            "ranger": 0.01,
            "vehicle": 0.01,
        },
        voltage_bias=-0.035,
        upload_delay_bias_minutes=6.0,
        night_lux_bias=0.74,
        weather_volatility=1.10,
        missing_ai_bias=0.02,
        telemetry_stale_bias=0.28,
        battery_glitch_bias=0.02,
    ),
    CameraProfile(
        mac="F0F5BD77B202",
        name="HaydenSouth1",
        camera_name="Hayden Valley South",
        location_name="Hayden Valley South",
        location_code="12T0538194E4934860N",
        latitude=44.6281,
        longitude=-110.4462,
        camera_profile="Broad valley camera with heavy bison and elk movement plus open thermal haze and empty scenes.",
        notes="Open basin with broad sky exposure, frequent empty landscapes, bird fly-throughs, and overcast summer afternoons.",
        base_event_mean=24.0,
        pressure_base=81660.0,
        temp_offset=-2.0,
        humidity_offset=5.0,
        battery_start=97.2,
        battery_drain_per_day=0.027,
        reset_days=(166,),
        sensor_weights={"F": 0.38, "B": 0.12, "L": 0.22, "R": 0.28},
        subject_weights={
            "elk": 0.15,
            "bison": 0.28,
            "deer": 0.05,
            "wolf": 0.04,
            "bear": 0.02,
            "fox_coyote": 0.05,
            "bird": 0.16,
            "empty_landscape": 0.20,
            "hiker": 0.02,
            "ranger": 0.01,
            "vehicle": 0.02,
        },
        voltage_bias=0.0,
        upload_delay_bias_minutes=8.0,
        night_lux_bias=0.95,
        weather_volatility=1.48,
        missing_ai_bias=0.03,
        telemetry_stale_bias=0.18,
        battery_glitch_bias=0.04,
    ),
    CameraProfile(
        mac="F0F5BD77B203",
        name="MammothEdge1",
        camera_name="Mammoth Trail Edge",
        location_name="Mammoth Trail Edge",
        location_code="12T0509427E4973815N",
        latitude=44.9766,
        longitude=-110.7012,
        camera_profile="Trail-adjacent camera mixing elk, deer, hikers, and periodic ranger truck pass-throughs.",
        notes="Busy shoulder trail with spring melt, summer foot traffic, and scheduled ranger presence during daylight hours.",
        base_event_mean=22.0,
        pressure_base=83120.0,
        temp_offset=-1.0,
        humidity_offset=1.0,
        battery_start=99.0,
        battery_drain_per_day=0.024,
        reset_days=(120, 240),
        sensor_weights={"F": 0.30, "B": 0.18, "L": 0.27, "R": 0.25},
        subject_weights={
            "elk": 0.18,
            "bison": 0.05,
            "deer": 0.15,
            "wolf": 0.02,
            "bear": 0.02,
            "fox_coyote": 0.04,
            "bird": 0.08,
            "empty_landscape": 0.12,
            "hiker": 0.19,
            "ranger": 0.08,
            "vehicle": 0.07,
        },
        voltage_bias=0.01,
        upload_delay_bias_minutes=5.0,
        night_lux_bias=1.0,
        weather_volatility=1.0,
        missing_ai_bias=0.10,
        telemetry_stale_bias=0.12,
        battery_glitch_bias=0.03,
    ),
    CameraProfile(
        mac="F0F5BD77B204",
        name="OldFaithful1",
        camera_name="Old Faithful Perimeter",
        location_name="Old Faithful Perimeter",
        location_code="12T0513209E4926624N",
        latitude=44.4605,
        longitude=-110.8281,
        camera_profile="Visitor-adjacent perimeter camera with birds, people, boardwalk motion, and occasional bison.",
        notes="Strong summer tourism pattern, daylight ranger activity, and late-evening bird and empty-boardwalk scenes.",
        base_event_mean=21.0,
        pressure_base=80980.0,
        temp_offset=0.5,
        humidity_offset=4.0,
        battery_start=98.1,
        battery_drain_per_day=0.026,
        reset_days=(155,),
        sensor_weights={"F": 0.36, "B": 0.14, "L": 0.20, "R": 0.30},
        subject_weights={
            "elk": 0.05,
            "bison": 0.07,
            "deer": 0.03,
            "wolf": 0.01,
            "bear": 0.01,
            "fox_coyote": 0.02,
            "bird": 0.18,
            "empty_landscape": 0.16,
            "hiker": 0.27,
            "ranger": 0.08,
            "vehicle": 0.12,
        },
        voltage_bias=-0.012,
        upload_delay_bias_minutes=44.0,
        night_lux_bias=1.0,
        weather_volatility=1.08,
        missing_ai_bias=0.04,
        telemetry_stale_bias=0.10,
        battery_glitch_bias=0.03,
    ),
    CameraProfile(
        mac="F0F5BD77B205",
        name="LakeOverlook1",
        camera_name="Yellowstone Lake Overlook",
        location_name="Yellowstone Lake Overlook",
        location_code="12T0558742E4905241N",
        latitude=44.4252,
        longitude=-110.3617,
        camera_profile="Shoreline overlook with birds, fox or coyote movement, and occasional bears near dawn or dusk.",
        notes="Cool lakeside microclimate, strong bird presence, foggy mornings, and periodic shoreline empty-scene captures.",
        base_event_mean=20.0,
        pressure_base=80120.0,
        temp_offset=-2.8,
        humidity_offset=8.0,
        battery_start=97.8,
        battery_drain_per_day=0.028,
        reset_days=(145, 290),
        sensor_weights={"F": 0.34, "B": 0.14, "L": 0.28, "R": 0.24},
        subject_weights={
            "elk": 0.06,
            "bison": 0.03,
            "deer": 0.07,
            "wolf": 0.03,
            "bear": 0.06,
            "fox_coyote": 0.14,
            "bird": 0.24,
            "empty_landscape": 0.22,
            "hiker": 0.08,
            "ranger": 0.03,
            "vehicle": 0.04,
        },
        voltage_bias=-0.055,
        upload_delay_bias_minutes=10.0,
        night_lux_bias=0.88,
        weather_volatility=1.22,
        missing_ai_bias=0.05,
        telemetry_stale_bias=0.22,
        battery_glitch_bias=0.09,
    ),
)


@dataclass(frozen=True)
class GroupContext:
    stale_mode: str
    stuck_battery: bool
    telemetry_seed: Dict[str, float]
    upload_mode: str
    ai_mode: str
    json_mode: str
    timestamp_mode: str


def env_default(name: str, fallback: str) -> str:
    value = os.getenv(name)
    return value if value is not None else fallback


def parse_bool(value: str | bool) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=env_default("GRIZCAM_PG_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(env_default("GRIZCAM_PG_PORT", "5432")))
    parser.add_argument("--admin-dbname", default=env_default("GRIZCAM_PG_ADMIN_DB", "postgres"))
    parser.add_argument("--user", default=env_default("GRIZCAM_PG_USER", os.getenv("USER", "")))
    parser.add_argument("--password", default=env_default("GRIZCAM_PG_PASSWORD", ""))
    parser.add_argument(
        "--target-dbname",
        default=env_default("GRIZCAM_SYNTHETIC_DB", "grizcam_synthetic_2025"),
    )
    parser.add_argument("--seed", type=int, default=int(env_default("GRIZCAM_SYNTHETIC_SEED", str(DEFAULT_SEED))))
    parser.add_argument(
        "--drop-existing",
        type=parse_bool,
        default=parse_bool(env_default("GRIZCAM_SYNTHETIC_DROP_EXISTING", "false")),
    )
    parser.add_argument(
        "--json-output",
        default=env_default("GRIZCAM_SYNTHETIC_JSON_OUTPUT", DEFAULT_JSON_OUTPUT),
    )
    parser.add_argument(
        "--skip-db",
        type=parse_bool,
        default=parse_bool(env_default("GRIZCAM_SYNTHETIC_SKIP_DB", "false")),
    )
    return parser


def require_psycopg2() -> None:
    if psycopg2 is None or sql is None or Json is None or execute_values is None:
        raise RuntimeError(
            "psycopg2 is required for Postgres seeding. Re-run with --skip-db true for JSON export only."
        )


def get_connection_args(args: argparse.Namespace, dbname: str) -> Dict[str, object]:
    return {
        "host": args.host,
        "port": args.port,
        "dbname": dbname,
        "user": args.user,
        "password": args.password,
    }


def connect(db_args: Dict[str, object], autocommit: bool = False):
    require_psycopg2()
    conn = psycopg2.connect(**db_args)
    conn.autocommit = autocommit
    return conn


def database_exists(admin_conn, dbname: str) -> bool:
    with admin_conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
        return cur.fetchone() is not None


def recreate_database(args: argparse.Namespace) -> None:
    admin_conn = connect(get_connection_args(args, args.admin_dbname), autocommit=True)
    try:
        exists = database_exists(admin_conn, args.target_dbname)
        if exists and not args.drop_existing:
            raise RuntimeError(
                "Target database already exists. Re-run with --drop-existing true to replace it."
            )

        with admin_conn.cursor() as cur:
            if exists:
                cur.execute(
                    """
                    SELECT pg_terminate_backend(pid)
                    FROM pg_stat_activity
                    WHERE datname = %s AND pid <> pg_backend_pid()
                    """,
                    (args.target_dbname,),
                )
                cur.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(args.target_dbname)))
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(args.target_dbname)))
    finally:
        admin_conn.close()


def create_schema(conn) -> None:
    ddl = """
    CREATE TABLE dim_devices (
        mac TEXT PRIMARY KEY,
        camera_name TEXT NOT NULL,
        location_name TEXT NOT NULL,
        location_code TEXT NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        camera_profile TEXT NOT NULL,
        notes TEXT NOT NULL
    );

    CREATE TABLE events (
        id TEXT PRIMARY KEY,
        name TEXT,
        mac TEXT NOT NULL REFERENCES dim_devices(mac),
        event TEXT NOT NULL,
        utc_timestamp TIMESTAMP NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        sequence INTEGER NOT NULL,
        sensor TEXT NOT NULL,
        location TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        temperature DOUBLE PRECISION,
        humidity DOUBLE PRECISION,
        pressure DOUBLE PRECISION,
        voltage DOUBLE PRECISION,
        bearing INTEGER,
        "batteryPercentage" DOUBLE PRECISION,
        battery_percentage DOUBLE PRECISION,
        lux INTEGER,
        "heatLevel" INTEGER,
        heat_level INTEGER,
        "fileType" TEXT,
        file_type TEXT,
        filename TEXT,
        image_blob_url TEXT,
        uploaded BOOLEAN,
        upload TEXT,
        created TIMESTAMP,
        ai_processed BOOLEAN,
        ai_timestamp TIMESTAMP,
        json_processed BOOLEAN,
        json_timestamp TIMESTAMP,
        utc_timestamp_off TIMESTAMP,
        timezone TEXT,
        tag TEXT,
        analysis JSONB,
        ai_description TEXT,
        analysis_title TEXT,
        analysis_summary TEXT,
        subject_class TEXT,
        subject_category TEXT,
        time_of_day_bucket TEXT,
        camera_name TEXT
    );

    CREATE TABLE daily_camera_summary (
        date DATE NOT NULL,
        mac TEXT NOT NULL REFERENCES dim_devices(mac),
        camera_name TEXT NOT NULL,
        total_rows INTEGER NOT NULL,
        unique_event_groups INTEGER NOT NULL,
        wildlife_rows INTEGER NOT NULL,
        human_rows INTEGER NOT NULL,
        vehicle_rows INTEGER NOT NULL,
        empty_scene_rows INTEGER NOT NULL,
        morning_rows INTEGER NOT NULL,
        afternoon_rows INTEGER NOT NULL,
        evening_rows INTEGER NOT NULL,
        night_rows INTEGER NOT NULL,
        avg_temperature DOUBLE PRECISION,
        avg_lux DOUBLE PRECISION,
        avg_heat_level DOUBLE PRECISION,
        avg_battery_percentage DOUBLE PRECISION,
        PRIMARY KEY (date, mac)
    );

    CREATE INDEX idx_events_mac_utc ON events(mac, utc_timestamp);
    CREATE INDEX idx_events_timestamp ON events(timestamp);
    CREATE INDEX idx_events_time_bucket ON events(time_of_day_bucket);
    CREATE INDEX idx_events_subject_category ON events(subject_category);
    CREATE INDEX idx_events_camera_timestamp ON events(camera_name, timestamp);
    CREATE INDEX idx_daily_camera_summary_date_mac ON daily_camera_summary(date, mac);
    """
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def insert_dim_devices(conn, devices: Sequence[CameraProfile]) -> None:
    rows = [
        (
            device.mac,
            device.camera_name,
            device.location_name,
            device.location_code,
            device.latitude,
            device.longitude,
            device.camera_profile,
            device.notes,
        )
        for device in devices
    ]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO dim_devices (
                mac, camera_name, location_name, location_code, latitude, longitude,
                camera_profile, notes
            ) VALUES %s
            """,
            rows,
        )
    conn.commit()


def season_for_day(day: date) -> str:
    return SEASON_BY_MONTH[day.month]


def time_bucket_for_hour(hour: int) -> str:
    for bucket_name, start_hour, end_hour in TIME_OF_DAY_BUCKETS:
        if start_hour <= hour <= end_hour:
            return bucket_name
    return "night"


def weighted_choice(rng: random.Random, items: Sequence[ChoiceT], weights: Sequence[float]) -> ChoiceT:
    return rng.choices(list(items), weights=list(weights), k=1)[0]


def seasonal_subject_weights(profile: CameraProfile, subject: str, season: str) -> float:
    weight = profile.subject_weights[subject]
    if season == "winter":
        if subject in {"hiker", "vehicle"}:
            weight *= 0.55
        elif subject == "bird":
            weight *= 0.82
        elif subject in {"wolf", "fox_coyote"}:
            weight *= 1.15
    elif season == "spring":
        if subject in {"bear", "bird"}:
            weight *= 1.18
        elif subject == "empty_landscape":
            weight *= 0.92
    elif season == "summer":
        if subject in {"hiker", "vehicle", "ranger"}:
            weight *= 1.35
        elif subject in {"bird", "bison"}:
            weight *= 1.10
    elif season == "fall":
        if subject in {"elk", "bear", "wolf"}:
            weight *= 1.18
        elif subject == "hiker":
            weight *= 0.82
    return weight


def hour_weight(profile: CameraProfile, subject: str, season: str, hour: int) -> float:
    category = SUBJECT_CATEGORIES[subject]
    dawn_peak = math.exp(-((hour - 7) ** 2) / 6.0)
    dusk_peak = math.exp(-((hour - 19) ** 2) / 7.0)
    midday_peak = math.exp(-((hour - 13) ** 2) / 10.0)
    late_peak = math.exp(-((hour - 23) ** 2) / 6.0)
    early_peak = math.exp(-((hour - 3) ** 2) / 5.0)

    if category == "wildlife":
        weight = 0.45 + 1.4 * dawn_peak + 1.55 * dusk_peak + 0.30 * midday_peak
        if subject in {"wolf", "fox_coyote", "bear"}:
            weight += 0.45 * early_peak + 0.30 * late_peak
        if subject == "bird":
            weight += 0.55 * math.exp(-((hour - 9) ** 2) / 8.0)
    elif category == "human":
        weight = 0.12 + 1.65 * midday_peak + 0.95 * math.exp(-((hour - 17) ** 2) / 8.0)
        if subject == "ranger":
            weight += 0.40 * math.exp(-((hour - 10) ** 2) / 8.0)
        if hour < 6 or hour > 21:
            weight *= 0.12
    elif category == "vehicle":
        weight = 0.08 + 1.45 * midday_peak + 0.75 * math.exp(-((hour - 16) ** 2) / 9.0)
        if hour < 6 or hour > 20:
            weight *= 0.10
    else:
        weight = 0.40 + 0.65 * midday_peak + 0.45 * dusk_peak

    if "Trail Edge" in profile.camera_name and category in {"human", "vehicle"}:
        weight *= 1.18
    if "Old Faithful" in profile.camera_name:
        if category in {"human", "vehicle"}:
            weight *= 1.28
        if category == "wildlife":
            weight *= 0.88
    if "Lamar" in profile.camera_name and category == "wildlife":
        weight *= 1.20
    if "Hayden" in profile.camera_name and subject == "empty_landscape":
        weight *= 1.15
    if "Lake" in profile.camera_name and subject in {"bird", "fox_coyote"}:
        weight *= 1.16

    if season == "winter":
        if 7 <= hour <= 17:
            weight *= 1.10
        else:
            weight *= 0.85 if category in {"human", "vehicle"} else 1.02
    elif season == "summer":
        if 5 <= hour <= 21:
            weight *= 1.07
        if category in {"human", "vehicle"} and 8 <= hour <= 18:
            weight *= 1.18
    elif season == "spring":
        if subject in {"bear", "bird"} and 6 <= hour <= 18:
            weight *= 1.10
    elif season == "fall":
        if subject in {"elk", "wolf"} and (5 <= hour <= 9 or 17 <= hour <= 21):
            weight *= 1.16

    if hour < 6 or hour > 21:
        weight *= 1.0 + max(0.0, (1.0 - profile.night_lux_bias)) * 0.6

    return max(weight, 0.01)


def choose_subject(rng: random.Random, profile: CameraProfile, season: str) -> str:
    subjects = list(profile.subject_weights)
    weights = [seasonal_subject_weights(profile, subject, season) for subject in subjects]
    return weighted_choice(rng, subjects, weights)


def choose_sensor(rng: random.Random, profile: CameraProfile) -> str:
    sensors = list(profile.sensor_weights)
    weights = [profile.sensor_weights[sensor] for sensor in sensors]
    return weighted_choice(rng, sensors, weights)


def choose_event_count(rng: random.Random, profile: CameraProfile, day: date) -> int:
    season = season_for_day(day)
    mean = profile.base_event_mean * SEASON_FACTORS[season]
    if day.weekday() >= 5 and profile.camera_name in {"Mammoth Trail Edge", "Old Faithful Perimeter"}:
        mean *= 1.18
    if day.month in {6, 7, 8} and profile.camera_name in {"Old Faithful Perimeter", "Yellowstone Lake Overlook"}:
        mean *= 1.08
    noise = rng.triangular(-4.0, 8.0, 1.5)
    count = int(round(mean + noise))
    return max(3, min(60, count))


def choose_burst_length(rng: random.Random, subject_category: str) -> int:
    if subject_category == "empty_scene":
        options = [1, 2, 3, 4, 5]
        weights = [0.34, 0.37, 0.18, 0.08, 0.03]
    elif subject_category == "wildlife":
        options = [1, 2, 3, 4, 5, 6, 7, 8]
        weights = [0.14, 0.26, 0.24, 0.16, 0.10, 0.05, 0.03, 0.02]
    else:
        options = [1, 2, 3, 4, 5, 6]
        weights = [0.18, 0.28, 0.23, 0.16, 0.10, 0.05]
    return weighted_choice(rng, options, weights)


def choose_local_event_time(
    rng: random.Random,
    profile: CameraProfile,
    subject: str,
    day: date,
) -> datetime:
    season = season_for_day(day)
    hours = list(range(24))
    weights = [hour_weight(profile, subject, season, hour) for hour in hours]
    hour = weighted_choice(rng, hours, weights)
    minute = rng.randint(0, 59)
    second = rng.randint(0, 59)
    return datetime.combine(day, time(int(hour), minute, second), tzinfo=LOCAL_TZ)


def local_and_utc_naive(local_dt: datetime) -> Tuple[datetime, datetime]:
    utc_dt = local_dt.astimezone(UTC)
    return local_dt.replace(tzinfo=None), utc_dt.replace(tzinfo=None)


def ensure_unique_group_time(local_dt: datetime, used_event_keys: set[str], mac: str) -> datetime:
    candidate = local_dt
    while True:
        _, utc_group_dt = local_and_utc_naive(candidate)
        event_key = f"{mac}{utc_group_dt.strftime('%Y%m%d%H%M%S')}"
        if event_key not in used_event_keys:
            used_event_keys.add(event_key)
            return candidate
        candidate += timedelta(seconds=1)


def battery_for_day(profile: CameraProfile, day_of_year: int, rng: random.Random) -> float:
    level = profile.battery_start - profile.battery_drain_per_day * (day_of_year - 1)
    for reset_day in profile.reset_days:
        if day_of_year >= reset_day:
            level += 4.4
    level += rng.uniform(-0.35, 0.35)
    return round(max(74.0, min(100.0, level)), 2)


def seasonal_temperature_base(profile: CameraProfile, day: date) -> float:
    base = {
        "winter": 16.0,
        "spring": 39.0,
        "summer": 61.0,
        "fall": 36.0,
    }[season_for_day(day)]
    return base + profile.temp_offset


def diurnal_temperature_adjustment(local_dt: datetime) -> float:
    hour = local_dt.hour + (local_dt.minute / 60.0)
    return 11.0 * math.sin(((hour - 8.0) / 24.0) * (2.0 * math.pi)) + 3.5 * math.sin(
        ((hour - 14.0) / 12.0) * math.pi
    )


def subject_temperature_adjustment(subject: str) -> float:
    return {
        "bison": 1.2,
        "elk": 1.0,
        "bear": 1.1,
        "wolf": 0.5,
        "fox_coyote": 0.3,
        "bird": 0.1,
        "hiker": 0.7,
        "ranger": 0.6,
        "vehicle": 1.6,
        "empty_landscape": -0.2,
        "deer": 0.5,
    }[subject]


def compute_lux(local_dt: datetime, rng: random.Random, season: str, subject: str, profile: CameraProfile) -> int:
    hour = local_dt.hour + local_dt.minute / 60.0
    sunrise = {"winter": 7.9, "spring": 6.6, "summer": 5.7, "fall": 7.1}[season]
    sunset = {"winter": 16.9, "spring": 19.6, "summer": 20.9, "fall": 18.3}[season]
    if hour <= sunrise - 0.6 or hour >= sunset + 0.4:
        base = rng.uniform(0, 18) * profile.night_lux_bias
    else:
        center = (sunrise + sunset) / 2.0
        span = max((sunset - sunrise) / 2.0, 1.0)
        daylight = max(0.0, 1.0 - ((hour - center) / span) ** 2)
        base = 120 + daylight * 920
        if season == "winter":
            base *= 0.72
        elif season == "summer":
            base *= 1.08
        if subject == "empty_landscape":
            base *= 1.03
    return int(round(max(0.0, min(1100.0, base + rng.uniform(-35.0, 35.0)))))


def compute_heat_level(subject: str, rng: random.Random) -> int:
    low, high = HEAT_RANGES[subject]
    return int(round(rng.uniform(low, high)))


def jitter_coordinate(base_value: float, sensor: str, rng: random.Random) -> float:
    sensor_offsets = {"F": 0.00012, "R": 0.00005, "B": -0.00008, "L": -0.00013}
    return round(base_value + sensor_offsets[sensor] + rng.uniform(-0.00006, 0.00006), 6)


def apply_camera_telemetry_quirks(
    telemetry: Dict[str, float],
    profile: CameraProfile,
    rng: random.Random,
    local_dt: datetime,
) -> Dict[str, float]:
    telemetry = dict(telemetry)
    if rng.random() < 0.02 * profile.weather_volatility:
        telemetry["humidity"] = 100.0
    if rng.random() < 0.012 * profile.weather_volatility:
        telemetry["pressure"] = round(max(77000.0, telemetry["pressure"] + rng.uniform(-1600.0, 1600.0)), 2)
    if rng.random() < 0.015 * profile.weather_volatility:
        telemetry["temperature"] = round(telemetry["temperature"] + rng.uniform(-13.0, 11.0), 2)
    if rng.random() < 0.012:
        telemetry["heat_level"] = min(100, telemetry["heat_level"] + rng.randint(8, 24))
    if rng.random() < 0.02:
        telemetry["lux"] = max(0, min(1100, int(round(telemetry["lux"] + rng.uniform(-180.0, 220.0)))))
    if rng.random() < profile.battery_glitch_bias:
        glitch = rng.choice(
            [
                rng.uniform(0.0, 8.0),
                rng.uniform(100.0, 105.0),
                rng.uniform(180.0, 205.0),
            ]
        )
        telemetry["battery_percentage"] = round(glitch, 2)
    telemetry["voltage"] = round(max(4.2, min(5.08, telemetry["voltage"] + profile.voltage_bias)), 3)
    if "Lake" in profile.camera_name and local_dt.hour < 9 and rng.random() < 0.06:
        telemetry["humidity"] = 100.0
    return telemetry


def telemetry_for_row(
    rng: random.Random,
    profile: CameraProfile,
    local_dt: datetime,
    battery_percentage: float,
    subject: str,
    subject_category: str,
    burst_index: int,
) -> Dict[str, float]:
    season = season_for_day(local_dt.date())
    base_temp = seasonal_temperature_base(profile, local_dt.date())
    temperature = (
        base_temp
        + diurnal_temperature_adjustment(local_dt)
        + subject_temperature_adjustment(subject)
        + rng.uniform(-2.2, 2.2)
        + burst_index * 0.08
    )

    humidity = {
        "winter": 61.0,
        "spring": 56.0,
        "summer": 44.0,
        "fall": 50.0,
    }[season]
    humidity += profile.humidity_offset
    humidity += 8.5 * math.cos(((local_dt.hour - 5) / 24.0) * 2.0 * math.pi)
    if subject_category == "empty_scene":
        humidity += 2.0
    humidity += rng.uniform(-5.0, 5.0) * profile.weather_volatility

    pressure = profile.pressure_base + rng.uniform(-780.0, 780.0) * profile.weather_volatility
    if season in {"spring", "fall"}:
        pressure += rng.uniform(-420.0, 260.0) * profile.weather_volatility

    voltage = 4.65 + (battery_percentage - 74.0) / 26.0 * 0.38 + rng.uniform(-0.03, 0.03)
    lux = compute_lux(local_dt, rng, season, subject, profile)
    heat_level = compute_heat_level(subject, rng)

    telemetry = {
        "temperature": round(temperature, 2),
        "humidity": round(max(10.0, min(100.0, humidity)), 2),
        "pressure": round(max(77000.0, pressure), 2),
        "voltage": round(max(4.35, min(5.1, voltage)), 3),
        "battery_percentage": round(battery_percentage, 2),
        "lux": lux,
        "heat_level": heat_level,
    }
    return apply_camera_telemetry_quirks(telemetry, profile, rng, local_dt)


def title_case_subject(subject: str) -> str:
    names = {
        "fox_coyote": "fox",
        "empty_landscape": "empty scene",
    }
    return names.get(subject, subject).replace("_", " ")


def subject_descriptor(subject: str, rng: random.Random) -> str:
    descriptors = {
        "elk": ["bull elk", "cow elk", "elk pair", "young elk"],
        "bison": ["bison herd", "single bison", "bison crossing", "large bull bison"],
        "deer": ["mule deer", "deer pair", "white-tailed deer", "young deer"],
        "wolf": ["gray wolf", "wolf moving through sage", "single wolf", "wolf silhouette"],
        "bear": ["black bear", "foraging bear", "bear near treeline", "solitary bear"],
        "fox_coyote": ["fox near shoreline", "coyote on ridge", "small canid", "fox moving along brush"],
        "bird": ["bird in foreground", "waterfowl pair", "perched bird", "bird crossing frame"],
        "empty_landscape": ["empty ridgeline", "open meadow", "still shoreline", "quiet valley scene"],
        "hiker": ["two hikers", "single hiker", "trail group", "visitor on boardwalk"],
        "ranger": ["park ranger", "ranger checking trail", "ranger on patrol", "uniformed ranger"],
        "vehicle": ["ranger pickup truck", "maintenance vehicle", "service truck", "park vehicle"],
    }
    return rng.choice(descriptors[subject])


def scene_phrase(profile: CameraProfile, season: str, bucket: str, rng: random.Random) -> str:
    season_words = {
        "winter": ["snowy", "frosted", "windy", "low-light"],
        "spring": ["muddy", "thawing", "green-up", "cool"],
        "summer": ["bright", "sunlit", "warm", "clear"],
        "fall": ["golden", "cool", "overcast", "rust-colored"],
    }
    bucket_words = {
        "night": ["under infrared light", "in dim predawn light", "during a dark overnight window"],
        "morning": ["near first light", "in crisp morning light", "during a cool morning pass"],
        "afternoon": ["in bright afternoon light", "during a warm daylight stretch", "under broad daylight"],
        "evening": ["near dusk", "in soft evening light", "during a fading evening window"],
    }
    location_words = {
        "Lamar Valley North": ["near the valley edge", "along the sage flats", "beside the open meadow"],
        "Hayden Valley South": ["across the open basin", "near a thermal haze pocket", "in the broad valley floor"],
        "Mammoth Trail Edge": ["along the trail edge", "near the service turnout", "beside low brush on the trail"],
        "Old Faithful Perimeter": ["near the boardwalk perimeter", "beside a visitor path", "near the geothermal overlook"],
        "Yellowstone Lake Overlook": ["above the shoreline", "near the lakeside brush", "along the overlook slope"],
    }
    return " ".join(
        [
            rng.choice(season_words[season]),
            rng.choice(location_words[profile.camera_name]),
            rng.choice(bucket_words[bucket]),
        ]
    )


def build_analysis_title_summary(
    profile: CameraProfile,
    subject: str,
    bucket: str,
    season: str,
    rng: random.Random,
    low_information: bool,
) -> Tuple[str, str]:
    descriptor = subject_descriptor(subject, rng)
    scene = scene_phrase(profile, season, bucket, rng)
    if low_information:
        low_titles = [
            "Motion near frame edge",
            "Low-confidence animal pass",
            "Scene captured with partial subject",
            "Trail camera image with limited detail",
        ]
        low_summaries = [
            "The frame contains limited detail and only a partial view of the scene.",
            "This capture is low-information, with little context beyond motion in frame.",
            "The subject is not fully resolved, but the event remains consistent with the camera location.",
        ]
        return rng.choice(low_titles), rng.choice(low_summaries)

    if subject == "empty_landscape":
        title = rng.choice(
            [
                "Empty snowy ridgeline with scattered conifers",
                "Quiet valley frame with no active subject",
                "Open shoreline scene under shifting light",
                "Still meadow with light thermal haze",
            ]
        )
        summary = f"An empty camera frame shows {scene} at {profile.location_name.lower()}."
        return title, summary

    title_patterns = [
        f"{descriptor.title()} {scene.split()[0]} {rng.choice(['meadow', 'boardwalk', 'shoreline', 'ridge', 'trail edge'])}",
        f"{descriptor.title()} near {profile.location_name}",
        f"{descriptor.title()} in {bucket} light",
    ]
    summary_patterns = [
        f"A {descriptor} appears {scene} at {profile.location_name.lower()}.",
        f"The frame captures {descriptor} {scene}, matching the camera's usual {bucket} activity pattern.",
        f"This event shows {descriptor} {scene} with a clear view from {profile.camera_name.lower()}.",
    ]
    return rng.choice(title_patterns), rng.choice(summary_patterns)


def maybe_blank(value: str, rng: random.Random, rate: float) -> str:
    return "" if rng.random() < rate else value


def build_analysis_payload(
    profile: CameraProfile,
    subject: str,
    bucket: str,
    season: str,
    rng: random.Random,
    analysis_timestamp: Optional[datetime],
    mismatch_bias: float,
) -> Tuple[Dict[str, Any], str]:
    low_information = rng.random() < 0.035
    title, summary = build_analysis_title_summary(profile, subject, bucket, season, rng, low_information)
    model_name, model_version = weighted_choice(
        rng,
        MODEL_VARIANTS,
        [0.58, 0.18, 0.16, 0.08],
    )
    setting = [
        profile.location_name.lower(),
        season,
        bucket,
        SUBJECT_CATEGORIES[subject],
    ]
    details = {
        "main_subject": title_case_subject(subject),
        "animal_details": "none visible" if SUBJECT_CATEGORIES[subject] != "wildlife" else descriptor_for_details(subject, rng),
        "people_details": "none visible" if SUBJECT_CATEGORIES[subject] != "human" else rng.choice(["single visitor visible", "one ranger visible", "group partially visible"]),
        "activities": activity_phrase(subject, rng),
        "notable_features": rng.choice(["none", "soft edge blur", "foreground grass occlusion", "partial subject framing"]),
    }
    if rng.random() < 0.08:
        details.pop(rng.choice(list(details)))

    analysis_obj: Dict[str, Any] = {
        "title": title,
        "summary": summary,
        "setting": setting,
        "model": model_name,
        "model_version": model_version,
        "keywords": {
            "People": maybe_blank("visitor" if SUBJECT_CATEGORIES[subject] == "human" else "", rng, 0.25),
            "Animals": maybe_blank(title_case_subject(subject) if SUBJECT_CATEGORIES[subject] == "wildlife" else "", rng, 0.15),
            "Threats": maybe_blank("vehicle" if subject == "vehicle" else "", rng, 0.75),
            "Objects": maybe_blank(rng.choice(["trail", "brush", "boardwalk", "snow", "truck", "shoreline"]), rng, 0.12),
        },
        "details": details,
        "lighting": rng.choice(["", bucket, "mixed light", "infrared"]),
        "analysis_timestamp": analysis_timestamp.isoformat() if analysis_timestamp else None,
    }

    ai_description_obj = json.loads(json.dumps(analysis_obj))
    if rng.random() < mismatch_bias:
        ai_description_obj["model_version"] = rng.choice(["2025-06-03", "2025-07-01", "2025-08-12"])
        if rng.random() < 0.55:
            ai_description_obj["summary"] = summary.replace("This event", "This frame")
        if rng.random() < 0.35 and isinstance(ai_description_obj.get("details"), dict):
            ai_description_obj["details"].pop("notable_features", None)

    return analysis_obj, json.dumps(ai_description_obj, ensure_ascii=False, separators=(",", ":"))


def descriptor_for_details(subject: str, rng: random.Random) -> str:
    detail_map = {
        "elk": ["single adult elk", "pair of elk", "partial elk body"],
        "bison": ["one bison near meadow edge", "bison group in distance", "bison crossing frame"],
        "deer": ["single deer visible", "small deer group", "partial deer silhouette"],
        "wolf": ["single wolf visible", "wolf shape near horizon", "partial canid silhouette"],
        "bear": ["single bear visible", "bear near brush line", "bear body partially obscured"],
        "fox_coyote": ["small canid visible", "fox or coyote near edge", "canid body blurred in motion"],
        "bird": ["one bird visible", "bird in foreground", "waterfowl pair in frame"],
        "empty_landscape": ["none visible"],
    }
    return rng.choice(detail_map[subject])


def activity_phrase(subject: str, rng: random.Random) -> str:
    activity_map = {
        "elk": ["walking through frame", "grazing", "pausing near meadow edge"],
        "bison": ["moving across valley", "standing in open basin", "grazing slowly"],
        "deer": ["moving along brush", "standing alert", "passing through frame"],
        "wolf": ["trotting through corridor", "moving through low light", "passing quickly across frame"],
        "bear": ["foraging", "moving near treeline", "walking along game trail"],
        "fox_coyote": ["moving along shoreline", "crossing brush line", "briefly entering frame"],
        "bird": ["perched briefly", "crossing foreground", "gliding through scene"],
        "empty_landscape": ["static scene"],
        "hiker": ["walking on trail", "pausing briefly", "moving through visitor area"],
        "ranger": ["patrolling", "checking the trail", "moving along access route"],
        "vehicle": ["passing through service area", "parked briefly", "moving along road edge"],
    }
    return rng.choice(activity_map[subject])


def choose_group_context(profile: CameraProfile, rng: random.Random) -> GroupContext:
    stale_mode = weighted_choice(
        rng,
        ["drift", "repeat", "mixed"],
        [0.56, min(0.32, 0.12 + profile.telemetry_stale_bias), 0.12],
    )
    upload_mode = weighted_choice(rng, ["fast", "moderate", "backlog", "failed"], [0.62, 0.25, 0.09, 0.04])
    ai_mode = weighted_choice(
        rng,
        ["done", "delayed", "missing"],
        [0.86 - profile.missing_ai_bias, 0.10, 0.04 + profile.missing_ai_bias],
    )
    json_mode = weighted_choice(
        rng,
        ["done", "delayed", "missing"],
        [0.84 - profile.missing_ai_bias / 2.0, 0.11, 0.05 + profile.missing_ai_bias / 2.0],
    )
    timestamp_mode = weighted_choice(rng, ["standard", "offset_missing"], [0.965, 0.035])
    return GroupContext(
        stale_mode=stale_mode,
        stuck_battery=rng.random() < 0.08 + profile.telemetry_stale_bias * 0.2,
        telemetry_seed={},
        upload_mode=upload_mode,
        ai_mode=ai_mode,
        json_mode=json_mode,
        timestamp_mode=timestamp_mode,
    )


def upload_delay_minutes(rng: random.Random, profile: CameraProfile, mode: str) -> float:
    if mode == "fast":
        return max(0.0, rng.uniform(0.2, 5.5) + profile.upload_delay_bias_minutes * 0.12)
    if mode == "moderate":
        return rng.uniform(9.0, 45.0) + profile.upload_delay_bias_minutes
    if mode == "backlog":
        return rng.uniform(120.0, 900.0) + profile.upload_delay_bias_minutes * 2.0
    return rng.uniform(1.0, 30.0) + profile.upload_delay_bias_minutes


def processing_delay_seconds(rng: random.Random, mode: str, base_range: Tuple[float, float], delayed_range: Tuple[float, float]) -> Optional[float]:
    if mode == "done":
        return rng.uniform(*base_range)
    if mode == "delayed":
        return rng.uniform(*delayed_range)
    return None


def maybe_parseable_iso(dt: Optional[datetime], rng: random.Random) -> Optional[str]:
    if dt is None:
        return None
    if rng.random() < 0.035:
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return dt.isoformat()


def json_timestamp_value(dt: Optional[datetime], rng: random.Random) -> Optional[str]:
    if dt is None:
        return None
    if rng.random() < 0.04:
        return dt.strftime("%Y-%m-%dT%H:%M:%S")
    return dt.isoformat()


def serialize_datetime_for_json(field: str, value: Optional[datetime], rng: random.Random) -> Optional[str]:
    if value is None:
        return None
    if field == "timestamp":
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if field in {"utc_timestamp", "utc_timestamp_off"}:
        if rng.random() < 0.02:
            return value.strftime("%Y-%m-%dT%H:%M:%S")
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if field == "created":
        return maybe_parseable_iso(value, rng)
    if field in {"ai_timestamp", "json_timestamp"}:
        return json_timestamp_value(value, rng)
    return value.isoformat()


def formatted_export_row(row: Dict[str, Any], rng: random.Random) -> Dict[str, Any]:
    payload = dict(row)
    for field in ("timestamp", "utc_timestamp", "utc_timestamp_off", "created", "ai_timestamp", "json_timestamp"):
        payload[field] = serialize_datetime_for_json(field, payload.get(field), rng)
    return payload


def build_export_row(row: Dict[str, Any]) -> Dict[str, Any]:
    # Raw export intentionally excludes Cosmos internals such as _rid/_etag/_ts.
    ordered_keys = [
        "name",
        "mac",
        "utc_timestamp",
        "sequence",
        "sensor",
        "location",
        "filename",
        "fileType",
        "id",
        "timestamp",
        "utc_timestamp_off",
        "timezone",
        "event",
        "tag",
        "upload",
        "ai_description",
        "analysis",
        "ai_processed",
        "ai_timestamp",
        "json_processed",
        "json_timestamp",
        "image_blob_url",
        "uploaded",
        "created",
        "heatLevel",
        "latitude",
        "longitude",
        "temperature",
        "humidity",
        "pressure",
        "bearing",
        "voltage",
        "batteryPercentage",
        "lux",
        "analysis_title",
        "analysis_summary",
        "subject_class",
        "subject_category",
        "time_of_day_bucket",
        "camera_name",
    ]
    return {key: row.get(key) for key in ordered_keys}


def write_json_output(path_str: str, rows: Sequence[Dict[str, Any]], seed: int) -> Path:
    output_path = Path(path_str)
    if not output_path.is_absolute():
        output_path = Path.cwd() / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed + 99)
    opener = gzip.open if output_path.suffix == ".gz" else open
    with opener(output_path, "wt", encoding="utf-8") as handle:
        handle.write("[")
        first = True
        for row in rows:
            export_row = build_export_row(formatted_export_row(row, rng))
            if not first:
                handle.write(",")
            handle.write(json.dumps(export_row, ensure_ascii=False, separators=(",", ":")))
            first = False
        handle.write("]")
    return output_path


def build_row(
    *,
    profile: CameraProfile,
    event_key: str,
    utc_group_dt: datetime,
    capture_local_naive: datetime,
    capture_utc_naive: datetime,
    sequence: int,
    sensor: str,
    bearing: int,
    telemetry: Dict[str, float],
    analysis: Optional[Dict[str, Any]],
    ai_description: Optional[str],
    pipeline: Dict[str, Any],
    subject: str,
    subject_category: str,
    bucket: str,
) -> Dict[str, Any]:
    filename = (
        f"{profile.name}_{profile.mac}_{utc_group_dt.strftime('%Y%m%d%H%M%S')}"
        f"_{sequence}_{sensor}_{capture_utc_naive.strftime('%Y%m%d%H%M%S')}"
        f"_{profile.location_code}_{bearing}_{telemetry['heat_level']}.jpg"
    )
    return {
        "id": filename,
        "name": profile.name,
        "mac": profile.mac,
        "event": event_key,
        "utc_timestamp": utc_group_dt,
        "timestamp": capture_local_naive,
        "sequence": sequence,
        "sensor": sensor,
        "location": profile.location_code,
        "latitude": telemetry["latitude"],
        "longitude": telemetry["longitude"],
        "temperature": telemetry["temperature"],
        "humidity": telemetry["humidity"],
        "pressure": telemetry["pressure"],
        "voltage": telemetry["voltage"],
        "bearing": bearing,
        "batteryPercentage": telemetry["battery_percentage"],
        "battery_percentage": telemetry["battery_percentage"],
        "lux": telemetry["lux"],
        "heatLevel": telemetry["heat_level"],
        "heat_level": telemetry["heat_level"],
        "fileType": "camera",
        "file_type": "camera",
        "filename": filename,
        "image_blob_url": f"{BLOB_ROOT}/{filename}",
        "uploaded": pipeline["uploaded"],
        "upload": pipeline["upload"],
        "created": pipeline["created"],
        "ai_processed": pipeline["ai_processed"],
        "ai_timestamp": pipeline["ai_timestamp"],
        "json_processed": pipeline["json_processed"],
        "json_timestamp": pipeline["json_timestamp"],
        "utc_timestamp_off": pipeline["utc_timestamp_off"],
        "timezone": pipeline["timezone"],
        "tag": pipeline["tag"],
        "analysis": analysis,
        "ai_description": ai_description,
        "analysis_title": analysis.get("title") if analysis else None,
        "analysis_summary": analysis.get("summary") if analysis else None,
        "subject_class": subject,
        "subject_category": subject_category,
        "time_of_day_bucket": bucket,
        "camera_name": profile.camera_name,
    }


def pipeline_for_row(
    rng: random.Random,
    profile: CameraProfile,
    group_context: GroupContext,
    capture_local_naive: datetime,
    capture_utc_naive: datetime,
    sequence: int,
) -> Dict[str, Any]:
    created_dt = capture_utc_naive + timedelta(minutes=upload_delay_minutes(rng, profile, group_context.upload_mode))
    uploaded = group_context.upload_mode != "failed" or rng.random() < 0.25
    if not uploaded:
        created_dt = None

    ai_delay = processing_delay_seconds(rng, group_context.ai_mode, (2.0, 75.0), (180.0, 22000.0))
    ai_timestamp = created_dt + timedelta(seconds=ai_delay) if created_dt and ai_delay is not None else None
    ai_processed = ai_timestamp is not None

    json_delay = processing_delay_seconds(rng, group_context.json_mode, (4.0, 120.0), (600.0, 32000.0))
    if ai_timestamp and json_delay is not None:
        json_timestamp = ai_timestamp + timedelta(seconds=json_delay)
    elif created_dt and json_delay is not None and rng.random() < 0.18:
        json_timestamp = created_dt + timedelta(seconds=json_delay)
    else:
        json_timestamp = None
    json_processed = json_timestamp is not None

    upload_value: Optional[str]
    if rng.random() < 0.07:
        upload_value = "true" if uploaded else "false"
    elif rng.random() < 0.02:
        upload_value = ""
    else:
        upload_value = "true" if uploaded else None

    timezone_value: Optional[str]
    utc_timestamp_off: Optional[datetime]
    if group_context.timestamp_mode == "offset_missing" and sequence == 1 and rng.random() < 0.4:
        timezone_value = None
        utc_timestamp_off = None
    else:
        timezone_value = str(int(capture_local_naive.replace(tzinfo=LOCAL_TZ).utcoffset().total_seconds() / 3600))
        utc_timestamp_off = capture_utc_naive

    return {
        "uploaded": uploaded,
        "upload": upload_value,
        "created": created_dt,
        "ai_processed": ai_processed,
        "ai_timestamp": ai_timestamp,
        "json_processed": json_processed,
        "json_timestamp": json_timestamp,
        "utc_timestamp_off": utc_timestamp_off,
        "timezone": timezone_value,
        "tag": f"{sensor_tag(sequence)}",
    }


def sensor_tag(sequence: int) -> str:
    # The raw export uses low-information tag strings; keeping them simple preserves that shape.
    return ""


def telemetry_with_group_behavior(
    rng: random.Random,
    profile: CameraProfile,
    group_context: GroupContext,
    base_battery: float,
    subject: str,
    subject_category: str,
    sequence: int,
    sensor: str,
    capture_local_dt: datetime,
) -> Dict[str, float]:
    if group_context.stuck_battery:
        battery_percentage = base_battery
    else:
        battery_percentage = max(74.0, base_battery - sequence * rng.uniform(0.0, 0.015))

    telemetry = telemetry_for_row(
        rng=rng,
        profile=profile,
        local_dt=capture_local_dt,
        battery_percentage=battery_percentage,
        subject=subject,
        subject_category=subject_category,
        burst_index=sequence - 1,
    )

    if group_context.stale_mode == "repeat" and group_context.telemetry_seed:
        telemetry = dict(group_context.telemetry_seed)
    elif group_context.stale_mode == "mixed" and group_context.telemetry_seed and sequence % 2 == 0:
        telemetry = dict(group_context.telemetry_seed)
        telemetry["temperature"] = round(telemetry["temperature"] + rng.uniform(-0.35, 0.35), 2)
        telemetry["lux"] = max(0, min(1100, int(round(telemetry["lux"] + rng.uniform(-10.0, 10.0)))))
    elif not group_context.telemetry_seed:
        group_context.telemetry_seed.update(telemetry)

    telemetry["latitude"] = jitter_coordinate(profile.latitude, sensor, rng)
    telemetry["longitude"] = jitter_coordinate(profile.longitude, sensor, rng)
    return telemetry


def generate_events(devices: Sequence[CameraProfile], seed: int) -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    rows: List[Dict[str, Any]] = []
    start_day = date(2025, 1, 1)
    end_day = date(2025, 12, 31)
    total_days = (end_day - start_day).days + 1
    used_event_keys_by_mac = {profile.mac: set() for profile in devices}

    # Added raw-schema fields are populated here instead of only analytics aliases so the
    # output can power ops monitoring, anomaly detection, and canonicalization workflows.
    for day_index in range(total_days):
        current_day = start_day + timedelta(days=day_index)
        day_of_year = current_day.timetuple().tm_yday
        season = season_for_day(current_day)

        for profile in devices:
            event_groups = choose_event_count(rng, profile, current_day)
            battery_level = battery_for_day(profile, day_of_year, rng)

            for _ in range(event_groups):
                subject = choose_subject(rng, profile, season)
                subject_category = SUBJECT_CATEGORIES[subject]
                sensor = choose_sensor(rng, profile)
                burst_length = int(choose_burst_length(rng, subject_category))
                local_event_dt = ensure_unique_group_time(
                    choose_local_event_time(rng, profile, subject, current_day),
                    used_event_keys_by_mac[profile.mac],
                    profile.mac,
                )
                local_group_dt, utc_group_dt = local_and_utc_naive(local_event_dt)
                event_key = f"{profile.mac}{utc_group_dt.strftime('%Y%m%d%H%M%S')}"
                bucket = time_bucket_for_hour(local_group_dt.hour)
                bearing = BEARING_BY_SENSOR[sensor]
                group_context = choose_group_context(profile, rng)

                base_analysis_timestamp = None
                if group_context.ai_mode != "missing":
                    base_analysis_timestamp = utc_group_dt + timedelta(seconds=rng.uniform(20.0, 120.0))

                for sequence in range(1, burst_length + 1):
                    capture_local_dt = local_event_dt + timedelta(seconds=(sequence - 1) * rng.randint(2, 6))
                    capture_local_naive, capture_utc_naive = local_and_utc_naive(capture_local_dt)
                    telemetry = telemetry_with_group_behavior(
                        rng=rng,
                        profile=profile,
                        group_context=group_context,
                        base_battery=battery_level,
                        subject=subject,
                        subject_category=subject_category,
                        sequence=sequence,
                        sensor=sensor,
                        capture_local_dt=capture_local_dt,
                    )
                    pipeline = pipeline_for_row(
                        rng=rng,
                        profile=profile,
                        group_context=group_context,
                        capture_local_naive=capture_local_naive,
                        capture_utc_naive=capture_utc_naive,
                        sequence=sequence,
                    )
                    if pipeline["ai_timestamp"] is not None:
                        analysis_timestamp = pipeline["ai_timestamp"]
                    else:
                        analysis_timestamp = base_analysis_timestamp

                    base_analysis: Optional[Dict[str, Any]]
                    ai_description: Optional[str]
                    analysis: Optional[Dict[str, Any]]
                    if pipeline["ai_processed"]:
                        base_analysis, ai_description = build_analysis_payload(
                            profile=profile,
                            subject=subject,
                            bucket=bucket,
                            season=season,
                            rng=rng,
                            analysis_timestamp=analysis_timestamp,
                            mismatch_bias=0.09,
                        )
                        analysis = base_analysis if pipeline["json_processed"] else None
                    else:
                        base_analysis = None
                        analysis = None
                        ai_description = None

                    row = build_row(
                        profile=profile,
                        event_key=event_key,
                        utc_group_dt=utc_group_dt,
                        capture_local_naive=capture_local_naive,
                        capture_utc_naive=capture_utc_naive,
                        sequence=sequence,
                        sensor=sensor,
                        bearing=bearing,
                        telemetry=telemetry,
                        analysis=analysis,
                        ai_description=ai_description,
                        pipeline=pipeline,
                        subject=subject,
                        subject_category=subject_category,
                        bucket=bucket,
                    )
                    row["tag"] = f"{sensor.lower()}_"
                    rows.append(row)

    return rows


def bulk_insert_events(conn, rows: Sequence[Dict[str, Any]]) -> None:
    columns = """
        id, name, mac, event, utc_timestamp, timestamp, sequence, sensor, location,
        latitude, longitude, temperature, humidity, pressure, voltage, bearing,
        "batteryPercentage", battery_percentage, lux, "heatLevel", heat_level,
        "fileType", file_type, filename, image_blob_url, uploaded, upload, created,
        ai_processed, ai_timestamp, json_processed, json_timestamp, utc_timestamp_off,
        timezone, tag, analysis, ai_description, analysis_title, analysis_summary,
        subject_class, subject_category, time_of_day_bucket, camera_name
    """
    values = [
        (
            row["id"],
            row["name"],
            row["mac"],
            row["event"],
            row["utc_timestamp"],
            row["timestamp"],
            row["sequence"],
            row["sensor"],
            row["location"],
            row["latitude"],
            row["longitude"],
            row["temperature"],
            row["humidity"],
            row["pressure"],
            row["voltage"],
            row["bearing"],
            row["batteryPercentage"],
            row["battery_percentage"],
            row["lux"],
            row["heatLevel"],
            row["heat_level"],
            row["fileType"],
            row["file_type"],
            row["filename"],
            row["image_blob_url"],
            row["uploaded"],
            row["upload"],
            row["created"],
            row["ai_processed"],
            row["ai_timestamp"],
            row["json_processed"],
            row["json_timestamp"],
            row["utc_timestamp_off"],
            row["timezone"],
            row["tag"],
            Json(row["analysis"]) if row["analysis"] is not None else None,
            row["ai_description"],
            row["analysis_title"],
            row["analysis_summary"],
            row["subject_class"],
            row["subject_category"],
            row["time_of_day_bucket"],
            row["camera_name"],
        )
        for row in rows
    ]
    with conn.cursor() as cur:
        # The enriched raw-schema rows are much larger than the old analytics-only tuples,
        # so use smaller batches to avoid overwhelming local Postgres instances during reseeds.
        execute_values(cur, f"INSERT INTO events ({columns}) VALUES %s", values, page_size=500)
    conn.commit()


def build_daily_summary(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE daily_camera_summary")
        cur.execute(
            """
            INSERT INTO daily_camera_summary (
                date, mac, camera_name, total_rows, unique_event_groups,
                wildlife_rows, human_rows, vehicle_rows, empty_scene_rows,
                morning_rows, afternoon_rows, evening_rows, night_rows,
                avg_temperature, avg_lux, avg_heat_level, avg_battery_percentage
            )
            SELECT
                DATE(timestamp) AS date,
                mac,
                camera_name,
                COUNT(*) AS total_rows,
                COUNT(DISTINCT event) AS unique_event_groups,
                COUNT(*) FILTER (WHERE subject_category = 'wildlife') AS wildlife_rows,
                COUNT(*) FILTER (WHERE subject_category = 'human') AS human_rows,
                COUNT(*) FILTER (WHERE subject_category = 'vehicle') AS vehicle_rows,
                COUNT(*) FILTER (WHERE subject_category = 'empty_scene') AS empty_scene_rows,
                COUNT(*) FILTER (WHERE time_of_day_bucket = 'morning') AS morning_rows,
                COUNT(*) FILTER (WHERE time_of_day_bucket = 'afternoon') AS afternoon_rows,
                COUNT(*) FILTER (WHERE time_of_day_bucket = 'evening') AS evening_rows,
                COUNT(*) FILTER (WHERE time_of_day_bucket = 'night') AS night_rows,
                ROUND(AVG(temperature)::numeric, 2)::double precision AS avg_temperature,
                ROUND(AVG(lux)::numeric, 2)::double precision AS avg_lux,
                ROUND(AVG(heat_level)::numeric, 2)::double precision AS avg_heat_level,
                ROUND(AVG(battery_percentage)::numeric, 2)::double precision AS avg_battery_percentage
            FROM events
            GROUP BY DATE(timestamp), mac, camera_name
            ORDER BY DATE(timestamp), mac
            """
        )
    conn.commit()


def human_readable_size(size_bytes: int) -> str:
    units = ["bytes", "KB", "MB", "GB", "TB"]
    value = float(size_bytes)
    for unit in units:
        if value < 1024.0 or unit == units[-1]:
            if unit == "bytes":
                return f"{int(value)} {unit}"
            return f"{value:.2f} {unit}"
        value /= 1024.0
    return f"{size_bytes} bytes"


def fetch_summary(conn, dbname: str) -> Dict[str, object]:
    summary: Dict[str, object] = {"database_name": dbname}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS rows, COUNT(DISTINCT event) AS event_groups
            FROM events
            """
        )
        total_rows, total_event_groups = cur.fetchone()
        summary["total_rows"] = total_rows
        summary["total_event_groups"] = total_event_groups

        cur.execute(
            """
            SELECT camera_name, COUNT(*)
            FROM events
            GROUP BY camera_name
            ORDER BY camera_name
            """
        )
        summary["rows_by_device"] = cur.fetchall()

        cur.execute(
            """
            SELECT time_of_day_bucket, COUNT(*)
            FROM events
            GROUP BY time_of_day_bucket
            ORDER BY CASE time_of_day_bucket
                WHEN 'morning' THEN 1
                WHEN 'afternoon' THEN 2
                WHEN 'evening' THEN 3
                WHEN 'night' THEN 4
                ELSE 5
            END
            """
        )
        summary["rows_by_time_bucket"] = cur.fetchall()

        try:
            cur.execute("SELECT pg_database_size(%s)", (dbname,))
            db_size = int(cur.fetchone()[0])
        except Exception:
            db_size = int(total_rows) * 900
        summary["estimated_size_bytes"] = db_size
        summary["estimated_size_human"] = human_readable_size(db_size)
    return summary


def print_summary(summary: Dict[str, object], json_output_path: Path) -> None:
    print("")
    print("Synthetic Yellowstone database ready")
    print(f"Database name: {summary['database_name']}")
    print(f"Total raw rows: {summary['total_rows']}")
    print(f"Total unique event groups: {summary['total_event_groups']}")
    print("Rows by device:")
    for device_name, count in summary["rows_by_device"]:
        print(f"  - {device_name}: {count}")
    print("Rows by time_of_day_bucket:")
    for bucket_name, count in summary["rows_by_time_bucket"]:
        print(f"  - {bucket_name}: {count}")
    print(
        "Estimated database size: "
        f"{summary['estimated_size_human']} ({summary['estimated_size_bytes']} bytes)"
    )
    print(f"JSON export: {json_output_path}")


def print_export_only_summary(rows: Sequence[Dict[str, Any]], json_output_path: Path) -> None:
    counts: Dict[str, int] = {}
    for row in rows:
        counts[row["camera_name"]] = counts.get(row["camera_name"], 0) + 1
    print("")
    print("Synthetic Yellowstone export ready")
    print(f"Total raw rows: {len(rows)}")
    print(f"Total unique event groups: {len({row['event'] for row in rows})}")
    print("Rows by device:")
    for camera_name in sorted(counts):
        print(f"  - {camera_name}: {counts[camera_name]}")
    print(f"JSON export: {json_output_path}")


def main() -> None:
    args = build_parser().parse_args()
    rows = generate_events(CAMERA_PROFILES, args.seed)
    json_output_path = write_json_output(args.json_output, rows, args.seed)

    if args.skip_db:
        print_export_only_summary(rows, json_output_path)
        return

    recreate_database(args)
    conn = connect(get_connection_args(args, args.target_dbname), autocommit=False)
    try:
        create_schema(conn)
        insert_dim_devices(conn, CAMERA_PROFILES)
        bulk_insert_events(conn, rows)
        build_daily_summary(conn)
        summary = fetch_summary(conn, args.target_dbname)
    finally:
        conn.close()

    print_summary(summary, json_output_path)


if __name__ == "__main__":
    main()
