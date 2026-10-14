/** Thin loader (mirrors offer-loader): the React Trendpost chunk loads only
 * for a signed-in workspace, after the business is selected. */
export async function loadTrendpost(tenantId:string):Promise<void>{
 const root=document.getElementById('trendpost-root');
 if(!root||!tenantId)return;
 try{
  const {mountTrendpost}=await import('./trendpost');
  mountTrendpost(root,tenantId);
 }catch{/* the Today view works without the panel */}
}
