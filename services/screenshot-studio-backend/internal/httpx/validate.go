package httpx

import (
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"github.com/go-playground/validator/v10"
)

var (
	validateOnce sync.Once
	validate     *validator.Validate
)

// Validator returns the shared validator so packages can register custom
// rules (class-validator custom decorators) at init.
func Validator() *validator.Validate {
	validateOnce.Do(func() {
		validate = validator.New(validator.WithRequiredStructEnabled())
		validate.RegisterTagNameFunc(func(f reflect.StructField) string {
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if name == "" || name == "-" {
				name = strings.Split(f.Tag.Get("query"), ",")[0]
			}
			if name == "" || name == "-" {
				return f.Name
			}
			return name
		})
	})
	return validate
}

// Validate checks `validate` struct tags and reports failures the way Nest's
// ValidationPipe does: 400 with {message: [...], error, statusCode}.
// A DTO with a `Validate() []string` method (the exact class-validator
// messages) is validated by that method instead of its tags.
func Validate(v any) error {
	if dto, ok := v.(interface{ Validate() []string }); ok {
		if messages := dto.Validate(); len(messages) > 0 {
			return BadRequest(messages)
		}
		return nil
	}
	err := Validator().Struct(v)
	if err == nil {
		return nil
	}
	var invalid validator.ValidationErrors
	if !errors.As(err, &invalid) {
		return nil
	}
	messages := make([]string, 0, len(invalid))
	for _, fe := range invalid {
		messages = append(messages, message(fe))
	}
	return BadRequest(messages)
}

func message(fe validator.FieldError) string {
	field := fe.Namespace()
	if i := strings.Index(field, "."); i >= 0 {
		field = field[i+1:]
	}
	switch fe.Tag() {
	case "required", "required_without", "required_with", "required_if":
		return field + " should not be empty"
	case "email":
		return field + " must be an email"
	case "url", "http_url", "uri":
		return field + " must be a URL address"
	case "oneof":
		return fmt.Sprintf("%s must be one of the following values: %s", field, strings.ReplaceAll(fe.Param(), " ", ", "))
	case "min":
		if fe.Kind() == reflect.String {
			return fmt.Sprintf("%s must be longer than or equal to %s characters", field, fe.Param())
		}
		if fe.Kind() == reflect.Slice || fe.Kind() == reflect.Array {
			return fmt.Sprintf("%s must contain at least %s elements", field, fe.Param())
		}
		return fmt.Sprintf("%s must not be less than %s", field, fe.Param())
	case "max":
		if fe.Kind() == reflect.String {
			return fmt.Sprintf("%s must be shorter than or equal to %s characters", field, fe.Param())
		}
		if fe.Kind() == reflect.Slice || fe.Kind() == reflect.Array {
			return fmt.Sprintf("%s must contain no more than %s elements", field, fe.Param())
		}
		return fmt.Sprintf("%s must not be greater than %s", field, fe.Param())
	case "datetime":
		return field + " must be a valid ISO 8601 date string"
	case "uuid", "uuid4":
		return field + " must be a UUID"
	case "hexcolor":
		return field + " must be a hexadecimal color"
	}
	return fmt.Sprintf("%s failed the %s validation", field, fe.Tag())
}

// decodeValues fills v from query values, converting to the field types the
// way class-transformer does for @Type() annotated query DTOs.
func decodeValues(values url.Values, v any) error {
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Pointer || rv.Elem().Kind() != reflect.Struct {
		return fmt.Errorf("BindQuery needs a struct pointer")
	}
	rv = rv.Elem()
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		sf := rt.Field(i)
		name := strings.Split(sf.Tag.Get("query"), ",")[0]
		if name == "" {
			name = strings.Split(sf.Tag.Get("json"), ",")[0]
		}
		if name == "" || name == "-" {
			continue
		}
		raw, ok := values[name]
		if !ok {
			raw, ok = values[name+"[]"]
		}
		if !ok || len(raw) == 0 {
			continue
		}
		if err := setValue(rv.Field(i), raw); err != nil {
			return BadRequest([]string{fmt.Sprintf("%s %v", name, err)})
		}
	}
	return nil
}

func setValue(field reflect.Value, raw []string) error {
	if field.Kind() == reflect.Pointer {
		elem := reflect.New(field.Type().Elem())
		if err := setValue(elem.Elem(), raw); err != nil {
			return err
		}
		field.Set(elem)
		return nil
	}
	if field.Kind() == reflect.Slice {
		items := raw
		if len(raw) == 1 && strings.Contains(raw[0], ",") && field.Type().Elem().Kind() == reflect.String {
			items = raw
		}
		slice := reflect.MakeSlice(field.Type(), len(items), len(items))
		for i, item := range items {
			if err := setValue(slice.Index(i), []string{item}); err != nil {
				return err
			}
		}
		field.Set(slice)
		return nil
	}
	value := raw[len(raw)-1]
	switch field.Kind() {
	case reflect.String:
		field.SetString(value)
	case reflect.Bool:
		field.SetBool(value == "true" || value == "1")
	case reflect.Int, reflect.Int64, reflect.Int32:
		n, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return fmt.Errorf("must be a number conforming to the specified constraints")
		}
		field.SetInt(int64(n))
	case reflect.Float64, reflect.Float32:
		n, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return fmt.Errorf("must be a number conforming to the specified constraints")
		}
		field.SetFloat(n)
	default:
		return fmt.Errorf("has an unsupported type")
	}
	return nil
}
