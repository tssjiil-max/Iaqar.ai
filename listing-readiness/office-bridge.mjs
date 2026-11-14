import { assessListing } from './readiness.mjs';
// Versioned, opt-in transport contract. This module does not deploy or create a server.
// Connection settings must be supplied by authenticated office configuration on each launch.
export function createOfficeReadinessBridge({baseUrl, officeId, getAccessToken, transport = globalThis.fetch} = {}) {
  if (baseUrl !== undefined && !/^https:\/\/[^/]+/i.test(baseUrl)) throw new Error('HTTPS endpoint required');
  if (typeof transport !== 'function') throw new TypeError('transport required');
  const endpoint = baseUrl && officeId ? `${baseUrl.replace(/\/$/,'')}/api/v1/offices/${encodeURIComponent(officeId)}/listing-readiness` : null;
  return {
    assessLocal: assessListing,
    async assessRemote(listing) {
      if (!endpoint || typeof getAccessToken !== 'function') throw new Error('authorization and office connection required');
      const token = await getAccessToken();
      if (!token || typeof token !== 'string') throw new Error('authorization required');
      const result = assessListing(listing);
      // Whitelist only. No customer contact, raw text, owner details, or caller-supplied officeId.
      const {listingId, schemaVersion} = listing;
      if (typeof listingId !== 'string' || !listingId.trim()) throw new TypeError('listingId required');
      const safe = {listingId,schemaVersion,readiness:{score:result.score,missing:result.missing,canPublish:result.canPublish}};
      const response = await transport(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,'Idempotency-Key':`readiness-v1:${encodeURIComponent(officeId)}:${encodeURIComponent(listingId)}:${result.score}:${result.missing.join(',')}`},
        body:JSON.stringify({listing:safe}),
      });
      if (!response.ok) throw new Error(`office bridge rejected request: HTTP ${response.status}`);
      return response.json();
    }
  };
}
