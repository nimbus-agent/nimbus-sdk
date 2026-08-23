package connectorkit

import (
	"context"
	"errors"
	"strings"
	"testing"
)

var schema = map[string]any{"type": "object"}

func echoHandler(_ context.Context, args map[string]any) (MCPToolResult, error) {
	return JSONResult(args)
}

func TestListToolsReturnsTheWireShape(t *testing.T) {
	var r ToolRouter
	if err := r.Add(MCPToolDescriptor{Name: "echo", Description: "Echo it back", InputSchema: schema}, echoHandler, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	tools := r.ListTools()
	if len(tools) != 1 || tools[0].Name != "echo" || tools[0].Description != "Echo it back" {
		t.Fatalf("ListTools() = %#v", tools)
	}
}

// A Go map has no order, so the router must keep its own. Registration order is what
// Python's dict gives for free and what a reader expects from tools/list.
func TestListToolsPreservesRegistrationOrder(t *testing.T) {
	var r ToolRouter
	for _, name := range []string{"b", "a", "c"} {
		if err := r.Add(MCPToolDescriptor{Name: name, InputSchema: schema}, echoHandler, nil); err != nil {
			t.Fatalf("Add(%q): %v", name, err)
		}
	}
	got := []string{}
	for _, tool := range r.ListTools() {
		got = append(got, tool.Name)
	}
	if len(got) != 3 || got[0] != "b" || got[1] != "a" || got[2] != "c" {
		t.Errorf("order = %v, want [b a c]", got)
	}
}

func TestCallToolDispatches(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, echoHandler, nil)
	out := r.CallTool(context.Background(), "echo", map[string]any{"text": "hi"})
	if out.IsError {
		t.Fatalf("unexpected error result: %#v", out)
	}
}

// A bad tool call must not kill the session, so CallTool returns no error at all.
func TestAnUnknownToolIsAnErrorResult(t *testing.T) {
	var r ToolRouter
	out := r.CallTool(context.Background(), "nope", nil)
	if !out.IsError {
		t.Fatal("want IsError")
	}
	if len(out.Content) == 0 || !strings.Contains(out.Content[0].Text, "nope") {
		t.Errorf("Content = %#v", out.Content)
	}
}

func TestAHandlerErrorBecomesAnErrorResult(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "boom", InputSchema: schema},
		func(context.Context, map[string]any) (MCPToolResult, error) {
			return MCPToolResult{}, errors.New("handler exploded")
		}, nil)
	out := r.CallTool(context.Background(), "boom", nil)
	if !out.IsError || out.Content[0].Text != "handler exploded" {
		t.Errorf("out = %#v", out)
	}
}

func TestAValidatorErrorBecomesAnErrorResultAndTheHandlerDoesNotRun(t *testing.T) {
	ran := false
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(context.Context, map[string]any) (MCPToolResult, error) {
			ran = true
			return JSONResult(nil)
		},
		func(map[string]any) error { return errors.New("text must be a string") })
	out := r.CallTool(context.Background(), "echo", map[string]any{"text": 7})
	if !out.IsError || out.Content[0].Text != "text must be a string" {
		t.Errorf("out = %#v", out)
	}
	if ran {
		t.Error("the handler ran despite a failed validation")
	}
}

// InputSchema is advertised, never enforced: this package is dependency-free and
// carries no JSON Schema implementation. Pretending otherwise would be worse than
// saying so — an author would trust a check that was not happening.
func TestANilValidatorMeansNoValidation(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: map[string]any{
		"type": "object", "required": []any{"text"},
	}}, echoHandler, nil)
	out := r.CallTool(context.Background(), "echo", map[string]any{"unexpected": 1})
	if out.IsError {
		t.Errorf("schema was enforced: %#v", out)
	}
}

func TestTheHandlerCannotMutateTheCallersArguments(t *testing.T) {
	supplied := map[string]any{"text": "hi"}
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(_ context.Context, args map[string]any) (MCPToolResult, error) {
			args["text"] = "clobbered"
			return JSONResult(nil)
		}, nil)
	r.CallTool(context.Background(), "echo", supplied)
	if supplied["text"] != "hi" {
		t.Errorf("caller's map was mutated: %v", supplied)
	}
}

func TestNilArgumentsBecomeAnEmptyMap(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(_ context.Context, args map[string]any) (MCPToolResult, error) {
			if args == nil {
				return MCPToolResult{}, errors.New("args was nil")
			}
			return JSONResult(nil)
		}, nil)
	if out := r.CallTool(context.Background(), "echo", nil); out.IsError {
		t.Errorf("out = %#v", out)
	}
}

func TestTheContextReachesTheHandler(t *testing.T) {
	type key struct{}
	var seen any
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(ctx context.Context, _ map[string]any) (MCPToolResult, error) {
			seen = ctx.Value(key{})
			return JSONResult(nil)
		}, nil)
	r.CallTool(context.WithValue(context.Background(), key{}, "v"), "echo", nil)
	if seen != "v" {
		t.Errorf("context value = %v", seen)
	}
}

// A bug in the connector's own startup path, not a runtime call, so it is reported
// rather than swallowed into an error result.
func TestADuplicateNameIsAnError(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, echoHandler, nil)
	err := r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, echoHandler, nil)
	if err == nil {
		t.Fatal("want an error on a duplicate name")
	}
	if !errors.Is(err, ErrConnectorKit) {
		t.Errorf("want a kit error, got %v", err)
	}
}

// var r ToolRouter, no constructor. Go callers expect that of a struct with only a map
// inside, and Add is what lazily creates it.
func TestTheZeroToolRouterIsUsable(t *testing.T) {
	var r ToolRouter
	if got := r.ListTools(); len(got) != 0 {
		t.Errorf("ListTools() = %v", got)
	}
	if out := r.CallTool(context.Background(), "x", nil); !out.IsError {
		t.Error("want an error result from an empty router")
	}
}

// Handler is a function type, so nil is a value a caller can pass. Stored unchecked it
// panics inside CallTool — which is the one thing the router promises not to do, and it
// takes the session down with it rather than returning the documented error result.
// Rejected at registration instead, where a wiring mistake belongs.
func TestANilHandlerIsRejectedAtRegistration(t *testing.T) {
	var r ToolRouter
	err := r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, nil, nil)
	if err == nil {
		t.Fatal("want an error for a nil handler")
	}
	if !errors.Is(err, ErrConnectorKit) {
		t.Errorf("want a kit error, got %v", err)
	}
	if !strings.Contains(err.Error(), "echo") {
		t.Errorf("the error should name the tool: %q", err.Error())
	}
}

func TestANilHandlerLeavesTheRouterUnchanged(t *testing.T) {
	// A rejected registration must not half-land: no descriptor in ListTools, and the
	// name still free for a later, valid Add.
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, nil, nil)
	if got := r.ListTools(); len(got) != 0 {
		t.Fatalf("ListTools() = %#v after a rejected Add", got)
	}
	if err := r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, echoHandler, nil); err != nil {
		t.Fatalf("the name should still be free: %v", err)
	}
	if out := r.CallTool(context.Background(), "echo", nil); out.IsError {
		t.Errorf("out = %#v", out)
	}
}
