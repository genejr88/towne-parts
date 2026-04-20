CREATE TABLE IF NOT EXISTS "private_files" (
  "id"               SERIAL PRIMARY KEY,
  "storedPath"       TEXT NOT NULL,
  "originalFilename" TEXT,
  "caption"          TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
