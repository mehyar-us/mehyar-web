import {z} from 'zod';
import type {PlatformEmail} from './resend';
const fields=z.object({from:z.email().max(254),recipient:z.email().max(254),businessName:z.string().trim().min(1).max(160).regex(/^[^\p{Cc}\p{Cf}]+$/u),role:z.enum(['manager','staff','billing','viewer']),expiresAt:z.iso.datetime(),appOrigin:z.url()}).strict();
/** Text-only, fixed-purpose v1 template. No bearer secret, tracking URL or arbitrary CTA. */
export function invitationEmail(value:z.infer<typeof fields>):PlatformEmail{
  const data=fields.parse(value),origin=new URL(data.appOrigin);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('invalid_platform_email_origin');
  return {from:data.from,to:[data.recipient],subject:'Invitation to a Mehyar Business Agent workspace',text:[
    `You have been invited to join "${data.businessName}" as ${data.role}.`,
    `Sign in with ${data.recipient} at ${origin.origin}/ and review Your invitations before accepting. If you already have a workspace, open Team to find your invitations.`,
    `This invitation expires at ${new Date(data.expiresAt).toISOString()} (UTC).`,
    'Accepting adds your account to this business. It does not connect your email, calendar or other accounts.',
    'If you did not expect this invitation, you can ignore this message. No membership is created unless you accept.',
    'Mehyar Business Agent',
  ].join('\n\n')};
}
