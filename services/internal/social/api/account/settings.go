package account

import (
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/settings"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// RegisterSettingsController registers the settings routes (authenticated, /settings).
func RegisterSettingsController(r *httpx.Router, authMiddleware httpx.Middleware, perms *auth.PermissionsService, orgs *organizations.Service) {
	g := r.Group("/settings", authMiddleware)
	team := perms.CheckPolicies(
		auth.Policy(auth.ActionCreate, auth.SectionTeamMembers),
		auth.Policy(auth.ActionCreate, auth.SectionAdmin),
	)

	g.Get("/team", func(c *httpx.Ctx) (any, error) {
		return orgs.GetTeam(c.R.Context(), c.Org.ID)
	}, team)

	g.Post("/team", func(c *httpx.Ctx) (any, error) {
		var body settings.AddTeamMemberDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return orgs.InviteTeamMember(c.R.Context(), c.Org, c.User, &body)
	}, team)

	g.Post("/team/add", func(c *httpx.Ctx) (any, error) {
		var body settings.AdminAddTeamMemberDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		if !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		return orgs.AddTeamMemberByEmail(c.R.Context(), c.Org, &body)
	})

	g.Delete("/team/:id", func(c *httpx.Ctx) (any, error) {
		return orgs.DeleteTeamMember(c.R.Context(), c.Org, c.Param("id"))
	}, team)

	g.Get("/shortlink", func(c *httpx.Ctx) (any, error) {
		return orgs.GetShortlinkPreference(c.R.Context(), c.Org.ID)
	})

	g.Post("/shortlink", func(c *httpx.Ctx) (any, error) {
		var body settings.ShortlinkPreferenceDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return orgs.UpdateShortlinkPreference(c.R.Context(), c.Org.ID, organization.Shortlink(body.Shortlink))
	}, perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionAdmin)))
}
