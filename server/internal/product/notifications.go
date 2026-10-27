package product

import "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"

// WithNotifications attaches the backend-owned workspace activity service.
func (c *Configuration) WithNotifications(service *notifications.Service) *Configuration {
	c.notifications = service
	return c
}

// NotificationService is the optional activity capability used by the HTTP facade.
func (c *Configuration) NotificationService() *notifications.Service { return c.notifications }
