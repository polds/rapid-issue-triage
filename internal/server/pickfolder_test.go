package server

import (
	"errors"
	"fmt"
	"testing"
)

func TestCanceledDetection(t *testing.T) {
	if !canceled(fmt.Errorf("osascript: user canceled"), "") {
		t.Fatal("expected user canceled")
	}
	if canceled(fmt.Errorf("osascript: execution error"), "nope") {
		t.Fatal("false positive")
	}
	if !errors.Is(errPickCanceled, errPickCanceled) {
		t.Fatal("sentinel")
	}
}
