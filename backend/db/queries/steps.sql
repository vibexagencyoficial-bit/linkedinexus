-- name: CreateCampaignStep :one
INSERT INTO campaign_steps (
    organization_id,
    campaign_id,
    position,
    step_type,
    name,
    template_body,
    delay_amount,
    delay_unit,
    conditions
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListCampaignSteps :many
SELECT * FROM campaign_steps
WHERE organization_id = $1 AND campaign_id = $2
ORDER BY position ASC;

-- name: GetCampaignStepByID :one
SELECT * FROM campaign_steps
WHERE organization_id = $1 AND id = $2;

-- name: DeleteCampaignStepsByCampaign :exec
DELETE FROM campaign_steps
WHERE organization_id = $1 AND campaign_id = $2;

-- name: GetNextCampaignStep :one
SELECT * FROM campaign_steps
WHERE organization_id = $1 
  AND campaign_id = $2 
  AND position > $3
ORDER BY position ASC
LIMIT 1;

-- name: GetFirstCampaignStep :one
SELECT * FROM campaign_steps
WHERE organization_id = $1 AND campaign_id = $2
ORDER BY position ASC
LIMIT 1;
