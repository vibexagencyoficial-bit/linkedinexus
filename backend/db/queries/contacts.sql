-- name: UpsertContact :one
INSERT INTO contacts (
    organization_id,
    first_name,
    last_name,
    full_name,
    company,
    job_title,
    linkedin_url,
    status,
    metadata
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (organization_id, linkedin_url) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    full_name = EXCLUDED.full_name,
    company = EXCLUDED.company,
    job_title = EXCLUDED.job_title,
    metadata = EXCLUDED.metadata,
    updated_at = NOW()
RETURNING *;

-- name: GetContactByID :one
SELECT * FROM contacts
WHERE organization_id = $1 AND id = $2;

-- name: GetContactByLinkedInURL :one
SELECT * FROM contacts
WHERE organization_id = $1 AND linkedin_url = $2;

-- name: ListContacts :many
SELECT * FROM contacts
WHERE organization_id = $1
  AND ($2::text = '' OR status = $2)
  AND ($3::text = '' OR full_name ILIKE '%' || $3 || '%' OR company ILIKE '%' || $3 || '%')
ORDER BY created_at DESC
LIMIT $4 OFFSET $5;

-- name: CountContacts :one
SELECT COUNT(*) FROM contacts
WHERE organization_id = $1
  AND ($2::text = '' OR status = $2)
  AND ($3::text = '' OR full_name ILIKE '%' || $3 || '%' OR company ILIKE '%' || $3 || '%');

-- name: UpdateContactStatus :exec
UPDATE contacts
SET status = $3, updated_at = NOW()
WHERE organization_id = $1 AND id = $2;

-- name: DeleteContact :exec
DELETE FROM contacts
WHERE organization_id = $1 AND id = $2;
