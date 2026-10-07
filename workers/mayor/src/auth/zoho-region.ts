/** Fixed data-center endpoints. Callback fields never become arbitrary token URLs. */
const regions={us:'zoho.com',eu:'zoho.eu',in:'zoho.in',au:'zoho.com.au',jp:'zoho.jp',ca:'zohocloud.ca',sa:'zoho.sa'} as const;
export type ZohoRegion=keyof typeof regions;
export function zohoRegion(value:unknown):ZohoRegion{
 if(typeof value!=='string'||!Object.hasOwn(regions,value))throw new Error('unsupported_zoho_region');
 return value as ZohoRegion;
}
export function zohoEndpoints(value:unknown){
 const region=zohoRegion(value),suffix=regions[region];
 return {region,accounts:`https://accounts.${suffix}`,calendar:`https://calendar.${suffix}/api/v1/`};
}
