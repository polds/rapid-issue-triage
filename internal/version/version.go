// Package version carries this binary's build stamp and knows how to order
// two release versions. It is a leaf: stdlib only, so anything may import it.
//
// GoReleaser stamps `main.version`/`main.commit`/`main.date` through -ldflags.
// A plain `go build` or `go install` stamps nothing, so Resolve falls back to
// the VCS and module information the toolchain embeds instead — a developer
// build then still reports a commit rather than a bare "dev".
package version

import (
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
)

// Dev is the version a build carries when nothing stamped one.
const Dev = "dev"

// Info is the build stamp, and the JSON body of GET /api/version. Its tags are
// the frontend's contract (web/src/lib/types.ts).
type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit,omitempty"`
	Date    string `json:"date,omitempty"`
	// Dev is true for an unreleased build. Nothing is ever "newer" than one,
	// so the update check reports no update rather than a bogus downgrade.
	Dev bool `json:"dev"`
}

// Resolve normalizes the ldflags stamp into an Info, filling the gaps from the
// build info Go embeds. Call it once, at startup, and pass the result down.
func Resolve(version, commit, date string) Info {
	info := Info{Version: strings.TrimSpace(version), Commit: strings.TrimSpace(commit), Date: strings.TrimSpace(date)}
	if bi, ok := debug.ReadBuildInfo(); ok {
		info = fillFromBuildInfo(info, bi)
	}
	if info.Version == "" {
		info.Version = Dev
	}
	if len(info.Commit) > 12 {
		info.Commit = info.Commit[:12]
	}
	info.Dev = Parse(info.Version) == nil
	return info
}

// pseudoVersion matches the vX.Y.Z-<timestamp>-<12 hex> form the toolchain
// synthesizes for a build that is not at a tag. It looks like a release and is
// not one, so it is rejected in favor of "dev".
var pseudoVersion = regexp.MustCompile(`[-.][0-9]{14}-[0-9a-f]{12}(\+[0-9A-Za-z.-]+)?$`)

// fillFromBuildInfo takes the module version and the VCS stamp for whatever
// -ldflags did not supply. `go install module@v1.2.3` records the tag in
// Main.Version; `go build` inside a checkout records vcs.revision/vcs.time but
// only a synthesized pseudo-version, which is no better than "dev".
func fillFromBuildInfo(i Info, bi *debug.BuildInfo) Info {
	if i.Version == "" || i.Version == Dev {
		if v := bi.Main.Version; v != "" && v != "(devel)" && !pseudoVersion.MatchString(v) {
			i.Version = v
		}
	}
	for _, s := range bi.Settings {
		switch s.Key {
		case "vcs.revision":
			if i.Commit == "" {
				i.Commit = s.Value
			}
		case "vcs.time":
			if i.Date == "" {
				i.Date = s.Value
			}
		}
	}
	return i
}

// String renders the stamp the way `triage -version` prints it.
func (i Info) String() string {
	out := "triage " + i.Version
	switch {
	case i.Commit != "" && i.Date != "":
		out += " (" + i.Commit + ", " + i.Date + ")"
	case i.Commit != "":
		out += " (" + i.Commit + ")"
	}
	return out
}

// Semver is a parsed release version. Build metadata is dropped: semver says
// it takes no part in precedence.
type Semver struct {
	Major, Minor, Patch int
	Pre                 string
}

// Parse reads a "v1.2.3", "1.2", or "v1.2.3-rc.1+build" style version. It
// returns nil for anything that is not a release version — "dev", a bare
// commit, or a snapshot — which is how callers detect an unreleased build.
func Parse(s string) *Semver {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "v")
	if s == "" {
		return nil
	}
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	var pre string
	if i := strings.IndexByte(s, '-'); i >= 0 {
		s, pre = s[:i], s[i+1:]
	}
	parts := strings.Split(s, ".")
	if len(parts) > 3 {
		return nil
	}
	nums := [3]int{}
	for idx, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil
		}
		nums[idx] = n
	}
	return &Semver{Major: nums[0], Minor: nums[1], Patch: nums[2], Pre: pre}
}

// Compare orders two parsed versions: -1 if a sorts before b, 0 if equal,
// 1 if after. A prerelease sorts before the release it leads to (semver §11).
func Compare(a, b Semver) int {
	for _, p := range [][2]int{{a.Major, b.Major}, {a.Minor, b.Minor}, {a.Patch, b.Patch}} {
		if p[0] != p[1] {
			return sign(p[0] - p[1])
		}
	}
	switch {
	case a.Pre == b.Pre:
		return 0
	case a.Pre == "":
		return 1
	case b.Pre == "":
		return -1
	}
	return comparePre(a.Pre, b.Pre)
}

// comparePre orders dot-separated prerelease identifiers: numeric ones compare
// numerically and sort below alphanumeric ones; a shorter prefix sorts first.
func comparePre(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(as) && i < len(bs); i++ {
		if as[i] == bs[i] {
			continue
		}
		an, aErr := strconv.Atoi(as[i])
		bn, bErr := strconv.Atoi(bs[i])
		switch {
		case aErr == nil && bErr == nil:
			return sign(an - bn)
		case aErr == nil:
			return -1
		case bErr == nil:
			return 1
		}
		return sign(strings.Compare(as[i], bs[i]))
	}
	return sign(len(as) - len(bs))
}

func sign(n int) int {
	switch {
	case n < 0:
		return -1
	case n > 0:
		return 1
	}
	return 0
}

// IsNewer reports whether latest is a strictly newer release than current.
// Either side failing to parse means no: an unreleased local build is never
// "out of date", and a tag we cannot read is never an upgrade.
func IsNewer(latest, current string) bool {
	l, c := Parse(latest), Parse(current)
	if l == nil || c == nil {
		return false
	}
	return Compare(*l, *c) > 0
}
