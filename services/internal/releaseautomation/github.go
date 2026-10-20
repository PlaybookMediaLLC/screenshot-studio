package releaseautomation

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releasenotes"
)

var ErrPayload = errors.New("invalid supported GitHub event")

// NormalizeGitHub accepts only the three shipped business operations. Ignored
// actions need no full payload; malformed supported actions must fail visibly.
// Delivery IDs never contribute to semantic identity.
func NormalizeGitHub(eventName string, body json.RawMessage) (int64, *Event, error) {
	if eventName != "release" && eventName != "pull_request" && eventName != "deployment_status" {
		return 0, nil, nil
	}
	if len(body) > 1<<20 {
		return 0, nil, ErrPayload
	}
	var header struct {
		Action string `json:"action"`
		PR     struct {
			Merged *bool `json:"merged"`
		} `json:"pull_request"`
		Status struct {
			State string `json:"state"`
		} `json:"deployment_status"`
	}
	if err := json.Unmarshal(body, &header); err != nil {
		return 0, nil, ErrPayload
	}
	if eventName != "deployment_status" && header.Action == "" {
		return 0, nil, ErrPayload
	}
	if eventName == "release" && header.Action != "published" || eventName == "pull_request" && header.Action != "closed" {
		return 0, nil, nil
	}
	if eventName == "pull_request" && header.PR.Merged != nil && !*header.PR.Merged {
		return 0, nil, nil
	}
	if eventName == "deployment_status" && header.Status.State != "" && header.Status.State != "success" {
		return 0, nil, nil
	}
	var payload struct {
		Installation struct {
			ID int64 `json:"id"`
		} `json:"installation"`
		Repository struct {
			ID            int64  `json:"id"`
			FullName      string `json:"full_name"`
			DefaultBranch string `json:"default_branch"`
		} `json:"repository"`
		Sender struct {
			Login string `json:"login"`
		} `json:"sender"`
		Release struct {
			ID          int64     `json:"id"`
			Tag         string    `json:"tag_name"`
			Name        string    `json:"name"`
			Body        string    `json:"body"`
			URL         string    `json:"html_url"`
			PublishedAt time.Time `json:"published_at"`
			Prerelease  *bool     `json:"prerelease"`
		} `json:"release"`
		PR struct {
			ID       int64     `json:"id"`
			Number   int       `json:"number"`
			Title    string    `json:"title"`
			Body     string    `json:"body"`
			URL      string    `json:"html_url"`
			MergedAt time.Time `json:"merged_at"`
			Merged   *bool     `json:"merged"`
			Base     struct {
				Ref string `json:"ref"`
			} `json:"base"`
			User struct {
				Login string `json:"login"`
				Type  string `json:"type"`
			} `json:"user"`
			Labels []struct {
				Name string `json:"name"`
			} `json:"labels"`
		} `json:"pull_request"`
		Deployment struct {
			ID          int64  `json:"id"`
			Environment string `json:"environment"`
			SHA         string `json:"sha"`
			Production  *bool  `json:"production_environment"`
		} `json:"deployment"`
		Status struct {
			State       string    `json:"state"`
			Environment string    `json:"environment"`
			URL         string    `json:"environment_url"`
			TargetURL   string    `json:"target_url"`
			CreatedAt   time.Time `json:"created_at"`
		} `json:"deployment_status"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Installation.ID <= 0 || payload.Repository.ID <= 0 {
		return 0, nil, ErrPayload
	}
	e := &Event{RepositoryID: strconv.FormatInt(payload.Repository.ID, 10), RepositoryName: payload.Repository.FullName, DefaultBranch: payload.Repository.DefaultBranch, Origin: "live", Fields: map[string]Value{}}
	e.Fields["repository.id"] = StringValue(e.RepositoryID)
	if e.RepositoryName != "" {
		e.Fields["repository.name"] = StringValue(e.RepositoryName)
	}
	if payload.Sender.Login != "" {
		e.Fields["actor.login"] = StringValue(payload.Sender.Login)
	}
	switch eventName {
	case "release":
		r := payload.Release
		if r.ID <= 0 || r.Tag == "" || r.PublishedAt.IsZero() {
			return 0, nil, ErrPayload
		}
		e.Family, e.ObjectID, e.OccurredAt, e.URL = Published, strconv.FormatInt(r.ID, 10), r.PublishedAt, r.URL
		e.Title = releasenotes.Clean(r.Name, 160)
		if e.Title == "" {
			e.Title = releasenotes.Clean(r.Tag, 160)
		}
		e.Notes = releasenotes.Clean(r.Body, 50000)
		e.SemanticKey = "release:" + e.RepositoryID + ":" + e.ObjectID
		e.Fields["release.tag"], e.Fields["release.title"] = StringValue(r.Tag), StringValue(e.Title)
		if r.Prerelease != nil {
			e.Fields["release.prerelease"] = BoolValue(*r.Prerelease)
		}
	case "pull_request":
		pr := payload.PR
		if pr.ID <= 0 || pr.Number <= 0 || pr.Merged == nil || !*pr.Merged || pr.MergedAt.IsZero() || pr.Base.Ref == "" || pr.Title == "" {
			return 0, nil, ErrPayload
		}
		e.Family, e.ObjectID, e.Number, e.OccurredAt, e.URL = Merged, strconv.FormatInt(pr.ID, 10), pr.Number, pr.MergedAt, pr.URL
		e.Title, e.Notes = releasenotes.Clean(pr.Title, 160), releasenotes.Clean(pr.Body, 10000)
		e.SemanticKey = fmt.Sprintf("pr:%s:%d", e.RepositoryID, pr.Number)
		e.Fields["pr.base"], e.Fields["pr.title"], e.Fields["pr.number"] = StringValue(pr.Base.Ref), StringValue(e.Title), StringValue(strconv.Itoa(pr.Number))
		if len(pr.Labels) > 100 {
			return 0, nil, ErrPayload
		}
		labels := []string{}
		for _, label := range pr.Labels {
			if len(label.Name) > 100 {
				return 0, nil, ErrPayload
			}
			labels = append(labels, label.Name)
		}
		e.Fields["pr.labels"], e.Fields["pr.files"] = StringValue(labels...), Value{State: "pending"}
		if pr.User.Login != "" {
			e.Fields["pr.author"] = StringValue(pr.User.Login)
		}
		if pr.User.Type != "" {
			e.Fields["pr.bot"] = BoolValue(pr.User.Type == "Bot" || strings.HasSuffix(strings.ToLower(pr.User.Login), "[bot]"))
		}
	case "deployment_status":
		d, s := payload.Deployment, payload.Status
		if d.ID <= 0 || s.State != "success" || s.CreatedAt.IsZero() {
			return 0, nil, ErrPayload
		}
		environment := s.Environment
		if environment == "" {
			environment = d.Environment
		}
		if environment == "" {
			return 0, nil, ErrPayload
		}
		e.Family, e.ObjectID, e.OccurredAt, e.URL = Deployed, strconv.FormatInt(d.ID, 10), s.CreatedAt, s.URL
		if e.URL == "" {
			e.URL = s.TargetURL
		}
		e.Title = releasenotes.Clean("Deployment to "+environment, 160)
		e.Notes = "Successful deployment " + e.ObjectID + " at commit " + d.SHA
		e.SemanticKey = "deployment:" + e.RepositoryID + ":" + e.ObjectID + ":success"
		e.Fields["deployment.environment"], e.Fields["deployment.state"] = StringValue(environment), StringValue("success")
		if d.SHA != "" {
			e.Fields["deployment.sha"] = StringValue(d.SHA)
		}
		if d.Production != nil {
			e.Fields["deployment.production"] = BoolValue(*d.Production)
		}
	}
	e.Fields["event.family"] = StringValue(string(e.Family))
	action := header.Action
	if action == "" && e.Family == Deployed {
		action = "success"
	}
	e.Fields["event.action"] = StringValue(action)
	if err := ValidateEvent(*e); err != nil {
		return 0, nil, err
	}
	return payload.Installation.ID, e, nil
}

// ValidateEvent also validates administrator-supplied dry-run examples.
func ValidateEvent(e Event) error {
	if body, err := json.Marshal(e); err != nil || len(body) > 512<<10 {
		return ErrPayload
	}
	for _, text := range []string{e.RepositoryID, e.RepositoryName, e.ObjectID, e.SemanticKey, e.DefaultBranch, e.Title, e.Notes, e.URL} {
		if strings.ContainsRune(text, 0) {
			return ErrPayload
		}
	}
	if !ValidFamily(e.Family) || e.RepositoryID == "" || len(e.RepositoryID) > 64 || len(e.RepositoryName) > 200 || len(e.ObjectID) > 64 || len(e.SemanticKey) > 255 || e.OccurredAt.IsZero() || e.Title == "" || len([]rune(e.Title)) > 160 || len([]rune(e.Notes)) > 50000 || (e.Origin != "live" && e.Origin != "historical" && e.Origin != "example") {
		return ErrPayload
	}
	if e.URL != "" {
		u, err := url.Parse(e.URL)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(e.URL) > 2000 {
			return ErrPayload
		}
	}
	for name, value := range e.Fields {
		kind, ok := FieldKinds(e.Family)[name]
		if !ok || !slicesContainsState(value.State) || len(value.Values) > 3000 {
			return ErrPayload
		}
		if value.State == "available" && ((kind == "boolean" && (value.Boolean == nil || len(value.Values) > 0)) || (kind != "boolean" && (value.Boolean != nil || kind == "string" && len(value.Values) != 1))) {
			return ErrPayload
		}
		for _, item := range value.Values {
			if len(item) > 2000 || strings.ContainsRune(item, 0) {
				return ErrPayload
			}
		}
	}
	return nil
}

func slicesContainsState(state string) bool {
	return state == "available" || state == "missing" || state == "pending" || state == "unavailable" || state == "not_applicable"
}
