package version

import "testing"

func TestParse(t *testing.T) {
	cases := []struct {
		in   string
		want *Semver
	}{
		{"v0.1.1", &Semver{Major: 0, Minor: 1, Patch: 1}},
		{"1.2.3", &Semver{Major: 1, Minor: 2, Patch: 3}},
		{"v2.0", &Semver{Major: 2}},
		{"v1.2.3-rc.1", &Semver{Major: 1, Minor: 2, Patch: 3, Pre: "rc.1"}},
		{"v1.2.3+meta", &Semver{Major: 1, Minor: 2, Patch: 3}},
		{"  v1.2.3  ", &Semver{Major: 1, Minor: 2, Patch: 3}},
		{"dev", nil},
		{"", nil},
		{"v", nil},
		{"1.2.3.4", nil},
		{"v1.x.3", nil},
		{"v-1.2.3", nil},
		{"abc1234-snapshot", nil},
	}
	for _, c := range cases {
		got := Parse(c.in)
		switch {
		case c.want == nil && got != nil:
			t.Errorf("Parse(%q) = %+v, want nil", c.in, *got)
		case c.want != nil && got == nil:
			t.Errorf("Parse(%q) = nil, want %+v", c.in, *c.want)
		case c.want != nil && *got != *c.want:
			t.Errorf("Parse(%q) = %+v, want %+v", c.in, *got, *c.want)
		}
	}
}

func TestCompareAndIsNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.0.0", "v1.0.0", 0},
		{"v1.0.1", "v1.0.0", 1},
		{"v1.1.0", "v1.0.9", 1},
		{"v2.0.0", "v1.9.9", 1},
		{"v0.1.0", "v0.1.1", -1},
		{"v1.0.0", "v1.0.0-rc.1", 1},
		{"v1.0.0-rc.1", "v1.0.0", -1},
		{"v1.0.0-rc.1", "v1.0.0-rc.2", -1},
		{"v1.0.0-rc.2", "v1.0.0-rc.10", -1},
		{"v1.0.0-alpha", "v1.0.0-beta", -1},
		{"v1.0.0-rc.1", "v1.0.0-rc", 1},
		{"v1.0.0-1", "v1.0.0-alpha", -1},
		{"v1.0.0-alpha", "v1.0.0-1", 1},
	}
	for _, c := range cases {
		a, b := Parse(c.a), Parse(c.b)
		if a == nil || b == nil {
			t.Fatalf("fixture does not parse: %q / %q", c.a, c.b)
		}
		if got := Compare(*a, *b); got != c.want {
			t.Errorf("Compare(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
		if got := IsNewer(c.a, c.b); got != (c.want > 0) {
			t.Errorf("IsNewer(%q, %q) = %v, want %v", c.a, c.b, got, c.want > 0)
		}
	}
}

// An unreleased build is never out of date, and an unreadable tag is never an
// upgrade — both sides must parse before anything is offered to the user.
func TestIsNewerRejectsUnparseable(t *testing.T) {
	for _, c := range [][2]string{
		{"v9.9.9", "dev"},
		{"v9.9.9", ""},
		{"nightly", "v0.1.0"},
		{"", "v0.1.0"},
	} {
		if IsNewer(c[0], c[1]) {
			t.Errorf("IsNewer(%q, %q) = true, want false", c[0], c[1])
		}
	}
}

func TestResolveStamped(t *testing.T) {
	got := Resolve("v0.1.1", "0123456789abcdef0123", "2026-08-28T00:00:00Z")
	if got.Version != "v0.1.1" {
		t.Errorf("Version = %q, want v0.1.1", got.Version)
	}
	if got.Commit != "0123456789ab" {
		t.Errorf("Commit = %q, want the 12-char short form", got.Commit)
	}
	if got.Dev {
		t.Error("Dev = true for a stamped release build")
	}
	if want := "triage v0.1.1 (0123456789ab, 2026-08-28T00:00:00Z)"; got.String() != want {
		t.Errorf("String() = %q, want %q", got.String(), want)
	}
}

// Nothing stamped: the version falls back to "dev" and the build is flagged as
// unreleased. Commit/date may or may not come from the embedded VCS stamp
// depending on how the test binary was built, so they are not asserted.
func TestResolveUnstamped(t *testing.T) {
	got := Resolve("", "", "")
	if got.Version == "" {
		t.Error("Version is empty; want a fallback")
	}
	if Parse(got.Version) == nil && !got.Dev {
		t.Errorf("Version %q does not parse but Dev = false", got.Version)
	}
}

func TestInfoString(t *testing.T) {
	cases := []struct {
		in   Info
		want string
	}{
		{Info{Version: "dev"}, "triage dev"},
		{Info{Version: "v1.0.0", Commit: "abc1234"}, "triage v1.0.0 (abc1234)"},
		{Info{Version: "v1.0.0", Date: "2026-01-01"}, "triage v1.0.0"},
	}
	for _, c := range cases {
		if got := c.in.String(); got != c.want {
			t.Errorf("String() = %q, want %q", got, c.want)
		}
	}
}

// A `go build` inside a checkout synthesizes a pseudo-version. It parses as a
// v0.0.0 prerelease, so taking it at face value would both show the user a
// version they never installed and offer them an "upgrade" to any real tag.
func TestPseudoVersionIsNotARelease(t *testing.T) {
	for _, v := range []string{
		"v0.0.0-20260831170347-5fc31f49c73e",
		"v0.0.0-20260831170347-5fc31f49c73e+dirty",
		"v1.2.4-0.20260831170347-5fc31f49c73e",
	} {
		if !pseudoVersion.MatchString(v) {
			t.Errorf("pseudoVersion did not match %q", v)
		}
	}
	for _, v := range []string{"v0.1.1", "v1.0.0-rc.1", "v1.0.0+meta"} {
		if pseudoVersion.MatchString(v) {
			t.Errorf("pseudoVersion matched the real version %q", v)
		}
	}
}
