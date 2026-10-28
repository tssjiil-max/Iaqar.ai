# Smart Office Focus Implementation Plan

Goal: daily decisions, matches, deals, assistant and scout before secondary tools.
Architecture: existing services, same data and permissions; new presentation routes and navigation mapping only.
Tech Stack: existing ES modules, local Firestore harness, Node and Playwright.
Spec: user's approved execution brief in this session, 27 October 2026.

Constraints: no cloud database, messages, paid services, merge or deployment; preserve financial parsing and existing routes.

- [x] Capture baseline at 320/390/430/1024/1280 using local fixtures.
- [x] Add five-destination navigation mapping and nested-route unit tests.
- [x] Compact identity and work-first dashboard with loading/error states and same actor/task grouping.
- [x] Add deals list over existing journeys, older-result loading and follow hub links.
- [x] Add More/tools/support/link, inbox tabs and preserve notification enrollment.
- [x] Verify financial regressions and emulator round trips.
- [x] Complete the broader browser gate and independently review; attach final results and screenshots.
- [x] Open ready review PR; never merge or deploy within this task.

Review focus: inactive/member access; closed and unassigned deals; view cleanup and late callbacks; office switching; loading/error must not masquerade as zero.
