package product

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/brandkit"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/creativetemplate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Presets (creative templates) and brand kits are versioned by name: each
// save adds a version. Rename and archive act on every version of a name, so
// a library shows one entry per name. A name held by any version, archived
// or not, cannot be taken by a rename: archived versions keep their history.

var templateEditRoles = []string{"owner", "admin", "creator"}

func validLibraryName(name string) bool {
	return name != "" && utf8.RuneCountInString(name) <= 100
}

// RenameCreativeTemplate renames every version of the template id belongs to.
func (c *Configuration) RenameCreativeTemplate(ctx context.Context, actor Actor, id, name string) (*CreativeTemplateRecord, error) {
	if err := c.authorizeRoles(ctx, actor, templateEditRoles...); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if !validLibraryName(name) {
		return nil, ErrInvalidInput
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := tx.CreativeTemplate.Query().Where(creativetemplate.ID(id),
		creativetemplate.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if row.Name != name {
		taken, err := tx.CreativeTemplate.Query().Where(creativetemplate.OrganizationID(actor.OrganizationID),
			creativetemplate.Name(name)).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, publishing.ErrConflict
		}
		if _, err := tx.CreativeTemplate.Update().Where(creativetemplate.OrganizationID(actor.OrganizationID),
			creativetemplate.Name(row.Name)).SetName(name).Save(ctx); err != nil {
			return nil, err
		}
		if err := appendConfigurationAudit(ctx, tx, actor, "product.creative_template_renamed", "creative_template", row.ID,
			map[string]any{"from": row.Name, "to": name}); err != nil {
			return nil, err
		}
	}
	latest, err := tx.CreativeTemplate.Query().Where(creativetemplate.OrganizationID(actor.OrganizationID),
		creativetemplate.Name(name)).Order(ent.Desc(creativetemplate.FieldVersion)).First(ctx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := creativeTemplateRecord(latest.Unwrap())
	return &result, nil
}

// ArchiveCreativeTemplate archives every version of the template id belongs
// to. Variants that pinned a version keep it.
func (c *Configuration) ArchiveCreativeTemplate(ctx context.Context, actor Actor, id string) error {
	if err := c.authorizeRoles(ctx, actor, templateEditRoles...); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	row, err := tx.CreativeTemplate.Query().Where(creativetemplate.ID(id),
		creativetemplate.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.CreativeTemplate.Update().Where(creativetemplate.OrganizationID(actor.OrganizationID),
		creativetemplate.Name(row.Name)).SetStatus(creativetemplate.StatusARCHIVED).Save(ctx); err != nil {
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.creative_template_archived", "creative_template", row.ID); err != nil {
		return err
	}
	return tx.Commit()
}

// RenameBrandKit renames every version of the brand kit id belongs to.
func (c *Configuration) RenameBrandKit(ctx context.Context, actor Actor, id, name string) (*ent.BrandKit, error) {
	if err := c.Authorize(ctx, actor); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if !validLibraryName(name) {
		return nil, ErrInvalidInput
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := tx.BrandKit.Query().Where(brandkit.ID(id), brandkit.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if row.Name != name {
		taken, err := tx.BrandKit.Query().Where(brandkit.OrganizationID(actor.OrganizationID), brandkit.Name(name)).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, publishing.ErrConflict
		}
		if _, err := tx.BrandKit.Update().Where(brandkit.OrganizationID(actor.OrganizationID),
			brandkit.Name(row.Name)).SetName(name).Save(ctx); err != nil {
			return nil, err
		}
		if err := appendConfigurationAudit(ctx, tx, actor, "product.brand_kit_renamed", "brand_kit", row.ID,
			map[string]any{"from": row.Name, "to": name}); err != nil {
			return nil, err
		}
	}
	latest, err := tx.BrandKit.Query().Where(brandkit.OrganizationID(actor.OrganizationID), brandkit.Name(name)).
		Order(ent.Desc(brandkit.FieldVersion)).First(ctx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return latest.Unwrap(), nil
}

// ArchiveBrandKit archives every version of the brand kit id belongs to.
// Variants that pinned a version keep it; launches stop picking it.
func (c *Configuration) ArchiveBrandKit(ctx context.Context, actor Actor, id string) error {
	if err := c.Authorize(ctx, actor); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	row, err := tx.BrandKit.Query().Where(brandkit.ID(id), brandkit.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.BrandKit.Update().Where(brandkit.OrganizationID(actor.OrganizationID),
		brandkit.Name(row.Name)).SetStatus(brandkit.StatusARCHIVED).Save(ctx); err != nil {
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.brand_kit_archived", "brand_kit", row.ID); err != nil {
		return err
	}
	return tx.Commit()
}
