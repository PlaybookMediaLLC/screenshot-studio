package releaseautomation

import (
	"path"
	"slices"
	"strings"
)

func ValidateCondition(c Condition, family Family) string {
	count := 0
	var visit func(Condition, int) string
	visit = func(c Condition, depth int) string {
		count++
		if depth > 8 || count > 128 {
			return "Conditions exceed the depth or size limit."
		}
		if c.Group != "" {
			if c.Field != "" || c.Operator != "" || len(c.Values) != 0 {
				return "A group cannot also be a predicate."
			}
			if c.Group != "ALL" && c.Group != "ANY" && c.Group != "NOT" {
				return "Unknown condition group."
			}
			if len(c.Children) == 0 || len(c.Children) > 32 || (c.Group == "NOT" && len(c.Children) != 1) {
				return "ALL/ANY need 1–32 children; NOT needs one."
			}
			for _, child := range c.Children {
				if reason := visit(child, depth+1); reason != "" {
					return reason
				}
			}
			return ""
		}
		kind, ok := FieldKinds(family)[c.Field]
		if !ok || len(c.Children) != 0 {
			return "This field does not apply to the selected event."
		}
		if len(c.Values) > 50 {
			return "A predicate supports at most 50 values."
		}
		for _, value := range c.Values {
			if len(value) > 1000 || strings.ContainsRune(value, 0) {
				return "Condition value is too long or contains NUL."
			}
		}
		switch c.Operator {
		case "exists", "not_exists":
			if len(c.Values) != 0 {
				return "Existence operators take no values."
			}
		case "is_true", "is_false":
			if kind != "boolean" || len(c.Values) != 0 {
				return "Boolean operators require a boolean field and no values."
			}
		case "eq", "ne", "contains", "not_contains", "starts_with", "glob":
			if kind == "boolean" || len(c.Values) != 1 {
				return "This operator requires one string value."
			}
			if c.Operator == "glob" {
				if strings.Contains(c.Values[0], "**") {
					return "Glob uses *, ?, and [ranges]; ** is not supported."
				}
				if _, err := path.Match(c.Values[0], ""); err != nil {
					return "Invalid glob pattern."
				}
			}
		case "in", "not_in":
			if kind == "boolean" || len(c.Values) == 0 {
				return "Membership requires one or more string values."
			}
		default:
			return "Unknown condition operator."
		}
		return ""
	}
	if !ValidFamily(family) {
		return "Unknown event family."
	}
	return visit(c, 1)
}

// Evaluate uses case-sensitive strings. Positive collection predicates match
// any item; negatives require every item to fail the positive predicate.
// Exists means observed, including empty strings/lists. Unavailable enrichment
// propagates through every group and can never select an else branch.
func Evaluate(c Condition, event Event) Decision {
	if reason := ValidateCondition(c, event.Family); reason != "" {
		return Decision{Status: "invalid", Reason: reason}
	}
	return evaluate(c, event)
}

func evaluate(c Condition, event Event) Decision {
	if c.Group != "" {
		matched := c.Group == "ALL"
		for _, child := range c.Children {
			result := evaluate(child, event)
			if result.Status != "evaluated" {
				return result
			}
			switch c.Group {
			case "ALL":
				matched = matched && result.Match
			case "ANY":
				matched = matched || result.Match
			case "NOT":
				matched = !result.Match
			}
		}
		return Decision{Status: "evaluated", Match: matched, Reason: c.Group + " group evaluated."}
	}
	value, exists := event.Fields[c.Field]
	if !exists || value.State == "missing" {
		if c.Operator == "exists" || c.Operator == "not_exists" {
			return Decision{Status: "evaluated", Match: c.Operator == "not_exists", Reason: c.Field + " was not supplied."}
		}
		return Decision{Status: "missing", Reason: c.Field + " was not supplied; no branch selected."}
	}
	if value.State != "available" {
		state := value.State
		if !slices.Contains([]string{"pending", "unavailable", "not_applicable"}, state) {
			state = "invalid"
		}
		return Decision{Status: state, Reason: c.Field + " is " + state + "; no branch selected."}
	}
	kind := FieldKinds(event.Family)[c.Field]
	if (kind == "boolean" && (value.Boolean == nil || len(value.Values) > 0)) || (kind != "boolean" && (value.Boolean != nil || (kind == "string" && len(value.Values) != 1))) {
		return Decision{Status: "invalid", Reason: "Recorded field has the wrong type."}
	}
	matched := false
	switch c.Operator {
	case "exists":
		matched = true
	case "not_exists":
		matched = false
	case "is_true":
		matched = *value.Boolean
	case "is_false":
		matched = !*value.Boolean
	default:
		for _, item := range value.Values {
			switch c.Operator {
			case "eq", "ne":
				matched = matched || item == c.Values[0]
			case "in", "not_in":
				matched = matched || slices.Contains(c.Values, item)
			case "contains", "not_contains":
				if kind == "collection" {
					matched = matched || item == c.Values[0]
				} else {
					matched = matched || strings.Contains(item, c.Values[0])
				}
			case "starts_with":
				matched = matched || strings.HasPrefix(item, c.Values[0])
			case "glob":
				yes, _ := path.Match(c.Values[0], item)
				matched = matched || yes
			}
		}
		if c.Operator == "ne" || c.Operator == "not_in" || c.Operator == "not_contains" {
			matched = !matched
		}
	}
	return Decision{Status: "evaluated", Match: matched, Reason: c.Field + " " + c.Operator + " evaluated against recorded evidence."}
}
