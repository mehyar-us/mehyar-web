import {describe,it,expect} from 'vitest';
import {customEndpoint,canonicalToolArgs,safeConnectorResult,parseMcpResponse,customConnectionErrorMessage} from '../src/custom-connectors';
const origin='https://mayor.mehyar.us';
describe('custom outbound boundaries',()=>{
  it('explains uncertain writes without exposing provider messages or suggesting a retry',()=>{
    const message=customConnectionErrorMessage('tool_outcome_unknown_no_retry');
    expect(message).toContain('Check the connected service');expect(message).toContain('Do not repeat this action');
    expect(customConnectionErrorMessage('secret-provider-error-detail')).not.toContain('secret-provider-error-detail');
  });
  it.each(['http://api.vendor.com/','https://127.0.0.1/','https://[::1]/','https://2130706433/',
    'https://api.internal/','https://localhost/','https://user:pass@api.vendor.com/',
    'https://api.vendor.com/?token=private','https://api.vendor.com/#private','https://api.vendor.com:8443/',
    'https://127.0.0.1.nip.io/','https://mayor.mehyar.us/api/private'])('rejects unsafe target %s',url=>{
    expect(()=>customEndpoint(url,origin)).toThrow();
  });
  it('accepts a fixed public HTTPS path and keeps exact input hashes stable',()=>{
    expect(customEndpoint('https://api.vendor.com/v1/orders',origin).href).toBe('https://api.vendor.com/v1/orders');
    expect(canonicalToolArgs({b:2,a:{z:true}})).toBe(canonicalToolArgs({a:{z:true},b:2}));
    expect(()=>canonicalToolArgs({body:'x'.repeat(9000)})).toThrow();
    expect(()=>canonicalToolArgs({n:Infinity})).toThrow();
  });
  it('removes credentials and bounds untrusted provider text',()=>{
    const result=safeConnectorResult({token:'secret-credential',nested:{authorization:'private',text:'echo secret-credential'},long:'x'.repeat(5000)},'secret-credential');
    expect(JSON.stringify(result)).not.toContain('secret-credential');expect(JSON.stringify(result)).not.toContain('authorization');
    expect((result as any).long).toHaveLength(4000);
  });
  it('binds JSON/SSE responses to the exact RPC id and never runs server requests',()=>{
    const message={jsonrpc:'2.0',id:'owned',result:{tools:[]}};
    expect(parseMcpResponse(JSON.stringify(message),'owned','application/json')).toEqual({tools:[]});
    expect(parseMcpResponse('event: message\r\ndata: '+JSON.stringify(message)+'\r\n\r\n','owned','text/event-stream')).toEqual({tools:[]});
    for(const value of [{...message,id:'other'},{...message,error:{message:'private'}},{...message,jsonrpc:'1.0'},
      {jsonrpc:'2.0',id:'server',method:'sampling/createMessage'}])expect(()=>parseMcpResponse(JSON.stringify(value),'owned','application/json')).toThrow();
  });
});
