package releaseautomation

import (
	"math"
	"path"
	"slices"
	"strconv"
	"strings"
)

// number parses a number field's decimal string; NaN and infinities are not numbers.
func number(text string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	return value, err == nil && !math.IsNaN(value) && !math.IsInf(value, 0)
}

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
		case "gt", "gte", "lt", "lte":
			if kind != "number" || len(c.Values) != 1 {
				return "Comparisons require a number field and one value."
			}
		case "eq", "ne", "contains", "not_contains", "starts_with", "glob":
			if kind == "boolean" || len(c.Values) != 1 {
				return "This operator requires one string value."
			}
			if kind == "number" && c.Operator != "eq" && c.Operator != "ne" {
				return "Number fields take equality, membership, and comparisons."
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
		if kind == "number" {
			for _, value := range c.Values {
				if _, ok := number(value); !ok {
					return "Number fields compare against numbers."
				}
			}
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
	if !valueFits(kind, value) {
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
		if kind == "number" {
			// Numbers compare by value, so "2" equals "2.0".
			item, _ := number(value.Values[0])
			for _, text := range c.Values {
				want, _ := number(text)
				switch c.Operator {
				case "eq", "ne", "in", "not_in":
					matched = matched || item == want
				case "gt":
					matched = item > want
				case "gte":
					matched = item >= want
				case "lt":
					matched = item < want
				case "lte":
					matched = item <= want
				}
			}
			if c.Operator == "ne" || c.Operator == "not_in" {
				matched = !matched
			}
			break
		}
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

// valueFits reports whether an observed value has its field's shape.
func valueFits(kind string, value Value) bool {
	switch kind {
	case "boolean":
		return value.Boolean != nil && len(value.Values) == 0
	case "string":
		return value.Boolean == nil && len(value.Values) == 1
	case "number":
		if value.Boolean != nil || len(value.Values) != 1 {
			return false
		}
		_, ok := number(value.Values[0])
		return ok
	}
	return value.Boolean == nil
}
