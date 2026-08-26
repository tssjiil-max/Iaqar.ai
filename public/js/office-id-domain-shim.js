(() => {
  "use strict";
  function text(value) {
    return String(value == null ? "" : value).trim();
  }
  function firestoreOfficeId(value) {
    return text(value)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
  function officeAuthorizationKey(value) {
    return text(value)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
  function officeIdsEquivalent(left, right) {
    const a = officeAuthorizationKey(left);
    const b = officeAuthorizationKey(right);
    return Boolean(a) && a === b;
  }
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.officeIdDomain = {
    text,
    firestoreOfficeId,
    officeAuthorizationKey,
    officeIdsEquivalent
  };
})();
