-- name: InsertEvent :one
INSERT INTO events (organization_id, entity_type, entity_id, event_type, payload)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListEventsByOrganization :many
SELECT * FROM events
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: InsertAuditLog :one
INSERT INTO audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata, ip)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListAuditLogsByOrganization :many
SELECT * FROM audit_logs
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
