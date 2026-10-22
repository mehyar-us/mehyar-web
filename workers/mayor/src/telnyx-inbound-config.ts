import {z} from 'zod';
/** Server-controlled designated-call settings, shared by API-key and OAuth envelopes. */
export const telnyxInboundSchema=z.object({publicKey:z.string().regex(/^[A-Za-z0-9+/]{43}=$/),applicationId:z.string().regex(/^\d{1,64}$/),testCaller:z.string().regex(/^\+[1-9]\d{6,14}$/),verifyProfileId:z.uuid().optional()}).strict();
