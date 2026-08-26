// rapid-issue-triage: a local-only, keyboard-first rapid triaging tool for
// Linear backlogs. Single binary; web UI embedded; sqlite index; optional
// Claude Code AI enrichment.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	webui "github.com/polds/rapid-issue-triage"
	"github.com/polds/rapid-issue-triage/internal/ai"
	"github.com/polds/rapid-issue-triage/internal/config"
	"github.com/polds/rapid-issue-triage/internal/linear"
	"github.com/polds/rapid-issue-triage/internal/server"
	"github.com/polds/rapid-issue-triage/internal/store"
	"github.com/polds/rapid-issue-triage/internal/syncer"
)

func main() {
	var (
		configPath = flag.String("config", "", "path to config file (default: ./rapid-triage.yaml, ~/.config/rapid-triage/config.yaml)")
		addr       = flag.String("addr", "", "listen address override (default from config, 127.0.0.1:7333)")
		noOpen     = flag.Bool("no-open", false, "do not open the browser on startup")
	)
	flag.Parse()

	if err := run(*configPath, *addr, *noOpen); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(configPath, addrOverride string, noOpen bool) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	if addrOverride != "" {
		cfg.Addr = addrOverride
	}
	apiKey, err := cfg.APIKey()
	if err != nil {
		return err
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("open db %s: %w", cfg.DBPath, err)
	}
	defer st.Close()

	lc := linear.New(apiKey)
	sy := syncer.New(lc, st, cfg.Filter, cfg.Sync.Interval, cfg.Sync.PageSize)

	var enricher *ai.Enricher
	if cfg.AI.Enabled {
		if _, err := exec.LookPath(cfg.AI.Command); err != nil {
			log.Printf("ai: %q not found in PATH; AI enrichment disabled", cfg.AI.Command)
		} else {
			enricher = &ai.Enricher{Command: cfg.AI.Command, Model: cfg.AI.Model, Timeout: cfg.AI.Timeout}
		}
	}

	srv := server.New(st, lc, sy, enricher)
	ui, err := webui.Dist()
	if err != nil {
		return fmt.Errorf("embedded ui: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go sy.Run(ctx)
	go srv.PrefetchEnrichments(ctx, cfg.AI.Prefetch)

	httpSrv := &http.Server{Addr: cfg.Addr, Handler: srv.Handler(ui)}
	errCh := make(chan error, 1)
	go func() { errCh <- httpSrv.ListenAndServe() }()

	url := "http://" + cfg.Addr
	log.Printf("rapid-triage listening on %s (db: %s)", url, cfg.DBPath)
	if !noOpen {
		openBrowser(url)
	}

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return httpSrv.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	default:
		return
	}
	if err := cmd.Start(); err != nil {
		log.Printf("open browser: %v", err)
	}
}
