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

- `CONTRACT_HANDSHAKE_EXIT: int` — **frozen** — from `contract`
- `CONTRACT_VERSIONS: tuple[str, ...]` — **frozen** — from `contract`
- `CONTRACT_VERSION_PATTERN: Pattern` — **frozen** — from `contract`
- `class NegotiationOk` — **frozen** — from `contract`
  - `version: str`
- `class NegotiationRefused` — **frozen** — from `contract`
  - `reason: str`
- `NegotiationResult = NegotiationOk | NegotiationRefused` — **frozen** — from `contract`
- `__version__: str` — **stable** — from `__init__`
- `def declared_versions_match(manifest_versions: Sequence[object], hello_versions: Sequence[str]) -> bool` — **frozen** — from `contract`
- `def load_corpus(area: str) -> list[dict[str, object]]` — **stable** — from `spec`
- `def load_schema(name: str) -> dict[str, object]` — **stable** — from `spec`
- `def manifest_contract_versions(manifest: object) -> tuple[object, ...]` — **frozen** — from `contract`
- `def negotiate_contract_version(local: Sequence[object], remote: Sequence[object]) -> NegotiationResult` — **frozen** — from `contract`
- `def spec_root() -> Path` — **stable** — from `spec`

## `nimbus_sdk.ipc`

15 exports.

- `class FlushResult` — **frozen** — from `ipc/ndjson`
  - `frames: tuple[str, ...]`
  - `truncated: bool`
- `class FrameTooLongError(Exception)` — **frozen** — from `ipc/ndjson`
- `HELLO_MESSAGE: str` — **frozen** — from `ipc/hello`
- `class HandshakeIO(Protocol)` — **frozen** — from `ipc/handshake`
  - `def read(self) -> bytes | None`
  - `def write(self, chunk: bytes) -> None`
- `class HandshakeOk` — **frozen** — from `ipc/handshake`
  - `version: str`
  - `pending: tuple[str, ...]`
- `class HandshakeRefused` — **frozen** — from `ipc/handshake`
  - `reason: str`
  - `pending: tuple[str, ...]`
- `HandshakeResult = HandshakeOk | HandshakeRefused` — **frozen** — from `ipc/handshake`
- `class HelloOk` — **frozen** — from `ipc/hello`
  - `contract_versions: tuple[str, ...]`
- `class HelloRefused` — **frozen** — from `ipc/hello`
  - `reason: str`
- `HelloResult = HelloOk | HelloRefused` — **frozen** — from `ipc/hello`
- `IPC_MAX_LINE_BYTES: int` — **frozen** — from `ipc/ndjson`
- `class NdjsonLineReader` — **frozen** — from `ipc/ndjson`
  - `def __init__(self) -> None`
  - `def flush_frames(self) -> FlushResult`
  - `def push(self, chunk: bytes) -> list[str]`
- `def encode_hello(versions: Sequence[str]) -> str` — **frozen** — from `ipc/hello`
- `def parse_hello(frame: str) -> HelloResult` — **frozen** — from `ipc/hello`
- `def perform_handshake(io: HandshakeIO, *, local_versions: Sequence[str] = ..., reader: NdjsonLineReader | None = ...) -> HandshakeResult` — **frozen** — from `ipc/handshake`

## `nimbus_sdk.diagnostics`

12 exports.

- `DIAGNOSTIC_KINDS: Final[tuple[str, ...]]` — **frozen** — from `diagnostics/event`
- `DIAGNOSTIC_LEVELS: Final[tuple[str, ...]]` — **frozen** — from `diagnostics/event`
- `class EncodeOk` — **frozen** — from `diagnostics/event`
  - `line: str`
- `class EncodeRejected` — **frozen** — from `diagnostics/event`
  - `reason: str`
  - `path: str`
- `EncodeResult = EncodeOk | EncodeRejected` — **frozen** — from `diagnostics/event`
- `class ParseOk` — **frozen** — from `diagnostics/event`
  - `event: dict[str, object]`
- `class ParseRejected` — **frozen** — from `diagnostics/event`
  - `reason: str`
  - `path: str`
- `ParseResult = ParseOk | ParseRejected` — **frozen** — from `diagnostics/event`
- `def encode_diagnostic(event: object) -> EncodeResult` — **frozen** — from `diagnostics/event`
- `def format_timestamp(value: datetime) -> str` — **stable** — from `diagnostics/timestamp`
- `def meets_level(level: str, threshold: str) -> bool` — **frozen** — from `diagnostics/event`
- `def parse_diagnostic(line: str) -> ParseResult` — **frozen** — from `diagnostics/event`

## `nimbus_sdk.connector_kit`

42 exports.

- `class ConnectorKitError(Exception)` — **stable** — from `connector_kit/errors`
- `FieldExtractor = Callable[[object], Sequence[str | None] | None]` — **stable** — from `connector_kit/search_filter`
- `class HttpRequest` — **experimental** — from `connector_kit/transport`
  - `url: str`
  - `method: str`
  - `headers: Mapping[str, str]`
  - `body: bytes | None`
  - `timeout_s: float`
- `class HttpResponse` — **experimental** — from `connector_kit/transport`
  - `status: int`
  - `text: str`
  - `json: object`
  - `ok: bool`
- `class HttpStatusError(ConnectorKitError)` — **stable** — from `connector_kit/errors`
  - `def __init__(self, service: str, status: int, snippet: str) -> None`
- `class JsonBodyResponse(TextResponse, Protocol)` — **stable** — from `connector_kit/results`
  - `json: object`
  - `ok: bool`
  - `status: int`
  - `text: str`
- `class McpTextContent` — **stable** — from `connector_kit/types`
  - `type: Literal['text']`
  - `text: str`
- `class McpToolDescriptor` — **stable** — from `connector_kit/types`
  - `name: str`
  - `description: str`
  - `inputSchema: dict[str, Any]`
- `class McpToolResult` — **stable** — from `connector_kit/types`
  - `content: list[McpTextContent]`
  - `isError: NotRequired[bool]`
- `class MissingEnvError(ConnectorKitError)` — **stable** — from `connector_kit/errors`
- `class RestFetcher(Protocol)` — **experimental** — from `connector_kit/rest`
- `class RestFetcherConfig` — **experimental** — from `connector_kit/rest`
  - `api_base: str`
  - `token: str`
  - `default_headers: Mapping[str, str]`
- `SearchFilter = Callable[..., list[object]]` — **stable** — from `connector_kit/search_filter`
- `class TextResponse(Protocol)` — **stable** — from `connector_kit/results`
  - `ok: bool`
  - `status: int`
  - `text: str`
- `ToolHandler = Callable[[dict[str, Any]], 'McpToolResult | Awaitable[McpToolResult]']` — **experimental** — from `connector_kit/router`
- `class ToolRouter` — **experimental** — from `connector_kit/router`
  - `def __init__(self) -> None`
  - `def add(self, name: str, description: str, input_schema: dict[str, Any], handler: ToolHandler, validate: ToolValidator | None = ...) -> None`
  - `async def call_tool(self, name: str, arguments: Mapping[str, Any] | None) -> McpToolResult`
  - `def list_tools(self) -> list[McpToolDescriptor]`
  - `def tool(self, name: str, description: str, input_schema: dict[str, Any], validate: ToolValidator | None = ...) -> Callable[[ToolHandler], ToolHandler]`
- `ToolValidator = Callable[[dict[str, Any]], None]` — **experimental** — from `connector_kit/router`
- `class Transport(Protocol)` — **experimental** — from `connector_kit/transport`
  - `def send(self, request: HttpRequest) -> HttpResponse`
- `class TransportError(ConnectorKitError)` — **stable** — from `connector_kit/errors`
  - `def __init__(self, method: str, url: str, reason: str) -> None`
- `class TransportTimeoutError(TransportError)` — **stable** — from `connector_kit/errors`
  - `def __init__(self, method: str, url: str, reason: str) -> None`
- `class UrlResolutionError(ConnectorKitError)` — **stable** — from `connector_kit/errors`
- `class UrllibTransport` — **experimental** — from `connector_kit/transport`
  - `def __init__(self) -> None`
  - `def send(self, request: HttpRequest) -> HttpResponse`
- `def as_objectish(value: object) -> dict[str, object] | None` — **stable** — from `connector_kit/search_filter`
- `def as_record(value: object) -> dict[str, object] | None` — **stable** — from `connector_kit/search_filter`
- `def error_result(message: str) -> McpToolResult` — **stable** — from `connector_kit/results`
- `def fields_from_keys(keys: Sequence[str], *, tags: bool = ...) -> Callable[[object], list[str] | None]` — **stable** — from `connector_kit/search_filter`
- `def filter_by_query(items: Sequence[object], *, query: str, fields: FieldExtractor, limit: float | None = ...) -> list[object]` — **stable** — from `connector_kit/search_filter`
- `def json_result(data: object) -> McpToolResult` — **stable** — from `connector_kit/results`
- `def json_result_from_text_if_ok(service_label: str, res: TextResponse, *, max_snippet: int = ..., json_parse_error_message: str | None = ...) -> McpToolResult` — **stable** — from `connector_kit/results`
- `def json_result_if_ok(service_label: str, res: JsonBodyResponse, snippet_max: int = ...) -> McpToolResult` — **stable** — from `connector_kit/results`
- `def make_query_filter(fields: FieldExtractor) -> SearchFilter` — **stable** — from `connector_kit/search_filter`
- `def make_rest_fetcher(config: RestFetcherConfig, transport: Transport | None = ...) -> RestFetcher` — **experimental** — from `connector_kit/rest`
- `def make_rest_tool(*, token_env: str, service_label: str, fetch: Callable[[str, str], HttpResponse], build_path: Callable[[dict[str, Any]], str], snippet_max: int = ..., env: Mapping[str, str] | None = ...) -> ToolHandler` — **experimental** — from `connector_kit/rest`
- `def matches_result(rows: object, search: SearchFilter, *, query: str, limit: float | None = ...) -> McpToolResult` — **stable** — from `connector_kit/search_filter`
- `def nested_string(root: dict[str, object], path: Sequence[str]) -> str` — **stable** — from `connector_kit/search_filter`
- `def parse_json_text_if_ok(service_label: str, res: TextResponse, max_snippet: int = ...) -> object` — **stable** — from `connector_kit/results`
- `def require_env(name: str, env: Mapping[str, str] = ...) -> str` — **stable** — from `connector_kit/env`
- `def resolve_url_with_base(base_url: str, path_or_url: str) -> str` — **frozen** — from `connector_kit/urls`
- `def should_strip_auth(from_url: str, to_url: str) -> bool` — **frozen** — from `connector_kit/urls`
- `def string_field(row: dict[str, object], key: str) -> str` — **stable** — from `connector_kit/search_filter`
- `def tag_names_from_objects(row: dict[str, object]) -> str` — **stable** — from `connector_kit/search_filter`
- `def tag_text(row: dict[str, object]) -> str` — **stable** — from `connector_kit/search_filter`

## `nimbus_sdk.data_profile`

7 exports.

- `class DataColumn` — **frozen** — from `data_profile/profile`
  - `name: str`
  - `type: str | None`
- `def first_line_and_rows(text: str, truncated: bool) -> tuple[str, float | None]` — **frozen** — from `data_profile/profile`
- `def js_kind(value: object) -> str` — **frozen** — from `data_profile/profile`
- `def parquet_columns_from_metadata(meta: object) -> tuple[list[DataColumn], float | None]` — **frozen** — from `data_profile/profile`
- `def parse_csv_header(first_line: str) -> list[DataColumn]` — **frozen** — from `data_profile/profile`
- `def parse_json_columns(parsed: object) -> tuple[list[DataColumn], float | None]` — **frozen** — from `data_profile/profile`
- `def parse_jsonl_columns(first_line: str) -> list[DataColumn]` — **frozen** — from `data_profile/profile`

## `nimbus_sdk.distribution_channel`

3 exports.

- `DistributionChannel = Literal['homebrew', 'scoop', 'winget', 'apt', 'yum', 'msi', 'pkg']` — **frozen** — from `distribution_channel/channel`
- `def channel_upgrade_hint(channel: DistributionChannel) -> str` — **frozen** — from `distribution_channel/channel`
- `def resolve_distribution_channel(env: Mapping[str, str] | None = ..., exec_path: str | None = ..., realpath: Callable[[str], str] | None = ...) -> DistributionChannel | None` — **frozen** — from `distribution_channel/channel`

## `nimbus_sdk.icalendar`

4 exports.

- `class BuildEventInput` — **frozen** — from `icalendar/events`
  - `uid: str`
  - `summary: str`
  - `start: str`
  - `end: str`
  - `description: str | None`
  - `location: str | None`
  - `attendees: tuple[str, ...] | None`
- `class ParsedEvent` — **frozen** — from `icalendar/events`
  - `uid: str`
  - `recurrence_id: str | None`
  - `summary: str | None`
  - `description: str | None`
  - `location: str | None`
  - `start: str | None`
  - `end: str | None`
  - `all_day: bool`
  - `status: str | None`
  - `organizer: str | None`
  - `attendees: tuple[str, ...]`
  - `rrule: str | None`
  - `dtstamp: str | None`
- `def build_vevent(event: BuildEventInput, now: str) -> str` — **frozen** — from `icalendar/events`
- `def parse_icalendar(ics: str) -> list[ParsedEvent]` — **frozen** — from `icalendar/events`

## `nimbus_sdk.jmap_fastmail`

23 exports.

- `class BuildRequest` — **frozen** — from `jmap_fastmail/jmap`
  - `using: tuple[str, ...]`
  - `method_calls: tuple[tuple[str, dict[str, Any], str], ...]`
- `CORE_CAPABILITY: str` — **frozen** — from `jmap_fastmail/jmap`
- `EMAIL_PROPERTIES: tuple[str, ...]` — **frozen** — from `jmap_fastmail/jmap`
- `class JmapAttachmentMeta` — **frozen** — from `jmap_fastmail/jmap`
  - `name: str | None`
  - `size_bytes: float | None`
  - `mime_type: str | None`
- `class JmapEmailView` — **frozen** — from `jmap_fastmail/jmap`
  - `id: str`
  - `message_id: str | None`
  - `subject: str | None`
  - `from_: tuple[str, ...]`
  - `to: tuple[str, ...]`
  - `cc: tuple[str, ...]`
  - `received_at: str | None`
  - `attachments: tuple[JmapAttachmentMeta, ...]`
  - `preview: str`
- `class JmapSession` — **frozen** — from `jmap_fastmail/jmap`
  - `api_url: str`
  - `account_id: str`
- `MAIL_CAPABILITY: str` — **frozen** — from `jmap_fastmail/jmap`
- `MAX_BODY_VALUE_BYTES: int` — **frozen** — from `jmap_fastmail/jmap`
- `PREVIEW_MAX_CHARS: int` — **frozen** — from `jmap_fastmail/jmap`
- `SUBMISSION_CAPABILITY: str` — **frozen** — from `jmap_fastmail/jmap`
- `def build_get_request(account_id: str, id_: str) -> BuildRequest` — **frozen** — from `jmap_fastmail/jmap`
- `def build_list_request(account_id: str, limit: int) -> BuildRequest` — **frozen** — from `jmap_fastmail/jmap`
- `def build_search_request(account_id: str, query: str, limit: int) -> BuildRequest` — **frozen** — from `jmap_fastmail/jmap`
- `def cap_preview(text: str) -> str` — **frozen** — from `jmap_fastmail/jmap`
- `def extract_attachments(value: object) -> tuple[JmapAttachmentMeta, ...]` — **frozen** — from `jmap_fastmail/jmap`
- `def extract_email_list(parsed: object) -> list[Any]` — **frozen** — from `jmap_fastmail/jmap`
- `def format_address(value: object) -> str` — **frozen** — from `jmap_fastmail/jmap`
- `def format_addresses(value: object) -> tuple[str, ...]` — **frozen** — from `jmap_fastmail/jmap`
- `def method_response_args(parsed: object, method_name: str) -> dict[str, Any] | None` — **frozen** — from `jmap_fastmail/jmap`
- `def parse_session(parsed: object) -> JmapSession | None` — **frozen** — from `jmap_fastmail/jmap`
- `def preview_for(raw: dict[str, Any]) -> str` — **frozen** — from `jmap_fastmail/jmap`
- `def validate_api_url(candidate: str, allowed_base: str) -> str` — **frozen** — from `jmap_fastmail/jmap`
- `def view_email(raw: object) -> JmapEmailView | None` — **frozen** — from `jmap_fastmail/jmap`

## `nimbus_sdk.signing`

14 exports.

- `CANONICALIZATION_REASONS: tuple[str, ...]` — **experimental** — from `signing/canonical_json`
- `class CanonicalizationError(Exception)` — **experimental** — from `signing/canonical_json`
  - `def __init__(self, reason: str) -> None`
- `Jwk = Mapping[str, object]` — **experimental** — from `signing/jwk`
- `class ProtectedHeader` — **experimental** — from `signing/jws`
  - `alg: NotRequired[str]`
  - `kid: str`
- `SIGNATURE_REASONS: tuple[str, ...]` — **experimental** — from `signing/errors`
- `class SignatureError(Exception)` — **experimental** — from `signing/errors`
  - `def __init__(self, reason: str, *, canonicalization_reason: str | None = ...) -> None`
- `def base64url_decode(text: str) -> bytes` — **experimental** — from `signing/base64url`
- `def base64url_encode(data: bytes) -> str` — **experimental** — from `signing/base64url`
- `def canonicalize(value: object) -> str` — **experimental** — from `signing/canonical_json`
- `def canonicalize_manifest(manifest: dict[str, object]) -> bytes` — **experimental** — from `signing/canonical_json`
- `def encode_protected_header(header: ProtectedHeader) -> str` — **experimental** — from `signing/jws`
- `def jwk_thumbprint(jwk: Jwk) -> str` — **experimental** — from `signing/jwk`
- `def parse_protected_header(b64url: str) -> ProtectedHeader` — **experimental** — from `signing/jws`
- `def signing_input(protected_b64url: str, canonical_bytes: bytes) -> bytes` — **experimental** — from `signing/jws`
