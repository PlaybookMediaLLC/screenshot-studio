package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/lucsky/cuid"
)

func (s *Store) recoverCommunications(ctx context.Context) error {
	return transaction(ctx, s.DB, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE customer_communication c SET status='SCHEDULED',"updatedAt"=now() WHERE status='PROCESSING' AND "updatedAt"<now()-interval '15 minutes' AND NOT EXISTS(SELECT 1 FROM communication_attempt a WHERE a."customerCommunicationId"=c.id AND a."completedAt" IS NULL)`); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `UPDATE customer_communication c SET status='FAILED',"updatedAt"=now() WHERE status='PROCESSING' AND "updatedAt"<now()-interval '15 minutes' RETURNING id,"organizationId"`)
		if err != nil {
			return err
		}
		var uncertain [][2]string
		for rows.Next() {
			var v [2]string
			if err = rows.Scan(&v[0], &v[1]); err != nil {
				rows.Close()
				return err
			}
			uncertain = append(uncertain, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, v := range uncertain {
			if _, err = tx.ExecContext(ctx, `UPDATE communication_attempt SET "completedAt"=now(),"failureCode"='UNKNOWN_DELIVERY',outcome='FAILED' WHERE "customerCommunicationId"=$1 AND "completedAt" IS NULL`, v[0]); err != nil {
				return err
			}
			if err = audit(ctx, tx, v[1], "communication.delivery_recovery_required", "customer_communication", v[0], "FAILED", map[string]string{"failureCode": "UNKNOWN_DELIVERY"}); err != nil {
				return err
			}
		}
		return nil
	})
}
func (s *Store) Communications(ctx context.Context) (int, error) {
	if err := s.recoverCommunications(ctx); err != nil {
		return 0, err
	}
	candidates, err := ids(ctx, s.DB, `SELECT id FROM customer_communication WHERE channel='EMAIL' AND status='SCHEDULED' AND "scheduledFor"<=now() ORDER BY "scheduledFor" LIMIT 25`)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, id := range candidates {
		// Fail before claiming if delivery is not configured, leaving mail retryable.
		if s.Mail == nil || s.Mail.APIKey == "" || s.Mail.From == "" || s.Mail.SigningSecret == "" {
			return total, fmt.Errorf("maintenance email configuration incomplete")
		}
		var org string
		err = s.DB.QueryRowContext(ctx, `UPDATE customer_communication SET status='PROCESSING',"updatedAt"=now() WHERE id=$1 AND status='SCHEDULED' AND "scheduledFor"<=now() RETURNING "organizationId"`, id).Scan(&org)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return total, err
		}
		ok, e := operational(ctx, s.DB, org)
		if e != nil {
			return total, e
		}
		if !ok {
			err = transaction(ctx, s.DB, func(tx *sql.Tx) error {
				if _, e := tx.ExecContext(ctx, `UPDATE customer_communication SET status='CANCELLED',"updatedAt"=now() WHERE id=$1`, id); e != nil {
					return e
				}
				return audit(ctx, tx, org, "communication.cancelled", "customer_communication", id, "SUCCEEDED", nil)
			})
			if err != nil {
				return total, err
			}
			continue
		}
		delivered, e := s.deliverCommunication(ctx, id, org)
		total += delivered
		if e != nil {
			return total, e
		}
	}
	return total, nil
}
func (s *Store) deliverCommunication(ctx context.Context, id, org string) (int, error) {
	var msg Message
	msg.OrganizationID = org
	err := s.DB.QueryRowContext(ctx, `SELECT o.name,r.title,r."benefitStatement",d."bodyMarkdown",COALESCE(c."ctaUrl",'') FROM customer_communication c JOIN organization o ON o.id=c."organizationId" JOIN release_document d ON d.id=c."releaseDocumentId" AND d."organizationId"=c."organizationId" JOIN release r ON r.id=d."releaseId" AND r."organizationId"=c."organizationId" WHERE c.id=$1 AND c."organizationId"=$2`, id, org).Scan(&msg.Product, &msg.Title, &msg.Benefit, &msg.Body, &msg.CTA)
	if err != nil {
		return 0, err
	}
	// gen_random_uuid generates IDs only; Prisma cuid fields accept arbitrary strings.
	_, err = s.DB.ExecContext(ctx, `INSERT INTO communication_recipient (id,"organizationId","customerCommunicationId","subscriberId",email) SELECT gen_random_uuid()::text,$1,$2,id,email FROM audience_subscriber WHERE "organizationId"=$1 AND "unsubscribedAt" IS NULL AND "suppressedAt" IS NULL ON CONFLICT ("customerCommunicationId",email) DO NOTHING`, org, id)
	if err != nil {
		return 0, err
	}
	// Re-check consent for materialized recipients on EVERY attempt, including
	// unsubscribe/suppression since a partially successful send.
	rows, err := s.DB.QueryContext(ctx, `SELECT r.id,r.email FROM communication_recipient r JOIN audience_subscriber a ON a.id=r."subscriberId" AND a."organizationId"=r."organizationId" AND a.email=r.email WHERE r."customerCommunicationId"=$1 AND r."organizationId"=$2 AND r."deliveredAt" IS NULL AND a."unsubscribedAt" IS NULL AND a."suppressedAt" IS NULL`, id, org)
	if err != nil {
		return 0, err
	}
	var recipients [][2]string
	for rows.Next() {
		var v [2]string
		if err = rows.Scan(&v[0], &v[1]); err != nil {
			rows.Close()
			return 0, err
		}
		recipients = append(recipients, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	attempt := cuid.New()
	var number int
	err = s.DB.QueryRowContext(ctx, `INSERT INTO communication_attempt (id,"organizationId","customerCommunicationId","attemptNumber") SELECT $1,$2,$3,COALESCE(MAX("attemptNumber"),0)+1 FROM communication_attempt WHERE "customerCommunicationId"=$3 RETURNING "attemptNumber"`, attempt, org, id).Scan(&number)
	if err != nil {
		return 0, err
	}
	delivered, failed, unknown := 0, 0, false
	for index, r := range recipients {
		// Resend's default limit is two requests/second; bound calls and preserve context.
		if index > 0 {
			select {
			case <-ctx.Done():
				return delivered, ctx.Err()
			case <-time.After(600 * time.Millisecond):
			}
		}
		// Honor consent changes during a long batch too.
		var allowed bool
		err = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM audience_subscriber WHERE "organizationId"=$1 AND email=$2 AND "unsubscribedAt" IS NULL AND "suppressedAt" IS NULL) AND NOT EXISTS(SELECT 1 FROM workspace_deletion WHERE "organizationId"=$1 AND status<>'CANCELLED')`, org, r[1]).Scan(&allowed)
		if err != nil {
			return delivered, err
		}
		if !allowed {
			continue
		}
		msg.RecipientID = r[0]
		msg.Email = r[1]
		providerID, rejected, sendErr := s.Mail.Send(ctx, msg)
		if ctx.Err() != nil {
			return delivered, ctx.Err()
		}
		if sendErr == nil {
			_, err = s.DB.ExecContext(ctx, `UPDATE communication_recipient SET "deliveredAt"=now(),"providerMessageId"=$2,"failureCode"=NULL WHERE id=$1 AND "organizationId"=$3`, r[0], providerID, org)
			if err != nil {
				return delivered, err
			}
			delivered++
		} else {
			code := "PROVIDER_REJECTED"
			if !rejected {
				code = "UNKNOWN_DELIVERY"
				unknown = true
			}
			failed++
			if _, err = s.DB.ExecContext(ctx, `UPDATE communication_recipient SET "failureCode"=$2 WHERE id=$1 AND "organizationId"=$3`, r[0], code, org); err != nil {
				return delivered, err
			}
			if unknown {
				break
			}
		}
	}
	status, outcome, action := "DELIVERED", "SUCCEEDED", "communication.delivered"
	if failed > 0 {
		status = "SCHEDULED"
		outcome = "FAILED"
		action = "communication.partially_failed"
		if number >= 3 {
			status = "FAILED"
		}
	}
	if unknown {
		status = "FAILED"
		action = "communication.delivery_recovery_required"
	}
	err = transaction(ctx, s.DB, func(tx *sql.Tx) error {
		code := ""
		if unknown {
			code = "UNKNOWN_DELIVERY"
		}
		if _, e := tx.ExecContext(ctx, `UPDATE communication_attempt SET "completedAt"=now(),outcome=$2::"AttemptOutcome","failureCode"=NULLIF($3,'') WHERE id=$1`, attempt, outcome, code); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `UPDATE customer_communication SET status=$2::"CustomerCommunicationStatus","updatedAt"=now() WHERE id=$1`, id, status); e != nil {
			return e
		}
		return audit(ctx, tx, org, action, "customer_communication", id, outcome, map[string]any{"attemptNumber": number, "delivered": delivered, "failed": failed, "failureCode": code})
	})
	return delivered, err
}
