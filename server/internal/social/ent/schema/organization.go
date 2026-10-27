package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

type Organization struct{ ent.Schema }

func (Organization) Annotations() []schema.Annotation { return table("Organization") }

func (Organization) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("name", "name"),
		optStr("description", "description"),
		optStr("api_key", "apiKey"),
		optStr("payment_id", "paymentId"),
		optTime("streak_since", "streakSince"),
		createdAt(),
		updatedAt(),
		deletedAt(),
		field.Bool("allow_trial").StorageKey("allowTrial").Default(false),
		field.Bool("is_trailing").StorageKey("isTrailing").Default(false),
		field.Enum("shortlink").StorageKey("shortlink").Values("ASK", "YES", "NO").Default("ASK"),
	}
}

func (Organization) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("autoPost", AutoPost.Type),
		edge.To("Comments", Comments.Type),
		edge.To("credits", Credits.Type),
		edge.To("clippings", Clipping.Type),
		edge.To("customers", Customer.Type),
		edge.To("errors", Errors.Type),
		edge.To("github", GitHub.Type),
		edge.To("Integration", Integration.Type),
		edge.To("media", Media.Type),
		edge.To("buyerOrganization", MessagesGroup.Type),
		edge.To("notifications", Notifications.Type),
		edge.To("plugs", Plugs.Type),
		edge.To("post", Post.Type),
		edge.To("submittedPost", Post.Type),
		edge.To("sets", Sets.Type),
		edge.To("signatures", Signatures.Type),
		edge.To("subscription", Subscription.Type).Unique(),
		edge.To("tags", Tags.Type),
		edge.To("thirdParty", ThirdParty.Type),
		edge.To("usedCodes", UsedCodes.Type),
		edge.To("users", UserOrganization.Type),
		edge.To("webhooks", Webhooks.Type),
		edge.To("oauthApp", OAuthApp.Type),
		edge.To("oauthAuthorizations", OAuthAuthorization.Type),
	}
}

type User struct{ ent.Schema }

func (User) Annotations() []schema.Annotation { return table("User") }

func (User) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("email", "email"),
		optSecret("password", "password"),
		field.Enum("provider_name").StorageKey("providerName").Values("LOCAL", "GITHUB", "GOOGLE", "APPLE", "FARCASTER", "WALLET", "GENERIC"),
		optStr("name", "name"),
		optStr("last_name", "lastName"),
		field.Bool("is_super_admin").StorageKey("isSuperAdmin").Default(false),
		optStr("bio", "bio"),
		field.Int("audience").StorageKey("audience").Default(0),
		optStr("picture_id", "pictureId"),
		optStr("provider_id", "providerId"),
		field.Int("timezone").StorageKey("timezone"),
		createdAt(),
		updatedAt(),
		field.Time("last_read_notifications").StorageKey("lastReadNotifications").Default(time.Now),
		optStr("invite_id", "inviteId"),
		field.Bool("activated").StorageKey("activated").Default(true),
		optStr("account", "account"),
		field.Bool("connected_account").StorageKey("connectedAccount").Default(false),
		field.Time("last_online").StorageKey("lastOnline").Default(time.Now),
		optStr("ip", "ip"),
		optStr("agent", "agent"),
		deletedAt(),
		field.Bool("send_success_emails").StorageKey("sendSuccessEmails").Default(true),
		field.Bool("send_failure_emails").StorageKey("sendFailureEmails").Default(true),
		field.Bool("send_streak_emails").StorageKey("sendStreakEmails").Default(true),
	}
}

func (User) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("comments", Comments.Type),
		edge.To("items", ItemUser.Type),
		edge.To("groupBuyer", MessagesGroup.Type),
		edge.To("groupSeller", MessagesGroup.Type),
		edge.To("orderBuyer", Orders.Type),
		edge.To("orderSeller", Orders.Type),
		edge.To("payoutProblems", PayoutProblems.Type),
		edge.To("agencies", SocialMediaAgency.Type).Unique(),
		edge.From("picture", Media.Type).Ref("userPicture").Field("picture_id").Unique(),
		edge.To("organizations", UserOrganization.Type),
		edge.To("oauthAuthorizations", OAuthAuthorization.Type),
	}
}

type UsedCodes struct{ ent.Schema }

func (UsedCodes) Annotations() []schema.Annotation { return table("UsedCodes") }

func (UsedCodes) Fields() []ent.Field {
	return []ent.Field{uuidID(), str("code", "code"), str("org_id", "orgId"), createdAt(), updatedAt()}
}

func (UsedCodes) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("usedCodes").Field("org_id").Unique().Required(),
	}
}

type UserOrganization struct{ ent.Schema }

func (UserOrganization) Annotations() []schema.Annotation { return table("UserOrganization") }

func (UserOrganization) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("user_id", "userId"),
		str("organization_id", "organizationId"),
		field.Bool("disabled").StorageKey("disabled").Default(false),
		field.Enum("role").StorageKey("role").Values("SUPERADMIN", "ADMIN", "USER").Default("USER"),
		createdAt(),
		updatedAt(),
	}
}

func (UserOrganization) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("users").Field("organization_id").Unique().Required(),
		edge.From("user", User.Type).Ref("organizations").Field("user_id").Unique().Required(),
	}
}

type GitHub struct{ ent.Schema }

func (GitHub) Annotations() []schema.Annotation { return table("GitHub") }

func (GitHub) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), optStr("login", "login"), optStr("name", "name"), secret("token", "token"),
		optStr("job_id", "jobId"), str("organization_id", "organizationId"), createdAt(), updatedAt(),
	}
}

func (GitHub) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("github").Field("organization_id").Unique().Required(),
	}
}

type Trending struct{ ent.Schema }

func (Trending) Annotations() []schema.Annotation { return table("Trending") }

func (Trending) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("trending_list", "trendingList"), optStr("language", "language"), str("hash", "hash"),
		field.Time("date").StorageKey("date"), createdAt(), updatedAt(),
	}
}

type TrendingLog struct{ ent.Schema }

func (TrendingLog) Annotations() []schema.Annotation { return table("TrendingLog") }

func (TrendingLog) Fields() []ent.Field {
	return []ent.Field{uuidID(), optStr("language", "language"), field.Time("date").StorageKey("date")}
}

type ItemUser struct{ ent.Schema }

func (ItemUser) Annotations() []schema.Annotation { return table("ItemUser") }

func (ItemUser) Fields() []ent.Field {
	return []ent.Field{uuidID(), str("user_id", "userId"), str("key", "key")}
}

func (ItemUser) Edges() []ent.Edge {
	return []ent.Edge{edge.From("user", User.Type).Ref("items").Field("user_id").Unique().Required()}
}

type Star struct{ ent.Schema }

func (Star) Annotations() []schema.Annotation { return table("Star") }

func (Star) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		field.Int("stars").StorageKey("stars"),
		field.Int("total_stars").StorageKey("totalStars"),
		field.Int("forks").StorageKey("forks"),
		field.Int("total_forks").StorageKey("totalForks"),
		str("login", "login"),
		field.Time("date").StorageKey("date").Default(time.Now),
		createdAt(),
		updatedAt(),
	}
}

type Credits struct{ ent.Schema }

func (Credits) Annotations() []schema.Annotation { return table("Credits") }

func (Credits) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("organization_id", "organizationId"), field.Int("credits").StorageKey("credits"),
		createdAt(), updatedAt(), field.String("type").StorageKey("type").Default("ai_images"),
	}
}

func (Credits) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("credits").Field("organization_id").Unique().Required(),
	}
}

type Subscription struct{ ent.Schema }

func (Subscription) Annotations() []schema.Annotation { return table("Subscription") }

func (Subscription) Fields() []ent.Field {
	return []ent.Field{
		cuidID(),
		str("organization_id", "organizationId"),
		field.Enum("subscription_tier").StorageKey("subscriptionTier").Values("STANDARD", "PRO", "TEAM", "ULTIMATE"),
		field.String("provider").StorageKey("provider").Default("stripe"),
		optStr("identifier", "identifier"),
		optTime("cancel_at", "cancelAt"),
		field.Enum("period").StorageKey("period").Values("MONTHLY", "YEARLY"),
		field.Int("total_channels").StorageKey("totalChannels"),
		field.Bool("is_lifetime").StorageKey("isLifetime").Default(false),
		createdAt(),
		updatedAt(),
		deletedAt(),
	}
}

func (Subscription) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("subscription").Field("organization_id").Unique().Required(),
	}
}

type Customer struct{ ent.Schema }

func (Customer) Annotations() []schema.Annotation { return table("Customer") }

func (Customer) Fields() []ent.Field {
	return []ent.Field{uuidID(), str("name", "name"), str("org_id", "orgId"), createdAt(), updatedAt(), deletedAt()}
}

func (Customer) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("customers").Field("org_id").Unique().Required(),
		edge.To("integrations", Integration.Type),
	}
}

type Announcement struct{ ent.Schema }

func (Announcement) Annotations() []schema.Annotation { return table("Announcement") }

func (Announcement) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("title", "title"), str("description", "description"),
		field.Enum("color").StorageKey("color").Values("INFO", "WARNING", "ERROR").Default("INFO"),
		createdAt(),
	}
}
