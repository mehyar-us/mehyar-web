import { z } from "zod";
import { publicPaths } from "@/data/site-seo";
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[<>]/.test(s));
const industry = z.enum([
  "barbershops-salons",
  "clinics-dentists",
  "real-estate",
  "restaurants-cafes",
  "spas-fitness",
  "home-services",
  "professional-services",
  "auto-services",
  "pet-care",
  "retail",
]);
const title = plain(100);
export const visualAnswerSchema = z.object({
  title,
  answer: plain(1800),
  mode: z.literal("live"),
  answerOrigin: z.literal("verified-product-guide").optional(),
  latencyMs: z.number().nonnegative(),
  blocks: z
    .array(
      z.discriminatedUnion("type", [
        z.object({type:z.literal('concept-gallery'),title,conceptIds:z.array(z.enum(['knowledge','mobile','operations','business-ai'])).min(1).max(3)}),
        z.object({type:z.literal("navigation"),title,links:z.array(z.object({label:plain(80),detail:plain(250),path:z.string().refine(p=>publicPaths.includes(p)||p==='https://mayor.mehyar.us')})).min(1).max(3)}),
        z.object({
          type: z.literal("workflow"),
          title,
          steps: z
            .array(z.object({ title: plain(80), detail: plain(350) }))
            .min(2)
            .max(5),
        }),
        z.object({
          type: z.literal("comparison"),
          title,
          leftLabel: plain(60),
          rightLabel: plain(60),
          rows: z
            .array(
              z.object({
                label: plain(80),
                left: plain(250),
                right: plain(250),
              }),
            )
            .min(1)
            .max(6),
        }),
        z.object({
          type: z.literal("gallery"),
          title,
          industryIds: z.array(industry).min(1).max(3),
        }),
        z.object({
          type: z.literal("checklist"),
          title,
          items: z.array(plain(250)).min(1).max(6),
        }),
        z.object({
          type: z.literal("product"),
          title,
          detail: plain(500),
          industryId: industry,
        }),
      ]),
    )
    .min(1)
    .max(3),
  followUps: z.array(plain(160)).max(3),
  sources: z
    .array(
      z
        .string()
        .refine((s) =>
          publicPaths.includes(s),
        ),
    )
    .max(4),
});
export const preservedVisitSchema = z.object({
  attribution: z
    .record(z.string().max(160))
    .refine((v) =>
      Object.keys(v).every((k) =>
        ["utm_source", "utm_campaign", "industry", "source"].includes(k),
      ),
    )
    .default({}),
  messages: z
    .array(
      z.object({ role: z.enum(["user", "assistant"]), content: plain(1600) }),
    )
    .max(8),
  board: z
    .object({ question: plain(1600), response: visualAnswerSchema })
    .nullable(),
  brief: z.string().max(4000).default(""),
  saved: z
    .array(z.object({ question: plain(1600), response: visualAnswerSchema }))
    .max(5)
    .default([]),
});
