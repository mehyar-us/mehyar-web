/**
 * FaceTime-style assessment call window.
 *
 * Full-viewport call UI: the 3D Mayor avatar centered in a call tile,
 * connection state + recording indicator on top, call controls at the
 * bottom. The avatar itself is mounted via the mountAvatar() contract
 * (../../lib/assessment-call/mayor-avatar) and handed to the parent
 * through onAvatarReady — the infra crew drives setState/playSpeech.
 *
 * Compliance notes:
 * - Recording consent is collected BEFORE this screen (AssessmentCallConsent);
 *   this window keeps a persistent "recorded + transcribed" indicator.
 * - No AI disclosure badge: per Mayor's explicit 2026-10-09 11:47 ET order
 *   ("NEVER mention it's AI"), recorded as a compliance flag in
 *   docs/assessment-call-contract.md.
 * - Controls meet WCAG AA contrast (asserted in __tests__/call-window.test.ts).
 */
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Captions, PhoneOff } from "lucide-react";
import { mountAvatar } from "@/lib/assessment-call/mayor-avatar";
import type {
  AvatarHandle,
  AvatarMountOpts,
  AvatarState,
} from "@/lib/assessment-call/types";

export type CallConnection = "connecting" | "live" | "reconnecting" | "ended";

export interface AssessmentCallWindowProps {
  connection: CallConnection;
  /** Live caption lines, newest last. Infra crew wires the real transcript. */
  captions: string[];
  callDurationSec: number;
  muted: boolean;
  captionsOn: boolean;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
  onEndCall: () => void;
  /** Receives the avatar handle; parent drives setState/playSpeech. */
  onAvatarReady: (handle: AvatarHandle) => void;
  avatarOpts?: AvatarMountOpts;
  /** Status line under the avatar, e.g. "The Mayor is thinking…". */
  statusMessage?: string;
  /** Mirror the avatar's call state for the status line. */
  avatarState?: AvatarState;
}

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STATE_LABEL: Record<AvatarState, string> = {
  idle: "On the call",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export function AssessmentCallWindow(props: AssessmentCallWindowProps) {
  const {
    connection, captions, callDurationSec, muted, captionsOn,
    onToggleMute, onToggleCaptions, onEndCall, onAvatarReady,
    avatarOpts, statusMessage, avatarState = "idle",
  } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let handle: AvatarHandle | null = null;
    try {
      handle = mountAvatar(el, avatarOpts);
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : "3D avatar failed to start.");
      return;
    }
    onAvatarReady(handle);
    return () => {
      handle?.dispose();
    };
    // Mount once: re-creating the GL context on every prop change would
    // flash the avatar and waste the D5 warmup. eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = connection === "live";
  const visibleCaptions = captions.slice(-2);

  return (
    <div
      className="flex h-[100dvh] w-full flex-col bg-[#0b1220] text-white"
      role="region"
      aria-label="Assessment call"
    >
      {/* Top bar: connection, timer, recording indicator */}
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div
          className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium"
          role="status"
          aria-label={`Connection: ${connection}`}
        >
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              live ? "bg-emerald-400" : connection === "ended" ? "bg-zinc-500" : "bg-amber-400 animate-pulse"
            }`}
            aria-hidden="true"
          />
          {connection === "connecting" && "Connecting…"}
          {connection === "live" && "Live"}
          {connection === "reconnecting" && "Reconnecting…"}
          {connection === "ended" && "Ended"}
        </div>
        <div className="text-sm tabular-nums text-zinc-300" aria-label="Call duration">
          {formatDuration(callDurationSec)}
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-zinc-200"
          title="You consented to recording before joining this call"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
          REC
          <span className="hidden sm:inline">· recorded &amp; transcribed</span>
        </div>
      </div>

      {/* Avatar stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-2 sm:px-8">
        <div className="relative h-full max-h-[72dvh] w-full max-w-3xl overflow-hidden rounded-3xl bg-gradient-to-b from-[#1b2a4a] via-[#16233d] to-[#0e1626] shadow-2xl ring-1 ring-white/10">
          <div ref={stageRef} className="absolute inset-0" />
          {avatarError && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center" role="alert">
              <div>
                <p className="font-semibold">The video avatar could not start</p>
                <p className="mt-1 text-sm text-zinc-300">
                  {avatarError} The call audio continues normally.
                </p>
              </div>
            </div>
          )}
          {/* Name plate */}
          <div className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1 text-sm font-semibold backdrop-blur-sm">
            The Mayor
          </div>
          {/* Captions overlay */}
          {captionsOn && visibleCaptions.length > 0 && (
            <div
              className="absolute inset-x-4 bottom-4 rounded-2xl bg-black/60 px-4 py-3 backdrop-blur-sm"
              aria-live="polite"
              aria-label="Live captions"
            >
              {visibleCaptions.map((line, i) => (
                <p
                  key={`${i}-${line.slice(0, 12)}`}
                  className={i === visibleCaptions.length - 1 ? "text-base font-medium" : "text-sm text-zinc-300"}
                >
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status line */}
      <p className="pb-1 text-center text-sm text-zinc-300" role="status" aria-live="polite">
        {statusMessage ?? STATE_LABEL[avatarState]}
      </p>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 px-4 pb-6 pt-2 sm:gap-6 sm:pb-8">
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/15 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {muted ? <MicOff className="h-6 w-6" aria-hidden="true" /> : <Mic className="h-6 w-6" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={onToggleCaptions}
          aria-pressed={captionsOn}
          aria-label={captionsOn ? "Hide captions" : "Show captions"}
          className={`flex h-14 w-14 items-center justify-center rounded-full ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            captionsOn
              ? "bg-white text-[#0b1220] ring-white"
              : "bg-white/10 text-white ring-white/15 hover:bg-white/20"
          }`}
        >
          <Captions className="h-6 w-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onEndCall}
          aria-label="End call"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-700 text-white ring-1 ring-red-500 transition hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <PhoneOff className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
