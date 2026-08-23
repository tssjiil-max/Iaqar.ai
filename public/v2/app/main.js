import { buildV2Hash, parseV2Hash } from "./router.js";
import { createV2Shell } from "./shell.js";
function boot() {
    const root = document.getElementById("v2-root");
    if (!root)
        return;
    const shell = createV2Shell(root);
    const sync = () => {
        const route = parseV2Hash(window.location.hash);
        const expected = buildV2Hash(route);
        if (window.location.hash !== expected) {
            window.history.replaceState(window.history.state, "", expected);
        }
        shell.render(route);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    sync();
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
}
else {
    boot();
}
//# sourceMappingURL=main.js.map