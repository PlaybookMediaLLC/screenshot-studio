package httpx

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"runtime/debug"

	"github.com/getsentry/sentry-go"
)

// Error is a Nest HttpException: a status and the exact JSON body to send.
// Write, when set, replaces the default rendering (Nest exception filters).
type Error struct {
	Status int
	Body   any
	Write  func(c *Ctx)
}

func (e *Error) Error() string { return fmt.Sprintf("http %d: %v", e.Status, e.Body) }

// ErrHandled stops a middleware chain after the middleware wrote the response.
var ErrHandled = errors.New("response already written")

// NewError renders body verbatim, like `new HttpException(object, status)`.
func NewError(status int, body any) *Error { return &Error{Status: status, Body: body} }

// HTTPException mirrors `new HttpException('message', status)`, whose body is
// {statusCode, message}. Passing a non-string body sends it as-is.
func HTTPException(message any, status int) *Error {
	if s, ok := message.(string); ok {
		return &Error{Status: status, Body: statusMessage{StatusCode: status, Message: s}}
	}
	return &Error{Status: status, Body: message}
}

func named(status int, name string, message any) *Error {
	if message == nil {
		message = name
	}
	// Nest's createBody: a plain object is the body verbatim; strings and
	// arrays become {message, error, statusCode}.
	if isPlainObject(message) {
		return &Error{Status: status, Body: message}
	}
	return &Error{Status: status, Body: namedBody{Message: message, Error: name, StatusCode: status}}
}

// Nest's exception bodies, with Nest's key order.
type namedBody struct {
	Message    any    `json:"message"`
	Error      string `json:"error"`
	StatusCode int    `json:"statusCode"`
}

type statusMessage struct {
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
}

func isPlainObject(v any) bool {
	k := reflect.Indirect(reflect.ValueOf(v)).Kind()
	return k == reflect.Map || k == reflect.Struct
}

// BadRequest mirrors Nest's BadRequestException.
func BadRequest(message any) *Error { return named(http.StatusBadRequest, "Bad Request", message) }

// Unauthorized mirrors Nest's UnauthorizedException.
func Unauthorized(message any) *Error { return named(http.StatusUnauthorized, "Unauthorized", message) }

// Forbidden mirrors Nest's ForbiddenException.
func Forbidden(message any) *Error { return named(http.StatusForbidden, "Forbidden", message) }

// NotFound mirrors Nest's NotFoundException.
func NotFound(message any) *Error { return named(http.StatusNotFound, "Not Found", message) }

// Conflict mirrors Nest's ConflictException.
func Conflict(message any) *Error { return named(http.StatusConflict, "Conflict", message) }

// UnprocessableEntity mirrors Nest's UnprocessableEntityException.
func UnprocessableEntity(message any) *Error {
	return named(http.StatusUnprocessableEntity, "Unprocessable Entity", message)
}

// TooManyRequests mirrors the throttler's ThrottlerException.
func TooManyRequests() *Error {
	return HTTPException("ThrottlerException: Too Many Requests", http.StatusTooManyRequests)
}

// InternalServerError mirrors Nest's InternalServerErrorException.
func InternalServerError(message any) *Error {
	return named(http.StatusInternalServerError, "Internal Server Error", message)
}

func (c *Ctx) fail(err error) {
	if errors.Is(err, ErrHandled) || c.written {
		return
	}
	var httpErr *Error
	if errors.As(err, &httpErr) {
		if httpErr.Write != nil {
			httpErr.Write(c)
			c.written = true
			return
		}
		c.JSON(httpErr.Status, httpErr.Body)
		return
	}
	// Nest's default filter: unknown errors are logged and hidden.
	slog.Error("unhandled request error", "method", c.R.Method, "path", c.R.URL.Path, "error", err)
	sentry.CaptureException(err)
	c.JSON(http.StatusInternalServerError, statusMessage{StatusCode: 500, Message: "Internal server error"})
}

type panicErr struct {
	value any
	stack []byte
}

func (p panicErr) Error() string { return fmt.Sprintf("panic: %v\n%s", p.value, p.stack) }

func panicError(value any) error {
	if err, ok := value.(error); ok {
		var httpErr *Error
		if errors.As(err, &httpErr) {
			return err
		}
	}
	return panicErr{value: value, stack: debug.Stack()}
}

// Message returns the body's message field (string messages only), or "".
func (e *Error) Message() string {
	switch b := e.Body.(type) {
	case namedBody:
		s, _ := b.Message.(string)
		return s
	case statusMessage:
		return b.Message
	case map[string]any:
		s, _ := b["message"].(string)
		return s
	}
	return ""
}

// Messages returns the body's message as a list (validation errors), or nil.
func (e *Error) Messages() []string {
	switch b := e.Body.(type) {
	case namedBody:
		if list, ok := b.Message.([]string); ok {
			return list
		}
	case map[string]any:
		if list, ok := b["message"].([]string); ok {
			return list
		}
	}
	if m := e.Message(); m != "" {
		return []string{m}
	}
	return nil
}
