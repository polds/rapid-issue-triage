package store

import "testing"

func TestNormalizeLinearTheme(t *testing.T) {
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"", "", true},
		{"  ", "", true},
		{"#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFFFFF", "#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFFFFF", true},
		{" ffffff , 44494d,#edeef3,#44494D,#475ba1,#FFFFFF ", "#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFFFFF", true},
		{"#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1", "", false},
		{"#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFFFFF,#000000", "", false},
		{"#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFF", "", false},
		{"#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#GGGGGG", "", false},
		{"#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,url(x)", "", false},
	}
	for _, c := range cases {
		got, err := NormalizeLinearTheme(c.in)
		if (err == nil) != c.ok {
			t.Fatalf("%q: ok=%v err=%v", c.in, c.ok, err)
		}
		if got != c.want {
			t.Fatalf("%q: got %q want %q", c.in, got, c.want)
		}
	}
}

func TestUIThemeRoundTrip(t *testing.T) {
	st := testStore(t)
	if got := st.GetUITheme(); got.Linear != "" {
		t.Fatalf("fresh store should have no theme: %+v", got)
	}
	saved, err := st.SetUITheme(UITheme{Linear: "ffffff,#44494D,#EDEEF3,#44494D,#475BA1,#FFFFFF"})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Linear != "#FFFFFF,#44494D,#EDEEF3,#44494D,#475BA1,#FFFFFF" {
		t.Fatalf("normalized: %q", saved.Linear)
	}
	if got := st.GetUITheme(); got != saved {
		t.Fatalf("round trip: %+v vs %+v", got, saved)
	}
	if _, err := st.SetUITheme(UITheme{Linear: "nope"}); err == nil {
		t.Fatal("expected invalid theme to be rejected")
	}
	if got := st.GetUITheme(); got != saved {
		t.Fatalf("rejected write must not clobber: %+v", got)
	}
	// A hand-corrupted row reads back as unset rather than as a stylesheet.
	if err := st.SetMeta("ui_theme", "javascript:alert(1)"); err != nil {
		t.Fatal(err)
	}
	if got := st.GetUITheme(); got.Linear != "" {
		t.Fatalf("corrupt row leaked: %+v", got)
	}
	if _, err := st.SetUITheme(UITheme{}); err != nil {
		t.Fatal(err)
	}
	if got := st.GetUITheme(); got.Linear != "" {
		t.Fatalf("clear failed: %+v", got)
	}
}
