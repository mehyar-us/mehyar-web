/**
 * Pre-join gate for the assessment call.
 *
 * Explicit recording/transcription consent (unchecked by default — no dark
 * pattern) is REQUIRED before joining. Join is disabled until the box is
 * checked. Footer carries the shared mehyar.us legal links + business
 * details (compliance items 1, 2, 16, 20).
 */
import { useState } from "react";
import { PhoneCall, ShieldCheck } from "lucide-react";

export interface AssessmentCallConsentProps {
  onJoin: () => void;
}

export function AssessmentCallConsent({ onJoin }: AssessmentCallConsentProps) {
  const [consented, setConsented] = useState(false);

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#0b1220] px-4 py-10 text-white">
      <div className="w-full max-w-md rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10 sm:p-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
          <PhoneCall className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-bold">Your business assessment call</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          A 40–45 minute working session with the Mayor. He will walk through
          where your business is leaking money and where AI fits — and lay out
          the $330 full audit at the end if it makes sense for you.
        </p>

        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10 transition hover:bg-white/[0.08]">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-emerald-400"
            aria-describedby="recording-consent-desc"
          />
          <span className="text-sm leading-relaxed">
            <span className="font-semibold">I understand this call is recorded and transcribed</span>
            <span id="recording-consent-desc" className="mt-1 block text-zinc-300">
              so we can prepare your assessment and follow-up. Recordings are
              kept only as long as needed for your assessment.
            </span>
          </span>
        </label>

        <button
          type="button"
          disabled={!consented}
          onClick={onJoin}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-base font-bold text-[#06281c] transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          Join the call
        </button>
        {!consented && (
          <p className="mt-2 text-center text-xs text-zinc-400">
            Please accept the recording notice to join.
          </p>
        )}

        <footer className="mt-8 border-t border-white/10 pt-4 text-xs text-zinc-400">
          <p className="font-semibold text-zinc-300">Mehyar Soft LLC · info@mehyar.us</p>
          <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
            <a className="underline hover:text-zinc-200" href="https://mehyar.us/privacy-policy/">Privacy Policy</a>
            <a className="underline hover:text-zinc-200" href="https://mehyar.us/terms/">Terms of Service</a>
            <a className="underline hover:text-zinc-200" href="https://mehyar.us/data-deletion/">Data Deletion</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
