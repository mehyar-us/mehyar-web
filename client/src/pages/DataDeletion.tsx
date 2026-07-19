// DataDeletion.tsx — MehyarSoft LLC public data deletion request page
//
// Purpose: Satisfies Apple App Store / Google Play store requirements for any
// app that accesses user data to provide "a way for users to request that
// their data be deleted". Apple reviewers check for a working URL when
// reviewing Rizza (iOS PWA) and AiMech (Android/iOS PWAs), and Google Play's
// Data safety form requires a public-facing deletion link.
//
// This page is part of the Mehyar.us "Apps that access user data" compliance
// set (see /privacy-policy, /terms). It applies to:
//   1. Rizza — https://rizza.app (conversational AI for dating-app replies)
//   2. AiMech — https://aimech.app (AI car diagnostics for everyday drivers)
// Plus any future apps MehyarSoft ships.
//
// Two paths are offered:
//   - In-app: every app exposes an in-product "Delete my account & data"
//     action that purges the account and all associated rows in one tap.
//   - Email fallback: anyone can write to info@mehyar.us and we'll action
//     within 14 days. The 14-day window matches the Privacy Policy.
//
// Last updated: 2026-07-19.

import { Trash2, Mail, ShieldCheck, Clock, ExternalLink, Smartphone, MessageSquare, Car } from "lucide-react";

const company = "MehyarSoft LLC";
const contactEmail = "info@mehyar.us";

interface AppInfo {
  id: string;
  name: string;
  url: string;
  tagline: string;
  icon: any;
  whatWeCollect: string;
  whatWeDelete: string;
  inAppPath: string;
}

const apps: AppInfo[] = [
  {
    id: "rizza",
    name: "Rizza",
    url: "https://rizza.app",
    tagline: "Your AI wingman for dating-app replies.",
    icon: MessageSquare,
    inAppPath: "Settings → Account → Delete my account",
    whatWeCollect:
      "Email address (if you sign in), account handle, optional profile fields you fill in, and the conversation snippets you submit to Rizza so it can suggest a reply. We do not read your messages outside the moments you paste them in.",
    whatWeDelete:
      "Account record, profile fields, every conversation snippet and suggestion stored against your account, push-notification tokens, and any aggregated analytics rows that can be tied back to your account id.",
  },
  {
    id: "aimech",
    name: "AiMech",
    url: "https://aimech.app",
    tagline: "AI mechanic for everyday car owners.",
    icon: Car,
    inAppPath: "Settings → Account → Delete my account",
    whatWeCollect:
      "Email address (if you sign in), the vehicle make / model / year you set up, the symptom descriptions and diagnostic answers you submit, and your saved history of past diagnoses.",
    whatWeDelete:
      "Account record, vehicle profile, full diagnostic history, symptom logs, and any rows tied to your account id in our logs. The diagnostic model itself does not retain your individual inputs after the session — only the rows we explicitly stored.",
  },
];

interface Section {
  icon?: any;
  title: string;
  body: React.ReactNode;
}

const sections: Section[] = [
  {
    icon: ShieldCheck,
    title: "What this page is",
    body: (
      <>
        <p>
          MehyarSoft runs a small set of apps (<a className="text-brand-700 underline dark:text-brand-100" href="/apps">see the Apps page</a>).
          Any app that stores user data exposes a deletion path. This page is the public, plain-English
          summary of those paths and a fallback email channel for users who can&apos;t reach the in-app
          controls.
        </p>
        <p className="mt-2">
          It satisfies the Apple App Store and Google Play store-data-deletion requirements, and it
          mirrors the retention + deletion rules already stated in our{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href="/privacy-policy">Privacy Policy</a>{" "}
          (your data, your call, deletion on request, 14-day window).
        </p>
      </>
    ),
  },
  {
    icon: Trash2,
    title: "How to delete your data from each app",
    body: (
      <>
        <p>
          Every MehyarSoft app exposes the same in-app control, plus this email fallback. Either path
          results in the same outcome: your account and all data tied to it are purged, and you get a
          confirmation email.
        </p>
        <div className="mt-4 grid gap-3">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <div key={app.id} className="rounded-xl border border-border bg-card/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                  <h3 className="text-lg font-semibold text-foreground">{app.name}</h3>
                  <span className="text-sm text-muted-foreground">— {app.tagline}</span>
                  <a
                    className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline dark:text-brand-100"
                    href={app.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {app.url.replace("https://", "")} <ExternalLink className="inline h-3 w-3" />
                  </a>
                </div>
                <dl className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                  <div>
                    <dt className="font-semibold text-foreground">In-app control</dt>
                    <dd className="mt-1">
                      Open the app and go to <code className="rounded bg-muted px-1 py-0.5 text-xs">{app.inAppPath}</code>.
                      Confirm the deletion. The account and all data tied to it are purged immediately
                      and you get an on-screen success message plus a confirmation email.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">Email fallback (if you can&apos;t reach the in-app control)</dt>
                    <dd className="mt-1">
                      Send the request from the email address you signed up with to{" "}
                      <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}?subject=${encodeURIComponent(`${app.name} data deletion request`)}`}>
                        {contactEmail}
                      </a>
                      . Include the app name in the subject line. We verify ownership, action the
                      deletion within 14 days, and reply to confirm.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">What we collect from this app</dt>
                    <dd className="mt-1">{app.whatWeCollect}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">What we delete</dt>
                    <dd className="mt-1">{app.whatWeDelete}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </>
    ),
  },
  {
    icon: Clock,
    title: "How long deletion takes",
    body: (
      <>
        <p>
          <strong>In-app:</strong> the deletion runs as part of the request. Most accounts are fully
          purged within a few seconds; any cached rows clear on the next read.
        </p>
        <p className="mt-2">
          <strong>Email requests:</strong> we action the deletion within <strong>14 days</strong> of
          receiving a verifiable request. That window covers manual verification (so a stranger
          can&apos;t delete someone else&apos;s account) and any caches, backups, or analytics tables
          that hold historical rows.
        </p>
        <p className="mt-2">
          We&apos;ll send you a confirmation email at the address you wrote from. If we need more
          information to verify ownership, we&apos;ll reply with a single follow-up question before
          the 14-day clock starts.
        </p>
      </>
    ),
  },
  {
    icon: ShieldCheck,
    title: "What happens to backups and logs",
    body: (
      <>
        <p>
          Encrypted backups are rotated on a 30-day cycle. A row that was deleted from the live
          database will roll off the most recent backup within 30 days. System logs that may briefly
          include a request id (not user content) are retained for up to 90 days for security and
          abuse-prevention purposes, and are deleted at the end of that window.
        </p>
        <p className="mt-2">
          We do not sell or share your data with third parties, so there is nothing to retract
          elsewhere.
        </p>
      </>
    ),
  },
  {
    icon: Smartphone,
    title: "App store notes",
    body: (
      <>
        <p>
          <strong>Apple App Store:</strong> the deletion URL on this page is the URL we provide in
          App Store Connect under &ldquo;Account Deletion&rdquo; for each MehyarSoft app that ships
          through TestFlight or the App Store. Apple reviewers can validate the in-app path and the
          email fallback from this page.
        </p>
        <p className="mt-2">
          <strong>Google Play:</strong> the same page satisfies the Data safety form&apos;s
          &ldquo;Data deletion link&rdquo; requirement for each MehyarSoft app published on Google
          Play.
        </p>
      </>
    ),
  },
  {
    icon: Mail,
    title: "Contact and escalation",
    body: (
      <>
        <p>
          Deletion requests, general privacy questions, or concerns that a request has not been
          handled correctly: write to{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          . Include the app name and the email address you signed up with.
        </p>
        <p className="mt-2">
          If you have already requested deletion and feel it has been more than 14 days without
          confirmation, reply to the original request email or write again to{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}?subject=${encodeURIComponent("Escalation: deletion request pending")}`}>
            {contactEmail}
          </a>{" "}
          with &ldquo;Escalation&rdquo; in the subject line.
        </p>
      </>
    ),
  },
];

const DataDeletion = () => {
  return (
    <section className="bg-background px-4 pb-16 pt-28 md:pb-20 md:pt-32">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
            {company}
          </p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">
            Data Deletion
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Request deletion of your data from any MehyarSoft app — Rizza, AiMech, or anything
            else we ship. Use the in-app control or email us. Either way, your account and every
            row tied to it are purged, and we confirm in writing.
          </p>
        </div>
        <div className="space-y-4">
          {sections.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-6"
            >
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
                {Icon && <Icon className="h-5 w-5 text-brand-700 dark:text-brand-100" />}
                {title}
              </h2>
              <div className="mt-3 leading-7 text-muted-foreground">{body}</div>
            </article>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-border bg-card/50 p-5 text-sm text-muted-foreground md:p-6">
          <p>
            <strong>Effective date:</strong> July 19, 2026.{" "}
            <strong>Operator:</strong> MehyarSoft LLC.{" "}
            <strong>Contact:</strong>{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>
            .{" "}
            <strong>Related pages:</strong>{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href="/privacy-policy">Privacy Policy</a>,{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href="/terms">Terms</a>,{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href="/apps">Apps</a>.
          </p>
        </div>
      </div>
    </section>
  );
};

export default DataDeletion;