/// <reference lib="dom" />

/**
 * Server-hosted collaborative browser.
 *
 * The Electron client remains the richest preview host, but web-only T3
 * environments still need an automation target. This adapter registers the
 * environment server itself with PreviewAutomationBroker and lazily launches
 * an installed Chromium browser on the first agent browser operation.
 */
import {
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_AUTOMATION_OPERATIONS,
  type BrowserNavigationTarget,
  type PreviewAutomationActionEvent,
  type PreviewAutomationClickInput,
  type PreviewAutomationConsoleEntry,
  type PreviewAutomationEvaluateInput,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationNetworkEntry,
  type PreviewAutomationOpenInput,
  type PreviewAutomationOperation,
  type PreviewAutomationPressInput,
  type PreviewAutomationRequest,
  type PreviewAutomationResizeInput,
  type PreviewAutomationResponse,
  type PreviewAutomationScrollInput,
  type PreviewAutomationSetColorSchemeInput,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
  type PreviewAutomationTypeInput,
  type PreviewAutomationWaitForInput,
  type PreviewRenderedViewportSize,
  type PreviewSessionSnapshot,
  type PreviewTabId,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "playwright-core";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import * as PreviewManager from "./Manager.ts";

const SERVER_BROWSER_CLIENT_ID_PREFIX = "server-browser";
const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;
const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_DIAGNOSTIC_ENTRIES = 200;
const MAX_EVALUATION_BYTES = 64_000;

// A server host does not currently save recordings. Advertising the precise
// set prevents a provider session from being pinned to a host that cannot
// complete a later recording request.
export const SERVER_BROWSER_OPERATIONS = PREVIEW_AUTOMATION_OPERATIONS.filter(
  (operation) => operation !== "recordingStart" && operation !== "recordingStop",
);

type ServerBrowserOperation = (typeof SERVER_BROWSER_OPERATIONS)[number];

interface BrowserTab {
  readonly threadId: string;
  readonly tabId: PreviewTabId;
  readonly page: Page;
  viewportSetting: PreviewViewportSetting;
  loading: boolean;
  readonly consoleEntries: PreviewAutomationConsoleEntry[];
  readonly networkEntries: PreviewAutomationNetworkEntry[];
  readonly actionTimeline: PreviewAutomationActionEvent[];
}

interface RemoteHostError extends Error {
  readonly _tag: string;
  readonly detail?: unknown;
}

const remoteError = (tag: string, message: string, detail?: unknown): RemoteHostError =>
  Object.assign(new Error(message), {
    _tag: tag,
    ...(detail === undefined ? {} : { detail }),
  });

const isRemoteHostError = (value: unknown): value is RemoteHostError =>
  value instanceof Error && "_tag" in value && typeof value._tag === "string";

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const boundedPush = <A>(entries: A[], value: A): void => {
  entries.push(value);
  if (entries.length > MAX_DIAGNOSTIC_ENTRIES) {
    entries.splice(0, entries.length - MAX_DIAGNOSTIC_ENTRIES);
  }
};

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const nowIso = (): string => DateTime.formatIso(DateTime.nowUnsafe());

export function resolveServerBrowserUrl(input: {
  readonly url?: string | undefined;
  readonly target?: BrowserNavigationTarget | undefined;
}): string {
  if (input.target?.kind === "environment-port") {
    const protocol = input.target.protocol ?? "http";
    const path = input.target.path?.startsWith("/")
      ? input.target.path
      : `/${input.target.path ?? ""}`;
    return `${protocol}://localhost:${input.target.port}${path}`;
  }
  const raw = input.target?.kind === "url" ? input.target.url : input.url;
  if (!raw) throw remoteError("PreviewAutomationExecutionError", "No browser URL was provided.");
  return normalizePreviewUrl(raw);
}

export function serverBrowserViewport(
  setting: PreviewViewportSetting,
): PreviewRenderedViewportSize {
  if (setting._tag === "fill") return DEFAULT_VIEWPORT;
  return { width: setting.width, height: setting.height };
}

const requestedViewport = (input: PreviewAutomationResizeInput): PreviewViewportSetting =>
  resolvePreviewViewport(input);

const locatorFor = (
  page: Page,
  input: {
    readonly locator?: string | undefined;
    readonly selector?: string | undefined;
  },
) => page.locator(input.locator ?? input.selector!).first();

const canGoBack = async (page: Page): Promise<boolean> =>
  await page.evaluate(() => window.history.length > 1).catch(() => false);

const navigationWaitUntil = (
  readiness: PreviewAutomationNavigateInput["readiness"],
): "load" | "domcontentloaded" | "commit" => {
  switch (readiness) {
    case "domContentLoaded":
      return "domcontentloaded";
    case "none":
      return "commit";
    default:
      return "load";
  }
};

const makeConsoleEntry = (message: ConsoleMessage): PreviewAutomationConsoleEntry => {
  const location = message.location();
  return {
    level: message.type(),
    text: message.text(),
    timestamp: nowIso(),
    ...(location.url ? { source: location.url } : {}),
  };
};

const makeResponseEntry = (response: Response): PreviewAutomationNetworkEntry => ({
  url: response.url(),
  method: response.request().method(),
  status: response.status(),
  failed: false,
  timestamp: nowIso(),
});

const makeFailureEntry = (request: Request): PreviewAutomationNetworkEntry => ({
  url: request.url(),
  method: request.method(),
  status: null,
  failed: true,
  ...(request.failure()?.errorText ? { errorText: request.failure()!.errorText } : {}),
  timestamp: nowIso(),
});

class ServerBrowserController {
  private browserPromise: Promise<Browser> | null = null;
  private contextPromise: Promise<BrowserContext> | null = null;
  private readonly tabs = new Map<PreviewTabId, BrowserTab>();

  private async launchBrowser(): Promise<Browser> {
    const executablePath = process.env.T3CODE_PREVIEW_BROWSER_EXECUTABLE?.trim();
    const attempts: ReadonlyArray<() => Promise<Browser>> = executablePath
      ? [() => chromium.launch({ executablePath, headless: true })]
      : [
          () => chromium.launch({ channel: "chrome", headless: true }),
          () => chromium.launch({ channel: "msedge", headless: true }),
          () => chromium.launch({ headless: true }),
        ];
    const failures: string[] = [];
    for (const attempt of attempts) {
      try {
        const browser = await attempt();
        browser.on("disconnected", () => {
          for (const tab of this.tabs.values()) {
            void tab.page.close().catch(() => undefined);
          }
          this.tabs.clear();
          this.contextPromise = null;
          this.browserPromise = null;
        });
        return browser;
      } catch (cause) {
        failures.push(errorMessage(cause));
      }
    }
    throw remoteError(
      "PreviewAutomationUnavailableError",
      "No compatible Chromium browser is installed for server-hosted preview automation. Install Google Chrome, Microsoft Edge, or set T3CODE_PREVIEW_BROWSER_EXECUTABLE.",
      { attempts: failures.length },
    );
  }

  private async context(): Promise<BrowserContext> {
    if (!this.browserPromise) {
      this.browserPromise = this.launchBrowser().catch((cause) => {
        this.browserPromise = null;
        throw cause;
      });
    }
    if (!this.contextPromise) {
      this.contextPromise = this.browserPromise
        .then((browser) =>
          browser.newContext({
            viewport: DEFAULT_VIEWPORT,
            ignoreHTTPSErrors: true,
          }),
        )
        .catch((cause) => {
          this.contextPromise = null;
          throw cause;
        });
    }
    return await this.contextPromise;
  }

  private attachDiagnostics(tab: BrowserTab): void {
    tab.page.on("console", (message) => boundedPush(tab.consoleEntries, makeConsoleEntry(message)));
    tab.page.on("response", (response) =>
      boundedPush(tab.networkEntries, makeResponseEntry(response)),
    );
    tab.page.on("requestfailed", (request) =>
      boundedPush(tab.networkEntries, makeFailureEntry(request)),
    );
    tab.page.on("close", () => {
      if (this.tabs.get(tab.tabId)?.page === tab.page) this.tabs.delete(tab.tabId);
    });
  }

  async ensureTab(input: {
    readonly threadId: string;
    readonly tabId: PreviewTabId;
    readonly viewportSetting: PreviewViewportSetting;
    readonly initialUrl?: string | undefined;
  }): Promise<BrowserTab> {
    const current = this.tabs.get(input.tabId);
    if (current && !current.page.isClosed()) return current;
    const context = await this.context();
    const viewport = serverBrowserViewport(input.viewportSetting);
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    const tab: BrowserTab = {
      threadId: input.threadId,
      tabId: input.tabId,
      page,
      viewportSetting: input.viewportSetting,
      loading: false,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
    };
    this.attachDiagnostics(tab);
    this.tabs.set(input.tabId, tab);
    if (input.initialUrl) await page.goto(input.initialUrl, { waitUntil: "load" });
    return tab;
  }

  getTab(tabId: PreviewTabId | undefined): BrowserTab | null {
    if (!tabId) return null;
    const tab = this.tabs.get(tabId);
    return tab && !tab.page.isClosed() ? tab : null;
  }

  async close(): Promise<void> {
    const browser = await this.browserPromise?.catch(() => null);
    this.tabs.clear();
    this.contextPromise = null;
    this.browserPromise = null;
    await browser?.close();
  }
}

const snapshotInitialUrl = (snapshot: PreviewSessionSnapshot): string | undefined =>
  snapshot.navStatus._tag === "Idle" ? undefined : snapshot.navStatus.url;

const tabStatus = async (tab: BrowserTab | null): Promise<PreviewAutomationStatus> => {
  if (!tab) {
    return {
      available: true,
      visible: false,
      tabId: null,
      url: null,
      title: null,
      loading: false,
    };
  }
  const url = tab.page.url();
  return {
    available: true,
    visible: false,
    tabId: tab.tabId,
    url: url === "about:blank" ? null : url,
    title: (await tab.page.title().catch(() => "")) || null,
    loading: tab.loading,
    viewportSetting: tab.viewportSetting,
    viewport: serverBrowserViewport(tab.viewportSetting),
  };
};

const requireTab = (
  controller: ServerBrowserController,
  tabId: PreviewTabId | undefined,
  operation: PreviewAutomationOperation,
  threadId: string,
): BrowserTab => {
  const tab = controller.getTab(tabId);
  if (tab?.threadId === threadId) return tab;
  throw remoteError(
    "PreviewAutomationTabNotFoundError",
    tabId
      ? `Preview tab ${tabId} was not found for ${operation}.`
      : `No active preview tab was found for ${operation}.`,
  );
};

const remoteResponseError = (cause: unknown): NonNullable<PreviewAutomationResponse["error"]> => {
  if (isRemoteHostError(cause)) {
    return {
      _tag: cause._tag,
      message: cause.message.slice(0, 2_000),
      ...(cause.detail === undefined ? {} : { detail: cause.detail }),
    };
  }
  const message = errorMessage(cause);
  const timeout = cause instanceof Error && cause.name === "TimeoutError";
  return {
    _tag: timeout ? "PreviewAutomationTimeoutError" : "PreviewAutomationExecutionError",
    message: message.slice(0, 2_000),
  };
};

const captureSnapshot = async (tab: BrowserTab): Promise<PreviewAutomationSnapshot> => {
  const page = tab.page;
  const pageState = await page.evaluate(
    ({ maximumElements, maximumText }) => {
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        for (const attribute of ["data-testid", "name"]) {
          const value = element.getAttribute(attribute);
          if (value) {
            return `${element.tagName.toLowerCase()}[${attribute}=${JSON.stringify(value)}]`;
          }
        }
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && parts.length < 8) {
          const parent: Element | null = current.parentElement;
          const siblings: Element[] = parent
            ? Array.from(parent.children).filter((child) => child.tagName === current!.tagName)
            : [];
          const base: string = current.tagName.toLowerCase();
          parts.unshift(
            siblings.length > 1 ? `${base}:nth-of-type(${siblings.indexOf(current) + 1})` : base,
          );
          current = parent;
        }
        return parts.join(" > ");
      };
      const visible = (element: Element): boolean => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const interactiveElements = Array.from(
        document.querySelectorAll("a[href],button,input,textarea,select,[role],[tabindex]"),
      )
        .filter(visible)
        .slice(0, maximumElements)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role"),
            name:
              element.getAttribute("aria-label") ||
              (element as HTMLElement).innerText ||
              element.getAttribute("name") ||
              "",
            selector: selectorFor(element),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        });
      return {
        url: location.href,
        title: document.title,
        loading: document.readyState !== "complete",
        visibleText: (document.body?.innerText || "").slice(0, maximumText),
        interactiveElements,
      };
    },
    { maximumElements: MAX_INTERACTIVE_ELEMENTS, maximumText: MAX_VISIBLE_TEXT_LENGTH },
  );
  const cdp = await page.context().newCDPSession(page);
  const accessibilityTree = await cdp
    .send("Accessibility.getFullAXTree")
    .finally(() => cdp.detach());
  const screenshot = await page.screenshot({ type: "png", fullPage: false });
  const viewport = page.viewportSize() ?? DEFAULT_VIEWPORT;
  return {
    ...pageState,
    accessibilityTree,
    consoleEntries: [...tab.consoleEntries],
    networkEntries: [...tab.networkEntries],
    actionTimeline: [...tab.actionTimeline],
    screenshot: {
      mimeType: "image/png",
      data: screenshot.toString("base64"),
      width: viewport.width,
      height: viewport.height,
    },
  };
};

const runAction = async <A>(
  tab: BrowserTab,
  action: string,
  operation: () => Promise<A>,
): Promise<A> => {
  const event: PreviewAutomationActionEvent = {
    id: `${tab.tabId}-${tab.actionTimeline.length}`,
    action,
    status: "running",
    startedAt: nowIso(),
  };
  boundedPush(tab.actionTimeline, event);
  try {
    const result = await operation();
    Object.assign(event, { status: "succeeded", completedAt: nowIso() });
    return result;
  } catch (cause) {
    Object.assign(event, {
      status: "failed",
      completedAt: nowIso(),
      error: errorMessage(cause).slice(0, 2_000),
    });
    throw cause;
  }
};

const makeRequestHandler = (input: {
  readonly controller: ServerBrowserController;
  readonly manager: PreviewManager.PreviewManager["Service"];
}) =>
  Effect.fn("ServerBrowserHost.handleRequest")(function* (request: PreviewAutomationRequest) {
    const { controller, manager } = input;
    switch (request.operation as ServerBrowserOperation) {
      case "status":
        return yield* Effect.tryPromise(() => tabStatus(controller.getTab(request.tabId)));
      case "open": {
        const operationInput = request.input as PreviewAutomationOpenInput;
        const canReuse = operationInput.reuseExistingTab !== false;
        let snapshot: PreviewSessionSnapshot | undefined;
        if (canReuse && request.tabId) {
          const listed = yield* manager.list({ threadId: request.threadId });
          snapshot = listed.sessions.find((session) => session.tabId === request.tabId);
        }
        if (!snapshot) {
          snapshot = yield* manager.open({
            threadId: request.threadId,
            ...(operationInput.url
              ? { url: resolveServerBrowserUrl({ url: operationInput.url }) }
              : {}),
            viewport: FILL_PREVIEW_VIEWPORT,
          });
        }
        const initialUrl = operationInput.url
          ? resolveServerBrowserUrl({ url: operationInput.url })
          : snapshotInitialUrl(snapshot);
        const tab = yield* Effect.tryPromise(() =>
          controller.ensureTab({
            threadId: request.threadId,
            tabId: snapshot.tabId,
            viewportSetting: snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
            ...(initialUrl ? { initialUrl } : {}),
          }),
        );
        if (initialUrl) {
          yield* manager.reportStatus({
            threadId: request.threadId,
            tabId: tab.tabId,
            navStatus: {
              _tag: "Success",
              url: tab.page.url(),
              title: yield* Effect.tryPromise(() => tab.page.title()),
            },
            canGoBack: yield* Effect.tryPromise(() => canGoBack(tab.page)),
            canGoForward: false,
          });
        }
        return yield* Effect.tryPromise(() => tabStatus(tab));
      }
      case "navigate": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const operationInput = request.input as PreviewAutomationNavigateInput;
        const url = resolveServerBrowserUrl(operationInput);
        tab.loading = true;
        yield* manager.reportStatus({
          threadId: request.threadId,
          tabId: tab.tabId,
          navStatus: { _tag: "Loading", url, title: "" },
          canGoBack: yield* Effect.tryPromise(() => canGoBack(tab.page)),
          canGoForward: false,
        });
        const navigation = Effect.tryPromise(() =>
          runAction(tab, "navigate", async () => {
            await tab.page.goto(url, {
              waitUntil: navigationWaitUntil(operationInput.readiness),
              timeout: operationInput.timeoutMs ?? request.timeoutMs,
            });
          }),
        );
        yield* navigation.pipe(
          Effect.tapError((cause) =>
            manager.reportStatus({
              threadId: request.threadId,
              tabId: tab.tabId,
              navStatus: {
                _tag: "LoadFailed",
                url,
                title: "",
                code: -2,
                description: errorMessage(cause),
              },
              canGoBack: false,
              canGoForward: false,
            }),
          ),
          Effect.ensuring(Effect.sync(() => (tab.loading = false))),
        );
        const title = yield* Effect.tryPromise(() => tab.page.title());
        yield* manager.reportStatus({
          threadId: request.threadId,
          tabId: tab.tabId,
          navStatus: { _tag: "Success", url: tab.page.url(), title },
          canGoBack: yield* Effect.tryPromise(() => canGoBack(tab.page)),
          canGoForward: false,
        });
        return yield* Effect.tryPromise(() => tabStatus(tab));
      }
      case "resize": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const setting = requestedViewport(request.input as PreviewAutomationResizeInput);
        const viewport = serverBrowserViewport(setting);
        yield* Effect.tryPromise(() => tab.page.setViewportSize(viewport));
        tab.viewportSetting = setting;
        yield* manager.resize({
          threadId: request.threadId,
          tabId: tab.tabId,
          viewport: setting,
        });
        return { tabId: tab.tabId, setting, viewport };
      }
      case "setColorScheme": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const { colorScheme } = request.input as PreviewAutomationSetColorSchemeInput;
        yield* Effect.tryPromise(() =>
          tab.page.emulateMedia({ colorScheme: colorScheme === "system" ? null : colorScheme }),
        );
        return { tabId: tab.tabId, colorScheme };
      }
      case "snapshot": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        return yield* Effect.tryPromise(() =>
          runAction(tab, "snapshot", () => captureSnapshot(tab)),
        );
      }
      case "click": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const operationInput = request.input as PreviewAutomationClickInput;
        yield* Effect.tryPromise(() =>
          runAction(tab, "click", async () => {
            if (operationInput.locator || operationInput.selector) {
              await locatorFor(tab.page, operationInput).click({
                timeout: operationInput.timeoutMs ?? request.timeoutMs,
              });
            } else {
              await tab.page.mouse.click(operationInput.x!, operationInput.y!);
            }
          }),
        );
        return undefined;
      }
      case "type": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const operationInput = request.input as PreviewAutomationTypeInput;
        yield* Effect.tryPromise(() =>
          runAction(tab, "type", async () => {
            if (operationInput.locator || operationInput.selector) {
              const locator = locatorFor(tab.page, operationInput);
              if (operationInput.clear) await locator.fill(operationInput.text);
              else {
                await locator.focus({ timeout: operationInput.timeoutMs ?? request.timeoutMs });
                await tab.page.keyboard.insertText(operationInput.text);
              }
              return;
            }
            if (operationInput.clear) {
              await tab.page.evaluate(() => {
                const active = document.activeElement;
                if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                  active.value = "";
                  active.dispatchEvent(new InputEvent("input", { bubbles: true }));
                } else if (active instanceof HTMLElement && active.isContentEditable) {
                  active.replaceChildren();
                  active.dispatchEvent(new InputEvent("input", { bubbles: true }));
                }
              });
            }
            await tab.page.keyboard.insertText(operationInput.text);
          }),
        );
        return undefined;
      }
      case "press": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const operationInput = request.input as PreviewAutomationPressInput;
        const key = [...(operationInput.modifiers ?? []), operationInput.key].join("+");
        yield* Effect.tryPromise(() => runAction(tab, "press", () => tab.page.keyboard.press(key)));
        return undefined;
      }
      case "scroll": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const operationInput = request.input as PreviewAutomationScrollInput;
        yield* Effect.tryPromise(() =>
          runAction(tab, "scroll", async () => {
            if (operationInput.locator || operationInput.selector) {
              await locatorFor(tab.page, operationInput).evaluate(
                (element, delta) => element.scrollBy(delta.x, delta.y),
                { x: operationInput.deltaX ?? 0, y: operationInput.deltaY ?? 0 },
              );
            } else {
              await tab.page.mouse.wheel(operationInput.deltaX ?? 0, operationInput.deltaY ?? 0);
            }
          }),
        );
        return undefined;
      }
      case "evaluate": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const operationInput = request.input as PreviewAutomationEvaluateInput;
        const value = yield* Effect.tryPromise(() =>
          runAction(tab, "evaluate", () => tab.page.evaluate(operationInput.expression)),
        );
        if (operationInput.returnByValue === false) return null;
        const serialized = encodeUnknownJson(value);
        if (Buffer.byteLength(serialized ?? "null", "utf8") > MAX_EVALUATION_BYTES) {
          return yield* Effect.fail(
            remoteError(
              "PreviewAutomationResultTooLargeError",
              `Browser evaluation result exceeds ${MAX_EVALUATION_BYTES} bytes.`,
              { maximumBytes: MAX_EVALUATION_BYTES },
            ),
          );
        }
        return value;
      }
      case "waitFor": {
        const tab = requireTab(controller, request.tabId, request.operation, request.threadId);
        const operationInput = request.input as PreviewAutomationWaitForInput;
        const timeout = operationInput.timeoutMs ?? request.timeoutMs;
        yield* Effect.tryPromise(() =>
          runAction(tab, "waitFor", async () => {
            const waits: Promise<unknown>[] = [];
            if (operationInput.locator || operationInput.selector) {
              waits.push(
                locatorFor(tab.page, operationInput).waitFor({ state: "attached", timeout }),
              );
            }
            if (operationInput.text) {
              waits.push(
                tab.page.getByText(operationInput.text, { exact: false }).first().waitFor({
                  state: "visible",
                  timeout,
                }),
              );
            }
            if (operationInput.urlIncludes) {
              waits.push(
                tab.page.waitForURL((url) => url.href.includes(operationInput.urlIncludes!), {
                  timeout,
                }),
              );
            }
            await Promise.all(waits);
          }),
        );
        return undefined;
      }
      default:
        return yield* Effect.fail(
          remoteError(
            "PreviewAutomationUnsupportedClientError",
            `Server browser does not support ${request.operation}.`,
          ),
        );
    }
  });

export const __testing = {
  requestedViewport,
};

export const layer = Layer.effectDiscard(
  Effect.gen(function* ServerBrowserHostLayer() {
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const manager = yield* PreviewManager.PreviewManager;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const environmentId = yield* environment.getEnvironmentId;
    const controller = new ServerBrowserController();
    yield* Effect.addFinalizer(() => Effect.promise(() => controller.close()));
    const clientId = `${SERVER_BROWSER_CLIENT_ID_PREFIX}-${environmentId}`;
    const stream = yield* broker.connect({
      clientId,
      environmentId,
      supportedOperations: [...SERVER_BROWSER_OPERATIONS],
    });
    const handleRequest = makeRequestHandler({ controller, manager });
    yield* stream.pipe(
      Stream.runForEach((event) => {
        if (event.type === "connected") return Effect.void;
        const response = handleRequest(event.request).pipe(
          Effect.match({
            onFailure: (cause): PreviewAutomationResponse => ({
              clientId,
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: false,
              error: remoteResponseError(cause),
            }),
            onSuccess: (result): PreviewAutomationResponse => ({
              clientId,
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: true,
              result,
            }),
          }),
          Effect.flatMap(broker.respond),
          Effect.catch((cause) =>
            Effect.logWarning("Server browser request failed to respond.", {
              operation: event.request.operation,
              cause,
            }),
          ),
        );
        return Effect.forkScoped(response).pipe(Effect.asVoid);
      }),
      Effect.forkScoped,
    );
    yield* Effect.logInfo("Server-hosted browser automation registered.", {
      environmentId,
      operations: SERVER_BROWSER_OPERATIONS.length,
    });
  }),
);
