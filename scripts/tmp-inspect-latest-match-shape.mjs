import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
const PROJECT_ID="iaqar-ai-staging", OFFICE_ID="staging-hamra-20260829";
const MATCH_ID="mat_b9449d9f46168139f50aa6e8af8b43c48ff4";
const OP_ID="op_b1e69cc5ceb1bc4beaf84fbcc5b5e358bce79178";
const parsed=parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,PROJECT_ID);
if(!parsed.serviceAccount){console.error("STAGING_READ_ACCESS_UNAVAILABLE");process.exit(1);}
const app=admin.initializeApp({credential:admin.cert(parsed.serviceAccount),projectId:PROJECT_ID});
const db=getFirestore(app); const office=db.collection("offices").doc(OFFICE_ID);
const [m,o]=await Promise.all([office.collection("matches").doc(MATCH_ID).get(),office.collection("operations").doc(OP_ID).get()]);
const safe=(obj={})=>{const out={};for(const [k,v] of Object.entries(obj||{})){const low=k.toLowerCase();if(low.includes("phone")||low.includes("name")||low.includes("email")||low.includes("note")||low.includes("message")||low.includes("address")||low.includes("location")||low.includes("district")||low.includes("price")||low.includes("budget"))continue;if(v&&typeof v==="object"&&!Array.isArray(v)&&typeof v.toDate!=="function")out[k]=safe(v);else if(typeof v!=="function")out[k]=v;}return out;};
const md=m.data()||{}, od=o.data()||{};
console.log(JSON.stringify({officeId:OFFICE_ID,match:{id:m.id,keys:Object.keys(md).sort(),safe:safe(md)},operation:{id:o.id,keys:Object.keys(od).sort(),safe:safe(od)}},null,2));
await app.delete();
