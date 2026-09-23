package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vibexcorp/linkedin-outreach/backend/platform/postgres"
)

// Contrato cross-tenant (PRD-honestidade-conexao, Fase B2): com dois tenants
// reais no Postgres (porta 5433, banco vibex_outreach), cada tenant enxerga
// SOMENTE as próprias linhas — contacts do outro tenant são invisíveis
// (0 linhas) sob o contexto RLS. Sem app.organization_id setado, FORCE RLS
// retorna 0 linhas (nunca vaza).
//
// Requer o stack local no ar (scripts/local/start.ps1). Sem Postgres, o teste
// é pulado de forma honesta (Skip) em vez de fingir isolamento.

const crossTenantDBURL = "postgres://vibex_admin:vibex_secure_password_2026@localhost:5433/vibex_outreach?sslmode=disable"

func crossTenantClient(t *testing.T) *postgres.Client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := postgres.New(ctx, crossTenantDBURL)
	if err != nil {
		t.Skipf("postgres local indisponivel (rode scripts/local/start.ps1): %v", err)
	}
	t.Cleanup(client.Close)
	return client
}

func freshTenantOrg(t *testing.T, c *postgres.Client, slugPrefix, name string) uuid.UUID {
	t.Helper()
	// Sufixo temporal com nanosegundos: cada run ganha uma org virgem (sem
	// devices, contatos ou contas de runs anteriores). Segundo-granular não
	// basta — dois testes no mesmo segundo geravam o MESMO slug e, com RLS
	// em organizations (000011), a org conflitante é invisível e o upsert
	// falha no USING. Slug sempre único → sempre INSERT puro no contexto
	// certo.
	return ensureTenantOrg(t, c,
		slugPrefix+"-"+time.Now().UTC().Format("20060102-150405.000000000")+"-e2e",
		name+" (E2E)")
}

func ensureTenantOrg(t *testing.T, c *postgres.Client, slug, name string) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// RLS em organizations (migration 000011): a org entra no próprio contexto
	// para poder se inserir — id gerado no cliente + set_config transacional
	// (mesmo padrão das demais tabelas multi-tenant).
	newID := uuid.New()
	tx, err := c.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("ensure org %s: begin tx: %v", slug, err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT set_config('app.organization_id', $1, true)`, newID.String()); err != nil {
		t.Fatalf("ensure org %s: set_config: %v", slug, err)
	}
	var orgID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO organizations (id, name, slug)
		VALUES ($1, $2, $3)
		ON CONFLICT (slug) DO NOTHING
		RETURNING id
	`, newID, name, slug).Scan(&orgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("ensure org %s: slug ja existe de outra organizacao (invisivel sob RLS)", slug)
		}
		t.Fatalf("ensure org %s: %v", slug, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("ensure org %s: commit: %v", slug, err)
	}
	return orgID
}
func seedTenantContact(t *testing.T, c *postgres.Client, orgID uuid.UUID, fullName, linkedinURL string) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var contactID uuid.UUID
	err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO contacts (organization_id, first_name, last_name, full_name, company, job_title, linkedin_url, status)
			VALUES ($1, 'Cross', 'Tenant', $2, 'Acme', 'Dev', $3, 'pending')
			RETURNING id
		`, orgID, fullName, linkedinURL).Scan(&contactID)
	})
	if err != nil {
		t.Fatalf("seed contact tenant %s: %v", orgID, err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
			_, _ = tx.Exec(ctx, `DELETE FROM contacts WHERE organization_id = $1 AND id = $2`, orgID, contactID)
			return nil
		})
	})
	return contactID
}

func countContactsNamed(t *testing.T, c *postgres.Client, orgID uuid.UUID, fullName string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var count int
	if err := c.ExecWithTenant(ctx, orgID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM contacts WHERE organization_id = $1 AND full_name = $2
		`, orgID, fullName).Scan(&count)
	}); err != nil {
		t.Fatalf("count tenant %s: %v", orgID, err)
	}
	return count
}

func TestCrossTenant_Contacts_Isolados(t *testing.T) {
	c := crossTenantClient(t)

	// Orgs de prova criadas de verdade (FK de contacts exige organization
	// existente); slugs estáveis tornam o teste repetível.
	orgA := freshTenantOrg(t, c, "xtenant-a-b2", "Cross-Tenant A (B2)")
	orgB := freshTenantOrg(t, c, "xtenant-b-b2", "Cross-Tenant B (B2)")

	seedTenantContact(t, c, orgA, "Contato Do Tenant A", "https://linkedin.com/in/tenant-a-prova-b2")

	// Tenant B NÃO enxerga o contato do tenant A (RLS → 0 linhas).
	if n := countContactsNamed(t, c, orgB, "Contato Do Tenant A"); n != 0 {
		t.Fatalf("VAZAMENTO cross-tenant: tenant B enxergou %d contato(s) do tenant A", n)
	}

	// Tenant A enxerga o próprio contato (sanidade: o isolamento não é "tudo vazio").
	if n := countContactsNamed(t, c, orgA, "Contato Do Tenant A"); n != 1 {
		t.Fatalf("tenant A deveria ver 1 contato proprio, viu %d", n)
	}
}

func TestCrossTenant_SemContexto_ZeroLinhas(t *testing.T) {
	c := crossTenantClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Sem SET LOCAL app.organization_id, FORCE RLS + NULLIF devolve 0 linhas
	// em tabela de tenant — nunca vaza conteúdo de ninguém.
	var count int
	if err := c.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM contacts`).Scan(&count); err != nil {
		t.Fatalf("count sem contexto: %v", err)
	}
	if count != 0 {
		t.Fatalf("sem contexto de tenant, contacts devolveu %d linhas (esperado 0)", count)
	}
}
