/** Request permission before starting paid server-side voice resources. */
export async function prepareMicrophone(){
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone capture is unavailable in this browser. Open https://mayor.mehyar.us in a full browser, or use text chat here.');
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  return stream;
 }catch(error){
  const name=error instanceof DOMException?error.name:'';
  if(name==='NotAllowedError'||name==='SecurityError')throw new Error('This browser blocked microphone access. Allow the microphone in this site’s permissions and your device settings. If this is an embedded browser, open mayor.mehyar.us in your regular browser. Text chat works separately.');
  if(name==='NotFoundError')throw new Error('No microphone was found. Connect one, then try again. You can use text chat now.');
  if(name==='NotReadableError')throw new Error('Your microphone could not be opened. Check whether another app is using it, then try again. You can use text chat now.');
  throw new Error('The microphone could not start. Check your device and browser settings, or use text chat.');
 }
}
