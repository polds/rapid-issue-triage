package server

import (
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

var errPickCanceled = errors.New("picker canceled")

// pickPath opens a native OS folder or file dialog and returns the POSIX
// (or Windows) path the user chose. Canceled dialogs return errPickCanceled.
func pickPath(kind string) (string, error) {
	switch runtime.GOOS {
	case "darwin":
		return pickDarwin(kind)
	case "linux":
		return pickLinux(kind)
	case "windows":
		return pickWindows(kind)
	default:
		return "", fmt.Errorf("native picker is not supported on %s", runtime.GOOS)
	}
}

func pickDarwin(kind string) (string, error) {
	chooser := "choose folder with prompt \"Select a repository directory\""
	if kind == "file" {
		chooser = "choose file with prompt \"Select the Claude Code binary\""
	}
	script := fmt.Sprintf(`
tell application "System Events" to activate
delay 0.15
try
	POSIX path of (%s)
on error number -128
	return ""
end try
`, chooser)
	cmd := exec.Command("osascript", "-e", script)
	out, err := cmd.Output()
	if err != nil {
		if canceled(err, string(out)) {
			return "", errPickCanceled
		}
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("folder picker: %s", firstLine(string(ee.Stderr)))
		}
		return "", fmt.Errorf("folder picker: %w", err)
	}
	p := strings.TrimSpace(string(out))
	if p == "" {
		return "", errPickCanceled
	}
	return strings.TrimSuffix(p, "/"), nil
}

func pickLinux(kind string) (string, error) {
	var cmd *exec.Cmd
	if _, err := exec.LookPath("zenity"); err == nil {
		args := []string{"--file-selection", "--title=Select a directory"}
		if kind == "folder" {
			args = append(args, "--directory")
		}
		cmd = exec.Command("zenity", args...)
	} else if _, err := exec.LookPath("kdialog"); err == nil {
		if kind == "folder" {
			cmd = exec.Command("kdialog", "--getexistingdirectory", ".")
		} else {
			cmd = exec.Command("kdialog", "--getopenfilename", ".")
		}
	} else {
		return "", fmt.Errorf("install zenity or kdialog to use the system folder picker")
	}
	out, err := cmd.Output()
	if err != nil {
		if canceled(err, string(out)) {
			return "", errPickCanceled
		}
		if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
			return "", errPickCanceled
		}
		return "", fmt.Errorf("folder picker: %w", err)
	}
	p := strings.TrimSpace(string(out))
	if p == "" {
		return "", errPickCanceled
	}
	return p, nil
}

func pickWindows(kind string) (string, error) {
	script := `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Select a repository directory'
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath } else { '' }
`
	if kind == "file" {
		script = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = 'Select the Claude Code binary'
$d.Filter = 'All files (*.*)|*.*'
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName } else { '' }
`
	}
	cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("folder picker: %w", err)
	}
	p := strings.TrimSpace(string(out))
	if p == "" {
		return "", errPickCanceled
	}
	return p, nil
}

func canceled(err error, out string) bool {
	msg := strings.ToLower(err.Error() + " " + out)
	return strings.Contains(msg, "user canceled") || strings.Contains(msg, "user cancelled")
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i > 0 {
		return s[:i]
	}
	return s
}
