// Package ipc carries the hello frame — the one message this contract specifies by
// name.
//
// Normative document: docs/spec/negotiation/v1/contract-version.md (RFC-0005). The
// frame's shape is frozen across every future contract major: a v1-only connector and
// a v2-only gateway must still read each other's hello in order to discover they share
// nothing, which is why its schema is published without a version segment.
package ipc

import (
	"bytes"
	"encoding/json"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
)

// HelloMessage is the frame's discriminator, so a gateway envelope can never be
// mistaken for a hello.
const HelloMessage = "hello"

// HelloResult is the outcome of reading one frame. Sealed by an unexported method.
type HelloResult interface{ isHelloResult() }

// HelloOk is a frame that parsed as a hello, announcing exactly these majors.
//
// ContractVersions preserves the order the frame declared, which is what the corpus
// pins. That order carries no meaning to the negotiation algorithm — §4 makes a
// declared set unordered — but reporting it faithfully is a parser's job.
type HelloOk struct{ ContractVersions []string }

// HelloRefused says why a frame is not a usable hello. One of the seven §5 reasons.
type HelloRefused struct{ Reason string }

func (HelloOk) isHelloResult()      {}
func (HelloRefused) isHelloResult() {}

type helloFrame struct {
	Nimbus           string   `json:"nimbus"`
	ContractVersions []string `json:"contractVersions"`
}

// EncodeHello returns the canonical hello frame for a set of majors, without its
// terminating LF.
//
// The LF belongs to the framing layer (spec/wire/v1/framing.md §3), so a caller
// composes this with whatever writes frames rather than getting a half-framed string.
//
// SetEscapeHTML(false) is explicit: json.Marshal escapes <, > and & by default, which
// no contract version can contain, but leaving it on would make the encoder's output
// depend on a rule the spec does not have.
func EncodeHello(versions []string) (string, error) {
	if versions == nil {
		versions = []string{}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(helloFrame{Nimbus: HelloMessage, ContractVersions: versions}); err != nil {
		return "", err
	}
	// Encode appends a newline; the framing layer owns that byte, not this function.
	return string(bytes.TrimRight(buf.Bytes(), "\n")), nil
}

// ParseHello reads one decoded frame as a hello.
//
// Takes a string rather than bytes so it composes with a line reader without depending
// on one. Refuses as a value and never returns an error: a binding in another language
// has no exceptions to mirror, and the corpus compares outcomes.
//
// Whitespace and member order are insignificant — this parses JSON, and a reader that
// compares bytes against the canonical form is non-conformant. Unknown members are
// ignored.
func ParseHello(frame string) HelloResult {
	var decoded any
	if err := json.Unmarshal([]byte(frame), &decoded); err != nil {
		return HelloRefused{Reason: "not-json"}
	}

	record, ok := decoded.(map[string]any)
	if !ok {
		return HelloRefused{Reason: "not-object"}
	}
	if record["nimbus"] != HelloMessage {
		return HelloRefused{Reason: "wrong-message"}
	}

	// An absent field and a present non-array read the same way: there is no array to
	// inspect.
	declared, isList := record["contractVersions"].([]any)
	if !isList {
		return HelloRefused{Reason: "missing-versions"}
	}
	if len(declared) == 0 {
		return HelloRefused{Reason: "empty-versions"}
	}

	versions := make([]string, 0, len(declared))
	seen := make(map[string]bool, len(declared))
	for _, member := range declared {
		// Validity before duplication, per member: a frame declaring ["01","01"] is
		// invalid-version, not duplicate-version.
		if !contract.IsContractVersion(member) {
			return HelloRefused{Reason: "invalid-version"}
		}
		s := member.(string)
		if seen[s] {
			return HelloRefused{Reason: "duplicate-version"}
		}
		seen[s] = true
		versions = append(versions, s)
	}
	return HelloOk{ContractVersions: versions}
}
