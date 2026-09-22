-- name: UpsertConversation :one
INSERT INTO conversations (organization_id, contact_id, linkedin_account_id, status)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, contact_id) DO UPDATE SET
    status = EXCLUDED.status,
    last_message_at = NOW(),
    updated_at = NOW()
RETURNING *;

-- name: CheckIfContactReplied :one
SELECT EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.organization_id = $1 
      AND c.contact_id = $2 
      AND m.direction = 'inbound'
) as has_replied;

-- name: AddMessage :one
INSERT INTO messages (organization_id, conversation_id, direction, content, sent_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListMessagesByConversation :many
SELECT * FROM messages
WHERE organization_id = $1 AND conversation_id = $2
ORDER BY sent_at ASC;
