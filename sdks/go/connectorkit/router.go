package connectorkit

import "context"

// Handler implements one tool.
type Handler func(context.Context, map[string]any) (MCPToolResult, error)

// Validator checks a tool's arguments. A non-nil error means invalid.
//
// This is Python's raise-to-fail contract in Go's spelling: there, validate signals
// failure by raising and the router turns it into an error result.
type Validator func(map[string]any) error

type registration struct {
	descriptor MCPToolDescriptor
	handler    Handler
	validate   Validator
}

// ToolRouter registers tools and dispatches calls to them.
//
// The zero value is ready to use. It imports no MCP package: ListTools and CallTool
// return the wire shapes from types.go, and a connector adapts them to whatever MCP
// library it uses. There is no such caller in this repository yet — Python's router has
// one because the scaffolder generates a Python connector, and there is no Go template.
// That changes when a Go template or a real Go connector arrives.
//
// CallTool NEVER returns an error, by design: an unknown tool, a failed validation and
// a handler error all become an error result, because a bad tool call must not kill the
// session. The detail is currently lost, which is deliberate and temporary — it belongs
// in a diagnostics event (see the Phase 3 box in docs/ROADMAP.md).
//
// Add is different. A duplicate name is a bug in the connector's own startup path, not
// a runtime call, so it is returned as an error and should be loud.
//
// A ToolRouter is not safe for concurrent Add; register every tool before serving.
// Concurrent CallTool is safe once registration has finished.
type ToolRouter struct {
	byName map[string]registration
	order  []string
}

// Add registers one tool. validate may be nil, which means no validation.
//
// A third parameter rather than a variadic option, because nil-selects-the-default is
// already this package's convention: RequireEnv(name, nil) selects os.Getenv, and
// MakeRESTFetcher(cfg, nil) selects the default transport.
func (r *ToolRouter) Add(descriptor MCPToolDescriptor, handler Handler, validate Validator) error {
	if r.byName == nil {
		r.byName = make(map[string]registration)
	}
	if _, exists := r.byName[descriptor.Name]; exists {
		return &Error{Message: "connectorkit: tool " + descriptor.Name + " is already registered"}
	}
	r.byName[descriptor.Name] = registration{descriptor, handler, validate}
	r.order = append(r.order, descriptor.Name)
	return nil
}

// ListTools returns every registered tool, in registration order.
//
// The order slice exists because a Go map has none, and ranging one would return the
// tools in a different sequence on every call — the same rootless-ordering problem that
// makes JSONResult's key ordering a documented divergence rather than a bug.
func (r *ToolRouter) ListTools() []MCPToolDescriptor {
	tools := make([]MCPToolDescriptor, 0, len(r.order))
	for _, name := range r.order {
		tools = append(tools, r.byName[name].descriptor)
	}
	return tools
}

// CallTool dispatches one call. It never returns an error — see the type's docs.
func (r *ToolRouter) CallTool(ctx context.Context, name string, args map[string]any) MCPToolResult {
	entry, found := r.byName[name]
	if !found {
		return ErrorResult("unknown tool " + name)
	}
	// Copied, so a handler cannot mutate the caller's map.
	local := make(map[string]any, len(args))
	for key, value := range args {
		local[key] = value
	}
	if entry.validate != nil {
		if err := entry.validate(local); err != nil {
			return ErrorResult(err.Error())
		}
	}
	result, err := entry.handler(ctx, local)
	if err != nil {
		return ErrorResult(err.Error())
	}
	return result
}
