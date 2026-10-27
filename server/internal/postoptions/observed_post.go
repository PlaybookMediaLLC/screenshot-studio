package postoptions

import "time"

// ObservedPost is a provider's read-only timeline item. It is never a publishing command.
type ObservedPost struct {
	ID          string    `json:"id"`
	URL         string    `json:"url"`
	Caption     string    `json:"caption"`
	PublishedAt time.Time `json:"publishedAt"`
	Metrics     Metrics   `json:"metrics"`
}
