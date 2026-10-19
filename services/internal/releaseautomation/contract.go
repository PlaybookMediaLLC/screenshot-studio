// Package releaseautomation defines the bounded, versioned release workflow language.
// It has no database, network, clock, or model dependencies.
package releaseautomation

import "time"

const SchemaVersion = 1
const MaxNodes = 64

// Outputs contains safe product references, never provider tokens or asset URLs.
type Outputs struct {
	BrandKitID      string   `json:"brandKitId,omitempty"`
	BrandKitVersion int      `json:"brandKitVersion,omitempty"`
	DestinationIDs  []string `json:"destinationIds,omitempty"`
	ReleaseID       string   `json:"releaseId,omitempty"`
	CampaignID      string   `json:"campaignId,omitempty"`
	PostIDs         []string `json:"postIds,omitempty"`
}

type Family string

const (
	Published Family = "release.published"
	Merged    Family = "pull_request.merged"
	Deployed  Family = "deployment.succeeded"
)

func ValidFamily(f Family) bool { return f == Published || f == Merged || f == Deployed }

// Value records whether a field was actually observed. An absent file list is
// pending enrichment, never evidence that a pull request changed no files.
type Value struct {
	State   string   `json:"state"`
	Values  []string `json:"values,omitempty"`
	Boolean *bool    `json:"boolean,omitempty"`
}

type Event struct {
	Family         Family           `json:"family"`
	SemanticKey    string           `json:"semanticKey"`
	RepositoryID   string           `json:"repositoryId"`
	RepositoryName string           `json:"repositoryName"`
	ObjectID       string           `json:"objectId"`
	Number         int              `json:"number,omitempty"`
	OccurredAt     time.Time        `json:"occurredAt"`
	Origin         string           `json:"origin"`
	Title          string           `json:"title"`
	Notes          string           `json:"notes"`
	URL            string           `json:"url"`
	DefaultBranch  string           `json:"defaultBranch,omitempty"`
	Fields         map[string]Value `json:"fields"`
}

// Condition is either a predicate or an ALL/ANY/NOT group, never executable code.
type Condition struct {
	Group    string      `json:"group,omitempty"`
	Children []Condition `json:"children,omitempty"`
	Field    string      `json:"field,omitempty"`
	Operator string      `json:"operator,omitempty"`
	Values   []string    `json:"values,omitempty"`
}

type Reference struct {
	NodeID string `json:"nodeId"`
	Output string `json:"output"`
}

// Action has a closed configuration: destinations are tenant connection IDs,
// and input IDs can only come from a dominating action's recorded output.
type Action struct {
	Type           string     `json:"type"`
	Input          *Reference `json:"input,omitempty"`
	BrandKitID     string     `json:"brandKitId,omitempty"`
	DestinationIDs []string   `json:"destinationIds,omitempty"`
	Audience       string     `json:"audience,omitempty"`
	CallToAction   string     `json:"callToAction,omitempty"`
}

type Node struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Condition *Condition `json:"condition,omitempty"`
	Action    *Action    `json:"action,omitempty"`
	Outcome   string     `json:"outcome,omitempty"`
}

type Edge struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Branch string `json:"branch"`
}

type Graph struct {
	SchemaVersion int       `json:"schemaVersion"`
	Family        Family    `json:"family"`
	Qualification Condition `json:"qualification"`
	Nodes         []Node    `json:"nodes"`
	Edges         []Edge    `json:"edges"`
}

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Issue struct {
	NodeID  string `json:"nodeId"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Decision struct {
	Status string `json:"status"`
	Match  bool   `json:"match"`
	Reason string `json:"reason"`
}

type Step struct {
	NodeID   string    `json:"nodeId"`
	Type     string    `json:"type"`
	Decision *Decision `json:"decision,omitempty"`
	Action   string    `json:"action,omitempty"`
	Outcome  string    `json:"outcome,omitempty"`
}

type Preview struct {
	Issues        []Issue  `json:"issues"`
	Qualification Decision `json:"qualification"`
	Steps         []Step   `json:"steps"`
	Outcome       string   `json:"outcome"`
}

func StringValue(values ...string) Value { return Value{State: "available", Values: values} }
func BoolValue(value bool) Value         { return Value{State: "available", Boolean: &value} }

// FieldKinds is also the editor's field catalog. Branch evidence is offered
// only for PRs: a release target_commitish need not be a branch.
func FieldKinds(f Family) map[string]string {
	fields := map[string]string{"repository.id": "string", "event.family": "string", "event.action": "string", "actor.login": "string"}
	switch f {
	case Published:
		fields["release.tag"], fields["release.title"], fields["release.prerelease"] = "string", "string", "boolean"
	case Merged:
		fields["pr.base"], fields["pr.labels"], fields["pr.author"], fields["pr.bot"], fields["pr.files"], fields["pr.title"] = "string", "collection", "string", "boolean", "collection", "string"
	case Deployed:
		fields["deployment.environment"], fields["deployment.state"], fields["deployment.sha"], fields["deployment.production"] = "string", "string", "string", "boolean"
	}
	return fields
}
