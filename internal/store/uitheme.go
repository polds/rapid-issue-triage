package store

import (
	"fmt"
	"regexp"
	"strings"
)

// UITheme is the user's appearance override: a Linear custom-theme string,
// six comma-separated hex colors in Linear's own slot order —
// base background, base text, sidebar background, sidebar text, accent,
// accent text — the exact format linear.style hands out and Linear's
// Preferences → Theme → Custom accepts. Empty means the built-in palette.
//
// The frontend derives every design token from the six values; the server
// only validates the shape and persists it, so a garbage value never reaches
// a stylesheet.
type UITheme struct {
	Linear string `json:"linear"`
}

var hexColor = regexp.MustCompile(`^#?[0-9a-fA-F]{6}$`)

// NormalizeLinearTheme canonicalizes a Linear theme string to
// "#RRGGBB,#RRGGBB,…" (six upper-case entries) or returns an error saying
// which slot is wrong. Whitespace and a missing leading '#' are tolerated
// because the string is usually pasted.
func NormalizeLinearTheme(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 6 {
		return "", fmt.Errorf("a Linear theme has 6 colors, got %d", len(parts))
	}
	out := make([]string, 0, 6)
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if !hexColor.MatchString(p) {
			return "", fmt.Errorf("color %d (%q) is not a 6-digit hex value", i+1, p)
		}
		out = append(out, "#"+strings.ToUpper(strings.TrimPrefix(p, "#")))
	}
	return strings.Join(out, ","), nil
}

// GetUITheme returns the persisted appearance override, empty when unset.
func (s *Store) GetUITheme() UITheme {
	raw, err := s.GetMeta("ui_theme")
	if err != nil {
		return UITheme{}
	}
	norm, err := NormalizeLinearTheme(raw)
	if err != nil {
		return UITheme{}
	}
	return UITheme{Linear: norm}
}

// SetUITheme validates and persists the override; an empty string clears it.
func (s *Store) SetUITheme(t UITheme) (UITheme, error) {
	norm, err := NormalizeLinearTheme(t.Linear)
	if err != nil {
		return UITheme{}, err
	}
	if err := s.SetMeta("ui_theme", norm); err != nil {
		return UITheme{}, err
	}
	return UITheme{Linear: norm}, nil
}
