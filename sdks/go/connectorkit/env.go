package connectorkit

import "os"

// RequireEnv returns env(name), or a *MissingEnvError when it is unset or empty.
//
// env is the replaceable seam docs/INCLUSION-POLICY.md §2 requires: a helper that reads
// the process environment with no way to override it fails criterion 2, which is exactly
// what TypeScript's requireProcessEnv does. Passing nil selects os.Getenv, so the common
// call is RequireEnv("API_TOKEN", nil) and the seam costs a caller nothing until they
// want it.
//
// func(string) string rather than Python's Mapping: os.Getenv already has this signature,
// so the stdlib supplies the default for free, and a read-only function gives a caller no
// seam that invites writing to the environment.
//
// An empty string counts as unset, matching Python and TypeScript.
func RequireEnv(name string, env func(string) string) (string, error) {
	if env == nil {
		env = os.Getenv
	}
	value := env(name)
	if value == "" {
		return "", &MissingEnvError{Name: name}
	}
	return value, nil
}
