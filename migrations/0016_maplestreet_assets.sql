CREATE TABLE IF NOT EXISTS maplestreet_assets (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  spec TEXT NOT NULL,
  files TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS maplestreet_assets_kind_idx ON maplestreet_assets (kind, created_at);

INSERT OR IGNORE INTO maplestreet_assets (id, kind, name, status, spec, files, version, created_by, created_at, updated_at)
  SELECT id, 'item', name, CASE active WHEN 1 THEN 'published' ELSE 'retired' END,
    json_object('price', price, 'room', room, 'func', func, 'indoor', json(CASE indoor WHEN 1 THEN 'true' ELSE 'false' END),
      'solid', json(CASE solid WHEN 1 THEN 'true' ELSE 'false' END), 'scale', json_object('x', scale_x, 'y', scale_y, 'z', scale_z),
      'yaw', yaw, 'w', width, 'd', depth, 'h', height),
    json_object('model', json_object('key', 'maplestreet-item/' || id, 'type', model_type, 'bytes', model_bytes)),
    1, created_by, created_at, updated_at
  FROM maplestreet_items;

INSERT OR IGNORE INTO maplestreet_assets (id, kind, name, status, spec, files, version, created_by, created_at, updated_at)
  SELECT id, 'vehicle', name, CASE active WHEN 1 THEN 'published' ELSE 'retired' END, spec,
    CASE WHEN wheel_type IS NULL
      THEN json_object('model', json_object('key', 'maplestreet-vehicle/' || id, 'type', model_type, 'bytes', model_bytes))
      ELSE json_object('model', json_object('key', 'maplestreet-vehicle/' || id, 'type', model_type, 'bytes', model_bytes),
        'wheel', json_object('key', 'maplestreet-vehicle/' || id || '/wheel', 'type', wheel_type, 'bytes', wheel_bytes))
    END,
    1, created_by, created_at, updated_at
  FROM maplestreet_vehicles;
