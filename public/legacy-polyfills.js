/*
 * Small, guarded polyfills for older tablet browsers — mainly iPads stuck on
 * iPadOS 15 (Safari 15), plus iPadOS 16 / early 17 for Promise.withResolvers.
 * Loaded before any app code (next/script "beforeInteractive" in the root
 * layout). Each one only installs itself when the browser is missing it, so
 * modern browsers are untouched.
 *
 * Why these specific ones: they're the APIs that a scan of the production
 * build found in Next.js's own runtime (Object.hasOwn) and in libraries the
 * board loads, that Safari 15.0–15.3 doesn't have.
 */
(function () {
  function define(target, name, value) {
    if (target && !(name in target)) {
      Object.defineProperty(target, name, { value: value, writable: true, configurable: true });
    }
  }

  define(Object, "hasOwn", function (obj, key) {
    return Object.prototype.hasOwnProperty.call(Object(obj), key);
  });

  function at(index) {
    var len = this.length;
    var i = Math.trunc(index) || 0;
    if (i < 0) i += len;
    if (i < 0 || i >= len) return undefined;
    return this[i];
  }
  define(Array.prototype, "at", at);
  define(String.prototype, "at", function (index) {
    return at.call(String(this), index);
  });
  if (typeof Int8Array !== "undefined") {
    define(Object.getPrototypeOf(Int8Array.prototype), "at", at);
  }

  define(Array.prototype, "findLast", function (fn, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (fn.call(thisArg, this[i], i, this)) return this[i];
    }
    return undefined;
  });
  define(Array.prototype, "findLastIndex", function (fn, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (fn.call(thisArg, this[i], i, this)) return i;
    }
    return -1;
  });

  if (typeof Promise !== "undefined") {
    define(Promise, "withResolvers", function () {
      var resolve, reject;
      var promise = new this(function (res, rej) {
        resolve = res;
        reject = rej;
      });
      return { promise: promise, resolve: resolve, reject: reject };
    });
  }

  if (typeof AbortSignal !== "undefined" && typeof AbortController !== "undefined") {
    define(AbortSignal, "timeout", function (ms) {
      var controller = new AbortController();
      setTimeout(function () {
        var reason;
        try {
          reason = new DOMException("The operation timed out.", "TimeoutError");
        } catch (e) {
          reason = new Error("The operation timed out.");
        }
        controller.abort(reason);
      }, ms);
      return controller.signal;
    });
  }
})();
