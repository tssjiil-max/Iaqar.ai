import { createPrivateKey, createSign } from "node:crypto";

const FIREBASE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIREBASE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export function stripOuterQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length < 2) return trimmed;

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed.trim();
    } catch {
      return trimmed.slice(1, -1).trim();
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

export function normalizePrivateKey(value) {
  return stripOuterQuotes(value)
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function normalizeFirebaseSecrets(env = process.env) {
  return {
    clientEmail: stripOuterQuotes(env.FIREBASE_CLIENT_EMAIL), // pragma: allowlist secret
    privateKeyId: stripOuterQuotes(env.FIREBASE_PRIVATE_KEY_ID), // pragma: allowlist secret
    privateKey: normalizePrivateKey(env.FIREBASE_PRIVATE_KEY) // pragma: allowlist secret
  };
}

export function validateFirebaseSecrets(credentials) {
  const invalidFields = [];
  const clientEmail = String(credentials?.clientEmail || "");
  const privateKeyId = String(credentials?.privateKeyId || "");
  const privateKey = String(credentials?.privateKey || "");

  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/i.test(clientEmail)) {
    invalidFields.push("FIREBASE_CLIENT_EMAIL"); // pragma: allowlist secret
  }
  if (!/^[a-f0-9]{40}$/i.test(privateKeyId)) {
    invalidFields.push("FIREBASE_PRIVATE_KEY_ID"); // pragma: allowlist secret
  }

  const hasPemEnvelope = privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
    && privateKey.endsWith("-----END PRIVATE KEY-----");
  if (!hasPemEnvelope) {
    invalidFields.push("FIREBASE_PRIVATE_KEY"); // pragma: allowlist secret
  } else {
    try {
      const key = createPrivateKey(privateKey);
      const signer = createSign("RSA-SHA256");
      signer.update("iaqar-staging-local-signature-check");
      signer.end();
      signer.sign(key);
    } catch {
      invalidFields.push("FIREBASE_PRIVATE_KEY"); // pragma: allowlist secret
    }
  }

  return [...new Set(invalidFields)];
}

export function createServiceAccountPayload(credentials, projectId) {
  return {
    type: "service_account",
    project_id: projectId,
    private_key_id: credentials.privateKeyId, // pragma: allowlist secret
    private_key: `${credentials.privateKey}\n`, // pragma: allowlist secret
    client_email: credentials.clientEmail, // pragma: allowlist secret
    token_uri: FIREBASE_TOKEN_URL,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
  };
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createServiceAccountJwt(serviceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: serviceAccount.private_key_id // pragma: allowlist secret
  };
  const claims = {
    iss: serviceAccount.client_email, // pragma: allowlist secret
    scope: FIREBASE_SCOPE,
    aud: FIREBASE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(serviceAccount.private_key).toString("base64url")}`; // pragma: allowlist secret
}

export { FIREBASE_TOKEN_URL };
