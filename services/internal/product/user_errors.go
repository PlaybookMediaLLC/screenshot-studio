package product

import "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"

// userError keeps an HTTP-mapped sentinel (for errors.Is) and a message meant
// for the person using the product, which the API returns as-is.
type userError struct {
	kind    error
	message string
}

func (e userError) Error() string { return e.message }
func (e userError) Unwrap() error { return e.kind }

func conflict(message string) error  { return userError{publishing.ErrConflict, message} }
func notFound(message string) error  { return userError{publishing.ErrNotFound, message} }
func forbidden(message string) error { return userError{publishing.ErrForbidden, message} }
func invalid(message string) error   { return userError{ErrInvalidInput, message} }
