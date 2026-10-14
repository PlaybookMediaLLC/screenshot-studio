// Command combined-backend runs the social API, social Temporal worker, and
// tenant publishing/maintenance worker in one App Platform service.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

const tenantPrefix = "TENANT_"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		slog.Error("combined backend stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	if os.Getenv("RUN_WORKER") != "true" {
		return errors.New("RUN_WORKER=true is required for the social worker")
	}
	tenantEnv, err := publishingEnv(os.Environ())
	if err != nil {
		return err
	}
	children := []*exec.Cmd{
		exec.Command("/screenshot-studio-backend"),
		exec.Command("/publishing-orchestrator"),
		exec.Command("/publishing-backend"),
	}
	children[0].Env = os.Environ()
	children[1].Env = tenantEnv
	children[2].Env = withPort(tenantEnv, "8082")
	started := make([]*exec.Cmd, 0, len(children))
	for _, child := range children {
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if err := child.Start(); err != nil {
			terminate(started)
			for _, running := range started {
				_ = running.Wait()
			}
			return fmt.Errorf("start %s: %w", child.Path, err)
		}
		started = append(started, child)
		slog.Info("started backend process", "process", child.Path, "pid", child.Process.Pid)
	}

	server := &http.Server{Addr: ":3003", Handler: readinessHandler(), ReadHeaderTimeout: 5 * time.Second}
	serverErr := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()
	childExit := make(chan error, len(children))
	for _, child := range children {
		go func(child *exec.Cmd) {
			childExit <- fmt.Errorf("%s exited: %w", child.Path, child.Wait())
		}(child)
	}
	var reason error
	exited := 0
	select {
	case reason = <-childExit:
		exited++
	case reason = <-serverErr:
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = server.Shutdown(shutdownCtx)
	cancel()
	terminate(children)
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	for exited < len(children) {
		select {
		case <-childExit:
			exited++
		case <-timer.C:
			for _, child := range children {
				_ = child.Process.Kill()
			}
			for exited < len(children) {
				<-childExit
				exited++
			}
		}
	}
	if reason != nil {
		return reason
	}
	return nil
}

func publishingEnv(environ []string) ([]string, error) {
	result := []string{"TZ=UTC"}
	for _, item := range environ {
		key, value, ok := strings.Cut(item, "=")
		if !ok || !strings.HasPrefix(key, tenantPrefix) {
			continue
		}
		name := strings.TrimPrefix(key, tenantPrefix)
		if name != "PORT" {
			result = append(result, name+"="+value)
		}
	}
	result = append(result, "PORT=8081")
	for _, key := range []string{"DATABASE_URL", "TEMPORAL_ADDRESS", "TEMPORAL_NAMESPACE", "AUDIT_RETENTION_DATABASE_URL", "PUBLISHING_SERVICE_TOKEN"} {
		if !hasEnv(result, key) {
			return nil, fmt.Errorf("TENANT_%s is required", key)
		}
	}
	for _, key := range []string{"RUN_MAINTENANCE", "RUN_CRON"} {
		if !hasValue(result, key, "true") {
			return nil, fmt.Errorf("TENANT_%s=true is required", key)
		}
	}
	if hasValue(result, "PUBLISHING_DIRECT_PROVIDER", "true") {
		socialURL := envValue(environ, "DATABASE_URL")
		tenantURL := envValue(result, "DATABASE_URL")
		if !sameLogicalDatabase(socialURL, tenantURL) {
			return nil, errors.New("direct publishing requires social and tenant Ent clients to use one PostgreSQL database")
		}
	}
	return result, nil
}

func envValue(environ []string, key string) string {
	for _, item := range environ {
		if value, ok := strings.CutPrefix(item, key+"="); ok {
			return value
		}
	}
	return ""
}

func sameLogicalDatabase(first, second string) bool {
	a, errA := url.Parse(first)
	b, errB := url.Parse(second)
	if errA != nil || errB != nil || a.Scheme == "" || b.Scheme == "" || a.Hostname() == "" || b.Hostname() == "" || a.Path == "" || b.Path == "" {
		return false
	}
	port := func(u *url.URL) string {
		if u.Port() != "" {
			return u.Port()
		}
		return "5432"
	}
	return strings.EqualFold(a.Hostname(), b.Hostname()) && port(a) == port(b) && a.Path == b.Path &&
		a.Query().Get("search_path") == b.Query().Get("search_path")
}

func withPort(environ []string, port string) []string {
	result := make([]string, 0, len(environ))
	for _, item := range environ {
		if strings.HasPrefix(item, "PORT=") {
			result = append(result, "PORT="+port)
		} else {
			result = append(result, item)
		}
	}
	return result
}

func hasEnv(environ []string, key string) bool {
	for _, item := range environ {
		if strings.HasPrefix(item, key+"=") && len(item) > len(key)+1 {
			return true
		}
	}
	return false
}

func hasValue(environ []string, key, value string) bool {
	for _, item := range environ {
		if item == key+"="+value {
			return true
		}
	}
	return false
}

func terminate(children []*exec.Cmd) {
	for _, child := range children {
		if child.Process != nil {
			_ = child.Process.Signal(syscall.SIGTERM)
		}
	}
}

func readinessHandler() http.Handler {
	client := &http.Client{Timeout: 7 * time.Second}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/readyz" {
			http.NotFound(w, r)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		endpoints := []string{"http://127.0.0.1:3000/", "http://127.0.0.1:3002/health/status", "http://127.0.0.1:8081/readyz", "http://127.0.0.1:8082/readyz"}
		results := make(chan bool, len(endpoints))
		var checks sync.WaitGroup
		for _, endpoint := range endpoints {
			checks.Add(1)
			go func() {
				defer checks.Done()
				request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
				response, err := client.Do(request)
				if err != nil {
					results <- false
					return
				}
				_ = response.Body.Close()
				results <- response.StatusCode == http.StatusOK
			}()
		}
		checks.Wait()
		close(results)
		for ready := range results {
			if !ready {
				http.Error(w, "backend component unavailable", http.StatusServiceUnavailable)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})
}
