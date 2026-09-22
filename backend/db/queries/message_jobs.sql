-- name: CreateMessageJob :one
INSERT INTO message_jobs (
    organization_id,
    campaign_id,
    contact_id,
    campaign_step_id,
    idempotency_key,
    rendered_content,
    status
) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (campaign_id, contact_id, campaign_step_id) DO NOTHING
RETURNING *;

-- name: GetMessageJobByID :one
SELECT * FROM message_jobs
WHERE organization_id = $1 AND id = $2;

-- name: GetMessageJobByIdempotencyKey :one
SELECT * FROM message_jobs
WHERE idempotency_key = $1;

-- name: UpdateMessageJobStatus :exec
UPDATE message_jobs
SET status = $3,
    attempts = attempts + 1,
    error_type = $4,
    error_message = $5,
    executed_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE executed_at END,
    updated_at = NOW()
WHERE organization_id = $1 AND id = $2;

-- name: CountExecutedJobsToday :one
SELECT COUNT(*) FROM message_jobs
WHERE organization_id = $1
  AND status = 'sent'
  AND executed_at >= CURRENT_DATE;
