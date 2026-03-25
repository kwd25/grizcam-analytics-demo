import json
import os
from azure.cosmos import CosmosClient

# ===== SET THESE VIA ENV VARS =====
COSMOS_URI = os.environ.get("COSMOS_URI", "")
COSMOS_KEY = os.environ.get("COSMOS_KEY", "")
DATABASE_NAME = os.environ.get("COSMOS_DATABASE_NAME", "GRIZCAM")
CONTAINER_NAME = os.environ.get("COSMOS_CONTAINER_NAME", "events")
OUTPUT_FILE = os.environ.get("COSMOS_OUTPUT_FILE", "clean_events_export.json")

# Start small first
QUERY = """
SELECT TOP 1000
    c.id,
    c.name,
    c.mac,
    c.event,
    c.utc_timestamp,
    c.timestamp,
    c.sequence,
    c.sensor,
    c.location,
    c.latitude,
    c.longitude,
    c.temperature,
    c.humidity,
    c.pressure,
    c.voltage,
    c.batteryPercentage,
    c.lux,
    c.heatLevel,
    c.fileType,
    c.filename,
    c.image_blob_url,
    c.analysis.title AS analysis_title,
    c.analysis.summary AS analysis_summary
FROM c
"""
# =========================

def main():
    if not COSMOS_URI or not COSMOS_KEY:
        raise RuntimeError("COSMOS_URI and COSMOS_KEY must be set in the environment")

    client = CosmosClient(COSMOS_URI, credential=COSMOS_KEY)

    database = client.get_database_client(DATABASE_NAME)
    container = database.get_container_client(CONTAINER_NAME)

    items = list(
        container.query_items(
            query=QUERY,
            enable_cross_partition_query=True
        )
    )

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)

    print(f"Exported {len(items)} records to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
