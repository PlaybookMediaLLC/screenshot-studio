package ent

import (
	"context"

	entsql "entgo.io/ent/dialect/sql"
)

// PlatformQuery reads reviewed platform SQL, such as a join with the social
// service's tables, and calls scan once per row.
func (c *Client) PlatformQuery(ctx context.Context, query string, args []any, scan func(entsql.ColumnScanner) error) error {
	rows := &entsql.Rows{}
	if err := c.driver.Query(ctx, query, args, rows); err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// PlatformQuery reads reviewed platform SQL inside the transaction.
func (tx *Tx) PlatformQuery(ctx context.Context, query string, args []any, scan func(entsql.ColumnScanner) error) error {
	rows := &entsql.Rows{}
	if err := tx.config.driver.Query(ctx, query, args, rows); err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}
