package server

import "testing"

func TestLinearIssueURL(t *testing.T) {
	from := "https://linear.app/acme/issue/ENG-1234/some-slug"
	got := linearIssueURL("ENG-1834", from, "")
	want := "https://linear.app/acme/issue/ENG-1834"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if got := linearIssueURL("ENG-1", from, "https://linear.app/x/issue/ENG-1"); got != "https://linear.app/x/issue/ENG-1" {
		t.Fatalf("explicit: %q", got)
	}
	if linearIssueURL("ENG-1", "", "") != "" {
		t.Fatal("empty template should yield empty")
	}
}
