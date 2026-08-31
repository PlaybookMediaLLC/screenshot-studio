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

type Temporal struct {
	APIKey            string
	ActivityTaskQueue string
	Address           string
	Namespace         string
	TLS               bool
	WorkflowTaskQueue string
}

type Backend struct {
	Common
	Temporal
	ActivityTimeout time.Duration
	MaxAttempts     int
	RetryDelay      time.Duration
	ServiceToken    string
}

type Orchestrator struct {
	Common
	Temporal
	ActivityConcurrency int
	PostizAPIURL        string
	ProviderTimeout     time.Duration
	StorageAPIURL       string
	StorageBucket       string
	StorageKey          string
}

func LoadBackend() (Backend, error) {
	common, err := loadCommon(8080)
	if err != nil {
		return Backend{}, err
	}
	temporal, err := loadTemporal()
	if err != nil {
		return Backend{}, err
	}
	cfg := Backend{
		Common: common, Temporal: temporal,
		ActivityTimeout: envDuration("PUBLISHING_ACTIVITY_TIMEOUT", 30*time.Second),
		MaxAttempts:     envInt("PUBLISHING_MAX_ATTEMPTS", 3),
		RetryDelay:      envDuration("PUBLISHING_RETRY_DELAY", 2*time.Minute),
		ServiceToken:    os.Getenv("PUBLISHING_SERVICE_TOKEN"),
	}
	if cfg.ServiceToken == "" {
		return Backend{}, fmt.Errorf("PUBLISHING_SERVICE_TOKEN is required")
	}
	if cfg.MaxAttempts < 1 || cfg.MaxAttempts > 10 {
		return Backend{}, fmt.Errorf("PUBLISHING_MAX_ATTEMPTS must be between 1 and 10")
	}
	if cfg.ActivityTimeout <= 0 || cfg.RetryDelay <= 0 {
		return Backend{}, fmt.Errorf("publishing activity timeout and retry delay must be positive")
	}
	return cfg, nil
}

func LoadOrchestrator() (Orchestrator, error) {
	common, err := loadCommon(8081)
	if err != nil {
		return Orchestrator{}, err
	}
	temporal, err := loadTemporal()
	if err != nil {
		return Orchestrator{}, err
	}
	cfg := Orchestrator{
		Common: common, Temporal: temporal,
		ActivityConcurrency: envInt("TEMPORAL_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTORS", 10),
		PostizAPIURL:        envString("POSTIZ_API_URL", "https://api.postiz.com/public/v1"),
		ProviderTimeout:     envDuration("POSTIZ_REQUEST_TIMEOUT", 15*time.Second),
		StorageAPIURL:       os.Getenv("STORAGE_API_URL"), StorageBucket: os.Getenv("STORAGE_BUCKET"), StorageKey: os.Getenv("STORAGE_SERVICE_KEY"),
	}
	if cfg.ActivityConcurrency < 1 || cfg.ActivityConcurrency > 1000 {
		return Orchestrator{}, fmt.Errorf("TEMPORAL_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTORS must be between 1 and 1000")
	}
	if cfg.ProviderTimeout <= 0 {
		return Orchestrator{}, fmt.Errorf("POSTIZ_REQUEST_TIMEOUT must be positive")
	}
	if cfg.StorageAPIURL == "" || cfg.StorageBucket == "" || cfg.StorageKey == "" {
		return Orchestrator{}, fmt.Errorf("STORAGE_API_URL, STORAGE_BUCKET, and STORAGE_SERVICE_KEY are required")
	}
	return cfg, nil
}

func loadTemporal() (Temporal, error) {
	tlsEnabled := false
	if raw := os.Getenv("TEMPORAL_TLS"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return Temporal{}, fmt.Errorf("TEMPORAL_TLS must be true or false")
		}
		tlsEnabled = parsed
	}
	return Temporal{
		APIKey:            os.Getenv("TEMPORAL_API_KEY"),
		ActivityTaskQueue: envString("TEMPORAL_POSTIZ_TASK_QUEUE", "postiz"),
		Address:           envString("TEMPORAL_ADDRESS", "127.0.0.1:7233"),
		Namespace:         envString("TEMPORAL_NAMESPACE", "default"),
		TLS:               tlsEnabled,
		WorkflowTaskQueue: envString("TEMPORAL_TASK_QUEUE", "main"),
	}, nil
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
