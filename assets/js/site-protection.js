/* Shared browser-level protections for every portal screen. */
(function disableContextMenu() {
  "use strict";

  window.addEventListener(
    "contextmenu",
    function (event) {
      event.preventDefault();
    },
    { capture: true },
  );
})();

/*
 * Small client-side guard for actions that create an output.  It deliberately
 * lives in the shared browser layer so every page can use the same behavior:
 * one action may be in flight at a time, and a successful submission with the
 * same complete input set is not accepted again during this page session.
 */
(function installPortalValidation() {
  "use strict";

  const pendingActions = new Map();
  const completedActions = new Map();
  const duplicateWindowMs = 30000;

  function normalize(value) {
    return String(value == null ? "" : value)
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function fingerprint(value) {
    if (Array.isArray(value)) {
      return JSON.stringify(value.map(fingerprint));
    }
    if (value && typeof value === "object") {
      return JSON.stringify(
        Object.keys(value)
          .sort()
          .map((key) => [key, fingerprint(value[key])]),
      );
    }
    return normalize(value);
  }

  function begin(key, values) {
    const actionKey = String(key || "portal-action");
    const inputFingerprint = fingerprint(values);
    const requestKey = `${actionKey}:${inputFingerprint}`;
    const now = Date.now();

    if (pendingActions.has(actionKey)) {
      return {
        allowed: false,
        code: "in_flight",
        message: "This action is already being processed.",
      };
    }

    const completedAt = completedActions.get(requestKey) || 0;
    if (completedAt > now) {
      return {
        allowed: false,
        code: "duplicate_submission",
        message: "The same inputs were already submitted.",
      };
    }

    pendingActions.set(actionKey, requestKey);
    let finished = false;

    return {
      allowed: true,
      fingerprint: inputFingerprint,
      complete(success) {
        if (finished) return;
        finished = true;
        if (pendingActions.get(actionKey) === requestKey) {
          pendingActions.delete(actionKey);
        }
        if (success) {
          completedActions.set(requestKey, Date.now() + duplicateWindowMs);
          window.setTimeout(() => {
            if ((completedActions.get(requestKey) || 0) <= Date.now()) {
              completedActions.delete(requestKey);
            }
          }, duplicateWindowMs + 50);
        }
      },
    };
  }

  window.PortalValidation = { begin, fingerprint, normalize };
})();
