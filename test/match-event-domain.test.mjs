import test from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_EVENT_TYPE,
  appendMatchEvent,
  brokerUnreadCount,
  buildMatchEvent,
  choiceEventType,
  lastUpdateLine,
  lifecycleForEvents,
  matchEventLabel,
  matchEventLogRow,
  notificationDedupeKey,
  notificationRoutes,
  partyLinkChoices,
  partyVisibleEvents,
  projectMatchEvents,
  relativeTimeLabel,
  unreadUpdatesLabel
} from "../public/js/match-event-domain.js";

const at = (minute) => `2026-09-29T10:${String(minute).padStart(2, "0")}:00.000Z`;
const ev = (fields, minute) => {
  const built = buildMatchEvent({ matchId: "mat_1", officeId: "office-1", source: "party_link", eventId: `ev_${minute}`, createdAt: at(minute), ...fields });
  assert.equal(built.ok, true, JSON.stringify(built));
  return built.event;
};

test("event schema carries every required field and rejects an operation id as matchId", () => {
  const event = ev({ actorType: "client", actorId: "ps_1", eventType: "CLIENT_INTERESTED", payload: { choiceId: "interested", label: "مهتم" } }, 1);
  for (const key of ["eventId", "matchId", "officeId", "actorType", "actorId", "eventType", "recipient", "payload", "createdAt", "source"]) assert.ok(key in event, key);
  assert.equal(buildMatchEvent({ matchId: "op_abc", actorType: "client", eventType: "CLIENT_INTERESTED" }).error, "match_id_invalid");
  assert.equal(buildMatchEvent({ matchId: "mat_1", actorType: "client", eventType: "NOPE" }).error, "event_type_invalid");
  for (const type of ["CLIENT_INTERESTED", "CLIENT_NOT_INTERESTED", "CLIENT_NEEDS_TIME", "CLIENT_VIEWING_REQUESTED", "CLIENT_CONDITION_CHANGED",
    "OWNER_INTERESTED", "OWNER_NOT_INTERESTED", "OWNER_NEEDS_TIME", "OWNER_VIEWING_RESPONSE", "OWNER_CONDITION_CHANGED",
    "BROKER_MESSAGE", "BROKER_INTERNAL_NOTE", "LINK_OPENED", "AGREEMENT_UPDATED", "MATCH_AGREED", "MATCH_CLOSED_NO_AGREEMENT", "MATCH_CLOSED"]) {
    assert.equal(MATCH_EVENT_TYPE[type], type);
  }
});

test("party link choices map to party events; broker topics map to conditions", () => {
  assert.deepEqual(partyLinkChoices("client").map((c) => c.label), ["مهتم", "غير مهتم", "يحتاج وقت", "معاينة", "موافق مبدئيًا", "شرط آخر"]);
  assert.deepEqual(partyLinkChoices("owner").map((c) => c.eventType.split("_")[0]), Array(6).fill("OWNER"));
  assert.equal(choiceEventType("client", "needs_time"), "CLIENT_NEEDS_TIME");
  assert.equal(choiceEventType("owner", "viewing"), "OWNER_VIEWING_RESPONSE");
  assert.equal(choiceEventType("client", "equipment"), "CLIENT_CONDITION_CHANGED");
});

test("history is kept and the latest choice is the current state", () => {
  let events = [];
  events = appendMatchEvent(events, ev({ actorType: "client", eventType: "CLIENT_INTERESTED", payload: { choiceId: "interested", label: "مهتم" } }, 1));
  events = appendMatchEvent(events, ev({ actorType: "client", eventType: "CLIENT_NEEDS_TIME", payload: { choiceId: "needs_time", label: "يحتاج وقت" } }, 2));
  events = appendMatchEvent(events, ev({ actorType: "client", eventType: "CLIENT_PRELIMINARY_AGREEMENT", payload: { choiceId: "preliminary_agreement", label: "موافق مبدئيًا" } }, 3));
  events = appendMatchEvent(events, ev({ actorType: "client", eventType: "CLIENT_PRELIMINARY_AGREEMENT", payload: { choiceId: "preliminary_agreement", label: "موافق مبدئيًا" } }, 3));
  assert.equal(events.length, 3, "same eventId is not duplicated");
  assert.equal(projectMatchEvents(events).client.choiceId, "preliminary_agreement");
});

test("labels read naturally for the broker and LINK_OPENED never claims read/approval", () => {
  assert.equal(matchEventLabel(ev({ actorType: "owner", eventType: "OWNER_NEEDS_TIME", payload: { label: "يحتاج وقت" } }, 1)), "المالك طلب وقتًا للرد");
  assert.equal(matchEventLabel(ev({ actorType: "client", eventType: "CLIENT_VIEWING_REQUESTED", payload: { label: "معاينة" } }, 1)), "العميل طلب معاينة");
  assert.equal(matchEventLabel(ev({ actorType: "client", eventType: "CLIENT_INTERESTED", payload: { label: "مهتم" } }, 1)), "العميل اختار: مهتم");
  const opened = matchEventLogRow(ev({ actorType: "owner", eventType: "LINK_OPENED" }, 1));
  assert.equal(opened.title, "المالك فتح رابط المطابقة");
  assert.match(opened.statusLabel, /لا يعني القراءة أو الموافقة/);
});

test("notification routing and the idempotency key", () => {
  const routes = (fields) => notificationRoutes(ev(fields, 1)).map((r) => `${r.recipient}:${r.channel}`);
  assert.deepEqual(routes({ actorType: "client", eventType: "CLIENT_INTERESTED", payload: { label: "مهتم" } }), ["broker:fcm", "owner:whatsapp"]);
  assert.deepEqual(routes({ actorType: "owner", eventType: "OWNER_NEEDS_TIME" }), ["broker:fcm", "client:whatsapp"]);
  assert.deepEqual(routes({ actorType: "broker", eventType: "BROKER_MESSAGE", recipient: "both", payload: { message: "x" } }), ["client:whatsapp", "owner:whatsapp"]);
  assert.deepEqual(routes({ actorType: "broker", eventType: "BROKER_INTERNAL_NOTE", recipient: "internal", payload: { message: "x" } }), []);
  assert.deepEqual(routes({ actorType: "client", eventType: "LINK_OPENED" }), []);
  assert.deepEqual(routes({ actorType: "client", eventType: "CLIENT_NOT_INTERESTED" }), ["broker:fcm"]);
  assert.equal(notificationDedupeKey({ matchId: "mat_1", eventId: "ev_1", recipient: "Owner", channel: "WhatsApp" }), "mat_1|ev_1|owner|whatsapp");
});

test("unread badge, relative time and last update line", () => {
  const events = [
    ev({ actorType: "client", eventType: "CLIENT_INTERESTED", payload: { label: "مهتم" } }, 1),
    ev({ actorType: "broker", eventType: "BROKER_MESSAGE", recipient: "client", payload: { message: "x" } }, 2),
    ev({ actorType: "owner", eventType: "OWNER_NEEDS_TIME", payload: { label: "يحتاج وقت" } }, 3)
  ];
  assert.equal(brokerUnreadCount(events, ""), 2);
  assert.equal(brokerUnreadCount(events, at(1)), 1);
  assert.equal(brokerUnreadCount(events, at(3)), 0);
  assert.deepEqual([1, 2, 3].map(unreadUpdatesLabel), ["1 تحديث جديد", "2 تحديثات جديدة", "3 تحديثات جديدة"]);
  assert.equal(relativeTimeLabel(at(3), new Date(at(3))), "الآن");
  assert.equal(relativeTimeLabel(at(1), new Date(at(3))), "قبل دقيقتين");
  assert.equal(lastUpdateLine(events, new Date(at(3))), "المالك طلب وقتًا للرد — الآن");
});

test("parties never see internal notes, link activity, or messages for the other party", () => {
  const events = [
    ev({ actorType: "broker", eventType: "BROKER_INTERNAL_NOTE", recipient: "internal", payload: { message: "سر" } }, 1),
    ev({ actorType: "broker", eventType: "BROKER_MESSAGE", recipient: "owner", payload: { message: "للمالك" } }, 2),
    ev({ actorType: "broker", eventType: "BROKER_MESSAGE", recipient: "both", payload: { message: "للطرفين" } }, 3),
    ev({ actorType: "owner", eventType: "LINK_OPENED" }, 4),
    ev({ actorType: "owner", eventType: "OWNER_NEEDS_TIME", payload: { label: "يحتاج وقت" } }, 5)
  ];
  assert.deepEqual(partyVisibleEvents(events, "client").map((e) => e.eventId), ["ev_3", "ev_5"]);
});

test("lifecycle: agreed and closed are final; closed status without event is CLOSED", () => {
  assert.equal(lifecycleForEvents([ev({ actorType: "broker", eventType: "MATCH_AGREED" }, 1)]), "AGREED");
  assert.equal(lifecycleForEvents([ev({ actorType: "broker", eventType: "MATCH_CLOSED_NO_AGREEMENT" }, 1)]), "CLOSED_NO_AGREEMENT");
  assert.equal(lifecycleForEvents([], "closed"), "CLOSED");
  assert.equal(lifecycleForEvents([]), "ACTIVE");
});
