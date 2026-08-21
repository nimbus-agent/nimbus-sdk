package connectorkit

import (
	"errors"
	"testing"
)

func TestRequireEnvReturnsTheValue(t *testing.T) {
	env := func(k string) string {
		if k == "API_TOKEN" {
			return "s3cret"
		}
		return ""
	}
	got, err := RequireEnv("API_TOKEN", env)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "s3cret" {
		t.Errorf("got %q, want %q", got, "s3cret")
	}
}

// An empty string counts as unset, matching Python and TypeScript.
func TestRequireEnvTreatsEmptyAsUnset(t *testing.T) {
	for _, value := range []string{"", ""} {
		_, err := RequireEnv("API_TOKEN", func(string) string { return value })
		var missing *MissingEnvError
		if !errors.As(err, &missing) {
			t.Fatalf("value %q: err = %v, want *MissingEnvError", value, err)
		}
		if missing.Name != "API_TOKEN" {
			t.Errorf("Name = %q, want API_TOKEN", missing.Name)
		}
		if got, want := err.Error(), "API_TOKEN is not set"; got != want {
			t.Errorf("message = %q, want %q", got, want)
		}
	}
}

// nil selects os.Getenv, so the seam is optional rather than mandatory at every call.
func TestRequireEnvDefaultsToTheProcessEnvironment(t *testing.T) {
	t.Setenv("NIMBUS_TEST_TOKEN", "from-os")
	got, err := RequireEnv("NIMBUS_TEST_TOKEN", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "from-os" {
		t.Errorf("got %q, want %q", got, "from-os")
	}
}
