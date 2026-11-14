/** Re-resolve the office connection after each login and app upgrade.
 * No localStorage token or hard-coded office identity. */
export async function resolveOfficeConnection({baseUrl,officeId,getAccessToken,transport=globalThis.fetch}={}){
 if(typeof baseUrl!=='string'||!/^https:\/\/[^/]+/i.test(baseUrl))throw new Error('HTTPS endpoint required');
 if(typeof officeId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(officeId))throw new Error('valid officeId required');
 if(typeof getAccessToken!=='function'||typeof transport!=='function')throw new Error('authorization required');
 const token=await getAccessToken();
 if(typeof token!=='string'||!token)throw new Error('authorization required');
 const response=await transport(`${baseUrl.replace(/\/$/,'')}/officeConnection`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({officeId})});
 if(!response.ok)throw new Error(`office connection unavailable: HTTP ${response.status}`);
 const data=await response.json();
 if(data.officeId!==officeId||data.enabled!==true||data.contractVersion!==1||typeof data.connectionId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(data.connectionId))throw new Error('untrusted office connection response');
 return Object.freeze({officeId:data.officeId,connectionId:data.connectionId,contractVersion:1,baseUrl});
}
