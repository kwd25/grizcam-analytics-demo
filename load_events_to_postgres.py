import json
import psycopg2

with open("clean_events_export.json", "r", encoding="utf-8") as f:
    rows = json.load(f)

conn = psycopg2.connect(
    host="localhost",
    port=5432,
    dbname="grizcam",
    user="kyle",   # change if needed
    password=""
)

cur = conn.cursor()

insert_sql = """
INSERT INTO events (
    id, name, mac, event, utc_timestamp, timestamp, sequence, sensor, location,
    latitude, longitude, temperature, humidity, pressure, voltage,
    battery_percentage, lux, heat_level, file_type, filename,
    image_blob_url, analysis_title, analysis_summary
)
VALUES (
    %(id)s, %(name)s, %(mac)s, %(event)s, %(utc_timestamp)s, %(timestamp)s,
    %(sequence)s, %(sensor)s, %(location)s, %(latitude)s, %(longitude)s,
    %(temperature)s, %(humidity)s, %(pressure)s, %(voltage)s,
    %(batteryPercentage)s, %(lux)s, %(heatLevel)s, %(fileType)s, %(filename)s,
    %(image_blob_url)s, %(analysis_title)s, %(analysis_summary)s
)
ON CONFLICT (id) DO NOTHING;
"""

for row in rows:
    clean_row = {
        "id": row.get("id"),
        "name": row.get("name"),
        "mac": row.get("mac"),
        "event": row.get("event"),
        "utc_timestamp": row.get("utc_timestamp"),
        "timestamp": row.get("timestamp"),
        "sequence": row.get("sequence"),
        "sensor": row.get("sensor"),
        "location": row.get("location"),
        "latitude": row.get("latitude"),
        "longitude": row.get("longitude"),
        "temperature": row.get("temperature"),
        "humidity": row.get("humidity"),
        "pressure": row.get("pressure"),
        "voltage": row.get("voltage"),
        "batteryPercentage": row.get("batteryPercentage"),
        "lux": row.get("lux"),
        "heatLevel": row.get("heatLevel"),
        "fileType": row.get("fileType"),
        "filename": row.get("filename"),
        "image_blob_url": row.get("image_blob_url"),
        "analysis_title": row.get("analysis_title"),
        "analysis_summary": row.get("analysis_summary"),
    }

    cur.execute(insert_sql, clean_row)

conn.commit()
cur.close()
conn.close()

print(f"Inserted {len(rows)} rows into Postgres")