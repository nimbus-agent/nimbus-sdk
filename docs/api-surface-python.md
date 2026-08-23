# Python public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with `python scripts/api_surface.py` from `sdks/python/`,
     after `python -m pip install -e .`.
     A diff in this file is a change to the published contract and
     must carry the matching semver bump — see
     docs/ROADMAP.md#7-versioning--compatibility. -->

Every name in the `__all__` of every published import root of `nimbus-dev-sdk`, as the
installed package exposes it.

Annotations appear as the compiler preserves them: every module under
`src/nimbus_sdk/` carries `from __future__ import annotations`, so an annotation is
stored and re-rendered as unparsed source rather than evaluated. That normalises the
spelling — `Literal["text"]` is recorded as `Literal['text']` — and the normalisation is
exactly why this file renders identically on every supported Python version. Type
aliases are recorded from their source text for the same reason — their runtime `repr`
is both verbose and version-dependent.

Two things are recorded as present without being recorded as valued, and neither
absence is an oversight:

- **`= ...` means the parameter has a default whose value is not recorded** — the way a
  `.pyi` stub spells it. A default can be a live runtime object whose `repr` carries
  secrets: `require_env`'s `env` defaults to `os.environ`, and rendering that would
  write the whole process environment into this published file.
- **A constant's value is not recorded.** `CONTRACT_VERSIONS: tuple[str, ...]` renders
  identically whether it holds `("1",)` or `("1", "2")`, so a change to what a
  published constant holds does not diff here.

Docstrings are not recorded, matching `api-surface.md` and `api-surface-go.md`: a
reworded docstring is not a change to the surface.

## `nimbus_sdk`

13 exports.

- `CONTRACT_HANDSHAKE_EXIT: int`
- `CONTRACT_VERSIONS: tuple[str, ...]`
- `CONTRACT_VERSION_PATTERN: Pattern`
- `class NegotiationOk`
  - `version: str`
- `class NegotiationRefused`
  - `reason: str`
- `NegotiationResult = NegotiationOk | NegotiationRefused`
- `__version__: str`
- `def declared_versions_match(manifest_versions: Sequence[object], hello_versions: Sequence[str]) -> bool`
- `def load_corpus(area: str) -> list[dict[str, object]]`
- `def load_schema(name: str) -> dict[str, object]`
- `def manifest_contract_versions(manifest: object) -> tuple[object, ...]`
- `def negotiate_contract_version(local: Sequence[object], remote: Sequence[object]) -> NegotiationResult`
- `def spec_root() -> Path`

## `nimbus_sdk.ipc`

15 exports.

- `class FlushResult`
  - `frames: tuple[str, ...]`
  - `truncated: bool`
- `class FrameTooLongError(Exception)`
- `HELLO_MESSAGE: str`
- `class HandshakeIO(Protocol)`
  - `def read(self) -> bytes | None`
  - `def write(self, chunk: bytes) -> None`
- `class HandshakeOk`
  - `version: str`
  - `pending: tuple[str, ...]`
- `class HandshakeRefused`
  - `reason: str`
  - `pending: tuple[str, ...]`
- `HandshakeResult = HandshakeOk | HandshakeRefused`
- `class HelloOk`
  - `contract_versions: tuple[str, ...]`
- `class HelloRefused`
  - `reason: str`
- `HelloResult = HelloOk | HelloRefused`
- `IPC_MAX_LINE_BYTES: int`
- `class NdjsonLineReader`
  - `def __init__(self) -> None`
  - `def flush_frames(self) -> FlushResult`
  - `def push(self, chunk: bytes) -> list[str]`
- `def encode_hello(versions: Sequence[str]) -> str`
- `def parse_hello(frame: str) -> HelloResult`
- `def perform_handshake(io: HandshakeIO, *, local_versions: Sequence[str] = ..., reader: NdjsonLineReader | None = ...) -> HandshakeResult`

## `nimbus_sdk.diagnostics`

12 exports.

- `DIAGNOSTIC_KINDS: Final[tuple[str, ...]]`
- `DIAGNOSTIC_LEVELS: Final[tuple[str, ...]]`
- `class EncodeOk`
  - `line: str`
- `class EncodeRejected`
  - `reason: str`
  - `path: str`
- `EncodeResult = EncodeOk | EncodeRejected`
- `class ParseOk`
  - `event: dict[str, object]`
- `class ParseRejected`
  - `reason: str`
  - `path: str`
- `ParseResult = ParseOk | ParseRejected`
- `def encode_diagnostic(event: object) -> EncodeResult`
- `def format_timestamp(value: datetime) -> str`
- `def meets_level(level: str, threshold: str) -> bool`
- `def parse_diagnostic(line: str) -> ParseResult`

## `nimbus_sdk.connector_kit`

42 exports.

- `class ConnectorKitError(Exception)`
- `FieldExtractor = Callable[[object], Sequence[str | None] | None]`
- `class HttpRequest`
  - `url: str`
  - `method: str`
  - `headers: Mapping[str, str]`
  - `body: bytes | None`
  - `timeout_s: float`
- `class HttpResponse`
  - `status: int`
  - `text: str`
  - `json: object`
  - `ok: bool`
- `class HttpStatusError(ConnectorKitError)`
  - `def __init__(self, service: str, status: int, snippet: str) -> None`
- `class JsonBodyResponse(TextResponse, Protocol)`
  - `json: object`
  - `ok: bool`
  - `status: int`
  - `text: str`
- `class McpTextContent`
  - `type: Literal['text']`
  - `text: str`
- `class McpToolDescriptor`
  - `name: str`
  - `description: str`
  - `inputSchema: dict[str, Any]`
- `class McpToolResult`
  - `content: list[McpTextContent]`
  - `isError: NotRequired[bool]`
- `class MissingEnvError(ConnectorKitError)`
- `class RestFetcher(Protocol)`
- `class RestFetcherConfig`
  - `api_base: str`
  - `token: str`
  - `default_headers: Mapping[str, str]`
- `SearchFilter = Callable[..., list[object]]`
- `class TextResponse(Protocol)`
  - `ok: bool`
  - `status: int`
  - `text: str`
- `ToolHandler = Callable[[dict[str, Any]], 'McpToolResult | Awaitable[McpToolResult]']`
- `class ToolRouter`
  - `def __init__(self) -> None`
  - `def add(self, name: str, description: str, input_schema: dict[str, Any], handler: ToolHandler, validate: ToolValidator | None = ...) -> None`
  - `def call_tool(self, name: str, arguments: Mapping[str, Any] | None) -> McpToolResult`
  - `def list_tools(self) -> list[McpToolDescriptor]`
  - `def tool(self, name: str, description: str, input_schema: dict[str, Any], validate: ToolValidator | None = ...) -> Callable[[ToolHandler], ToolHandler]`
- `ToolValidator = Callable[[dict[str, Any]], None]`
- `class Transport(Protocol)`
  - `def send(self, request: HttpRequest) -> HttpResponse`
- `class TransportError(ConnectorKitError)`
  - `def __init__(self, method: str, url: str, reason: str) -> None`
- `class TransportTimeoutError(TransportError)`
  - `def __init__(self, method: str, url: str, reason: str) -> None`
- `class UrlResolutionError(ConnectorKitError)`
- `class UrllibTransport`
  - `def __init__(self) -> None`
  - `def send(self, request: HttpRequest) -> HttpResponse`
- `def as_objectish(value: object) -> dict[str, object] | None`
- `def as_record(value: object) -> dict[str, object] | None`
- `def error_result(message: str) -> McpToolResult`
- `def fields_from_keys(keys: Sequence[str], *, tags: bool = ...) -> Callable[[object], list[str] | None]`
- `def filter_by_query(items: Sequence[object], *, query: str, fields: FieldExtractor, limit: float | None = ...) -> list[object]`
- `def json_result(data: object) -> McpToolResult`
- `def json_result_from_text_if_ok(service_label: str, res: TextResponse, *, max_snippet: int = ..., json_parse_error_message: str | None = ...) -> McpToolResult`
- `def json_result_if_ok(service_label: str, res: JsonBodyResponse, snippet_max: int = ...) -> McpToolResult`
- `def make_query_filter(fields: FieldExtractor) -> SearchFilter`
- `def make_rest_fetcher(config: RestFetcherConfig, transport: Transport | None = ...) -> RestFetcher`
- `def make_rest_tool(*, token_env: str, service_label: str, fetch: Callable[[str, str], HttpResponse], build_path: Callable[[dict[str, Any]], str], snippet_max: int = ..., env: Mapping[str, str] | None = ...) -> ToolHandler`
- `def matches_result(rows: object, search: SearchFilter, *, query: str, limit: float | None = ...) -> McpToolResult`
- `def nested_string(root: dict[str, object], path: Sequence[str]) -> str`
- `def parse_json_text_if_ok(service_label: str, res: TextResponse, max_snippet: int = ...) -> object`
- `def require_env(name: str, env: Mapping[str, str] = ...) -> str`
- `def resolve_url_with_base(base_url: str, path_or_url: str) -> str`
- `def should_strip_auth(from_url: str, to_url: str) -> bool`
- `def string_field(row: dict[str, object], key: str) -> str`
- `def tag_names_from_objects(row: dict[str, object]) -> str`
- `def tag_text(row: dict[str, object]) -> str`
