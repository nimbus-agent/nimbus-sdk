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

- `CONTRACT_HANDSHAKE_EXIT: int` — **frozen**
- `CONTRACT_VERSIONS: tuple[str, ...]` — **frozen**
- `CONTRACT_VERSION_PATTERN: Pattern` — **frozen**
- `class NegotiationOk` — **frozen**
  - `version: str`
- `class NegotiationRefused` — **frozen**
  - `reason: str`
- `NegotiationResult = NegotiationOk | NegotiationRefused` — **frozen**
- `__version__: str` — **stable**
- `def declared_versions_match(manifest_versions: Sequence[object], hello_versions: Sequence[str]) -> bool` — **frozen**
- `def load_corpus(area: str) -> list[dict[str, object]]` — **stable**
- `def load_schema(name: str) -> dict[str, object]` — **stable**
- `def manifest_contract_versions(manifest: object) -> tuple[object, ...]` — **frozen**
- `def negotiate_contract_version(local: Sequence[object], remote: Sequence[object]) -> NegotiationResult` — **frozen**
- `def spec_root() -> Path` — **stable**

## `nimbus_sdk.ipc`

15 exports.

- `class FlushResult` — **frozen**
  - `frames: tuple[str, ...]`
  - `truncated: bool`
- `class FrameTooLongError(Exception)` — **frozen**
- `HELLO_MESSAGE: str` — **frozen**
- `class HandshakeIO(Protocol)` — **frozen**
  - `def read(self) -> bytes | None`
  - `def write(self, chunk: bytes) -> None`
- `class HandshakeOk` — **frozen**
  - `version: str`
  - `pending: tuple[str, ...]`
- `class HandshakeRefused` — **frozen**
  - `reason: str`
  - `pending: tuple[str, ...]`
- `HandshakeResult = HandshakeOk | HandshakeRefused` — **frozen**
- `class HelloOk` — **frozen**
  - `contract_versions: tuple[str, ...]`
- `class HelloRefused` — **frozen**
  - `reason: str`
- `HelloResult = HelloOk | HelloRefused` — **frozen**
- `IPC_MAX_LINE_BYTES: int` — **frozen**
- `class NdjsonLineReader` — **frozen**
  - `def __init__(self) -> None`
  - `def flush_frames(self) -> FlushResult`
  - `def push(self, chunk: bytes) -> list[str]`
- `def encode_hello(versions: Sequence[str]) -> str` — **frozen**
- `def parse_hello(frame: str) -> HelloResult` — **frozen**
- `def perform_handshake(io: HandshakeIO, *, local_versions: Sequence[str] = ..., reader: NdjsonLineReader | None = ...) -> HandshakeResult` — **frozen**

## `nimbus_sdk.diagnostics`

12 exports.

- `DIAGNOSTIC_KINDS: Final[tuple[str, ...]]` — **frozen**
- `DIAGNOSTIC_LEVELS: Final[tuple[str, ...]]` — **frozen**
- `class EncodeOk` — **frozen**
  - `line: str`
- `class EncodeRejected` — **frozen**
  - `reason: str`
  - `path: str`
- `EncodeResult = EncodeOk | EncodeRejected` — **frozen**
- `class ParseOk` — **frozen**
  - `event: dict[str, object]`
- `class ParseRejected` — **frozen**
  - `reason: str`
  - `path: str`
- `ParseResult = ParseOk | ParseRejected` — **frozen**
- `def encode_diagnostic(event: object) -> EncodeResult` — **frozen**
- `def format_timestamp(value: datetime) -> str` — **stable**
- `def meets_level(level: str, threshold: str) -> bool` — **frozen**
- `def parse_diagnostic(line: str) -> ParseResult` — **frozen**

## `nimbus_sdk.connector_kit`

42 exports.

- `class ConnectorKitError(Exception)` — **stable**
- `FieldExtractor = Callable[[object], Sequence[str | None] | None]` — **stable**
- `class HttpRequest` — **experimental**
  - `url: str`
  - `method: str`
  - `headers: Mapping[str, str]`
  - `body: bytes | None`
  - `timeout_s: float`
- `class HttpResponse` — **experimental**
  - `status: int`
  - `text: str`
  - `json: object`
  - `ok: bool`
- `class HttpStatusError(ConnectorKitError)` — **stable**
  - `def __init__(self, service: str, status: int, snippet: str) -> None`
- `class JsonBodyResponse(TextResponse, Protocol)` — **stable**
  - `json: object`
  - `ok: bool`
  - `status: int`
  - `text: str`
- `class McpTextContent` — **stable**
  - `type: Literal['text']`
  - `text: str`
- `class McpToolDescriptor` — **stable**
  - `name: str`
  - `description: str`
  - `inputSchema: dict[str, Any]`
- `class McpToolResult` — **stable**
  - `content: list[McpTextContent]`
  - `isError: NotRequired[bool]`
- `class MissingEnvError(ConnectorKitError)` — **stable**
- `class RestFetcher(Protocol)` — **experimental**
- `class RestFetcherConfig` — **experimental**
  - `api_base: str`
  - `token: str`
  - `default_headers: Mapping[str, str]`
- `SearchFilter = Callable[..., list[object]]` — **stable**
- `class TextResponse(Protocol)` — **stable**
  - `ok: bool`
  - `status: int`
  - `text: str`
- `ToolHandler = Callable[[dict[str, Any]], 'McpToolResult | Awaitable[McpToolResult]']` — **experimental**
- `class ToolRouter` — **experimental**
  - `def __init__(self) -> None`
  - `def add(self, name: str, description: str, input_schema: dict[str, Any], handler: ToolHandler, validate: ToolValidator | None = ...) -> None`
  - `async def call_tool(self, name: str, arguments: Mapping[str, Any] | None) -> McpToolResult`
  - `def list_tools(self) -> list[McpToolDescriptor]`
  - `def tool(self, name: str, description: str, input_schema: dict[str, Any], validate: ToolValidator | None = ...) -> Callable[[ToolHandler], ToolHandler]`
- `ToolValidator = Callable[[dict[str, Any]], None]` — **experimental**
- `class Transport(Protocol)` — **experimental**
  - `def send(self, request: HttpRequest) -> HttpResponse`
- `class TransportError(ConnectorKitError)` — **stable**
  - `def __init__(self, method: str, url: str, reason: str) -> None`
- `class TransportTimeoutError(TransportError)` — **stable**
  - `def __init__(self, method: str, url: str, reason: str) -> None`
- `class UrlResolutionError(ConnectorKitError)` — **stable**
- `class UrllibTransport` — **experimental**
  - `def __init__(self) -> None`
  - `def send(self, request: HttpRequest) -> HttpResponse`
- `def as_objectish(value: object) -> dict[str, object] | None` — **stable**
- `def as_record(value: object) -> dict[str, object] | None` — **stable**
- `def error_result(message: str) -> McpToolResult` — **stable**
- `def fields_from_keys(keys: Sequence[str], *, tags: bool = ...) -> Callable[[object], list[str] | None]` — **stable**
- `def filter_by_query(items: Sequence[object], *, query: str, fields: FieldExtractor, limit: float | None = ...) -> list[object]` — **stable**
- `def json_result(data: object) -> McpToolResult` — **stable**
- `def json_result_from_text_if_ok(service_label: str, res: TextResponse, *, max_snippet: int = ..., json_parse_error_message: str | None = ...) -> McpToolResult` — **stable**
- `def json_result_if_ok(service_label: str, res: JsonBodyResponse, snippet_max: int = ...) -> McpToolResult` — **stable**
- `def make_query_filter(fields: FieldExtractor) -> SearchFilter` — **stable**
- `def make_rest_fetcher(config: RestFetcherConfig, transport: Transport | None = ...) -> RestFetcher` — **experimental**
- `def make_rest_tool(*, token_env: str, service_label: str, fetch: Callable[[str, str], HttpResponse], build_path: Callable[[dict[str, Any]], str], snippet_max: int = ..., env: Mapping[str, str] | None = ...) -> ToolHandler` — **experimental**
- `def matches_result(rows: object, search: SearchFilter, *, query: str, limit: float | None = ...) -> McpToolResult` — **stable**
- `def nested_string(root: dict[str, object], path: Sequence[str]) -> str` — **stable**
- `def parse_json_text_if_ok(service_label: str, res: TextResponse, max_snippet: int = ...) -> object` — **stable**
- `def require_env(name: str, env: Mapping[str, str] = ...) -> str` — **stable**
- `def resolve_url_with_base(base_url: str, path_or_url: str) -> str` — **frozen**
- `def should_strip_auth(from_url: str, to_url: str) -> bool` — **frozen**
- `def string_field(row: dict[str, object], key: str) -> str` — **stable**
- `def tag_names_from_objects(row: dict[str, object]) -> str` — **stable**
- `def tag_text(row: dict[str, object]) -> str` — **stable**

## `nimbus_sdk.data_profile`

7 exports.

- `class DataColumn` — **frozen**
  - `name: str`
  - `type: str | None`
- `def first_line_and_rows(text: str, truncated: bool) -> tuple[str, float | None]` — **frozen**
- `def js_kind(value: object) -> str` — **frozen**
- `def parquet_columns_from_metadata(meta: object) -> tuple[list[DataColumn], float | None]` — **frozen**
- `def parse_csv_header(first_line: str) -> list[DataColumn]` — **frozen**
- `def parse_json_columns(parsed: object) -> tuple[list[DataColumn], float | None]` — **frozen**
- `def parse_jsonl_columns(first_line: str) -> list[DataColumn]` — **frozen**

## `nimbus_sdk.distribution_channel`

3 exports.

- `DistributionChannel = Literal['homebrew', 'scoop', 'winget', 'apt', 'yum', 'msi', 'pkg']` — **frozen**
- `def channel_upgrade_hint(channel: DistributionChannel) -> str` — **frozen**
- `def resolve_distribution_channel(env: Mapping[str, str] | None = ..., exec_path: str | None = ..., realpath: Callable[[str], str] | None = ...) -> DistributionChannel | None` — **frozen**
