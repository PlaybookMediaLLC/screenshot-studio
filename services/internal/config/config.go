package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Common struct {
	DatabaseURL string
	Port        int
}

type Backend struct {
	Common
	ServiceToken string
}

type Orchestrator struct {
	Common
	BatchSize       int
	MaxAttempts     int
	PollInterval    time.Duration
	PostizAPIURL    string
	ProviderTimeout time.Duration
	RetryDelay      time.Duration
	StaleAfter      time.Duration
	StorageAPIURL   string
	StorageBucket   string
	StorageKey      string
}

func LoadBackend() (Backend, error) {
	common, err := loadCommon(8080)
	if err != nil {
		return Backend{}, err
	}
	cfg := Backend{Common: common, ServiceToken: os.Getenv("PUBLISHING_SERVICE_TOKEN")}
	if cfg.ServiceToken == "" {
		return Backend{}, fmt.Errorf("PUBLISHING_SERVICE_TOKEN is required")
	}
	return cfg, nil
}

func LoadOrchestrator() (Orchestrator, error) {
	common, err := loadCommon(8081)
	if err != nil {
		return Orchestrator{}, err
	}
	cfg := Orchestrator{
		Common:          common,
		BatchSize:       envInt("PUBLISHING_BATCH_SIZE", 100),
		MaxAttempts:     envInt("PUBLISHING_MAX_ATTEMPTS", 3),
		PollInterval:    envDuration("PUBLISHING_POLL_INTERVAL", 5*time.Second),
		PostizAPIURL:    envString("POSTIZ_API_URL", "https://api.postiz.com/public/v1"),
		ProviderTimeout: envDuration("POSTIZ_REQUEST_TIMEOUT", 15*time.Second),
		RetryDelay:      envDuration("PUBLISHING_RETRY_DELAY", 2*time.Minute),
		StaleAfter:      envDuration("PUBLISHING_STALE_AFTER", 10*time.Minute),
		StorageAPIURL:   os.Getenv("STORAGE_API_URL"),
		StorageBucket:   os.Getenv("STORAGE_BUCKET"),
		StorageKey:      os.Getenv("STORAGE_SERVICE_KEY"),
	}
	if cfg.BatchSize < 1 || cfg.BatchSize > 1000 {
		return Orchestrator{}, fmt.Errorf("PUBLISHING_BATCH_SIZE must be between 1 and 1000")
	}
	if cfg.MaxAttempts < 1 || cfg.MaxAttempts > 10 {
		return Orchestrator{}, fmt.Errorf("PUBLISHING_MAX_ATTEMPTS must be between 1 and 10")
	}
	if cfg.PollInterval <= 0 || cfg.ProviderTimeout <= 0 || cfg.RetryDelay <= 0 || cfg.StaleAfter <= 0 {
		return Orchestrator{}, fmt.Errorf("publishing poll, timeout, retry, and stale durations must be positive")
	}
	if cfg.StorageAPIURL == "" || cfg.StorageBucket == "" || cfg.StorageKey == "" {
		return Orchestrator{}, fmt.Errorf("STORAGE_API_URL, STORAGE_BUCKET, and STORAGE_SERVICE_KEY are required")
	}
	return cfg, nil
}

func loadCommon(defaultPort int) (Common, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return Common{}, fmt.Errorf("DATABASE_URL is required")
	}
	return Common{
		DatabaseURL: databaseURL,
		Port:        envInt("PORT", defaultPort),
	}, nil
}

func envString(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
