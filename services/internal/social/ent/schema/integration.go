package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

type Integration struct{ ent.Schema }

func (Integration) Annotations() []schema.Annotation { return table("Integration") }

func (Integration) Fields() []ent.Field {
	return []ent.Field{
		cuidID(),
		str("internal_id", "internalId"),
		str("organization_id", "organizationId"),
		str("name", "name"),
		optStr("custom_name", "customName"),
		optStr("picture", "picture"),
		str("provider_identifier", "providerIdentifier"),
		str("type", "type"),
		field.String("token").StorageKey("token").Sensitive().ValueScanner(credentialScanner("integration.token")),
		field.Bool("disabled").StorageKey("disabled").Default(false),
		optTime("token_expiration", "tokenExpiration"),
		field.String("refresh_token").StorageKey("refreshToken").Optional().GoType((*string)(nil)).Sensitive().ValueScanner(nullableCredentialScanner("integration.refresh_token")),
		optStr("profile", "profile"),
		deletedAt(),
		createdAt(),
		field.Time("updated_at").StorageKey("updatedAt").Optional().Nillable().Default(time.Now).UpdateDefault(time.Now),
		field.Bool("in_between_steps").StorageKey("inBetweenSteps").Default(false),
		field.Bool("refresh_needed").StorageKey("refreshNeeded").Default(false),
		field.String("posting_times").StorageKey("postingTimes").Default(`[{"time":120}, {"time":400}, {"time":700}]`),
		field.String("custom_instance_details").StorageKey("customInstanceDetails").Optional().Nillable().Sensitive(),
		optStr("customer_id", "customerId"),
		optStr("root_internal_id", "rootInternalId"),
		field.String("additional_settings").StorageKey("additionalSettings").Optional().Nillable().Default("[]"),
	}
}

func (Integration) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("exisingPlugData", ExisingPlugData.Type),
		edge.From("customer", Customer.Type).Ref("integrations").Field("customer_id").Unique(),
		edge.From("organization", Organization.Type).Ref("Integration").Field("organization_id").Unique().Required(),
		edge.From("webhookList", Webhooks.Type).Ref("integrationList").Through("webhooks", IntegrationsWebhooks.Type),
		edge.To("orderItems", OrderItems.Type),
		edge.To("plugs", Plugs.Type),
		edge.To("posts", Post.Type),
	}
}

type Plugs struct{ ent.Schema }

func (Plugs) Annotations() []schema.Annotation { return table("Plugs") }

func (Plugs) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("organization_id", "organizationId"), str("plug_function", "plugFunction"), str("data", "data"),
		str("integration_id", "integrationId"), field.Bool("activated").StorageKey("activated").Default(true),
	}
}

func (Plugs) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("integration", Integration.Type).Ref("plugs").Field("integration_id").Unique().Required(),
		edge.From("organization", Organization.Type).Ref("plugs").Field("organization_id").Unique().Required(),
	}
}

type ExisingPlugData struct{ ent.Schema }

func (ExisingPlugData) Annotations() []schema.Annotation { return table("ExisingPlugData") }

// The "value" column is exposed as PlugValue because Ent entities already have a
// Value method.
func (ExisingPlugData) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("integration_id", "integrationId"), str("method_name", "methodName"), str("plug_value", "value"),
	}
}

func (ExisingPlugData) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("integration", Integration.Type).Ref("exisingPlugData").Field("integration_id").Unique().Required(),
	}
}

// IntegrationsWebhooks is the Integration <-> Webhooks join table.
type IntegrationsWebhooks struct{ ent.Schema }

func (IntegrationsWebhooks) Annotations() []schema.Annotation {
	return append(table("IntegrationsWebhooks"), field.ID("webhook_id", "integration_id"))
}

func (IntegrationsWebhooks) Fields() []ent.Field {
	return []ent.Field{str("integration_id", "integrationId"), str("webhook_id", "webhookId")}
}

func (IntegrationsWebhooks) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("integration", Integration.Type).Field("integration_id").Unique().Required(),
		edge.To("webhook", Webhooks.Type).Field("webhook_id").Unique().Required(),
	}
}

type Webhooks struct{ ent.Schema }

func (Webhooks) Annotations() []schema.Annotation { return table("Webhooks") }

func (Webhooks) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("name", "name"), str("organization_id", "organizationId"), str("url", "url"),
		deletedAt(), createdAt(), updatedAt(),
	}
}

func (Webhooks) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("integrationList", Integration.Type).Through("integrations", IntegrationsWebhooks.Type),
		edge.From("organization", Organization.Type).Ref("webhooks").Field("organization_id").Unique().Required(),
	}
}

type ThirdParty struct{ ent.Schema }

func (ThirdParty) Annotations() []schema.Annotation { return table("ThirdParty") }

func (ThirdParty) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("organization_id", "organizationId"), str("identifier", "identifier"), str("name", "name"),
		str("internal_id", "internalId"), secret("api_key", "apiKey"), createdAt(), updatedAt(), deletedAt(),
	}
}

func (ThirdParty) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("thirdParty").Field("organization_id").Unique().Required(),
	}
}

type MessagesGroup struct{ ent.Schema }

func (MessagesGroup) Annotations() []schema.Annotation { return table("MessagesGroup") }

func (MessagesGroup) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("buyer_organization_id", "buyerOrganizationId"), str("buyer_id", "buyerId"),
		str("seller_id", "sellerId"), createdAt(), updatedAt(),
	}
}

func (MessagesGroup) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("messages", Messages.Type),
		edge.From("buyer", User.Type).Ref("groupBuyer").Field("buyer_id").Unique().Required(),
		edge.From("buyerOrganization", Organization.Type).Ref("buyerOrganization").Field("buyer_organization_id").Unique().Required(),
		edge.From("seller", User.Type).Ref("groupSeller").Field("seller_id").Unique().Required(),
		edge.To("orders", Orders.Type),
	}
}

type PayoutProblems struct{ ent.Schema }

func (PayoutProblems) Annotations() []schema.Annotation { return table("PayoutProblems") }

func (PayoutProblems) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("status", "status"), str("order_id", "orderId"), str("user_id", "userId"),
		optStr("post_id", "postId"), field.Int("amount").StorageKey("amount"), createdAt(), updatedAt(),
	}
}

func (PayoutProblems) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("order", Orders.Type).Ref("payoutProblems").Field("order_id").Unique().Required(),
		edge.From("post", Post.Type).Ref("payoutProblems").Field("post_id").Unique(),
		edge.From("user", User.Type).Ref("payoutProblems").Field("user_id").Unique().Required(),
	}
}

type Orders struct{ ent.Schema }

func (Orders) Annotations() []schema.Annotation { return table("Orders") }

func (Orders) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("buyer_id", "buyerId"), str("seller_id", "sellerId"),
		field.Enum("status").StorageKey("status").Values("PENDING", "ACCEPTED", "CANCELED", "COMPLETED"),
		str("message_group_id", "messageGroupId"), optStr("capture_id", "captureId"), createdAt(), updatedAt(),
	}
}

func (Orders) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("ordersItems", OrderItems.Type),
		edge.From("buyer", User.Type).Ref("orderBuyer").Field("buyer_id").Unique().Required(),
		edge.From("messageGroup", MessagesGroup.Type).Ref("orders").Field("message_group_id").Unique().Required(),
		edge.From("seller", User.Type).Ref("orderSeller").Field("seller_id").Unique().Required(),
		edge.To("payoutProblems", PayoutProblems.Type),
		edge.To("posts", Post.Type),
	}
}

type OrderItems struct{ ent.Schema }

func (OrderItems) Annotations() []schema.Annotation { return table("OrderItems") }

func (OrderItems) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("order_id", "orderId"), str("integration_id", "integrationId"),
		field.Int("quantity").StorageKey("quantity"), field.Int("price").StorageKey("price"),
	}
}

func (OrderItems) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("integration", Integration.Type).Ref("orderItems").Field("integration_id").Unique().Required(),
		edge.From("order", Orders.Type).Ref("ordersItems").Field("order_id").Unique().Required(),
	}
}

type Messages struct{ ent.Schema }

func (Messages) Annotations() []schema.Annotation { return table("Messages") }

func (Messages) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		field.Enum("from").StorageKey("from").Values("BUYER", "SELLER"),
		optStr("content", "content"),
		str("group_id", "groupId"),
		optStr("special", "special"),
		createdAt(),
		updatedAt(),
		deletedAt(),
	}
}

func (Messages) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("group", MessagesGroup.Type).Ref("messages").Field("group_id").Unique().Required(),
		edge.To("posts", Post.Type),
	}
}

type OAuthApp struct{ ent.Schema }

func (OAuthApp) Annotations() []schema.Annotation { return table("OAuthApp") }

func (OAuthApp) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		optStr("organization_id", "organizationId"),
		str("name", "name"),
		optStr("description", "description"),
		optStr("picture_id", "pictureId"),
		str("redirect_url", "redirectUrl"),
		optStr("redirect_uris", "redirectUris"),
		str("client_id", "clientId"),
		optSecret("client_secret", "clientSecret"),
		field.Bool("dynamic").StorageKey("dynamic").Default(false),
		optStr("token_endpoint_auth_method", "tokenEndpointAuthMethod"),
		createdAt(),
		updatedAt(),
		deletedAt(),
	}
}

func (OAuthApp) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("oauthApp").Field("organization_id").Unique(),
		edge.From("picture", Media.Type).Ref("oauthApps").Field("picture_id").Unique(),
		edge.To("authorizations", OAuthAuthorization.Type),
		edge.To("selfHostedAuthorizations", OAuthSelfHostedAuthorization.Type),
	}
}

type OAuthAuthorization struct{ ent.Schema }

func (OAuthAuthorization) Annotations() []schema.Annotation { return table("OAuthAuthorization") }

func (OAuthAuthorization) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("oauth_app_id", "oauthAppId"),
		str("user_id", "userId"),
		str("organization_id", "organizationId"),
		optSecret("access_token", "accessToken"),
		optSecret("authorization_code", "authorizationCode"),
		optTime("code_expires_at", "codeExpiresAt"),
		optStr("code_challenge", "codeChallenge"),
		optStr("code_challenge_method", "codeChallengeMethod"),
		optStr("redirect_uri", "redirectUri"),
		optTime("revoked_at", "revokedAt"),
		createdAt(),
		updatedAt(),
	}
}

func (OAuthAuthorization) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("oauthApp", OAuthApp.Type).Ref("authorizations").Field("oauth_app_id").Unique().Required(),
		edge.From("user", User.Type).Ref("oauthAuthorizations").Field("user_id").Unique().Required(),
		edge.From("organization", Organization.Type).Ref("oauthAuthorizations").Field("organization_id").Unique().Required(),
	}
}

type OAuthSelfHostedAuthorization struct{ ent.Schema }

func (OAuthSelfHostedAuthorization) Annotations() []schema.Annotation {
	return table("OAuthSelfHostedAuthorization")
}

func (OAuthSelfHostedAuthorization) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("oauth_app_id", "oauthAppId"),
		str("mcp_url", "mcpUrl"),
		secret("api_key", "apiKey"),
		optStr("email", "email"),
		optSecret("access_token", "accessToken"),
		optSecret("authorization_code", "authorizationCode"),
		optTime("code_expires_at", "codeExpiresAt"),
		optStr("code_challenge", "codeChallenge"),
		optStr("code_challenge_method", "codeChallengeMethod"),
		optStr("redirect_uri", "redirectUri"),
		optTime("revoked_at", "revokedAt"),
		createdAt(),
		updatedAt(),
	}
}

func (OAuthSelfHostedAuthorization) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("oauthApp", OAuthApp.Type).Ref("selfHostedAuthorizations").Field("oauth_app_id").Unique().Required(),
	}
}
