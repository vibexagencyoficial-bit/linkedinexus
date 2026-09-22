-- name: CreateCampaign :one
INSERT INTO campaigns (
    organization_id,
    name,
    description,
    status,
    daily_limit,
    allowed_start_time,
    allowed_end_time,
    timezone,
    is_flow_custom
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetCampaignByID :one
SELECT * FROM campaigns
WHERE organization_id = $1 AND id = $2;

-- name: ListCampaigns :many
SELECT * FROM campaigns
WHERE organization_id = $1
ORDER BY created_at DESC;

-- name: UpdateCampaignStatus :one
UPDATE campaigns
SET status = $3,
    started_at = CASE WHEN $3 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
    paused_at = CASE WHEN $3 = 'paused' THEN NOW() ELSE paused_at END,
    updated_at = NOW()
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: UpdateCampaignLimits :one
UPDATE campaigns
SET daily_limit = $3,
    allowed_start_time = $4,
    allowed_end_time = $5,
    timezone = $6,
    updated_at = NOW()
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: PauseAllCampaignsByOrg :exec
UPDATE campaigns
SET status = 'paused', paused_at = NOW(), updated_at = NOW()
WHERE organization_id = $1 AND status = 'running';

-- name: ResumeAllCampaignsByOrg :exec
UPDATE campaigns
SET status = 'running', updated_at = NOW()
WHERE organization_id = $1 AND status = 'paused';
