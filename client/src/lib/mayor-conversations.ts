import { z } from "zod";
import { visualAnswerSchema } from "./visual-answer";

export const mayorTurnSchema = z.object({
  id: z.string().min(1).max(80),
  question: z.string().trim().min(1).max(1600),
  response: visualAnswerSchema,
});
export const mayorConversationSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(100),
  updatedAt: z.number().finite().nonnegative(),
  turns: z.array(mayorTurnSchema).max(50),
});
export const mayorHistorySchema = z.array(mayorConversationSchema).max(10);
export const mayorVisitSchema = z.object({
  conversation: mayorConversationSchema,
  draft: z.string().max(1600),
  brief: z.string().max(4000),
  open: z.boolean(),
});
export type MayorTurn = z.infer<typeof mayorTurnSchema>;
export type MayorConversation = z.infer<typeof mayorConversationSchema>;
export const MAYOR_HISTORY_KEY = "mehyar-mayor-conversations-v1";
export const MAYOR_VISIT_KEY = "mehyar-mayor-approved-update-v1";
export function freshConversation(): MayorConversation {
  return { id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `visit-${Date.now()}-${Math.random().toString(36).slice(2)}`, title: "New conversation", updatedAt: Date.now(), turns: [] };
}
export function contextForMayor(turns: MayorTurn[], question: string) {
  return [...turns.slice(-3).flatMap(turn => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: `${turn.response.answer.slice(0,700)}\nVisual context: ${JSON.stringify(turn.response.blocks).slice(0,850)}` },
  ]), { role: "user" as const, content: question }];
}
export function mayorSummary(turns: MayorTurn[]) {
  return turns.map(turn => `You: ${turn.question}\n\nThe Mayor: ${turn.response.answer}\n\n${turn.response.blocks.map(b => {
    if (b.type === "workflow") return `${b.title}\n${b.steps.map(s=>`${s.title}: ${s.detail}`).join("\n")}`;
    if (b.type === "comparison") return `${b.title}\n${b.rows.map(r=>`${r.label}: ${r.left} / ${r.right}`).join("\n")}`;
    if (b.type === "checklist") return `${b.title}\n${b.items.join("\n")}`;
    if (b.type === "product") return `${b.title}\n${b.detail}`;
    if (b.type === "navigation") return `${b.title}\n${b.links.map(l=>`${l.label}: ${l.detail} — ${l.path==='https://mayor.mehyar.us'?l.path:`https://mehyar.us${l.path}`}`).join("\n")}`;
    if (b.type === "concept-gallery") return `${b.title}: illustrative concepts — ${b.conceptIds.join(', ')}`;
    return `${b.title}: illustrative ${b.industryIds.join(", ")} imagery`;
  }).join("\n\n")}`).join("\n\n---\n\n") + "\n\nPublic AI exploration; examples require scope and integration review. No business action was taken.";
}
