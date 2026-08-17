(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const officeId = String(params.get("office") || params.get("officeId") || params.get("o") || "").trim();
  if (!officeId || params.get("dashboard") === "1") return;

  const next = new URLSearchParams(location.search);
  next.set("office", officeId);
  next.delete("officeId");
  next.delete("o");
  if (!next.has("view")) next.set("view", "public");
  location.replace(`/?${next.toString()}`);
})();
