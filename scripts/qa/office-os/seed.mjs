// Seeds the local harness (real Worker, in-memory store) with one opportunity in each
// journey stage, through the same /os API the UI uses. Test data only.
import { idTokenFor, OFFICE_A, OWNER_A } from "./server.mjs";

export async function callWorker(h, route, body, uid = OWNER_A) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  const json = await response.json();
  if (!response.ok) throw new Error(`${route} ${response.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const PAIRS = [
  { key: "review", district: "الملقا", type: "شقة", price: 1250000, budget: 1300000 },
  { key: "negotiation", district: "النرجس", type: "فيلا", price: 2400000, budget: 2500000 },
  { key: "viewingConfirm", district: "العقيق", type: "دور", price: 900000, budget: 950000 },
  { key: "viewingResult", district: "الياسمين", type: "أرض", price: 1800000, budget: 1900000 },
  { key: "closed", district: "حطين", type: "مكتب", price: 600000, budget: 650000 }
];

function phone(n) { return `05${String(51000000 + n).padStart(8, "0")}`; }

export async function seedStates(h) {
  const out = { officeId: OFFICE_A };
  let n = 0;
  const token = (url) => String(url).split("#")[1];
  for (const pair of PAIRS) {
    n += 1;
    const request = await callWorker(h, "/os/records/save", { officeId: OFFICE_A, requestKey: `seed-r-${pair.key}`, record: {
      kind: "REQUEST", purpose: "PURCHASE", propertyType: pair.type, city: "الرياض", district: pair.district, price: pair.budget,
      contactName: `عميل ${pair.district} الاختباري`, contactPhone: phone(n)
    } });
    const offer = await callWorker(h, "/os/records/save", { officeId: OFFICE_A, requestKey: `seed-o-${pair.key}`, record: {
      kind: "OFFER", purpose: "SALE", propertyType: pair.type, city: "الرياض", district: pair.district, price: pair.price, area: n % 2 ? 240 : "",
      contactName: `مالك ${pair.district} الاختباري`, contactPhone: phone(n + 50), notes: "بيانات اختبار معزولة"
    } });
    const match = h.store.list(`offices/${OFFICE_A}/matches`).find((m) => m.offerId === offer.recordId && m.requestId === request.recordId);
    if (!match) throw new Error(`no match for ${pair.key}`);
    out[pair.key] = { requestId: request.recordId, offerId: offer.recordId, matchId: match.id };
    if (pair.key === "review") continue;
    const approved = await callWorker(h, "/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" });
    const journeyId = approved.journeyId;
    out[pair.key].journeyId = journeyId;
    const price = await callWorker(h, "/os/proposals/create", { officeId: OFFICE_A, journeyId, kind: "PRICE", recipients: ["client", "owner"], fields: { price: pair.price - 20000 }, requestKey: `seed-p-${pair.key}` });
    const client = price.proposals.find((p) => p.recipientRole === "client");
    const owner = price.proposals.find((p) => p.recipientRole === "owner");
    await callWorker(h, "/os/proposals/handoff", { officeId: OFFICE_A, proposalId: client.proposalId });
    await callWorker(h, "/os/proposals/handoff", { officeId: OFFICE_A, proposalId: owner.proposalId });
    await callWorker(h, "/os/reply/submit", { token: token(client.replyUrl), optionId: "accept_initial", submissionId: `seedsub${n}aa` }, "");
    out[pair.key].ownerReplyToken = token(owner.replyUrl);
    out[pair.key].clientReplyToken = token(client.replyUrl);
    if (pair.key === "negotiation") continue;
    const at = new Date(Date.now() + (pair.key === "viewingResult" ? 2 : 30) * 3600 * 1000).toISOString();
    const viewing = await callWorker(h, "/os/proposals/create", { officeId: OFFICE_A, journeyId, kind: "VIEWING", recipients: ["client"], fields: { viewingAt: at }, requestKey: `seed-v-${pair.key}` });
    await callWorker(h, "/os/proposals/handoff", { officeId: OFFICE_A, proposalId: viewing.proposals[0].proposalId });
    await callWorker(h, "/os/reply/submit", { token: token(viewing.proposals[0].replyUrl), optionId: "accept", submissionId: `seedview${n}a` }, "");
    if (pair.key === "viewingConfirm") continue;
    await callWorker(h, "/os/journeys/viewing/confirm", { officeId: OFFICE_A, journeyId });
    if (pair.key === "viewingResult") continue;
    await callWorker(h, "/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId, result: "interested", note: "العميل أعجبه الموقع" });
    await callWorker(h, "/os/journeys/close", { officeId: OFFICE_A, journeyId, outcome: "WON", finalPrice: pair.price - 10000 });
  }
  out.reviewTaskId = h.store.list(`offices/${OFFICE_A}/operations`).find((op) => op.type === "MATCH_REVIEW" && op.matchId === out.review.matchId)?.id;
  return out;
}
