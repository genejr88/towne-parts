CREATE TABLE IF NOT EXISTS "ro_location_photos" (
  "id"          SERIAL PRIMARY KEY,
  "roId"        INTEGER NOT NULL,
  "storedPath"  TEXT NOT NULL,
  "caption"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ro_location_photos_roId_fkey"
    FOREIGN KEY ("roId") REFERENCES "ros"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
