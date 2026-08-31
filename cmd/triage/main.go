// rapid-issue-triage: a local-only, keyboard-first rapid triaging tool for
// Linear backlogs. Single binary; web UI embedded; sqlite index; optional
// Claude Code AI enrichment.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
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
	"github.com/polds/rapid-issue-triage/internal/deep"
	"github.com/polds/rapid-issue-triage/internal/linear"
	"github.com/polds/rapid-issue-triage/internal/server"
	"github.com/polds/rapid-issue-triage/internal/store"
	"github.com/polds/rapid-issue-triage/internal/syncer"
)

// Filled by GoReleaser via -ldflags.
var (
	version = "dev"
	commit  = ""
	date    = ""
)

func main() {
	// `triage tool <tool> <args...>`: the shim scouts call. Talks to the
	// running server's toolbox endpoint; never touches anything directly.
	if len(os.Args) > 1 && os.Args[1] == "tool" {
		os.Exit(toolClient(os.Args[2:]))
	}
	var (
		configPath  = flag.String("config", "", "path to config file (default: ./rapid-triage.yaml, ~/.config/rapid-triage/config.yaml)")
		addr        = flag.String("addr", "", "listen address override (default from config, 127.0.0.1:7333)")
		noOpen      = flag.Bool("no-open", false, "do not open the browser on startup")
		showVersion = flag.Bool("version", false, "print version and exit")
	)
	flag.Parse()
	if *showVersion {
		switch {
		case commit != "" && date != "":
			fmt.Printf("triage %s (%s, %s)\n", version, commit, date)
		case commit != "":
			fmt.Printf("triage %s (%s)\n", version, commit)
		default:
			fmt.Printf("triage %s\n", version)
		}
		return
	}

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
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("open db %s: %w", cfg.DBPath, err)
	}
	defer st.Close()

	apiKey, err := cfg.APIKey()
	if err != nil {
		if k := st.GetSecrets().LinearAPIKey; k != "" {
			apiKey = k
			err = nil
		}
	}
	if err != nil {
		return err
	}

	lc := linear.New(apiKey)
	sy := syncer.New(lc, st, cfg.Filter, cfg.Sync.Interval, cfg.Sync.PageSize)

	var enricher *ai.Enricher
	var orch *deep.Orchestrator
	if cfg.AI.Enabled {
		cmd := cfg.AI.Command
		if p := st.GetEnrichSettings().ClaudePath; p != "" {
			cmd = p
		}
		enricher = &ai.Enricher{Command: cmd, Model: cfg.AI.Model, Timeout: cfg.AI.Timeout}
		toolbox := &deep.Toolbox{Linear: lc, Store: st}
		orch, err = deep.NewOrchestrator(st, toolbox, cmd, cfg.AI.Model, cfg.AI.Timeout, cfg.Addr, cfg.AI.MaxConcurrent)
		if err != nil {
			log.Printf("deep enrichment disabled: %v", err)
			orch = nil
		}
		if _, err := exec.LookPath(cmd); err != nil {
			log.Printf("ai: %q not found; set the Claude path in Settings", cmd)
		}
	}

	srv := server.New(st, lc, sy, enricher, orch, cfg.AI.Command)
	ui, err := webui.Dist()
	if err != nil {
		return fmt.Errorf("embedded ui: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go sy.Run(ctx)
	go srv.PrefetchEnrichments(ctx, cfg.AI.Prefetch)

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(ui),
		ReadHeaderTimeout: 10 * time.Second,
	}
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

// toolClient implements the `triage tool` shim: POST the call to the local
// server's toolbox and print the JSON result.
func toolClient(args []string) int {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: triage-tool <tool> [args...] (e.g. triage-tool linear.search foo)")
		return 2
	}
	url := os.Getenv("RT_TOOLBOX_URL")
	token := os.Getenv("RT_RUN_TOKEN")
	if url == "" || token == "" {
		fmt.Fprintln(os.Stderr, "triage-tool: RT_TOOLBOX_URL/RT_RUN_TOKEN not set (must run inside an enrichment)")
		return 2
	}
	body, _ := json.Marshal(map[string]any{
		"token": token,
		"agent": os.Getenv("RT_AGENT"),
		"tool":  args[0],
		"args":  args[1:],
	})
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "triage-tool: %v\n", err)
		return 1
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	os.Stdout.Write(out)
	fmt.Println()
	if resp.StatusCode >= 400 {
		return 1
	}
	return 0
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
