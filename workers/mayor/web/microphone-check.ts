/** Request permission before starting paid server-side voice resources.
 *  Errors stay in plain words for a busy owner on a phone: name the next tap,
 *  never blame, always offer typing as the fallback. */
export async function prepareMicrophone(){
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Voice talk needs a full browser. Open the app in Safari or Chrome — not inside another app\u2019s built-in browser — or just type below.');
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  return stream;
 }catch(error){
  const name=error instanceof DOMException?error.name:'';
  if(name==='NotAllowedError'||name==='SecurityError')throw new Error('The microphone is blocked. Tap the lock or tune icon in your browser\u2019s address bar, allow the microphone for this site, then tap the mic again. Typing works too.');
  if(name==='NotFoundError')throw new Error('No microphone was found on this device. Plug one in and try again — or just type below.');
  if(name==='NotReadableError')throw new Error('Another app is using your microphone right now (a call or a recording). Close it and try again — or just type below.');
  throw new Error('The microphone did not start. Check your device settings, then try again — or just type below.');
 }
}
