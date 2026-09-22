-- name: AddContactToCampaign :one
INSERT INTO campaign_contacts (
    organization_id,
    campaign_id,
    contact_id,
    status,
    current_step_id,
    current_position,
    next_execution_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (campaign_id, contact_id) DO NOTHING
RETURNING *;

-- name: GetCampaignContact :one
SELECT * FROM campaign_contacts
WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3;

-- name: ListContactsByCampaign :many
SELECT cc.*, c.first_name, c.last_name, c.full_name, c.company, c.job_title, c.linkedin_url
FROM campaign_contacts cc
JOIN contacts c ON cc.contact_id = c.id
WHERE cc.organization_id = $1 AND cc.campaign_id = $2
ORDER BY cc.created_at DESC
LIMIT $3 OFFSET $4;

-- name: CountContactsByCampaign :one
SELECT COUNT(*) FROM campaign_contacts
WHERE organization_id = $1 AND campaign_id = $2;

-- name: FindEligibleContactsForScheduling :many
SELECT cc.*, c.first_name, c.last_name, c.full_name, c.company, c.job_title, c.linkedin_url,
       camp.daily_limit, camp.allowed_start_time, camp.allowed_end_time, camp.timezone, camp.status as campaign_status
FROM campaign_contacts cc
JOIN campaigns camp ON cc.campaign_id = camp.id
JOIN contacts c ON cc.contact_id = c.id
WHERE cc.status = 'waiting'
  AND cc.next_execution_at <= NOW()
  AND camp.status = 'running'
ORDER BY cc.next_execution_at ASC
LIMIT $1
FOR UPDATE OF cc SKIP LOCKED;

-- name: UpdateCampaignContactState :exec
UPDATE campaign_contacts
SET status = $4,
    current_step_id = $5,
    current_position = $6,
    next_execution_at = $7,
    completed_at = CASE WHEN $4 = 'completed' THEN NOW() ELSE completed_at END,
    stopped_at = CASE WHEN $4 IN ('replied', 'failed', 'paused') THEN NOW() ELSE stopped_at END,
    stop_reason = $8,
    updated_at = NOW()
WHERE organization_id = $1 AND campaign_id = $2 AND contact_id = $3;

-- name: StopCampaignContactOnReply :exec
UPDATE campaign_contacts
SET status = 'replied',
    stop_reason = 'reply_detected',
    stopped_at = NOW(),
    updated_at = NOW()
WHERE organization_id = $1 AND contact_id = $2 AND status IN ('active', 'waiting', 'pending');
