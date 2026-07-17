// src/types.ts
var ScannerErrorCode = {
  NoDevice: "NO_DEVICE",
  InsecureContext: "INSECURE_CONTEXT",
  DeviceBusy: "DEVICE_BUSY",
  PermissionDenied: "PERMISSION_DENIED",
  RequestFailed: "REQUEST_FAILED",
  NotSupported: "NOT_SUPPORTED",
  DetectorFailed: "DETECTOR_FAILED"
};

// https://jsr.io/@marianmeres/clog/3.21.0/src/colors.ts
var CLOG_STYLED = /* @__PURE__ */ Symbol.for("@marianmeres/clog-styled");
var SAFE_COLORS = {
  gray: "#969696",
  grey: "#969696",
  red: "#d26565",
  orange: "#cba14d",
  yellow: "#cba14d",
  // same as orange - pure yellow is hard on light bg
  green: "#3dc73d",
  teal: "#4dcba1",
  cyan: "#4dcba1",
  // alias for teal
  blue: "#67afd3",
  purple: "#8e8ed4",
  magenta: "#b080c8",
  pink: "#be5b9d"
};
var AUTO_PALETTE = [
  SAFE_COLORS.gray,
  SAFE_COLORS.red,
  SAFE_COLORS.orange,
  "#8eba36",
  SAFE_COLORS.green,
  SAFE_COLORS.teal,
  SAFE_COLORS.blue,
  SAFE_COLORS.purple,
  SAFE_COLORS.magenta,
  SAFE_COLORS.pink
];
var _autoColorCache = /* @__PURE__ */ new Map();
function autoColor(namespace) {
  const cached = _autoColorCache.get(namespace);
  if (cached !== void 0) return cached;
  const color = AUTO_PALETTE[strHash(namespace) % AUTO_PALETTE.length];
  _autoColorCache.set(namespace, color);
  return color;
}
function strHash(str) {
  let hash = 0;
  for (let i2 = 0; i2 < str.length; i2++) {
    hash = (hash << 5) - hash + str.charCodeAt(i2) | 0;
  }
  return hash >>> 0;
}

// https://jsr.io/@marianmeres/clog/3.21.0/src/clog.ts
var LEVEL_MAP = {
  debug: "DEBUG",
  log: "INFO",
  warn: "WARNING",
  error: "ERROR"
};
var CLOG_SKIP = /* @__PURE__ */ Symbol.for("@marianmeres/clog-skip");
var DEFAULT_JSON_FIELD_NAMES = {
  timestamp: "timestamp",
  level: "level",
  logger: "logger",
  message: "message",
  meta: "meta",
  arg: "arg",
  stack: "stack"
};
var CLOG_INSTANCE = /* @__PURE__ */ Symbol.for("@marianmeres/clog-instance");
var GLOBAL_KEY = /* @__PURE__ */ Symbol.for("@marianmeres/clog");
var GLOBAL = globalThis[GLOBAL_KEY] ??= {
  hook: void 0,
  writer: void 0,
  jsonOutput: false,
  debug: void 0
};
var _cachedRuntime = null;
function detectRuntime() {
  if (_cachedRuntime !== null) return _cachedRuntime;
  if (typeof window !== "undefined" && window?.document) {
    return _cachedRuntime = "browser";
  }
  if (globalThis.Deno?.version?.deno) return _cachedRuntime = "deno";
  if (globalThis.process?.versions?.node) {
    return _cachedRuntime = "node";
  }
  return _cachedRuntime = "unknown";
}
var CLOG_FRAME_MARKERS = ["clog.ts", "colors.ts"];
function isClogFrame(line) {
  return CLOG_FRAME_MARKERS.some((m2) => line.includes(m2));
}
function captureStackLines(limit) {
  const stack = new Error().stack || "";
  const lines = stack.split("\n");
  const relevant = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (/^Error(:|$)/.test(line.trim())) continue;
    if (isClogFrame(line)) continue;
    relevant.push(line);
  }
  if (typeof limit === "number" && limit > 0) {
    return relevant.slice(0, limit);
  }
  return relevant;
}
function formatStack(lines) {
  return "\n---\nStack:\n" + lines.map((v2) => "  " + v2.trim()).join("\n");
}
function renderNs(ns) {
  if (!ns) return "";
  return ns.split(":").map((s2) => `[${s2}]`).join(" ");
}
function _stringifyArgs(args, config) {
  if (!(config?.stringify ?? GLOBAL.stringify)) return args;
  return args.map((arg) => {
    if (arg === null || arg === void 0) return arg;
    if (typeof arg !== "object") return arg;
    if (arg?.[CLOG_STYLED]) return arg.text;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });
}
function stringifyValue(arg) {
  if (arg === null) return "null";
  if (arg === void 0) return "undefined";
  if (typeof arg !== "object") return String(arg);
  if (arg?.[CLOG_STYLED]) return arg.text;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
function _hasStyledArgs(args) {
  return args.some((arg) => arg?.[CLOG_STYLED]);
}
function _cleanStyledArgs(args) {
  return args.map((arg) => arg?.[CLOG_STYLED] ? arg.text : arg);
}
function _processStyledArgs(args) {
  let format = "";
  const values = [];
  for (const arg of args) {
    if (arg?.[CLOG_STYLED]) {
      format += `%c${arg.text}%c `;
      values.push(arg.style, "");
    } else if (typeof arg === "string") {
      format += `${arg} `;
    } else {
      format += "%o ";
      values.push(arg);
    }
  }
  return [format.trim(), values];
}
function firstArgAsString(args, config) {
  if (args.length === 0) return "";
  const concat = config?.concat ?? GLOBAL.concat;
  const stringify = config?.stringify ?? GLOBAL.stringify;
  if (concat || stringify) return stringifyValue(args[0]);
  return String(args[0] ?? "");
}
var CONSOLE_METHOD = {
  DEBUG: "debug",
  INFO: "log",
  WARNING: "warn",
  ERROR: "error"
};
var defaultWriter = (data) => {
  const { level, namespace, args, timestamp, config, stack } = data;
  const runtime = detectRuntime();
  const consoleMethod = CONSOLE_METHOD[level];
  const nsText = renderNs(namespace);
  const stackStr = stack && stack.length ? formatStack(stack) : null;
  const shouldConcat = config?.concat ?? GLOBAL.concat;
  if (shouldConcat) {
    const stringified = args.map(stringifyValue).join(" ");
    const output = runtime === "browser" ? nsText ? `${nsText} ${stringified}` : stringified : `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""} ${stringified}`;
    console[consoleMethod](output, ...stackStr ? [stackStr] : []);
    return;
  }
  const processedArgs = _stringifyArgs(args, config);
  const hasStyled = _hasStyledArgs(processedArgs);
  if ((runtime === "browser" || runtime === "deno") && hasStyled) {
    const [content, contentValues] = _processStyledArgs(processedArgs);
    if (runtime === "browser") {
      console[consoleMethod](
        nsText ? `${nsText} ${content}` : content,
        ...contentValues,
        ...stackStr ? [stackStr] : []
      );
    } else {
      const prefix2 = `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""}`;
      console[consoleMethod](
        `${prefix2} ${content}`,
        ...contentValues,
        ...stackStr ? [stackStr] : []
      );
    }
    return;
  }
  const cleanedArgs = _cleanStyledArgs(processedArgs);
  if (runtime === "browser") {
    if (nsText) {
      console[consoleMethod](
        nsText,
        ...cleanedArgs,
        ...stackStr ? [stackStr] : []
      );
    } else {
      console[consoleMethod](
        ...cleanedArgs,
        ...stackStr ? [stackStr] : []
      );
    }
    return;
  }
  const useJson = config?.jsonOutput ?? GLOBAL.jsonOutput;
  if (useJson) {
    const fieldNames = {
      ...DEFAULT_JSON_FIELD_NAMES,
      ...GLOBAL.jsonFieldNames,
      ...config?.jsonFieldNames
    };
    const output = {
      [fieldNames.timestamp]: timestamp,
      [fieldNames.level]: level,
      ...namespace ? { [fieldNames.logger]: namespace } : {},
      [fieldNames.message]: cleanedArgs[0],
      ...data.meta && { [fieldNames.meta]: data.meta }
    };
    cleanedArgs.slice(1).forEach((arg, i2) => {
      output[`${fieldNames.arg}_${i2}`] = arg?.stack ?? arg;
    });
    if (stackStr) output[fieldNames.stack] = stackStr;
    console[consoleMethod](JSON.stringify(output));
    return;
  }
  const prefix = `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""}`.trim();
  console[consoleMethod](
    prefix,
    ...cleanedArgs,
    ...stackStr ? [stackStr] : []
  );
};
var colorWriter = (configuredColor) => (data) => {
  const { level, namespace, args, timestamp, config, stack } = data;
  const runtime = detectRuntime();
  if (runtime !== "browser" && runtime !== "deno" || !namespace || (config?.concat ?? GLOBAL.concat) || (config?.jsonOutput ?? GLOBAL.jsonOutput)) {
    return defaultWriter(data);
  }
  const color = configuredColor === "auto" ? autoColor(namespace) : configuredColor;
  const processedArgs = _stringifyArgs(args, config);
  const consoleMethod = CONSOLE_METHOD[level];
  const stackStr = stack && stack.length ? formatStack(stack) : null;
  const nsText = renderNs(namespace);
  if (_hasStyledArgs(processedArgs)) {
    const [content, contentValues] = _processStyledArgs(processedArgs);
    if (runtime === "browser") {
      console[consoleMethod](
        `%c${nsText}%c ${content}`,
        `color:${color}`,
        "",
        ...contentValues,
        ...stackStr ? [stackStr] : []
      );
    } else {
      const prefix = `[${timestamp}] [${level}] %c${nsText}%c`;
      console[consoleMethod](
        `${prefix} ${content}`,
        `color:${color}`,
        "",
        ...contentValues,
        ...stackStr ? [stackStr] : []
      );
    }
    return;
  }
  if (runtime === "browser") {
    console[consoleMethod](
      `%c${nsText}`,
      `color:${color}`,
      ...processedArgs,
      ...stackStr ? [stackStr] : []
    );
  } else {
    const prefix = `[${timestamp}] [${level}] %c${nsText}`;
    console[consoleMethod](
      prefix,
      `color:${color}`,
      ...processedArgs,
      ...stackStr ? [stackStr] : []
    );
  }
};
function createClog(namespace, config) {
  const ns = namespace ?? false;
  const _apply = (level, args) => {
    const clonedArgs = args.slice();
    const getMetaFn = config?.getMeta ?? GLOBAL.getMeta;
    const stacktraceConfig = config?.stacktrace ?? GLOBAL.stacktrace;
    const stack = stacktraceConfig ? captureStackLines(
      typeof stacktraceConfig === "number" ? stacktraceConfig : void 0
    ) : void 0;
    const data = {
      level: LEVEL_MAP[level],
      namespace: ns,
      args: clonedArgs,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      config,
      stack
    };
    if (getMetaFn) {
      let _meta;
      let _metaComputed = false;
      Object.defineProperty(data, "meta", {
        get() {
          if (!_metaComputed) {
            _metaComputed = true;
            try {
              _meta = getMetaFn();
            } catch {
              _meta = void 0;
            }
          }
          return _meta;
        },
        enumerable: true,
        configurable: true
      });
    }
    const hookResult = GLOBAL.hook?.(data);
    if (hookResult !== CLOG_SKIP) {
      let writer = GLOBAL.writer ?? config?.writer;
      if (!writer && config?.color) writer = colorWriter(config.color);
      writer = writer ?? defaultWriter;
      writer(data);
    }
    return firstArgAsString(clonedArgs, config);
  };
  const logger = ((...args) => _apply("log", args));
  logger.debug = (...args) => {
    if ((config?.debug ?? GLOBAL.debug) === false) {
      return firstArgAsString(args, config);
    }
    return _apply("debug", args);
  };
  logger.log = (...args) => _apply("log", args);
  logger.warn = (...args) => _apply("warn", args);
  logger.error = (...args) => _apply("error", args);
  Object.defineProperty(logger, "ns", { value: ns, writable: false });
  Object.defineProperty(logger, CLOG_INSTANCE, {
    value: { ns, config },
    enumerable: false,
    writable: false
  });
  return logger;
}
createClog.global = GLOBAL;
createClog.reset = () => {
  createClog.global.hook = void 0;
  createClog.global.writer = void 0;
  createClog.global.jsonOutput = false;
  createClog.global.jsonFieldNames = void 0;
  createClog.global.debug = void 0;
  createClog.global.stringify = void 0;
  createClog.global.concat = void 0;
  createClog.global.stacktrace = void 0;
  createClog.global.getMeta = void 0;
};

// https://jsr.io/@marianmeres/pubsub/3.0.0/src/pubsub.ts
if (typeof Symbol.dispose === "undefined") {
  Symbol.dispose = /* @__PURE__ */ Symbol.for("Symbol.dispose");
}
var WILDCARD = "*";
var PubSub = class {
  #subs = /* @__PURE__ */ new Map();
  #onError;
  constructor(options) {
    this.#onError = options?.onError ?? this.#defaultErrorHandler;
    this.publish = this.publish.bind(this);
    this.subscribe = this.subscribe.bind(this);
    this.subscribeOnce = this.subscribeOnce.bind(this);
    this.subscribeMany = this.subscribeMany.bind(this);
    this.unsubscribe = this.unsubscribe.bind(this);
    this.unsubscribeAll = this.unsubscribeAll.bind(this);
    this.isSubscribed = this.isSubscribed.bind(this);
    this.subscriberCount = this.subscriberCount.bind(this);
    this.hasSubscribers = this.hasSubscribers.bind(this);
    this.topics = this.topics.bind(this);
  }
  #defaultErrorHandler(error, topic, isWildcard) {
    const prefix = isWildcard ? "wildcard subscriber" : "subscriber";
    console.error(`Error in ${prefix} for topic "${topic}":`, error);
  }
  #invoke(cb, data, topic, isWildcard) {
    try {
      const result = cb(data);
      if (result && typeof result.then === "function") {
        result.catch((reason) => {
          const err = reason instanceof Error ? reason : new Error(String(reason));
          this.#onError(err, topic, isWildcard);
        });
      }
    } catch (error) {
      this.#onError(error, topic, isWildcard);
    }
  }
  #makeUnsubscriber(fn) {
    const u2 = (() => fn());
    u2[Symbol.dispose] = fn;
    return u2;
  }
  publish(topic, data) {
    if (topic === WILDCARD) {
      throw new Error(
        `Cannot publish to wildcard topic "*". "*" is reserved for subscribers; publish to a real topic name instead.`
      );
    }
    const direct = this.#subs.get(topic);
    const hadDirect = !!direct && direct.size > 0;
    if (direct) {
      for (const cb of [...direct]) {
        this.#invoke(cb, data, topic, false);
      }
    }
    const wildcards = this.#subs.get(WILDCARD);
    if (wildcards && wildcards.size > 0) {
      const envelope = {
        event: topic,
        data
      };
      for (const cb of [...wildcards]) {
        this.#invoke(cb, envelope, topic, true);
      }
    }
    return hadDirect;
  }
  subscribe(topic, cb) {
    let bucket = this.#subs.get(topic);
    if (!bucket) {
      bucket = /* @__PURE__ */ new Set();
      this.#subs.set(topic, bucket);
    }
    bucket.add(cb);
    return this.#makeUnsubscriber(() => {
      this.unsubscribe(topic, cb);
    });
  }
  subscribeOnce(topic, cb) {
    let fired = false;
    const onceWrapper = (data) => {
      if (fired) return;
      fired = true;
      this.unsubscribe(topic, onceWrapper);
      return cb(data);
    };
    return this.subscribe(topic, onceWrapper);
  }
  subscribeMany(topics, cb) {
    const unsubs = topics.map((t2) => this.subscribe(t2, cb));
    return this.#makeUnsubscriber(() => {
      for (const u2 of unsubs) u2();
    });
  }
  /**
   * Removes a specific callback from a topic, or — if `cb` is omitted —
   * removes every subscriber from the topic. Empty topics are cleaned up.
   *
   * @returns true if anything was removed.
   */
  unsubscribe(topic, cb) {
    const bucket = this.#subs.get(topic);
    if (!bucket) return false;
    if (typeof cb === "function") {
      const removed = bucket.delete(cb);
      if (bucket.size === 0) this.#subs.delete(topic);
      return removed;
    }
    return this.#subs.delete(topic);
  }
  /**
   * Removes every subscriber for `topic`, or — if `topic` is omitted —
   * every subscriber from every topic.
   *
   * @returns true if anything was removed.
   */
  unsubscribeAll(topic) {
    if (topic !== void 0) return this.#subs.delete(topic);
    if (this.#subs.size === 0) return false;
    this.#subs.clear();
    return true;
  }
  /**
   * Checks whether `cb` is subscribed to `topic`. By default also reports true
   * if `cb` is subscribed to the wildcard ("*"). Pass `considerWildcard: false`
   * to require an exact, direct subscription.
   */
  isSubscribed(topic, cb, considerWildcard = true) {
    if (this.#subs.get(topic)?.has(cb)) return true;
    if (considerWildcard && this.#subs.get(WILDCARD)?.has(cb)) return true;
    return false;
  }
  /**
   * Returns the subscriber count for `topic`, or — if `topic` is omitted —
   * the total count across all topics (including wildcard).
   */
  subscriberCount(topic) {
    if (topic !== void 0) return this.#subs.get(topic)?.size ?? 0;
    let total = 0;
    for (const set of this.#subs.values()) total += set.size;
    return total;
  }
  /**
   * Returns true if `topic` has at least one direct subscriber.
   * (Does not consider wildcard subscribers.)
   */
  hasSubscribers(topic) {
    return (this.#subs.get(topic)?.size ?? 0) > 0;
  }
  /**
   * Lists topics that currently have at least one subscriber. Includes "*"
   * if there are wildcard subscribers.
   */
  topics() {
    return [...this.#subs.keys()];
  }
  /**
   * Returns a defensive snapshot of internal subscriptions for debugging.
   * Mutating the returned object does not affect the instance.
   *
   * @internal Intended for debugging and tests only.
   */
  __dump() {
    const out = {};
    for (const [topic, set] of this.#subs.entries()) {
      out[topic] = new Set(set);
    }
    return out;
  }
};
function createPubSub(options) {
  return new PubSub(options);
}

// https://jsr.io/@marianmeres/store/3.0.1/src/store.ts
var isFn = (v2) => typeof v2 === "function";
var assertFn = (v2, prefix = "") => {
  if (!isFn(v2)) throw new TypeError(`${prefix} Expecting function arg`.trim());
};
var strictEqual = (a2, b2) => a2 === b2;
function createStore(initial, options = null) {
  const _equal = options?.equal ?? strictEqual;
  const _maybePersist = (v2) => {
    if (options?.persist) {
      try {
        options.persist(v2);
      } catch (e2) {
        if (options.onPersistError) {
          options.onPersistError(e2);
        } else {
          console.warn("Store persistence failed:", e2);
        }
      }
    }
  };
  const _handleInitialSubscriberError = (e2) => {
    const err = e2 instanceof Error ? e2 : new Error(String(e2));
    if (options?.onError) {
      options.onError(err, "change", false);
    } else {
      console.error(`Error in subscriber for topic "change":`, err);
    }
  };
  const _pubsub = createPubSub(
    options?.onError ? {
      onError: (e2, topic, isWildcard) => options.onError(e2, topic, isWildcard)
    } : void 0
  );
  let _value = initial;
  if (options?.eagerPersist !== false) {
    _maybePersist(_value);
  }
  const get = () => _value;
  let _notifying = false;
  let _hasPending = false;
  let _pendingValue;
  const _applyChange = (value) => {
    _value = value;
    _maybePersist(_value);
    _pubsub.publish("change", _value);
  };
  const set = (value) => {
    if (_equal(_value, value)) return;
    if (_notifying) {
      _hasPending = true;
      _pendingValue = value;
      return;
    }
    _notifying = true;
    try {
      _applyChange(value);
      while (_hasPending) {
        const next = _pendingValue;
        _hasPending = false;
        if (!_equal(_value, next)) _applyChange(next);
      }
    } finally {
      _notifying = false;
      _hasPending = false;
    }
  };
  const update = (cb) => {
    assertFn(cb, "[update]");
    set(cb(get()));
  };
  const subscribe = (cb) => {
    assertFn(cb, "[subscribe]");
    try {
      cb(_value);
    } catch (e2) {
      _handleInitialSubscriberError(e2);
    }
    return _pubsub.subscribe("change", cb);
  };
  return { set, get, update, subscribe };
}

// https://jsr.io/@marianmeres/mediaperms/1.1.1/src/mediaperms.ts
var MediaPermsErrorCode = {
  CheckFailed: "CHECK_FAILED",
  RequestFailed: "REQUEST_FAILED",
  NoDevice: "NO_DEVICE",
  InsecureContext: "INSECURE_CONTEXT",
  DeviceBusy: "DEVICE_BUSY"
};
function devicesForKind(kind) {
  switch (kind) {
    case "microphone":
      return ["microphone"];
    case "camera":
      return ["camera"];
    case "camera-and-microphone":
      return ["camera", "microphone"];
  }
  throw new Error(
    `mediaperms: invalid kind "${kind}" \u2014 expected "microphone" | "camera" | "camera-and-microphone"`
  );
}
function mergeStatuses(statuses) {
  if (!statuses.length) return "unknown";
  if (statuses.includes("denied")) return "denied";
  if (statuses.includes("prompt")) return "prompt";
  if (statuses.includes("unknown")) return "unknown";
  return statuses.every((s2) => s2 === "granted") ? "granted" : "unknown";
}
var DEFAULT_LOGGER = createClog("mediaperms");
function createDefaultAdapter(kind) {
  const constraints = {
    ...kind !== "camera" ? { audio: true } : {},
    ...kind !== "microphone" ? { video: true } : {}
  };
  function supportsPermissionsApi() {
    return typeof navigator !== "undefined" && typeof navigator.permissions?.query === "function";
  }
  async function queryPermission(device) {
    try {
      if (!supportsPermissionsApi()) return null;
      const result = await navigator.permissions.query({
        name: device
      });
      return result.state;
    } catch {
      return null;
    }
  }
  async function requestPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((t2) => t2.stop());
      return "granted";
    } catch (e2) {
      if (e2 instanceof DOMException) {
        const name = e2.name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          return "denied";
        }
      }
      throw e2;
    }
  }
  function onPermissionChange(device, cb) {
    if (!supportsPermissionsApi()) return null;
    let permStatus = null;
    let canceled = false;
    const handler = () => {
      if (canceled || !permStatus) return;
      cb(permStatus.state);
    };
    navigator.permissions.query({ name: device }).then((result) => {
      if (canceled) {
        result.onchange = null;
        return;
      }
      permStatus = result;
      result.onchange = handler;
    }).catch(() => {
    });
    return () => {
      canceled = true;
      if (permStatus) permStatus.onchange = null;
    };
  }
  return {
    queryPermission,
    requestPermission,
    supportsPermissionsApi,
    onPermissionChange
  };
}
var _g = globalThis;
function detectPlatform(config) {
  if (config.platform) return config.platform;
  try {
    if (_g.webkit?.messageHandlers) return "ios-webview";
  } catch {
  }
  try {
    if (_g[config.androidBridgeObject ?? "Android"]) {
      return "android-webview";
    }
  } catch {
  }
  try {
    if (_g.matchMedia?.("(display-mode: standalone)").matches || _g.navigator?.standalone === true) {
      return "pwa";
    }
  } catch {
  }
  return "browser";
}
function detectBridge(platform, config) {
  const iosBridgeHandler = config.iosBridgeHandler ?? "openAppSettings";
  const androidBridgeObject = config.androidBridgeObject ?? "Android";
  const androidBridgeMethod = config.androidBridgeMethod ?? "openAppSettings";
  try {
    if (platform === "ios-webview") {
      return !!_g.webkit?.messageHandlers?.[iosBridgeHandler];
    }
    if (platform === "android-webview") {
      return typeof _g[androidBridgeObject]?.[androidBridgeMethod] === "function";
    }
  } catch {
  }
  return false;
}
function classifyRequestError(e2) {
  if (e2 instanceof DOMException) {
    const name = e2.name;
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
      return MediaPermsErrorCode.NoDevice;
    }
    if (name === "SecurityError") {
      return MediaPermsErrorCode.InsecureContext;
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return MediaPermsErrorCode.DeviceBusy;
    }
  }
  return MediaPermsErrorCode.RequestFailed;
}
function observeDevice(dev, incoming) {
  if (incoming === "granted" && dev.observedDenied) {
    return { ...dev, observedDenied: false };
  }
  if (incoming === "denied" && !dev.observedDenied) {
    return { ...dev, observedDenied: true };
  }
  return dev;
}
function coerceStatus(dev, incoming) {
  if (dev.observedDenied && (incoming === "prompt" || incoming === "unknown")) {
    return "denied";
  }
  return incoming;
}
function createMediaPerms(kind, config) {
  const deviceKinds = devicesForKind(kind);
  const cfg = { ...config };
  const iosBridgeHandler = cfg.iosBridgeHandler ?? "openAppSettings";
  const androidBridgeObject = cfg.androidBridgeObject ?? "Android";
  const androidBridgeMethod = cfg.androidBridgeMethod ?? "openAppSettings";
  const appResumedEvent = cfg.appResumedEvent ?? "app-resumed";
  const log = cfg.logger ?? DEFAULT_LOGGER;
  const platform = detectPlatform(cfg);
  const adapter = cfg.adapter ?? createDefaultAdapter(kind);
  const canOpenSettings = detectBridge(platform, cfg);
  const initialDevices = {};
  for (const d2 of deviceKinds) {
    initialDevices[d2] = { status: "unknown", observedDenied: false };
  }
  const store = createStore({
    kind,
    status: "unknown",
    devices: initialDevices,
    platform,
    canOpenSettings,
    busy: false,
    observedDenied: false,
    error: null,
    lastCheckedAt: null
  });
  let destroyed = false;
  const cleanups = [];
  let inFlightCheck = null;
  let inFlightRequest = null;
  const MIN_PASSIVE_INTERVAL_MS = 500;
  function applyIncoming(devices, device, incoming) {
    const prev = devices[device];
    const observed = observeDevice(prev, incoming);
    const status = coerceStatus(observed, incoming);
    if (observed === prev && status === prev.status) return devices;
    return { ...devices, [device]: { ...observed, status } };
  }
  function commitDevices(updater, extra = {}) {
    store.update((s2) => {
      const devices = updater(s2.devices);
      return {
        ...s2,
        ...extra,
        devices,
        status: mergeStatuses(
          deviceKinds.map((d2) => devices[d2].status)
        ),
        observedDenied: deviceKinds.some(
          (d2) => devices[d2].observedDenied
        )
      };
    });
  }
  function clearObservedDenied() {
    if (!store.get().observedDenied) return;
    commitDevices((devices) => {
      const next = {};
      for (const d2 of deviceKinds) {
        const dev = devices[d2];
        next[d2] = dev.observedDenied ? { ...dev, observedDenied: false } : dev;
      }
      return next;
    });
  }
  for (const device of deviceKinds) {
    const permCleanup = adapter.onPermissionChange(
      device,
      (status) => {
        if (destroyed) return;
        commitDevices(
          (devices) => applyIncoming(devices, device, status),
          { lastCheckedAt: Date.now() }
        );
      }
    );
    if (permCleanup) cleanups.push(permCleanup);
  }
  function shouldSkipPassive() {
    const last = store.get().lastCheckedAt ?? 0;
    return Date.now() - last < MIN_PASSIVE_INTERVAL_MS;
  }
  if (typeof _g.addEventListener === "function") {
    const handleAppResumed = () => {
      if (destroyed || shouldSkipPassive()) return;
      check();
    };
    _g.addEventListener(appResumedEvent, handleAppResumed);
    cleanups.push(() => _g.removeEventListener(appResumedEvent, handleAppResumed));
    const handlePageshow = (e2) => {
      if (destroyed) return;
      if (!e2.persisted) return;
      if (shouldSkipPassive()) return;
      check();
    };
    _g.addEventListener("pageshow", handlePageshow);
    cleanups.push(() => _g.removeEventListener("pageshow", handlePageshow));
  }
  if (typeof _g.document !== "undefined") {
    const handleVisibility = () => {
      if (destroyed) return;
      if (_g.document.visibilityState !== "visible") return;
      if (shouldSkipPassive()) return;
      check();
    };
    _g.document.addEventListener("visibilitychange", handleVisibility);
    cleanups.push(
      () => _g.document.removeEventListener(
        "visibilitychange",
        handleVisibility
      )
    );
  }
  function check() {
    if (destroyed) {
      log.warn("mediaperms: check() called after destroy() \u2014 no-op");
      return Promise.resolve(store.get().status);
    }
    if (inFlightCheck) return inFlightCheck;
    inFlightCheck = (async () => {
      store.update((s2) => ({ ...s2, busy: true, error: null }));
      try {
        const results = await Promise.all(
          deviceKinds.map((d2) => adapter.queryPermission(d2))
        );
        const anyValue = results.some((r2) => r2 !== null);
        commitDevices(
          (devices) => {
            let next = devices;
            deviceKinds.forEach((d2, i2) => {
              const r2 = results[i2];
              if (r2 !== null) next = applyIncoming(next, d2, r2);
            });
            return next;
          },
          {
            busy: false,
            ...anyValue ? { lastCheckedAt: Date.now() } : {}
          }
        );
        return store.get().status;
      } catch (e2) {
        const message = e2 instanceof Error ? e2.message : "Permission check failed";
        log.error("mediaperms check failed", e2);
        store.update((s2) => ({
          ...s2,
          busy: false,
          error: {
            code: MediaPermsErrorCode.CheckFailed,
            message
          }
        }));
        return store.get().status;
      } finally {
        inFlightCheck = null;
      }
    })();
    return inFlightCheck;
  }
  function request() {
    if (destroyed) {
      log.warn("mediaperms: request() called after destroy() \u2014 no-op");
      return Promise.resolve(store.get().status);
    }
    if (inFlightRequest) return inFlightRequest;
    inFlightRequest = (async () => {
      store.update((s2) => ({ ...s2, busy: true, error: null }));
      try {
        const result = await adapter.requestPermission();
        commitDevices(
          (devices) => {
            let next = devices;
            for (const d2 of deviceKinds) {
              next = applyIncoming(next, d2, result);
            }
            return next;
          },
          { busy: false, lastCheckedAt: Date.now() }
        );
        if (result === "denied" && deviceKinds.length > 1 && adapter.supportsPermissionsApi()) {
          try {
            const refined = await Promise.all(
              deviceKinds.map((d2) => adapter.queryPermission(d2))
            );
            if (refined.some((r2) => r2 === "denied")) {
              commitDevices((devices) => {
                let next = devices;
                deviceKinds.forEach((d2, i2) => {
                  const r2 = refined[i2];
                  if (r2 !== null) {
                    next = applyIncoming(next, d2, r2);
                  }
                });
                return next;
              });
            }
          } catch {
          }
        }
        return store.get().status;
      } catch (e2) {
        const code = classifyRequestError(e2);
        const message = e2 instanceof Error ? e2.message : "Permission request failed";
        log.error("mediaperms request failed", e2);
        store.update((s2) => ({
          ...s2,
          busy: false,
          error: { code, message }
        }));
        return store.get().status;
      } finally {
        inFlightRequest = null;
      }
    })();
    return inFlightRequest;
  }
  function openSettings() {
    if (!canOpenSettings) return false;
    try {
      if (platform === "ios-webview") {
        _g.webkit.messageHandlers[iosBridgeHandler].postMessage({});
        clearObservedDenied();
        return true;
      }
      if (platform === "android-webview") {
        _g[androidBridgeObject][androidBridgeMethod]();
        clearObservedDenied();
        return true;
      }
    } catch (e2) {
      log.error("mediaperms openSettings failed", e2);
    }
    return false;
  }
  async function recheck() {
    const status = await check();
    if (status === "unknown" || status === "prompt") {
      return await request();
    }
    return status;
  }
  function reset() {
    if (destroyed) return;
    commitDevices(
      () => {
        const next = {};
        for (const d2 of deviceKinds) {
          next[d2] = { status: "unknown", observedDenied: false };
        }
        return next;
      },
      { error: null, lastCheckedAt: null }
    );
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  }
  return {
    subscribe: store.subscribe.bind(store),
    get: store.get.bind(store),
    check,
    request,
    openSettings,
    recheck,
    reset,
    destroy
  };
}
function createCamPerms(config) {
  return createMediaPerms("camera", config);
}

// src/camera-adapter.ts
var _g2 = globalThis;
function detectFacing(label) {
  if (/back|rear|environment/i.test(label)) return "environment";
  if (/front|user|facetime|selfie/i.test(label)) return "user";
  return null;
}
function mediaDevices() {
  return _g2?.navigator?.mediaDevices ?? null;
}
function createDefaultCameraAdapter(options = {}) {
  let perms = options.perms ?? null;
  let ownsPerms = false;
  let destroyed = false;
  function getPerms() {
    if (!perms) {
      perms = createCamPerms(options.permsConfig);
      ownsPerms = true;
    }
    return perms;
  }
  return {
    getStream(constraints) {
      const md = mediaDevices();
      if (!md?.getUserMedia) {
        const err = new Error("navigator.mediaDevices.getUserMedia unavailable");
        err.name = "NotSupportedError";
        return Promise.reject(err);
      }
      return md.getUserMedia(constraints);
    },
    async enumerateVideoDevices() {
      const md = mediaDevices();
      if (!md?.enumerateDevices) return [];
      const devices = await md.enumerateDevices();
      return devices.filter((d2) => d2.kind === "videoinput").map((d2) => ({
        deviceId: d2.deviceId,
        label: d2.label ?? "",
        facing: detectFacing(d2.label ?? "")
      }));
    },
    async queryPermission() {
      if (destroyed) return null;
      try {
        const status = await getPerms().check();
        return status === "unknown" ? null : status;
      } catch (_e2) {
        return null;
      }
    },
    onPermissionChange(cb) {
      if (destroyed) return null;
      let last = null;
      let first = true;
      return getPerms().subscribe((s2) => {
        const status = s2.status;
        if (!first && status !== last) cb(status);
        first = false;
        last = status;
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (ownsPerms) perms?.destroy();
      perms = null;
    }
  };
}

// ../../../Library/Caches/deno/deno_esbuild/registry.npmjs.org/barcode-detector@3.2.1_@types+emscripten@1.41.5/node_modules/barcode-detector/dist/es/zxing-exported.js
var e = [
  [
    "All",
    "*",
    "*",
    "     ",
    0,
    "All"
  ],
  [
    "AllReadable",
    "*",
    "r",
    "     ",
    0,
    "All Readable"
  ],
  [
    "AllCreatable",
    "*",
    "w",
    "     ",
    0,
    "All Creatable"
  ],
  [
    "AllLinear",
    "*",
    "l",
    "     ",
    0,
    "All Linear"
  ],
  [
    "AllMatrix",
    "*",
    "m",
    "     ",
    0,
    "All Matrix"
  ],
  [
    "AllGS1",
    "*",
    "G",
    "     ",
    0,
    "All GS1"
  ],
  [
    "AllRetail",
    "*",
    "R",
    "     ",
    0,
    "All Retail"
  ],
  [
    "AllIndustrial",
    "*",
    "I",
    "     ",
    0,
    "All Industrial"
  ],
  [
    "Codabar",
    "F",
    " ",
    "lrw  ",
    18,
    "Codabar"
  ],
  [
    "Code39",
    "A",
    " ",
    "lrw I",
    8,
    "Code 39"
  ],
  [
    "Code39Std",
    "A",
    "s",
    "lrw I",
    8,
    "Code 39 Standard"
  ],
  [
    "Code39Ext",
    "A",
    "e",
    "lr  I",
    9,
    "Code 39 Extended"
  ],
  [
    "Code32",
    "A",
    "2",
    "lr  I",
    129,
    "Code 32"
  ],
  [
    "PZN",
    "A",
    "p",
    "lr  I",
    52,
    "Pharmazentralnummer"
  ],
  [
    "Code93",
    "G",
    " ",
    "lrw I",
    25,
    "Code 93"
  ],
  [
    "Code128",
    "C",
    " ",
    "lrwGI",
    20,
    "Code 128"
  ],
  [
    "ITF",
    "I",
    " ",
    "lrw I",
    3,
    "ITF"
  ],
  [
    "ITF14",
    "I",
    "4",
    "lr  I",
    89,
    "ITF-14"
  ],
  [
    "DataBar",
    "e",
    " ",
    "lr GR",
    29,
    "DataBar"
  ],
  [
    "DataBarOmni",
    "e",
    "o",
    "lr GR",
    29,
    "DataBar Omni"
  ],
  [
    "DataBarStk",
    "e",
    "s",
    "lr GR",
    79,
    "DataBar Stacked"
  ],
  [
    "DataBarStkOmni",
    "e",
    "O",
    "lr GR",
    80,
    "DataBar Stacked Omni"
  ],
  [
    "DataBarLtd",
    "e",
    "l",
    "lr GR",
    30,
    "DataBar Limited"
  ],
  [
    "DataBarExp",
    "e",
    "e",
    "lr GR",
    31,
    "DataBar Expanded"
  ],
  [
    "DataBarExpStk",
    "e",
    "E",
    "lr GR",
    81,
    "DataBar Expanded Stacked"
  ],
  [
    "EANUPC",
    "E",
    " ",
    "lr  R",
    15,
    "EAN/UPC"
  ],
  [
    "EAN13",
    "E",
    "1",
    "lrw R",
    15,
    "EAN-13"
  ],
  [
    "EAN8",
    "E",
    "8",
    "lrw R",
    10,
    "EAN-8"
  ],
  [
    "EAN5",
    "E",
    "5",
    "l   R",
    12,
    "EAN-5"
  ],
  [
    "EAN2",
    "E",
    "2",
    "l   R",
    11,
    "EAN-2"
  ],
  [
    "ISBN",
    "E",
    "i",
    "lr  R",
    69,
    "ISBN"
  ],
  [
    "UPCA",
    "E",
    "a",
    "lrw R",
    34,
    "UPC-A"
  ],
  [
    "UPCE",
    "E",
    "e",
    "lrw R",
    37,
    "UPC-E"
  ],
  [
    "Telepen",
    "B",
    " ",
    "lr  I",
    32,
    "Telepen"
  ],
  [
    "TelepenAlpha",
    "B",
    "0",
    "lr  I",
    32,
    "Telepen Alpha"
  ],
  [
    "TelepenNumeric",
    "B",
    "1",
    "lr  I",
    87,
    "Telepen Numeric"
  ],
  [
    "OtherBarcode",
    "X",
    " ",
    " r   ",
    0,
    "Other barcode"
  ],
  [
    "DXFilmEdge",
    "X",
    "x",
    "lr   ",
    147,
    "DX Film Edge"
  ],
  [
    "PDF417",
    "L",
    " ",
    "mrw  ",
    55,
    "PDF417"
  ],
  [
    "CompactPDF417",
    "L",
    "c",
    "mr   ",
    56,
    "Compact PDF417"
  ],
  [
    "MicroPDF417",
    "L",
    "m",
    "mr   ",
    84,
    "MicroPDF417"
  ],
  [
    "Aztec",
    "z",
    " ",
    "mr G ",
    92,
    "Aztec"
  ],
  [
    "AztecCode",
    "z",
    "c",
    "mrwG ",
    92,
    "Aztec Code"
  ],
  [
    "AztecRune",
    "z",
    "r",
    "mr   ",
    128,
    "Aztec Rune"
  ],
  [
    "QRCode",
    "Q",
    " ",
    "mrwG ",
    58,
    "QR Code"
  ],
  [
    "QRCodeModel1",
    "Q",
    "1",
    "mr   ",
    0,
    "QR Code Model 1"
  ],
  [
    "QRCodeModel2",
    "Q",
    "2",
    "mr   ",
    58,
    "QR Code Model 2"
  ],
  [
    "MicroQRCode",
    "Q",
    "m",
    "mr   ",
    97,
    "Micro QR Code"
  ],
  [
    "RMQRCode",
    "Q",
    "r",
    "mr G ",
    145,
    "rMQR Code"
  ],
  [
    "DataMatrix",
    "d",
    " ",
    "mrwG ",
    71,
    "Data Matrix"
  ],
  [
    "MaxiCode",
    "U",
    " ",
    "mr   ",
    57,
    "MaxiCode"
  ]
];
var t = {
  DataBarExpanded: "DataBarExp",
  DataBarLimited: "DataBarLtd",
  "Linear-Codes": "AllLinear",
  "Matrix-Codes": "AllMatrix",
  Any: "All",
  rMQRCode: "RMQRCode"
};
e.map((e2) => e2[5]), e.filter((e2) => e2[1] === "*").map((e2) => e2[0]), e.filter((e2) => e2[1] !== "*").map((e2) => e2[0]), e.filter((e2) => e2[2] === " ").map((e2) => e2[0]), e.filter((e2) => e2[3][0] === "l").map((e2) => e2[0]), e.filter((e2) => e2[3][0] === "m").map((e2) => e2[0]), e.filter((e2) => e2[3][1] === "r").map((e2) => e2[0]), e.filter((e2) => e2[3][2] === "w" || e2[4] !== 0).map((e2) => e2[0]), e.filter((e2) => e2[3][3] === "G").map((e2) => e2[0]), e.filter((e2) => e2[3][4] === "R").map((e2) => e2[0]), e.filter((e2) => e2[3][4] === "I").map((e2) => e2[0]);
function n(e2) {
  var n2;
  return (n2 = t[e2]) == null ? e2 : n2;
}
function r(e2) {
  return e2.map(n).join(",");
}
var i = [
  "LocalAverage",
  "GlobalHistogram",
  "FixedThreshold",
  "BoolCast"
];
function a(e2) {
  return i.indexOf(e2);
}
var o = /* @__PURE__ */ "Unknown.ASCII.ISO8859_1.ISO8859_2.ISO8859_3.ISO8859_4.ISO8859_5.ISO8859_6.ISO8859_7.ISO8859_8.ISO8859_9.ISO8859_10.ISO8859_11.ISO8859_13.ISO8859_14.ISO8859_15.ISO8859_16.Cp437.Cp1250.Cp1251.Cp1252.Cp1256.Shift_JIS.Big5.GB2312.GB18030.EUC_JP.EUC_KR.UTF16BE.UTF8.UTF16LE.UTF32BE.UTF32LE.BINARY".split(".");
function s(e2) {
  return e2 === "UnicodeBig" ? o.indexOf("UTF16BE") : o.indexOf(e2);
}
var c = [
  "Text",
  "Binary",
  "Mixed",
  "GS1",
  "ISO15434",
  "UnknownECI"
];
function l(e2) {
  return c[e2];
}
var u = [
  "Ignore",
  "Read",
  "Require"
];
function d(e2) {
  return u.indexOf(e2);
}
var f = [
  "Plain",
  "ECI",
  "HRI",
  "Escaped",
  "Hex",
  "HexECI"
];
function p(e2) {
  return f.indexOf(e2);
}
var m = {
  formats: [],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  tryDenoise: false,
  binarizer: "LocalAverage",
  isPure: false,
  downscaleFactor: 3,
  downscaleThreshold: 500,
  minLineCount: 2,
  maxNumberOfSymbols: 255,
  validateOptionalChecksum: false,
  returnErrors: false,
  eanAddOnSymbol: "Ignore",
  textMode: "HRI",
  characterSet: "Unknown",
  tryCode39ExtendedMode: true
};
function h(e2) {
  var t2;
  return {
    ...e2,
    formats: r(e2.formats),
    binarizer: a(e2.binarizer),
    eanAddOnSymbol: d(e2.eanAddOnSymbol),
    textMode: p(e2.textMode),
    characterSet: s(e2.characterSet),
    tryCode39ExtendedMode: (t2 = e2.tryCode39ExtendedMode) == null || t2
  };
}
function g(e2) {
  return {
    ...e2,
    format: e2.format,
    symbology: e2.symbology,
    contentType: l(e2.contentType)
  };
}
var _ = {
  format: "QRCode",
  readerInit: false,
  forceSquareDataMatrix: false,
  ecLevel: "",
  scale: 1,
  sizeHint: 0,
  rotate: 0,
  invert: false,
  withHRT: false,
  withQuietZones: true,
  addHRT: false,
  addQuietZones: true,
  options: ""
};
var ne = { locateFile: (e2, t2) => {
  let n2 = e2.match(/_(.+?)\.wasm$/);
  return n2 ? `https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.1/dist/${n2[1]}/${e2}` : t2 + e2;
} };
var v = /* @__PURE__ */ new WeakMap();
function re(e2, t2) {
  return Object.is(e2, t2) || Object.keys(e2).length === Object.keys(t2).length && Object.keys(e2).every((n2) => Object.hasOwn(t2, n2) && e2[n2] === t2[n2]);
}
function ie(e2, { overrides: t2, equalityFn: n2 = re, fireImmediately: r2 = false } = {}) {
  var i2, a2;
  let [o2, s2] = (i2 = v.get(e2)) == null ? [ne] : i2, c2 = t2 == null ? o2 : t2, l2;
  if (r2) {
    if (s2 && (l2 = n2(o2, c2))) return s2;
    let t3 = e2({ ...c2 });
    return v.set(e2, [c2, t3]), t3;
  }
  ((a2 = l2) == null ? n2(o2, c2) : a2) || v.set(e2, [c2]);
}
function y(e2) {
  let t2 = e2.byteLength >> 2, n2 = new Uint8Array(t2);
  for (let r2 = 0; r2 < t2; r2++) {
    let t3 = r2 << 2;
    n2[r2] = 306 * e2[t3] + 601 * e2[t3 + 1] + 117 * e2[t3 + 2] + 512 >> 10;
  }
  return n2;
}
async function oe(e2, t2, n2 = m) {
  let r2 = {
    ...m,
    ...n2
  }, i2 = await ie(e2, { fireImmediately: true }), a2, o2;
  if ("width" in t2 && "height" in t2 && "data" in t2) {
    let { data: e3, width: n3, height: s3 } = t2, c2 = y(e3), l2 = c2.byteLength;
    if (o2 = i2._malloc(l2), !o2) throw Error(`Failed to allocate ${l2} bytes in WASM memory`);
    try {
      i2.HEAPU8.set(c2, o2), a2 = i2.readBarcodesFromPixmap(o2, n3, s3, h(r2));
    } finally {
      i2._free(o2);
    }
  } else {
    let e3, n3;
    if ("buffer" in t2) [e3, n3] = [t2.byteLength, t2];
    else if ("byteLength" in t2) [e3, n3] = [t2.byteLength, new Uint8Array(t2)];
    else if ("size" in t2) [e3, n3] = [t2.size, new Uint8Array(await t2.arrayBuffer())];
    else throw TypeError("Invalid input type");
    if (o2 = i2._malloc(e3), !o2) throw Error(`Failed to allocate ${e3} bytes in WASM memory`);
    try {
      i2.HEAPU8.set(n3, o2), a2 = i2.readBarcodesFromImage(o2, e3, h(r2));
    } finally {
      i2._free(o2);
    }
  }
  let s2 = [];
  for (let e3 = 0; e3 < a2.size(); ++e3) s2.push(g(a2.get(e3)));
  return s2;
}
({ ...m }, [...m.formats]), { ..._ };
async function se(e2 = {}) {
  var t2, n2, r2, i2 = e2, a2 = !!globalThis.window, o2 = typeof Bun < "u", s2 = !!globalThis.WorkerGlobalScope;
  !((n2 = globalThis.process) == null || (n2 = n2.versions) == null) && n2.node && ((r2 = globalThis.process) == null || r2.type);
  var c2 = "./this.program", l2, u2 = "";
  function d2(e3) {
    return i2.locateFile ? i2.locateFile(e3, u2) : u2 + e3;
  }
  var f2, p2;
  if (a2 || s2 || o2) {
    try {
      u2 = new URL(".", l2).href;
    } catch {
    }
    s2 && (p2 = (e3) => {
      var t3 = new XMLHttpRequest();
      return t3.open("GET", e3, false), t3.responseType = "arraybuffer", t3.send(null), new Uint8Array(t3.response);
    }), f2 = async (e3) => {
      var t3 = await fetch(e3, { credentials: "same-origin" });
      if (t3.ok) return t3.arrayBuffer();
      throw Error(t3.status + " : " + t3.url);
    };
  }
  console.log.bind(console);
  var m2 = console.error.bind(console), h2, g2 = false, _2, ee2, te2 = false;
  function ne2() {
    var e3 = Un.buffer;
    S2 = new Int8Array(e3), b2 = new Int16Array(e3), i2.HEAPU8 = T2 = new Uint8Array(e3), C2 = new Uint16Array(e3), x2 = new Int32Array(e3), w2 = new Uint32Array(e3), pe2 = new Float32Array(e3), me2 = new Float64Array(e3);
  }
  function v2() {
    if (i2.preRun) for (typeof i2.preRun == "function" && (i2.preRun = [i2.preRun]); i2.preRun.length; ) ye2(i2.preRun.shift());
    he2(ve2);
  }
  function re2() {
    te2 = true, Mr.ya();
  }
  function ie2() {
    if (i2.postRun) for (typeof i2.postRun == "function" && (i2.postRun = [i2.postRun]); i2.postRun.length; ) _e2(i2.postRun.shift());
    he2(ge2);
  }
  function ae(e3) {
    var t3, n3;
    (t3 = i2.onAbort) == null || t3.call(i2, e3), e3 = "Aborted(" + e3 + ")", m2(e3), g2 = true, e3 += ". Build with -sASSERTIONS for more info.";
    var r3 = new WebAssembly.RuntimeError(e3);
    throw (n3 = ee2) == null || n3(r3), r3;
  }
  var y2;
  function oe2() {
    return d2("zxing_reader.wasm");
  }
  function se2(e3) {
    if (e3 == y2 && h2) return new Uint8Array(h2);
    if (p2) return p2(e3);
    throw "both async and sync fetching of the wasm failed";
  }
  async function ce2(e3) {
    if (!h2) try {
      var t3 = await f2(e3);
      return new Uint8Array(t3);
    } catch {
    }
    return se2(e3);
  }
  async function le2(e3, t3) {
    try {
      var n3 = await ce2(e3);
      return await WebAssembly.instantiate(n3, t3);
    } catch (e4) {
      m2(`failed to asynchronously prepare wasm: ${e4}`), ae(e4);
    }
  }
  async function ue2(e3, t3, n3) {
    if (!e3 && WebAssembly.instantiateStreaming) try {
      var r3 = fetch(t3, { credentials: "same-origin" });
      return await WebAssembly.instantiateStreaming(r3, n3);
    } catch (e4) {
      m2(`wasm streaming compile failed: ${e4}`), m2("falling back to ArrayBuffer instantiation");
    }
    return le2(t3, n3);
  }
  function de2() {
    return { a: Kn };
  }
  async function fe2() {
    function e3(e4, t4) {
      return Mr = e4.exports, Gn(Mr), ne2(), Mr;
    }
    function t3(t4) {
      return e3(t4.instance);
    }
    var n3 = de2();
    return i2.instantiateWasm ? new Promise((t4, r3) => {
      i2.instantiateWasm(n3, (n4, r4) => {
        t4(e3(n4, r4));
      });
    }) : (y2 != null || (y2 = oe2()), t3(await ue2(h2, y2, n3)));
  }
  var b2, x2, S2, pe2, me2, C2, w2, T2, he2 = (e3) => {
    for (; e3.length > 0; ) e3.shift()(i2);
  }, ge2 = [], _e2 = (e3) => ge2.push(e3), ve2 = [], ye2 = (e3) => ve2.push(e3), E2 = (e3) => Fn(e3), D2 = () => In(), O2 = [], k2 = 0, be2 = (e3) => {
    var t3 = new Se2(e3);
    return t3.get_caught() || (t3.set_caught(true), k2--), t3.set_rethrown(false), O2.push(t3), Nn(e3);
  }, A2 = 0, xe2 = () => {
    $(0, 0);
    var e3 = O2.pop();
    Ln(e3.excPtr), A2 = 0;
  };
  class Se2 {
    constructor(e3) {
      this.excPtr = e3, this.ptr = e3 - 24;
    }
    set_type(e3) {
      w2[this.ptr + 4 >> 2] = e3;
    }
    get_type() {
      return w2[this.ptr + 4 >> 2];
    }
    set_destructor(e3) {
      w2[this.ptr + 8 >> 2] = e3;
    }
    get_destructor() {
      return w2[this.ptr + 8 >> 2];
    }
    set_caught(e3) {
      e3 = +!!e3, S2[this.ptr + 12] = e3;
    }
    get_caught() {
      return S2[this.ptr + 12] != 0;
    }
    set_rethrown(e3) {
      e3 = +!!e3, S2[this.ptr + 13] = e3;
    }
    get_rethrown() {
      return S2[this.ptr + 13] != 0;
    }
    init(e3, t3) {
      this.set_adjusted_ptr(0), this.set_type(e3), this.set_destructor(t3);
    }
    set_adjusted_ptr(e3) {
      w2[this.ptr + 16 >> 2] = e3;
    }
    get_adjusted_ptr() {
      return w2[this.ptr + 16 >> 2];
    }
  }
  var j2 = (e3) => Pn(e3), M2 = (e3) => {
    var t3 = A2;
    if (!t3) return j2(0), 0;
    var n3 = new Se2(t3);
    n3.set_adjusted_ptr(t3);
    var r3 = n3.get_type();
    if (!r3) return j2(0), t3;
    for (var i3 of e3) {
      if (i3 === 0 || i3 === r3) break;
      var a3 = n3.ptr + 16;
      if (zn(i3, r3, a3)) return j2(i3), t3;
    }
    return j2(r3), t3;
  }, Ce2 = () => M2([]), we2 = (e3) => M2([e3]), Te2 = (e3, t3) => M2([e3, t3]), Ee2 = () => {
    var e3 = O2.pop();
    e3 || ae("no exception to throw");
    var t3 = e3.excPtr;
    throw e3.get_rethrown() || (O2.push(e3), e3.set_rethrown(true), e3.set_caught(false), k2++), Rn(t3), A2 = t3, A2;
  }, De2 = (e3, t3, n3) => {
    throw new Se2(e3).init(t3, n3), Rn(e3), A2 = e3, k2++, A2;
  }, Oe2 = () => k2, ke2 = (e3) => {
    throw A2 || (A2 = e3), A2;
  }, Ae2 = () => ae(""), N2 = {}, P2 = (e3) => {
    for (; e3.length; ) {
      var t3 = e3.pop();
      e3.pop()(t3);
    }
  };
  function F2(e3) {
    return this.fromWireType(w2[e3 >> 2]);
  }
  var I = {}, L = {}, je = {}, Me = class extends Error {
    constructor(e3) {
      super(e3), this.name = "InternalError";
    }
  }, R = (e3) => {
    throw new Me(e3);
  }, z = (e3, t3, n3) => {
    e3.forEach((e4) => je[e4] = t3);
    function r3(t4) {
      var r4 = n3(t4);
      r4.length !== e3.length && R("Mismatched type converter count");
      for (var i4 = 0; i4 < e3.length; ++i4) U(e3[i4], r4[i4]);
    }
    var i3 = Array(t3.length), a3 = [], o3 = 0;
    {
      let e4 = t3;
      for (let t4 = 0; t4 < e4.length; ++t4) {
        let n4 = e4[t4];
        L.hasOwnProperty(n4) ? i3[t4] = L[n4] : (a3.push(n4), I.hasOwnProperty(n4) || (I[n4] = []), I[n4].push(() => {
          i3[t4] = L[n4], ++o3, o3 === a3.length && r3(i3);
        }));
      }
    }
    a3.length === 0 && r3(i3);
  }, Ne = (e3) => {
    var t3 = N2[e3];
    delete N2[e3];
    var n3 = t3.rawConstructor, r3 = t3.rawDestructor, i3 = t3.fields, a3 = i3.map((e4) => e4.getterReturnType).concat(i3.map((e4) => e4.setterArgumentType));
    z([e3], a3, (e4) => {
      var a4 = {};
      {
        let t4 = i3;
        for (let n4 = 0; n4 < t4.length; ++n4) {
          let r4 = t4[n4], o3 = e4[n4], s3 = r4.getter, c3 = r4.getterContext, l3 = e4[n4 + i3.length], u3 = r4.setter, d3 = r4.setterContext;
          a4[r4.fieldName] = {
            read: (e5) => o3.fromWireType(s3(c3, e5)),
            write: (e5, t5) => {
              var n5 = [];
              u3(d3, e5, l3.toWireType(n5, t5)), P2(n5);
            },
            optional: o3.optional
          };
        }
      }
      return [{
        name: t3.name,
        fromWireType: (e5) => {
          var t4 = {};
          for (var n4 in a4) t4[n4] = a4[n4].read(e5);
          return r3(e5), t4;
        },
        toWireType: (e5, t4) => {
          for (var i4 in a4) if (!(i4 in t4) && !a4[i4].optional) throw TypeError(`Missing field: "${i4}"`);
          var o3 = n3();
          for (i4 in a4) a4[i4].write(o3, t4[i4]);
          return e5 !== null && e5.push(r3, o3), o3;
        },
        readValueFromPointer: F2,
        destructorFunction: r3
      }];
    });
  }, Pe = (e3, t3, n3, r3, i3) => {
  }, B = (e3) => {
    for (var t3 = ""; ; ) {
      var n3 = T2[e3++];
      if (!n3) return t3;
      t3 += String.fromCharCode(n3);
    }
  }, V = class extends Error {
    constructor(e3) {
      super(e3), this.name = "BindingError";
    }
  }, H = (e3) => {
    throw new V(e3);
  };
  function Fe(e3, t3) {
    let n3 = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    var r3 = t3.name;
    if (e3 || H(`type "${r3}" must have a positive integer typeid pointer`), L.hasOwnProperty(e3)) {
      if (n3.ignoreDuplicateRegistrations) return;
      H(`Cannot register type '${r3}' twice`);
    }
    if (L[e3] = t3, delete je[e3], I.hasOwnProperty(e3)) {
      var i3 = I[e3];
      delete I[e3], i3.forEach((e4) => e4());
    }
  }
  function U(e3, t3) {
    return Fe(e3, t3, arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {});
  }
  var Ie = (e3, t3, n3, r3) => {
    t3 = B(t3), U(e3, {
      name: t3,
      fromWireType: function(e4) {
        return !!e4;
      },
      toWireType: function(e4, t4) {
        return t4 ? n3 : r3;
      },
      readValueFromPointer: function(e4) {
        return this.fromWireType(T2[e4]);
      },
      destructorFunction: null
    });
  }, Le = (e3) => ({
    count: e3.count,
    deleteScheduled: e3.deleteScheduled,
    preservePointerOnDelete: e3.preservePointerOnDelete,
    ptr: e3.ptr,
    ptrType: e3.ptrType,
    smartPtr: e3.smartPtr,
    smartPtrType: e3.smartPtrType
  }), Re = (e3) => {
    function t3(e4) {
      return e4.$$.ptrType.registeredClass.name;
    }
    H(t3(e3) + " instance already deleted");
  }, ze = false, Be = (e3) => {
  }, Ve = (e3) => {
    e3.smartPtr ? e3.smartPtrType.rawDestructor(e3.smartPtr) : e3.ptrType.registeredClass.rawDestructor(e3.ptr);
  }, He = (e3) => {
    --e3.count.value, e3.count.value === 0 && Ve(e3);
  }, W = (e3) => globalThis.FinalizationRegistry ? (ze = new FinalizationRegistry((e4) => {
    He(e4.$$);
  }), W = (e4) => {
    var t3 = e4.$$;
    if (t3.smartPtr) {
      var n3 = { $$: t3 };
      ze.register(e4, n3, e4);
    }
    return e4;
  }, Be = (e4) => ze.unregister(e4), W(e3)) : (W = (e4) => e4, e3), Ue = [], We = () => {
    for (; Ue.length; ) {
      var e3 = Ue.pop();
      e3.$$.deleteScheduled = false, e3.delete();
    }
  }, Ge, Ke = () => {
    let e3 = qe.prototype;
    Object.assign(e3, {
      isAliasOf(e4) {
        if (!(this instanceof qe) || !(e4 instanceof qe)) return false;
        var t4 = this.$$.ptrType.registeredClass, n3 = this.$$.ptr;
        e4.$$ = e4.$$;
        for (var r3 = e4.$$.ptrType.registeredClass, i3 = e4.$$.ptr; t4.baseClass; ) n3 = t4.upcast(n3), t4 = t4.baseClass;
        for (; r3.baseClass; ) i3 = r3.upcast(i3), r3 = r3.baseClass;
        return t4 === r3 && n3 === i3;
      },
      clone() {
        if (this.$$.ptr || Re(this), this.$$.preservePointerOnDelete) return this.$$.count.value += 1, this;
        var e4 = W(Object.create(Object.getPrototypeOf(this), { $$: { value: Le(this.$$) } }));
        return e4.$$.count.value += 1, e4.$$.deleteScheduled = false, e4;
      },
      delete() {
        this.$$.ptr || Re(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && H("Object already scheduled for deletion"), Be(this), He(this.$$), this.$$.preservePointerOnDelete || (this.$$.smartPtr = void 0, this.$$.ptr = void 0);
      },
      isDeleted() {
        return !this.$$.ptr;
      },
      deleteLater() {
        return this.$$.ptr || Re(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && H("Object already scheduled for deletion"), Ue.push(this), Ue.length === 1 && Ge && Ge(We), this.$$.deleteScheduled = true, this;
      }
    });
    let t3 = Symbol.dispose;
    t3 && (e3[t3] = e3.delete);
  };
  function qe() {
  }
  var Je = (e3, t3) => Object.defineProperty(t3, "name", { value: e3 }), Ye = {}, Xe = (e3, t3, n3) => {
    if (e3[t3].overloadTable === void 0) {
      var r3 = e3[t3];
      e3[t3] = function() {
        var r4 = [...arguments];
        return e3[t3].overloadTable.hasOwnProperty(r4.length) || H(`Function '${n3}' called with an invalid number of arguments (${r4.length}) - expects one of (${e3[t3].overloadTable})!`), e3[t3].overloadTable[r4.length].apply(this, r4);
      }, e3[t3].overloadTable = [], e3[t3].overloadTable[r3.argCount] = r3;
    }
  }, Ze = (e3, t3, n3) => {
    i2.hasOwnProperty(e3) ? ((n3 === void 0 || i2[e3].overloadTable !== void 0 && i2[e3].overloadTable[n3] !== void 0) && H(`Cannot register public name '${e3}' twice`), Xe(i2, e3, e3), i2[e3].overloadTable.hasOwnProperty(n3) && H(`Cannot register multiple overloads of a function with the same number of arguments (${n3})!`), i2[e3].overloadTable[n3] = t3) : (i2[e3] = t3, i2[e3].argCount = n3);
  }, Qe = 48, $e = 57, et = (e3) => {
    e3 = e3.replace(/[^a-zA-Z0-9_]/g, "$");
    var t3 = e3.charCodeAt(0);
    return t3 >= Qe && t3 <= $e ? `_${e3}` : e3;
  };
  function tt(e3, t3, n3, r3, i3, a3, o3, s3) {
    this.name = e3, this.constructor = t3, this.instancePrototype = n3, this.rawDestructor = r3, this.baseClass = i3, this.getActualType = a3, this.upcast = o3, this.downcast = s3, this.pureVirtualFunctions = [];
  }
  var nt = (e3, t3, n3) => {
    for (; t3 !== n3; ) t3.upcast || H(`Expected null or instance of ${n3.name}, got an instance of ${t3.name}`), e3 = t3.upcast(e3), t3 = t3.baseClass;
    return e3;
  }, rt = (e3) => {
    if (e3 === null) return "null";
    var t3 = typeof e3;
    return t3 === "object" || t3 === "array" || t3 === "function" ? e3.toString() : "" + e3;
  };
  function it(e3, t3) {
    if (t3 === null) return this.isReference && H(`null is not a valid ${this.name}`), 0;
    t3.$$ || H(`Cannot pass "${rt(t3)}" as a ${this.name}`), t3.$$.ptr || H(`Cannot pass deleted object as a pointer of type ${this.name}`);
    var n3 = t3.$$.ptrType.registeredClass;
    return nt(t3.$$.ptr, n3, this.registeredClass);
  }
  function at(e3, t3) {
    var n3;
    if (t3 === null) return this.isReference && H(`null is not a valid ${this.name}`), this.isSmartPointer ? (n3 = this.rawConstructor(), e3 !== null && e3.push(this.rawDestructor, n3), n3) : 0;
    (!t3 || !t3.$$) && H(`Cannot pass "${rt(t3)}" as a ${this.name}`), t3.$$.ptr || H(`Cannot pass deleted object as a pointer of type ${this.name}`), !this.isConst && t3.$$.ptrType.isConst && H(`Cannot convert argument of type ${t3.$$.smartPtrType ? t3.$$.smartPtrType.name : t3.$$.ptrType.name} to parameter type ${this.name}`);
    var r3 = t3.$$.ptrType.registeredClass;
    if (n3 = nt(t3.$$.ptr, r3, this.registeredClass), this.isSmartPointer) switch (t3.$$.smartPtr === void 0 && H("Passing raw pointer to smart pointer is illegal"), this.sharingPolicy) {
      case 0:
        t3.$$.smartPtrType === this ? n3 = t3.$$.smartPtr : H(`Cannot convert argument of type ${t3.$$.smartPtrType ? t3.$$.smartPtrType.name : t3.$$.ptrType.name} to parameter type ${this.name}`);
        break;
      case 1:
        n3 = t3.$$.smartPtr;
        break;
      case 2:
        if (t3.$$.smartPtrType === this) n3 = t3.$$.smartPtr;
        else {
          var i3 = t3.clone();
          n3 = this.rawShare(n3, Y.toHandle(() => i3.delete())), e3 !== null && e3.push(this.rawDestructor, n3);
        }
        break;
      default:
        H("Unsupported sharing policy");
    }
    return n3;
  }
  function ot(e3, t3) {
    if (t3 === null) return this.isReference && H(`null is not a valid ${this.name}`), 0;
    t3.$$ || H(`Cannot pass "${rt(t3)}" as a ${this.name}`), t3.$$.ptr || H(`Cannot pass deleted object as a pointer of type ${this.name}`), t3.$$.ptrType.isConst && H(`Cannot convert argument of type ${t3.$$.ptrType.name} to parameter type ${this.name}`);
    var n3 = t3.$$.ptrType.registeredClass;
    return nt(t3.$$.ptr, n3, this.registeredClass);
  }
  var st = (e3, t3, n3) => {
    if (t3 === n3) return e3;
    if (n3.baseClass === void 0) return null;
    var r3 = st(e3, t3, n3.baseClass);
    return r3 === null ? null : n3.downcast(r3);
  }, ct = {}, lt = (e3, t3) => {
    for (t3 === void 0 && H("ptr should not be undefined"); e3.baseClass; ) t3 = e3.upcast(t3), e3 = e3.baseClass;
    return t3;
  }, ut = (e3, t3) => (t3 = lt(e3, t3), ct[t3]), dt = (e3, t3) => ((!t3.ptrType || !t3.ptr) && R("makeClassHandle requires ptr and ptrType"), !!t3.smartPtrType != !!t3.smartPtr && R("Both smartPtrType and smartPtr must be specified"), t3.count = { value: 1 }, W(Object.create(e3, { $$: {
    value: t3,
    writable: true
  } })));
  function ft(e3) {
    var t3 = this.getPointee(e3);
    if (!t3) return this.destructor(e3), null;
    var n3 = ut(this.registeredClass, t3);
    if (n3 !== void 0) {
      if (n3.$$.count.value === 0) return n3.$$.ptr = t3, n3.$$.smartPtr = e3, n3.clone();
      var r3 = n3.clone();
      return this.destructor(e3), r3;
    }
    function i3() {
      return this.isSmartPointer ? dt(this.registeredClass.instancePrototype, {
        ptrType: this.pointeeType,
        ptr: t3,
        smartPtrType: this,
        smartPtr: e3
      }) : dt(this.registeredClass.instancePrototype, {
        ptrType: this,
        ptr: e3
      });
    }
    var a3 = Ye[this.registeredClass.getActualType(t3)];
    if (!a3) return i3.call(this);
    var o3 = this.isConst ? a3.constPointerType : a3.pointerType, s3 = st(t3, this.registeredClass, o3.registeredClass);
    return s3 === null ? i3.call(this) : this.isSmartPointer ? dt(o3.registeredClass.instancePrototype, {
      ptrType: o3,
      ptr: s3,
      smartPtrType: this,
      smartPtr: e3
    }) : dt(o3.registeredClass.instancePrototype, {
      ptrType: o3,
      ptr: s3
    });
  }
  var pt = () => {
    Object.assign(mt.prototype, {
      getPointee(e3) {
        return this.rawGetPointee && (e3 = this.rawGetPointee(e3)), e3;
      },
      destructor(e3) {
        var t3;
        (t3 = this.rawDestructor) == null || t3.call(this, e3);
      },
      readValueFromPointer: F2,
      fromWireType: ft
    });
  };
  function mt(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3) {
    this.name = e3, this.registeredClass = t3, this.isReference = n3, this.isConst = r3, this.isSmartPointer = i3, this.pointeeType = a3, this.sharingPolicy = o3, this.rawGetPointee = s3, this.rawConstructor = c3, this.rawShare = l3, this.rawDestructor = u3, !i3 && t3.baseClass === void 0 ? r3 ? (this.toWireType = it, this.destructorFunction = null) : (this.toWireType = ot, this.destructorFunction = null) : this.toWireType = at;
  }
  var ht = (e3, t3, n3) => {
    i2.hasOwnProperty(e3) || R("Replacing nonexistent public symbol"), i2[e3].overloadTable !== void 0 && n3 !== void 0 ? i2[e3].overloadTable[n3] = t3 : (i2[e3] = t3, i2[e3].argCount = n3);
  }, G = {}, gt = (e3, t3, n3) => {
    e3 = e3.replace(/p/g, "i");
    var r3 = G[e3];
    return r3(t3, ...n3);
  }, _t = [], K = (e3) => {
    var t3 = _t[e3];
    return t3 || (_t[e3] = t3 = Wn.get(e3)), t3;
  }, vt = function(e3, t3) {
    let n3 = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : [];
    if (arguments.length > 3 && arguments[3] !== void 0 && arguments[3], e3.includes("j")) return gt(e3, t3, n3);
    var r3 = K(t3)(...n3);
    function i3(e4) {
      return e4;
    }
    return i3(r3);
  }, yt = function(e3, t3) {
    let n3 = arguments.length > 2 && arguments[2] !== void 0 && arguments[2];
    return function() {
      return vt(e3, t3, [...arguments], n3);
    };
  }, q = function(e3, t3) {
    arguments.length > 2 && arguments[2] !== void 0 && arguments[2], e3 = B(e3);
    function n3() {
      return e3.includes("j") ? yt(e3, t3) : K(t3);
    }
    var r3 = n3();
    return typeof r3 != "function" && H(`unknown function pointer with signature ${e3}: ${t3}`), r3;
  };
  class bt extends Error {
  }
  var xt = (e3) => {
    var t3 = jn(e3), n3 = B(t3);
    return Q(t3), n3;
  }, St = (e3, t3) => {
    var n3 = [], r3 = {};
    function i3(e4) {
      if (!r3[e4] && !L[e4]) {
        if (je[e4]) {
          je[e4].forEach(i3);
          return;
        }
        n3.push(e4), r3[e4] = true;
      }
    }
    throw t3.forEach(i3), new bt(`${e3}: ` + n3.map(xt).join([", "]));
  }, Ct = (e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3) => {
    u3 = B(u3), a3 = q(i3, a3), s3 && (s3 = q(o3, s3)), l3 && (l3 = q(c3, l3)), f3 = q(d3, f3);
    var p3 = et(u3);
    Ze(p3, function() {
      St(`Cannot construct ${u3} due to unbound types`, [r3]);
    }), z([
      e3,
      t3,
      n3
    ], r3 ? [r3] : [], (t4) => {
      t4 = t4[0];
      var n4, i4;
      r3 ? (n4 = t4.registeredClass, i4 = n4.instancePrototype) : i4 = qe.prototype;
      var o4 = Je(u3, function() {
        if (Object.getPrototypeOf(this) !== c4) throw new V(`Use 'new' to construct ${u3}`);
        if (d4.constructor_body === void 0) throw new V(`${u3} has no accessible constructor`);
        var e4 = [...arguments], t5 = d4.constructor_body[e4.length];
        if (t5 === void 0) throw new V(`Tried to invoke ctor of ${u3} with invalid number of parameters (${e4.length}) - expected (${Object.keys(d4.constructor_body).toString()}) parameters instead!`);
        return t5.apply(this, e4);
      }), c4 = Object.create(i4, { constructor: { value: o4 } });
      o4.prototype = c4;
      var d4 = new tt(u3, o4, c4, f3, n4, a3, s3, l3);
      if (d4.baseClass) {
        var m3;
        (m3 = d4.baseClass).__derivedClasses != null || (m3.__derivedClasses = []), d4.baseClass.__derivedClasses.push(d4);
      }
      var h3 = new mt(u3, d4, true, false, false), g3 = new mt(u3 + "*", d4, false, false, false), _3 = new mt(u3 + " const*", d4, false, true, false);
      return Ye[e3] = {
        pointerType: g3,
        constPointerType: _3
      }, ht(p3, o4), [
        h3,
        g3,
        _3
      ];
    });
  }, wt = (e3, t3) => {
    for (var n3 = [], r3 = 0; r3 < e3; r3++) n3.push(w2[t3 + r3 * 4 >> 2]);
    return n3;
  };
  function Tt(e3) {
    for (var t3 = 1; t3 < e3.length; ++t3) if (e3[t3] !== null && e3[t3].destructorFunction === void 0) return true;
    return false;
  }
  function Et(e3, t3, n3, r3, i3, a3) {
    var o3 = t3.length;
    o3 < 2 && H("argTypes array size mismatch! Must at least get return value and 'this' types!");
    var s3 = t3[1] !== null && n3 !== null, c3 = Tt(t3), l3 = !t3[0].isVoid, u3 = o3 - 2, d3 = Array(u3), f3 = [], p3 = [];
    return Je(e3, function() {
      p3.length = 0;
      var e4;
      f3.length = s3 ? 2 : 1, f3[0] = i3, s3 && (e4 = t3[1].toWireType(p3, this), f3[1] = e4);
      for (var n4 = 0; n4 < u3; ++n4) d3[n4] = t3[n4 + 2].toWireType(p3, n4 < 0 || arguments.length <= n4 ? void 0 : arguments[n4]), f3.push(d3[n4]);
      var a4 = r3(...f3);
      function o4(n5) {
        if (c3) P2(p3);
        else for (var r4 = s3 ? 1 : 2; r4 < t3.length; r4++) {
          var i4 = r4 === 1 ? e4 : d3[r4 - 2];
          t3[r4].destructorFunction !== null && t3[r4].destructorFunction(i4);
        }
        if (l3) return t3[0].fromWireType(n5);
      }
      return o4(a4);
    });
  }
  var Dt = (e3, t3, n3, r3, i3, a3) => {
    var o3 = wt(t3, n3);
    i3 = q(r3, i3), z([], [e3], (e4) => {
      e4 = e4[0];
      var n4 = `constructor ${e4.name}`;
      if (e4.registeredClass.constructor_body === void 0 && (e4.registeredClass.constructor_body = []), e4.registeredClass.constructor_body[t3 - 1] !== void 0) throw new V(`Cannot register multiple constructors with identical number of parameters (${t3 - 1}) for class '${e4.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);
      return e4.registeredClass.constructor_body[t3 - 1] = () => {
        St(`Cannot construct ${e4.name} due to unbound types`, o3);
      }, z([], o3, (r4) => (r4.splice(1, 0, null), e4.registeredClass.constructor_body[t3 - 1] = Et(n4, r4, null, i3, a3), [])), [];
    });
  }, Ot = (e3) => {
    e3 = e3.trim();
    let t3 = e3.indexOf("(");
    return t3 === -1 ? e3 : e3.slice(0, t3);
  }, kt = (e3, t3, n3, r3, i3, a3, o3, s3, c3, l3) => {
    var u3 = wt(n3, r3);
    t3 = B(t3), t3 = Ot(t3), a3 = q(i3, a3, c3), z([], [e3], (e4) => {
      e4 = e4[0];
      var r4 = `${e4.name}.${t3}`;
      t3.startsWith("@@") && (t3 = Symbol[t3.substring(2)]), s3 && e4.registeredClass.pureVirtualFunctions.push(t3);
      function i4() {
        St(`Cannot call ${r4} due to unbound types`, u3);
      }
      var l4 = e4.registeredClass.instancePrototype, d3 = l4[t3];
      return d3 === void 0 || d3.overloadTable === void 0 && d3.className !== e4.name && d3.argCount === n3 - 2 ? (i4.argCount = n3 - 2, i4.className = e4.name, l4[t3] = i4) : (Xe(l4, t3, r4), l4[t3].overloadTable[n3 - 2] = i4), z([], u3, (i5) => {
        var s4 = Et(r4, i5, e4, a3, o3, c3);
        return l4[t3].overloadTable === void 0 ? (s4.argCount = n3 - 2, l4[t3] = s4) : l4[t3].overloadTable[n3 - 2] = s4, [];
      }), [];
    });
  }, At = [], J = [
    0,
    1,
    ,
    1,
    null,
    1,
    true,
    1,
    false,
    1
  ], jt = (e3) => {
    e3 > 9 && --J[e3 + 1] === 0 && (J[e3] = void 0, At.push(e3));
  }, Y = {
    toValue: (e3) => (e3 || H(`Cannot use deleted val. handle = ${e3}`), J[e3]),
    toHandle: (e3) => {
      switch (e3) {
        case void 0:
          return 2;
        case null:
          return 4;
        case true:
          return 6;
        case false:
          return 8;
        default: {
          let t3 = At.pop() || J.length;
          return J[t3] = e3, J[t3 + 1] = 1, t3;
        }
      }
    }
  }, Mt = {
    name: "emscripten::val",
    fromWireType: (e3) => {
      var t3 = Y.toValue(e3);
      return jt(e3), t3;
    },
    toWireType: (e3, t3) => Y.toHandle(t3),
    readValueFromPointer: F2,
    destructorFunction: null
  }, Nt = (e3) => U(e3, Mt), Pt = (e3, t3) => {
    switch (t3) {
      case 4:
        return function(e4) {
          return this.fromWireType(pe2[e4 >> 2]);
        };
      case 8:
        return function(e4) {
          return this.fromWireType(me2[e4 >> 3]);
        };
      default:
        throw TypeError(`invalid float width (${t3}): ${e3}`);
    }
  }, Ft = (e3, t3, n3) => {
    t3 = B(t3), U(e3, {
      name: t3,
      fromWireType: (e4) => e4,
      toWireType: (e4, t4) => t4,
      readValueFromPointer: Pt(t3, n3),
      destructorFunction: null
    });
  }, It = (e3, t3, n3, r3, i3, a3, o3, s3) => {
    var c3 = wt(t3, n3);
    e3 = B(e3), e3 = Ot(e3), i3 = q(r3, i3, o3), Ze(e3, function() {
      St(`Cannot call ${e3} due to unbound types`, c3);
    }, t3 - 1), z([], c3, (n4) => {
      var r4 = [n4[0], null].concat(n4.slice(1));
      return ht(e3, Et(e3, r4, null, i3, a3, o3), t3 - 1), [];
    });
  }, Lt = (e3, t3, n3) => {
    switch (t3) {
      case 1:
        return n3 ? (e4) => S2[e4] : (e4) => T2[e4];
      case 2:
        return n3 ? (e4) => b2[e4 >> 1] : (e4) => C2[e4 >> 1];
      case 4:
        return n3 ? (e4) => x2[e4 >> 2] : (e4) => w2[e4 >> 2];
      default:
        throw TypeError(`invalid integer width (${t3}): ${e3}`);
    }
  }, Rt = (e3, t3, n3, r3, i3) => {
    t3 = B(t3);
    let a3 = r3 === 0, o3 = (e4) => e4;
    if (a3) {
      var s3 = 32 - 8 * n3;
      o3 = (e4) => e4 << s3 >>> s3, i3 = o3(i3);
    }
    U(e3, {
      name: t3,
      fromWireType: o3,
      toWireType: (e4, t4) => t4,
      readValueFromPointer: Lt(t3, n3, r3 !== 0),
      destructorFunction: null
    });
  }, zt = (e3, t3, n3) => {
    let r3 = (e4, t4) => {
      let n4 = 0;
      return {
        next() {
          if (n4 >= e4) return { done: true };
          let r4 = n4;
          return n4++, {
            value: t4(r4),
            done: false
          };
        },
        [Symbol.iterator]() {
          return this;
        }
      };
    };
    e3[Symbol.iterator] || (e3[Symbol.iterator] = function() {
      return r3(this[t3](), (e4) => this[n3](e4));
    });
  }, Bt = (e3, t3, n3, r3) => {
    n3 = B(n3), r3 = B(r3), z([], [e3, t3], (e4) => {
      let t4 = e4[0];
      return zt(t4.registeredClass.instancePrototype, n3, r3), [];
    });
  }, Vt = (e3, t3, n3) => {
    var r3 = [
      Int8Array,
      Uint8Array,
      Int16Array,
      Uint16Array,
      Int32Array,
      Uint32Array,
      Float32Array,
      Float64Array
    ][t3];
    function i3(e4) {
      var t4 = w2[e4 >> 2], n4 = w2[e4 + 4 >> 2];
      return new r3(S2.buffer, n4, t4);
    }
    n3 = B(n3), U(e3, {
      name: n3,
      fromWireType: i3,
      readValueFromPointer: i3
    }, { ignoreDuplicateRegistrations: true });
  }, Ht = Object.assign({ optional: true }, Mt), Ut = (e3, t3) => {
    U(e3, Ht);
  }, Wt = (e3, t3, n3, r3) => {
    if (!(r3 > 0)) return 0;
    for (var i3 = n3, a3 = n3 + r3 - 1, o3 = 0; o3 < e3.length; ++o3) {
      var s3 = e3.codePointAt(o3);
      if (s3 <= 127) {
        if (n3 >= a3) break;
        t3[n3++] = s3;
      } else if (s3 <= 2047) {
        if (n3 + 1 >= a3) break;
        t3[n3++] = 192 | s3 >> 6, t3[n3++] = 128 | s3 & 63;
      } else if (s3 <= 65535) {
        if (n3 + 2 >= a3) break;
        t3[n3++] = 224 | s3 >> 12, t3[n3++] = 128 | s3 >> 6 & 63, t3[n3++] = 128 | s3 & 63;
      } else {
        if (n3 + 3 >= a3) break;
        t3[n3++] = 240 | s3 >> 18, t3[n3++] = 128 | s3 >> 12 & 63, t3[n3++] = 128 | s3 >> 6 & 63, t3[n3++] = 128 | s3 & 63, o3++;
      }
    }
    return t3[n3] = 0, n3 - i3;
  }, X = (e3, t3, n3) => Wt(e3, T2, t3, n3), Gt = (e3) => {
    for (var t3 = 0, n3 = 0; n3 < e3.length; ++n3) {
      var r3 = e3.charCodeAt(n3);
      r3 <= 127 ? t3++ : r3 <= 2047 ? t3 += 2 : r3 >= 55296 && r3 <= 57343 ? (t3 += 4, ++n3) : t3 += 3;
    }
    return t3;
  }, Kt = globalThis.TextDecoder && new TextDecoder(), qt = (e3, t3, n3, r3) => {
    var i3 = t3 + n3;
    if (r3) return i3;
    for (; e3[t3] && !(t3 >= i3); ) ++t3;
    return t3;
  }, Jt = function(e3) {
    let t3 = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0, n3 = arguments.length > 2 ? arguments[2] : void 0, r3 = arguments.length > 3 ? arguments[3] : void 0;
    var i3 = qt(e3, t3, n3, r3);
    if (i3 - t3 > 16 && e3.buffer && Kt) return Kt.decode(e3.subarray(t3, i3));
    for (var a3 = ""; t3 < i3; ) {
      var o3 = e3[t3++];
      if (!(o3 & 128)) {
        a3 += String.fromCharCode(o3);
        continue;
      }
      var s3 = e3[t3++] & 63;
      if ((o3 & 224) == 192) {
        a3 += String.fromCharCode((o3 & 31) << 6 | s3);
        continue;
      }
      var c3 = e3[t3++] & 63;
      if (o3 = (o3 & 240) == 224 ? (o3 & 15) << 12 | s3 << 6 | c3 : (o3 & 7) << 18 | s3 << 12 | c3 << 6 | e3[t3++] & 63, o3 < 65536) a3 += String.fromCharCode(o3);
      else {
        var l3 = o3 - 65536;
        a3 += String.fromCharCode(55296 | l3 >> 10, 56320 | l3 & 1023);
      }
    }
    return a3;
  }, Yt = (e3, t3, n3) => e3 ? Jt(T2, e3, t3, n3) : "", Xt = (e3, t3) => {
    t3 = B(t3);
    var n3 = true;
    U(e3, {
      name: t3,
      fromWireType(e4) {
        var t4 = w2[e4 >> 2], r3 = e4 + 4, i3;
        if (n3) i3 = Yt(r3, t4, true);
        else {
          i3 = "";
          for (var a3 = 0; a3 < t4; ++a3) i3 += String.fromCharCode(T2[r3 + a3]);
        }
        return Q(e4), i3;
      },
      toWireType(e4, t4) {
        t4 instanceof ArrayBuffer && (t4 = new Uint8Array(t4));
        var r3, i3 = typeof t4 == "string";
        i3 || ArrayBuffer.isView(t4) && t4.BYTES_PER_ELEMENT == 1 || H("Cannot pass non-string to std::string"), r3 = n3 && i3 ? Gt(t4) : t4.length;
        var a3 = Mn(4 + r3 + 1), o3 = a3 + 4;
        if (w2[a3 >> 2] = r3, i3) if (n3) X(t4, o3, r3 + 1);
        else for (var s3 = 0; s3 < r3; ++s3) {
          var c3 = t4.charCodeAt(s3);
          c3 > 255 && (Q(a3), H("String has UTF-16 code units that do not fit in 8 bits")), T2[o3 + s3] = c3;
        }
        else T2.set(t4, o3);
        return e4 !== null && e4.push(Q, a3), a3;
      },
      readValueFromPointer: F2,
      destructorFunction(e4) {
        Q(e4);
      }
    });
  }, Zt = globalThis.TextDecoder ? new TextDecoder("utf-16le") : void 0, Qt = (e3, t3, n3) => {
    var r3 = e3 >> 1, i3 = qt(C2, r3, t3 / 2, n3);
    if (i3 - r3 > 16 && Zt) return Zt.decode(C2.subarray(r3, i3));
    for (var a3 = "", o3 = r3; o3 < i3; ++o3) {
      var s3 = C2[o3];
      a3 += String.fromCharCode(s3);
    }
    return a3;
  }, $t = (e3, t3, n3) => {
    if (n3 != null || (n3 = 2147483647), n3 < 2) return 0;
    n3 -= 2;
    for (var r3 = t3, i3 = n3 < e3.length * 2 ? n3 / 2 : e3.length, a3 = 0; a3 < i3; ++a3) {
      var o3 = e3.charCodeAt(a3);
      b2[t3 >> 1] = o3, t3 += 2;
    }
    return b2[t3 >> 1] = 0, t3 - r3;
  }, en = (e3) => e3.length * 2, tn = (e3, t3, n3) => {
    for (var r3 = "", i3 = e3 >> 2, a3 = 0; !(a3 >= t3 / 4); a3++) {
      var o3 = w2[i3 + a3];
      if (!o3 && !n3) break;
      r3 += String.fromCodePoint(o3);
    }
    return r3;
  }, nn = (e3, t3, n3) => {
    if (n3 != null || (n3 = 2147483647), n3 < 4) return 0;
    for (var r3 = t3, i3 = r3 + n3 - 4, a3 = 0; a3 < e3.length; ++a3) {
      var o3 = e3.codePointAt(a3);
      if (o3 > 65535 && a3++, x2[t3 >> 2] = o3, t3 += 4, t3 + 4 > i3) break;
    }
    return x2[t3 >> 2] = 0, t3 - r3;
  }, rn = (e3) => {
    for (var t3 = 0, n3 = 0; n3 < e3.length; ++n3) e3.codePointAt(n3) > 65535 && n3++, t3 += 4;
    return t3;
  }, an = (e3, t3, n3) => {
    n3 = B(n3);
    var r3, i3, a3;
    t3 === 2 ? (r3 = Qt, i3 = $t, a3 = en) : (r3 = tn, i3 = nn, a3 = rn), U(e3, {
      name: n3,
      fromWireType: (e4) => {
        var n4 = w2[e4 >> 2], i4 = r3(e4 + 4, n4 * t3, true);
        return Q(e4), i4;
      },
      toWireType: (e4, r4) => {
        typeof r4 != "string" && H(`Cannot pass non-string to C++ string type ${n3}`);
        var o3 = a3(r4), s3 = Mn(4 + o3 + t3);
        return w2[s3 >> 2] = o3 / t3, i3(r4, s3 + 4, o3 + t3), e4 !== null && e4.push(Q, s3), s3;
      },
      readValueFromPointer: F2,
      destructorFunction(e4) {
        Q(e4);
      }
    });
  }, on = (e3, t3, n3, r3, i3, a3) => {
    N2[e3] = {
      name: B(t3),
      rawConstructor: q(n3, r3),
      rawDestructor: q(i3, a3),
      fields: []
    };
  }, sn = (e3, t3, n3, r3, i3, a3, o3, s3, c3, l3) => {
    N2[e3].fields.push({
      fieldName: B(t3),
      getterReturnType: n3,
      getter: q(r3, i3),
      getterContext: a3,
      setterArgumentType: o3,
      setter: q(s3, c3),
      setterContext: l3
    });
  }, cn = (e3, t3) => {
    t3 = B(t3), U(e3, {
      isVoid: true,
      name: t3,
      fromWireType: () => void 0,
      toWireType: (e4, t4) => void 0
    });
  }, ln = [], un = (e3) => {
    var t3 = ln.length;
    return ln.push(e3), t3;
  }, dn = (e3, t3) => {
    var n3 = L[e3];
    return n3 === void 0 && H(`${t3} has unknown type ${xt(e3)}`), n3;
  }, fn = (e3, t3) => {
    for (var n3 = Array(e3), r3 = 0; r3 < e3; ++r3) n3[r3] = dn(w2[t3 + r3 * 4 >> 2], `parameter ${r3}`);
    return n3;
  }, pn = (e3, t3, n3) => {
    var r3 = [], i3 = e3(r3, n3);
    return r3.length && (w2[t3 >> 2] = Y.toHandle(r3)), i3;
  }, mn = {}, hn = (e3) => {
    var t3 = mn[e3];
    return t3 === void 0 ? B(e3) : t3;
  }, gn = (e3, t3, n3) => {
    var [r3, ...i3] = fn(e3, t3), a3 = r3.toWireType.bind(r3), o3 = i3.map((e4) => e4.readValueFromPointer.bind(e4));
    e3--;
    var s3 = Array(e3);
    return un(Je(`methodCaller<(${i3.map((e4) => e4.name)}) => ${r3.name}>`, (t4, r4, i4, c3) => {
      for (var l3 = 0, u3 = 0; u3 < e3; ++u3) s3[u3] = o3[u3](c3 + l3), l3 += 8;
      var d3;
      switch (n3) {
        case 0:
          d3 = Y.toValue(t4).apply(null, s3);
          break;
        case 2:
          d3 = Reflect.construct(Y.toValue(t4), s3);
          break;
        case 3:
          d3 = s3[0];
          break;
        case 1:
          d3 = Y.toValue(t4)[hn(r4)](...s3);
          break;
      }
      return pn(a3, i4, d3);
    }));
  }, _n = (e3) => e3 ? (e3 = hn(e3), Y.toHandle(globalThis[e3])) : Y.toHandle(globalThis), vn = (e3) => {
    e3 > 9 && (J[e3 + 1] += 1);
  }, yn = (e3, t3, n3, r3, i3) => ln[e3](t3, n3, r3, i3), bn = (e3) => {
    P2(Y.toValue(e3)), jt(e3);
  }, xn = (e3, t3, n3, r3) => {
    var i3 = (/* @__PURE__ */ new Date()).getFullYear(), a3 = new Date(i3, 0, 1), o3 = new Date(i3, 6, 1), s3 = a3.getTimezoneOffset(), c3 = o3.getTimezoneOffset(), l3 = Math.max(s3, c3);
    w2[e3 >> 2] = l3 * 60, x2[t3 >> 2] = Number(s3 != c3);
    var u3 = (e4) => {
      var t4 = e4 >= 0 ? "-" : "+", n4 = Math.abs(e4);
      return `UTC${t4}${String(Math.floor(n4 / 60)).padStart(2, "0")}${String(n4 % 60).padStart(2, "0")}`;
    }, d3 = u3(s3), f3 = u3(c3);
    c3 < s3 ? (X(d3, n3, 17), X(f3, r3, 17)) : (X(d3, r3, 17), X(f3, n3, 17));
  }, Sn = () => 2147483648, Cn = (e3, t3) => Math.ceil(e3 / t3) * t3, wn = (e3) => {
    var t3 = (e3 - Un.buffer.byteLength + 65535) / 65536 | 0;
    try {
      return Un.grow(t3), ne2(), 1;
    } catch {
    }
  }, Tn = (e3) => {
    var t3 = T2.length;
    e3 >>>= 0;
    var n3 = Sn();
    if (e3 > n3) return false;
    for (var r3 = 1; r3 <= 4; r3 *= 2) {
      var i3 = t3 * (1 + 0.2 / r3);
      if (i3 = Math.min(i3, e3 + 100663296), wn(Math.min(n3, Cn(Math.max(e3, i3), 65536)))) return true;
    }
    return false;
  }, En = {}, Dn = () => c2 || "./this.program", Z = () => {
    if (!Z.strings) {
      var e3, t3, n3 = {
        USER: "web_user",
        LOGNAME: "web_user",
        PATH: "/",
        PWD: "/",
        HOME: "/home/web_user",
        LANG: ((e3 = (t3 = globalThis.navigator) == null ? void 0 : t3.language) == null ? "C" : e3).replace("-", "_") + ".UTF-8",
        _: Dn()
      };
      for (var r3 in En) En[r3] === void 0 ? delete n3[r3] : n3[r3] = En[r3];
      var i3 = [];
      for (var r3 in n3) i3.push(`${r3}=${n3[r3]}`);
      Z.strings = i3;
    }
    return Z.strings;
  }, On = (e3, t3) => {
    var n3 = 0, r3 = 0;
    for (var i3 of Z()) {
      var a3 = t3 + n3;
      w2[e3 + r3 >> 2] = a3, n3 += X(i3, a3, Infinity) + 1, r3 += 4;
    }
    return 0;
  }, kn = (e3, t3) => {
    var n3 = Z();
    w2[e3 >> 2] = n3.length;
    var r3 = 0;
    for (var i3 of n3) r3 += Gt(i3) + 1;
    return w2[t3 >> 2] = r3, 0;
  }, An = (e3) => e3;
  if (Ke(), pt(), i2.noExitRuntime && i2.noExitRuntime, i2.print && i2.print, i2.printErr && (m2 = i2.printErr), i2.wasmBinary && (h2 = i2.wasmBinary), i2.arguments && i2.arguments, i2.thisProgram && (c2 = i2.thisProgram), i2.preInit) for (typeof i2.preInit == "function" && (i2.preInit = [i2.preInit]); i2.preInit.length > 0; ) i2.preInit.shift()();
  var jn, Q, Mn, Nn, $, Pn, Fn, In, Ln, Rn, zn, Bn, Vn, Hn, Un, Wn;
  function Gn(e3) {
    jn = e3.za, Q = i2._free = e3.Aa, Mn = i2._malloc = e3.Ca, Nn = e3.Da, $ = e3.Ea, Pn = e3.Fa, Fn = e3.Ga, In = e3.Ha, Ln = e3.Ia, Rn = e3.Ja, zn = e3.Ka, G.viijii = e3.La, Bn = G.viijjijjjjjj = e3.Ma, Vn = G.iiijj = e3.Na, Hn = G.jiiii = e3.Oa, G.iiiiij = e3.Pa, G.iiiiijj = e3.Qa, G.iiiiiijj = e3.Ra, Un = e3.xa, Wn = e3.Ba;
  }
  var Kn = {
    q: be2,
    x: xe2,
    a: Ce2,
    i: we2,
    m: Te2,
    S: Ee2,
    p: De2,
    fa: Oe2,
    d: ke2,
    ba: Ae2,
    ua: Ne,
    aa: Pe,
    oa: Ie,
    sa: Ct,
    ra: Dt,
    H: kt,
    ma: Nt,
    X: Ft,
    Y: It,
    A: Rt,
    qa: Bt,
    u: Vt,
    ta: Ut,
    na: Xt,
    T: an,
    I: on,
    va: sn,
    pa: cn,
    O: gn,
    wa: jt,
    F: _n,
    U: vn,
    N: yn,
    ha: bn,
    ca: xn,
    ga: Tn,
    da: On,
    ea: kn,
    ka: pr,
    M: gr,
    B: Sr,
    P: er,
    V: wr,
    s: Tr,
    b: Yn,
    C: hr,
    ia: br,
    c: Zn,
    Q: xr,
    h: $n,
    j: or,
    r: sr,
    R: mr,
    t: lr,
    G: ur,
    D: dr,
    K: Er,
    _: kr,
    Z: Ar,
    f: tr,
    l: qn,
    e: Xn,
    W: _r,
    g: Qn,
    L: Cr,
    k: Jn,
    ja: vr,
    o: cr,
    y: rr,
    v: fr,
    E: ar,
    w: yr,
    n: nr,
    J: Dr,
    la: ir,
    $: Or,
    z: An
  };
  function qn(e3, t3) {
    var n3 = D2();
    try {
      K(e3)(t3);
    } catch (e4) {
      if (E2(n3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Jn(e3, t3, n3, r3, i3) {
    var a3 = D2();
    try {
      K(e3)(t3, n3, r3, i3);
    } catch (e4) {
      if (E2(a3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Yn(e3, t3) {
    var n3 = D2();
    try {
      return K(e3)(t3);
    } catch (e4) {
      if (E2(n3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Xn(e3, t3, n3) {
    var r3 = D2();
    try {
      K(e3)(t3, n3);
    } catch (e4) {
      if (E2(r3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Zn(e3, t3, n3) {
    var r3 = D2();
    try {
      return K(e3)(t3, n3);
    } catch (e4) {
      if (E2(r3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Qn(e3, t3, n3, r3) {
    var i3 = D2();
    try {
      K(e3)(t3, n3, r3);
    } catch (e4) {
      if (E2(i3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function $n(e3, t3, n3, r3) {
    var i3 = D2();
    try {
      return K(e3)(t3, n3, r3);
    } catch (e4) {
      if (E2(i3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function er(e3, t3, n3, r3, i3, a3) {
    var o3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3);
    } catch (e4) {
      if (E2(o3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function tr(e3) {
    var t3 = D2();
    try {
      K(e3)();
    } catch (e4) {
      if (E2(t3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function nr(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3) {
    var d3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3, c3, l3, u3);
    } catch (e4) {
      if (E2(d3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function rr(e3, t3, n3, r3, i3, a3, o3) {
    var s3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3);
    } catch (e4) {
      if (E2(s3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function ir(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3, p3, m3, h3, g3) {
    var _3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3, p3, m3, h3, g3);
    } catch (e4) {
      if (E2(_3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function ar(e3, t3, n3, r3, i3, a3, o3, s3, c3) {
    var l3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3, c3);
    } catch (e4) {
      if (E2(l3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function or(e3, t3, n3, r3, i3) {
    var a3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3);
    } catch (e4) {
      if (E2(a3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function sr(e3, t3, n3, r3, i3, a3) {
    var o3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3);
    } catch (e4) {
      if (E2(o3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function cr(e3, t3, n3, r3, i3, a3) {
    var o3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3);
    } catch (e4) {
      if (E2(o3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function lr(e3, t3, n3, r3, i3, a3, o3) {
    var s3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3, o3);
    } catch (e4) {
      if (E2(s3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function ur(e3, t3, n3, r3, i3, a3, o3, s3) {
    var c3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3, o3, s3);
    } catch (e4) {
      if (E2(c3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function dr(e3, t3, n3, r3, i3, a3, o3, s3, c3) {
    var l3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3, o3, s3, c3);
    } catch (e4) {
      if (E2(l3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function fr(e3, t3, n3, r3, i3, a3, o3, s3) {
    var c3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3);
    } catch (e4) {
      if (E2(c3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function pr(e3, t3, n3) {
    var r3 = D2();
    try {
      return K(e3)(t3, n3);
    } catch (e4) {
      if (E2(r3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function mr(e3, t3, n3, r3, i3, a3, o3) {
    var s3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3, o3);
    } catch (e4) {
      if (E2(s3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function hr(e3, t3, n3, r3) {
    var i3 = D2();
    try {
      return K(e3)(t3, n3, r3);
    } catch (e4) {
      if (E2(i3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function gr(e3, t3, n3, r3) {
    var i3 = D2();
    try {
      return K(e3)(t3, n3, r3);
    } catch (e4) {
      if (E2(i3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function _r(e3, t3, n3, r3, i3, a3, o3, s3, c3) {
    var l3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3, c3);
    } catch (e4) {
      if (E2(l3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function vr(e3, t3, n3, r3, i3, a3, o3, s3) {
    var c3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3);
    } catch (e4) {
      if (E2(c3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function yr(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3) {
    var u3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3, c3, l3);
    } catch (e4) {
      if (E2(u3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function br(e3, t3, n3) {
    var r3 = D2();
    try {
      return K(e3)(t3, n3);
    } catch (e4) {
      if (E2(r3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function xr(e3, t3, n3, r3, i3) {
    var a3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3);
    } catch (e4) {
      if (E2(a3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Sr(e3, t3, n3, r3, i3, a3) {
    var o3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3);
    } catch (e4) {
      if (E2(o3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Cr(e3, t3, n3, r3, i3, a3, o3) {
    var s3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3);
    } catch (e4) {
      if (E2(s3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function wr(e3, t3, n3, r3) {
    var i3 = D2();
    try {
      return K(e3)(t3, n3, r3);
    } catch (e4) {
      if (E2(i3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Tr(e3) {
    var t3 = D2();
    try {
      return K(e3)();
    } catch (e4) {
      if (E2(t3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Er(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3) {
    var f3 = D2();
    try {
      return K(e3)(t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3);
    } catch (e4) {
      if (E2(f3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Dr(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3, p3, m3, h3) {
    var g3 = D2();
    try {
      K(e3)(t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3, p3, m3, h3);
    } catch (e4) {
      if (E2(g3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Or(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3, p3, m3, h3, g3, _3, ee3, te3) {
    var ne3 = D2();
    try {
      Bn(e3, t3, n3, r3, i3, a3, o3, s3, c3, l3, u3, d3, f3, p3, m3, h3, g3, _3, ee3, te3);
    } catch (e4) {
      if (E2(ne3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function kr(e3, t3, n3, r3, i3, a3, o3) {
    var s3 = D2();
    try {
      return Vn(e3, t3, n3, r3, i3, a3, o3);
    } catch (e4) {
      if (E2(s3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function Ar(e3, t3, n3, r3, i3) {
    var a3 = D2();
    try {
      return Hn(e3, t3, n3, r3, i3);
    } catch (e4) {
      if (E2(a3), e4 !== e4 + 0) throw e4;
      $(1, 0);
    }
  }
  function jr() {
    v2();
    function e3() {
      var e4, t3;
      i2.calledRun = true, !g2 && (re2(), (e4 = _2) == null || e4(i2), (t3 = i2.onRuntimeInitialized) == null || t3.call(i2), ie2());
    }
    i2.setStatus ? (i2.setStatus("Running..."), setTimeout(() => {
      setTimeout(() => i2.setStatus(""), 1), e3();
    }, 1)) : e3();
  }
  var Mr = await fe2();
  return jr(), t2 = te2 ? i2 : new Promise((e3, t3) => {
    _2 = e3, ee2 = t3;
  }), t2;
}
function ce(e2) {
  return ie(se, e2);
}
async function de(e2, t2) {
  return oe(se, e2, t2);
}
var b = [
  ["aztec", "Aztec"],
  ["aztec_code", "AztecCode"],
  ["aztec_rune", "AztecRune"],
  ["code_128", "Code128"],
  ["code_39", "Code39"],
  ["code_39_standard", "Code39Std"],
  ["code_39_extended", "Code39Ext"],
  ["code_32", "Code32"],
  ["pzn", "PZN"],
  ["code_93", "Code93"],
  ["codabar", "Codabar"],
  ["databar", "DataBar"],
  ["databar_omni", "DataBarOmni"],
  ["databar_stacked", "DataBarStk"],
  ["databar_stacked_omni", "DataBarStkOmni"],
  ["databar_expanded", "DataBarExp"],
  ["databar_expanded_stacked", "DataBarExpStk"],
  ["databar_limited", "DataBarLtd"],
  ["data_matrix", "DataMatrix"],
  ["dx_film_edge", "DXFilmEdge"],
  ["ean_13", "EAN13"],
  ["ean_upc", "EANUPC"],
  ["isbn", "ISBN"],
  ["ean_8", "EAN8"],
  ["itf", "ITF"],
  ["itf_14", "ITF14"],
  ["maxi_code", "MaxiCode"],
  ["micro_qr_code", "MicroQRCode"],
  ["pdf417", "PDF417"],
  ["compact_pdf417", "CompactPDF417"],
  ["micro_pdf417", "MicroPDF417"],
  ["qr_code", "QRCode"],
  ["qr_code_model_1", "QRCodeModel1"],
  ["qr_code_model_2", "QRCodeModel2"],
  ["rm_qr_code", "RMQRCode"],
  ["upc_a", "UPCA"],
  ["upc_e", "UPCE"],
  ["telepen", "Telepen"],
  ["telepen_alpha", "TelepenAlpha"],
  ["telepen_numeric", "TelepenNumeric"],
  ["other_barcode", "OtherBarcode"],
  ["linear_codes", "AllLinear"],
  ["matrix_codes", "AllMatrix"],
  ["gs1_codes", "AllGS1"],
  ["retail_codes", "AllRetail"],
  ["industrial_codes", "AllIndustrial"],
  ["any", "All"]
];
var x = [...b, ["unknown"]].map((e2) => e2[0]);
var S = new Map(b);
function pe(e2) {
  for (let [t2, n2] of S) if (e2 === n2) return t2;
  return "unknown";
}
function me(e2) {
  if (C(e2)) return {
    width: e2.naturalWidth,
    height: e2.naturalHeight
  };
  if (w(e2)) return {
    width: e2.width.baseVal.value,
    height: e2.height.baseVal.value
  };
  if (T(e2)) return {
    width: e2.videoWidth,
    height: e2.videoHeight
  };
  if (ge(e2)) return {
    width: e2.width,
    height: e2.height
  };
  if (ve(e2)) return {
    width: e2.displayWidth,
    height: e2.displayHeight
  };
  if (he(e2) || _e(e2)) return {
    width: e2.width,
    height: e2.height
  };
  throw TypeError("The provided value is not of type '(Blob or HTMLCanvasElement or HTMLImageElement or HTMLVideoElement or ImageBitmap or ImageData or OffscreenCanvas or SVGImageElement or VideoFrame)'.");
}
function C(e2) {
  try {
    var t2;
    return e2 instanceof (e2 == null || (t2 = e2.ownerDocument) == null || (t2 = t2.defaultView) == null ? void 0 : t2.HTMLImageElement);
  } catch {
    return false;
  }
}
function w(e2) {
  try {
    var t2;
    return e2 instanceof (e2 == null || (t2 = e2.ownerDocument) == null || (t2 = t2.defaultView) == null ? void 0 : t2.SVGImageElement);
  } catch {
    return false;
  }
}
function T(e2) {
  try {
    var t2;
    return e2 instanceof (e2 == null || (t2 = e2.ownerDocument) == null || (t2 = t2.defaultView) == null ? void 0 : t2.HTMLVideoElement);
  } catch {
    return false;
  }
}
function he(e2) {
  try {
    var t2;
    return e2 instanceof (e2 == null || (t2 = e2.ownerDocument) == null || (t2 = t2.defaultView) == null ? void 0 : t2.HTMLCanvasElement);
  } catch {
    return false;
  }
}
function ge(e2) {
  try {
    return e2 instanceof ImageBitmap || Object.prototype.toString.call(e2) === "[object ImageBitmap]";
  } catch {
    return false;
  }
}
function _e(e2) {
  try {
    return e2 instanceof OffscreenCanvas || Object.prototype.toString.call(e2) === "[object OffscreenCanvas]";
  } catch {
    return false;
  }
}
function ve(e2) {
  try {
    return e2 instanceof VideoFrame || Object.prototype.toString.call(e2) === "[object VideoFrame]";
  } catch {
    return false;
  }
}
function ye(e2) {
  try {
    return e2 instanceof Blob || Object.prototype.toString.call(e2) === "[object Blob]";
  } catch {
    return false;
  }
}
function E(e2) {
  try {
    return e2 instanceof ImageData || Object.prototype.toString.call(e2) === "[object ImageData]";
  } catch {
    return false;
  }
}
function D(e2, t2) {
  try {
    let n2 = new OffscreenCanvas(e2, t2);
    if (n2.getContext("2d") instanceof OffscreenCanvasRenderingContext2D) return n2;
    throw void 0;
  } catch {
    let n2 = document.createElement("canvas");
    return n2.width = e2, n2.height = t2, n2;
  }
}
async function O(e2) {
  if (C(e2) && !await xe(e2)) throw new DOMException("Failed to load or decode HTMLImageElement.", "InvalidStateError");
  if (w(e2) && !await Se(e2)) throw new DOMException("Failed to load or decode SVGImageElement.", "InvalidStateError");
  if (ve(e2) && j(e2)) throw new DOMException("VideoFrame is closed.", "InvalidStateError");
  if (T(e2) && (e2.readyState === 0 || e2.readyState === 1)) throw new DOMException("Invalid element or state.", "InvalidStateError");
  if (ge(e2) && Ce(e2)) throw new DOMException("The image source is detached.", "InvalidStateError");
  let { width: t2, height: n2 } = me(e2);
  if (t2 === 0 || n2 === 0) return null;
  let r2 = D(t2, n2).getContext("2d");
  r2.drawImage(e2, 0, 0);
  try {
    return r2.getImageData(0, 0, t2, n2);
  } catch {
    throw new DOMException("Source would taint origin.", "SecurityError");
  }
}
async function k(e2) {
  let t2;
  try {
    t2 = await createImageBitmap(e2);
  } catch {
    try {
      if (globalThis.Image) {
        t2 = new Image();
        let n2 = "";
        try {
          n2 = URL.createObjectURL(e2), t2.src = n2, await t2.decode();
        } finally {
          URL.revokeObjectURL(n2);
        }
      } else return e2;
    } catch {
      throw new DOMException("Failed to load or decode Blob.", "InvalidStateError");
    }
  }
  return await O(t2);
}
function be(e2) {
  let { width: t2, height: n2 } = e2;
  if (t2 === 0 || n2 === 0) return null;
  let r2 = e2.getContext("2d");
  try {
    return r2.getImageData(0, 0, t2, n2);
  } catch {
    throw new DOMException("Source would taint origin.", "SecurityError");
  }
}
async function A(e2) {
  if (ye(e2)) return await k(e2);
  if (E(e2)) {
    if (M(e2)) throw new DOMException("The image data has been detached.", "InvalidStateError");
    return e2;
  }
  return he(e2) || _e(e2) ? be(e2) : await O(e2);
}
async function xe(e2) {
  try {
    return await e2.decode(), true;
  } catch {
    return false;
  }
}
async function Se(e2) {
  try {
    var t2;
    return await ((t2 = e2.decode) == null ? void 0 : t2.call(e2)), true;
  } catch {
    return false;
  }
}
function j(e2) {
  return e2.format === null;
}
function M(e2) {
  return e2.data.buffer.byteLength === 0;
}
function Ce(e2) {
  return e2.width === 0 && e2.height === 0;
}
function we(e2, t2) {
  return Te(e2) ? new DOMException(`${t2}: ${e2.message}`, e2.name) : Ee(e2) ? new e2.constructor(`${t2}: ${e2.message}`) : /* @__PURE__ */ Error(`${t2}: ${e2}`);
}
function Te(e2) {
  return e2 instanceof DOMException || Object.prototype.toString.call(e2) === "[object DOMException]";
}
function Ee(e2) {
  return e2 instanceof Error || Object.prototype.toString.call(e2) === "[object Error]";
}
function De(e2, t2) {
  if (t2.has(e2)) throw TypeError("Cannot initialize the same private elements twice on an object");
}
function Oe(e2, t2, n2) {
  De(e2, t2), t2.set(e2, n2);
}
function ke(e2, t2, n2) {
  if (typeof e2 == "function" ? e2 === t2 : e2.has(t2)) return arguments.length < 3 ? t2 : n2;
  throw TypeError("Private element is not present on this object");
}
function Ae(e2, t2, n2) {
  return e2.set(ke(e2, t2), n2), n2;
}
function N(e2, t2) {
  return e2.get(ke(e2, t2));
}
var P = /* @__PURE__ */ new WeakMap();
var F = class {
  constructor(e2 = {}) {
    Oe(this, P, void 0);
    try {
      var t2;
      let n2 = e2 == null || (t2 = e2.formats) == null ? void 0 : t2.filter((e3) => e3 !== "unknown");
      if ((n2 == null ? void 0 : n2.length) === 0) throw TypeError("Hint option provided, but is empty.");
      for (let e3 of n2 == null ? [] : n2) if (!S.has(e3)) throw TypeError(`Failed to read the 'formats' property from 'BarcodeDetectorOptions': The provided value '${e3}' is not a valid enum value of type BarcodeFormat.`);
      Ae(P, this, n2 == null ? [] : n2), ce({ fireImmediately: true }).catch(() => {
      });
    } catch (e3) {
      throw we(e3, "Failed to construct 'BarcodeDetector'");
    }
  }
  static async getSupportedFormats() {
    return x.filter((e2) => e2 !== "unknown");
  }
  async detect(e2) {
    try {
      let t2 = await A(e2);
      if (t2 === null) return [];
      let n2, r2 = {
        textMode: "Plain",
        formats: N(P, this).map((e3) => S.get(e3))
      };
      try {
        n2 = await de(t2, r2);
      } catch (e3) {
        throw console.error(e3), new DOMException("Barcode detection service unavailable.", "NotSupportedError");
      }
      return n2.map((e3) => {
        let { topLeft: { x: t3, y: n3 }, topRight: { x: r3, y: i2 }, bottomLeft: { x: a2, y: o2 }, bottomRight: { x: s2, y: c2 } } = e3.position, l2 = Math.min(t3, r3, a2, s2), u2 = Math.min(n3, i2, o2, c2), d2 = Math.max(t3, r3, a2, s2), f2 = Math.max(n3, i2, o2, c2);
        return {
          boundingBox: new DOMRectReadOnly(l2, u2, d2 - l2, f2 - u2),
          rawValue: e3.text,
          format: pe(e3.format),
          cornerPoints: [
            {
              x: t3,
              y: n3
            },
            {
              x: r3,
              y: i2
            },
            {
              x: s2,
              y: c2
            },
            {
              x: a2,
              y: o2
            }
          ]
        };
      });
    } catch (e3) {
      throw we(e3, "Failed to execute 'detect' on 'BarcodeDetector'");
    }
  }
};

// src/detector.ts
var DEFAULT_FORMATS = ["qr_code"];
function createDefaultDetector(options = {}) {
  if (options.wasmOverrides) {
    ce({ overrides: options.wasmOverrides });
  }
  const detector = new F({
    formats: options.formats ?? DEFAULT_FORMATS
  });
  return {
    async detect(source) {
      const detections = await detector.detect(source);
      return detections;
    }
  };
}
function toScanResult(d2, timestamp = Date.now()) {
  return {
    value: d2.rawValue,
    format: d2.format,
    cornerPoints: (d2.cornerPoints ?? []).map((p2) => ({ x: p2.x, y: p2.y })),
    boundingBox: d2.boundingBox,
    timestamp
  };
}

// src/scanner.ts
var _g3 = globalThis;
var DEFAULT_SCAN_INTERVAL_MS = 100;
var DEFAULT_DEDUPE_MS = 1500;
var MAX_DETECT_FAILURES = 5;
function classifyAcquireError(e2) {
  const name = e2?.name ?? "";
  const message = e2?.message || String(e2);
  switch (name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { code: ScannerErrorCode.NoDevice, message };
    case "SecurityError":
      return { code: ScannerErrorCode.InsecureContext, message };
    case "NotReadableError":
    case "TrackStartError":
      return { code: ScannerErrorCode.DeviceBusy, message };
    case "NotSupportedError":
      return { code: ScannerErrorCode.NotSupported, message };
    default:
      return { code: ScannerErrorCode.RequestFailed, message };
  }
}
function isPermissionDenied(e2) {
  const name = e2?.name ?? "";
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}
function createScanner(config = {}) {
  const logger = config.logger ?? createClog("scanner");
  const ownsAdapter = !config.adapter;
  const adapter = config.adapter ?? createDefaultCameraAdapter();
  const mode = config.mode ?? "single";
  const scanIntervalMs = Math.max(0, config.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS);
  const dedupeMs = Math.max(0, config.dedupeMs ?? DEFAULT_DEDUPE_MS);
  const store = createStore({
    status: "idle",
    error: null,
    permission: "unknown",
    torch: { supported: false, on: false },
    cameras: [],
    activeCameraId: null,
    lastResult: null
  });
  let detector = config.detector ?? null;
  let video = config.video ?? null;
  let stream = null;
  let destroyed = false;
  let active = false;
  let paused = false;
  let generation = 0;
  let startPromise = null;
  let resolveStart = null;
  let frameCancel = null;
  let lastDetectAt = 0;
  let consecutiveFailures = 0;
  const seen = /* @__PURE__ */ new Map();
  let overrideDeviceId = null;
  let switchChain = Promise.resolve();
  let torchProbeTimer = null;
  let trackEndedCleanup = null;
  const cleanups = [];
  function update(patch) {
    store.update((s2) => ({ ...s2, ...patch }));
  }
  function setError(error) {
    logger.warn(`[${error.code}]`, error.message);
    update({ error });
    try {
      config.onError?.(error);
    } catch (e2) {
      logger.error("onError callback threw", e2);
    }
  }
  function reportAcquireError(e2) {
    if (isPermissionDenied(e2)) {
      update({ permission: "denied" });
      setError({
        code: ScannerErrorCode.PermissionDenied,
        message: e2?.message || "Camera permission denied"
      });
    } else {
      setError(classifyAcquireError(e2));
    }
  }
  function safeOnScan(result) {
    try {
      config.onScan?.(result);
    } catch (e2) {
      logger.error("onScan callback threw", e2);
    }
  }
  function prepVideoEl(v2) {
    try {
      v2.muted = true;
      v2.autoplay = true;
      v2.playsInline = true;
      v2.setAttribute?.("playsinline", "");
      v2.setAttribute?.("muted", "");
      v2.setAttribute?.("autoplay", "");
    } catch (e2) {
      logger.debug("prepVideoEl", e2);
    }
  }
  function getVideo() {
    if (video) return video;
    if (!_g3?.document?.createElement) return null;
    video = _g3.document.createElement("video");
    prepVideoEl(video);
    return video;
  }
  function videoReady(v2) {
    return (v2.readyState ?? 0) >= 2 && (v2.videoWidth ?? 0) > 0;
  }
  function scheduleFrame(v2, fn) {
    const anyV = v2;
    if (typeof anyV.requestVideoFrameCallback === "function") {
      const id2 = anyV.requestVideoFrameCallback(() => fn());
      return () => anyV.cancelVideoFrameCallback?.(id2);
    }
    if (typeof _g3.requestAnimationFrame === "function") {
      const id2 = _g3.requestAnimationFrame(() => fn());
      return () => _g3.cancelAnimationFrame?.(id2);
    }
    const id = setTimeout(fn, Math.max(scanIntervalMs, 16));
    return () => clearTimeout(id);
  }
  function loop() {
    if (!active || destroyed || !video) return;
    const gen = generation;
    frameCancel = scheduleFrame(video, () => void onFrame(gen));
  }
  async function onFrame(gen) {
    if (gen !== generation || !active || destroyed || !video) return;
    const now = Date.now();
    const hidden = _g3?.document?.visibilityState === "hidden";
    if (!hidden && !paused && now - lastDetectAt >= scanIntervalMs && videoReady(video)) {
      lastDetectAt = now;
      try {
        const detections = await detector.detect(video);
        if (gen !== generation || !active || destroyed) return;
        consecutiveFailures = 0;
        if (detections?.length) {
          handleDetections(detections.map((d2) => toScanResult(d2)));
          if (!active) return;
        }
      } catch (e2) {
        if (gen !== generation || destroyed) return;
        consecutiveFailures++;
        logger.debug("detect failed", e2);
        if (consecutiveFailures >= MAX_DETECT_FAILURES) {
          setError({
            code: ScannerErrorCode.DetectorFailed,
            message: e2?.message || String(e2)
          });
          stopWith(null, "stopped");
          return;
        }
      }
    }
    loop();
  }
  function handleDetections(results) {
    if (mode === "single") {
      const result = results[0];
      update({ lastResult: result });
      safeOnScan(result);
      stopWith(result, "stopped");
      return;
    }
    for (const result of results) {
      const key = `${result.format}|${result.value}`;
      const last = seen.get(key) ?? 0;
      if (result.timestamp - last < dedupeMs) continue;
      seen.set(key, result.timestamp);
      update({ lastResult: result });
      safeOnScan(result);
    }
    if (seen.size > 64) {
      const now = Date.now();
      for (const [key, ts] of seen) {
        if (now - ts >= dedupeMs) seen.delete(key);
      }
    }
  }
  function buildConstraints() {
    const cam = overrideDeviceId ?? config.preferredCamera ?? "environment";
    const videoC = cam === "environment" || cam === "user" ? { facingMode: { ideal: cam } } : { deviceId: { exact: cam } };
    return { video: videoC, audio: false };
  }
  function adoptStream(s2) {
    stream = s2;
    const track = s2.getVideoTracks?.()[0];
    const settings = track?.getSettings?.();
    const caps = track?.getCapabilities?.();
    update({
      activeCameraId: settings?.deviceId ?? null,
      torch: { supported: !!caps?.torch, on: false }
    });
  }
  function scheduleTorchReprobe(track, gen) {
    if (typeof track?.getCapabilities !== "function") return;
    if (torchProbeTimer) clearTimeout(torchProbeTimer);
    torchProbeTimer = setTimeout(() => {
      torchProbeTimer = null;
      if (gen !== generation || destroyed) return;
      try {
        const caps = track.getCapabilities?.();
        if (caps?.torch && !store.get().torch.supported) {
          store.update((s2) => ({
            ...s2,
            torch: { ...s2.torch, supported: true }
          }));
        }
      } catch (_e2) {
      }
    }, 500);
  }
  function watchTrackEnded(track, gen) {
    trackEndedCleanup?.();
    trackEndedCleanup = null;
    if (typeof track?.addEventListener !== "function") return;
    const onEnded = () => {
      if (gen !== generation || destroyed) return;
      setError({
        code: ScannerErrorCode.RequestFailed,
        message: "Camera track ended unexpectedly (permission revoked, device unplugged or preempted)"
      });
      stopWith(null, "stopped");
    };
    track.addEventListener("ended", onEnded);
    trackEndedCleanup = () => track.removeEventListener?.("ended", onEnded);
  }
  async function playStream(s2) {
    if (!video) return;
    try {
      video.srcObject = s2;
      await video.play?.();
    } catch (e2) {
      logger.debug("video.play()", e2);
    }
  }
  async function refreshCameras() {
    if (destroyed) return [];
    try {
      const cameras = await adapter.enumerateVideoDevices();
      if (!destroyed) update({ cameras });
      return cameras;
    } catch (e2) {
      logger.debug("enumerateVideoDevices failed", e2);
      return [];
    }
  }
  async function init(gen) {
    update({ status: "initializing", error: null, lastResult: null });
    if (!detector) {
      try {
        detector = createDefaultDetector({
          formats: config.formats,
          wasmOverrides: config.wasmOverrides
        });
      } catch (e2) {
        setError({
          code: ScannerErrorCode.DetectorFailed,
          message: e2?.message || String(e2)
        });
        finishStart(null, "idle");
        return;
      }
    }
    if (!getVideo()) {
      setError({
        code: ScannerErrorCode.NotSupported,
        message: "No DOM available to create a video element (pass config.video explicitly)"
      });
      finishStart(null, "idle");
      return;
    }
    let s2;
    try {
      s2 = await adapter.getStream(buildConstraints());
    } catch (e2) {
      if (gen !== generation || destroyed) return;
      reportAcquireError(e2);
      finishStart(null, "idle");
      return;
    }
    if (gen !== generation || destroyed) {
      s2.getTracks?.().forEach((t2) => t2.stop());
      return;
    }
    update({ permission: "granted" });
    adoptStream(s2);
    await playStream(s2);
    if (gen !== generation || destroyed) return;
    const track = s2.getVideoTracks?.()[0];
    watchTrackEnded(track, gen);
    scheduleTorchReprobe(track, gen);
    lastDetectAt = 0;
    consecutiveFailures = 0;
    seen.clear();
    active = true;
    update({ status: "scanning" });
    void refreshCameras();
    loop();
  }
  function finishStart(result, status) {
    update({ status });
    const resolve = resolveStart;
    resolveStart = null;
    startPromise = null;
    resolve?.(result);
  }
  function stopWith(result, status) {
    generation++;
    active = false;
    paused = false;
    frameCancel?.();
    frameCancel = null;
    trackEndedCleanup?.();
    trackEndedCleanup = null;
    if (torchProbeTimer) {
      clearTimeout(torchProbeTimer);
      torchProbeTimer = null;
    }
    try {
      stream?.getTracks?.().forEach((t2) => t2.stop());
    } catch (e2) {
      logger.debug("track stop", e2);
    }
    stream = null;
    if (video) {
      try {
        video.srcObject = null;
      } catch (_e2) {
      }
    }
    store.update((s2) => ({ ...s2, torch: { ...s2.torch, on: false } }));
    finishStart(result, status);
  }
  function start() {
    if (destroyed) {
      logger.warn("start() called on destroyed scanner");
      return Promise.resolve(null);
    }
    if (startPromise) return startPromise;
    startPromise = new Promise((resolve) => {
      resolveStart = resolve;
    });
    const p2 = startPromise;
    void init(++generation);
    return p2;
  }
  function stop() {
    if (destroyed) return;
    if (!startPromise && !active && !stream) return;
    stopWith(null, "stopped");
  }
  function setCamera(deviceId) {
    if (destroyed) return Promise.resolve();
    overrideDeviceId = deviceId;
    switchChain = switchChain.then(() => doSwitchCamera(deviceId));
    return switchChain;
  }
  async function doSwitchCamera(deviceId) {
    if (destroyed || !stream) return;
    if (store.get().activeCameraId === deviceId) return;
    const gen = generation;
    paused = true;
    try {
      stream.getTracks?.().forEach((t2) => t2.stop());
      stream = null;
      const s2 = await adapter.getStream({
        video: { deviceId: { exact: deviceId } },
        audio: false
      });
      if (gen !== generation || destroyed || !active) {
        s2.getTracks?.().forEach((t2) => t2.stop());
        return;
      }
      adoptStream(s2);
      await playStream(s2);
      const track = s2.getVideoTracks?.()[0];
      watchTrackEnded(track, gen);
      scheduleTorchReprobe(track, gen);
    } catch (e2) {
      if (gen !== generation || destroyed) return;
      reportAcquireError(e2);
      stopWith(null, "stopped");
    } finally {
      if (gen === generation) paused = false;
    }
  }
  async function setTorch(on) {
    if (destroyed) return false;
    const gen = generation;
    const track = stream?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.();
    if (!caps?.torch) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      if (gen !== generation || destroyed) return false;
      store.update((s2) => ({ ...s2, torch: { ...s2.torch, on } }));
      return true;
    } catch (e2) {
      logger.warn("setTorch failed", e2);
      return false;
    }
  }
  function destroy() {
    if (destroyed) return;
    stopWith(null, "stopped");
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (_e2) {
      }
    });
    cleanups.length = 0;
    if (ownsAdapter) {
      try {
        adapter.destroy?.();
      } catch (e2) {
        logger.debug("adapter destroy", e2);
      }
    }
    destroyed = true;
  }
  if (video) prepVideoEl(video);
  adapter.queryPermission?.().then((status) => {
    if (status && !destroyed) update({ permission: status });
  }).catch(() => {
  });
  const unsubPerm = adapter.onPermissionChange?.((status) => {
    if (!destroyed) update({ permission: status });
  });
  if (unsubPerm) cleanups.push(unsubPerm);
  return {
    subscribe: store.subscribe.bind(store),
    get: store.get.bind(store),
    start,
    stop,
    listCameras: refreshCameras,
    setCamera,
    setTorch,
    getVideo,
    destroy
  };
}

// src/scan-image.ts
async function scanImage(source, options = {}) {
  const detector = options.detector ?? createDefaultDetector({
    formats: options.formats,
    wasmOverrides: options.wasmOverrides
  });
  let src;
  if (typeof source === "string") {
    const resp = await fetch(source);
    if (!resp.ok) {
      throw new Error(`Failed to fetch image (${resp.status}): ${source}`);
    }
    src = await resp.blob();
  } else {
    src = source;
  }
  const detections = await detector.detect(src);
  const now = Date.now();
  return detections.map((d2) => toScanResult(d2, now));
}
export {
  DEFAULT_FORMATS,
  ScannerErrorCode,
  classifyAcquireError,
  createDefaultCameraAdapter,
  createDefaultDetector,
  createScanner,
  detectFacing,
  scanImage,
  toScanResult
};
