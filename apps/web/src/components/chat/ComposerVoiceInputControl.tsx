import type { VoiceInputState } from "@t3tools/client-runtime/voice-input";
import { MicIcon, SquareIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ComposerVoiceInputControl(props: {
  readonly isAvailable: boolean;
  readonly disabled: boolean;
  readonly elapsedSeconds: number;
  readonly state: VoiceInputState;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onCancel: () => void;
}) {
  if (!props.isAvailable) return null;

  if (props.state.phase === "idle" || props.state.phase === "error") {
    const label = props.state.error ?? "Record voice message";
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(props.state.phase === "error" && "text-destructive")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={props.onStart}
              disabled={props.disabled}
              aria-label={label}
            />
          }
        >
          <MicIcon />
        </TooltipTrigger>
        <TooltipPopup className="max-w-72">{label}</TooltipPopup>
      </Tooltip>
    );
  }

  const recording = props.state.phase === "recording";
  const statusLabel = recording
    ? `Recording ${formatElapsed(props.elapsedSeconds)}`
    : props.state.phase === "transcribing"
      ? "Transcribing voice"
      : "Starting microphone";

  return (
    <div className="flex items-center gap-1" role="status" aria-label={statusLabel}>
      <span className="whitespace-nowrap px-1 text-xs tabular-nums text-secondary-label">
        {recording ? formatElapsed(props.elapsedSeconds) : statusLabel}
      </span>
      {recording ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                onPointerDown={(event) => event.preventDefault()}
                onClick={props.onStop}
                aria-label="Stop and transcribe"
              />
            }
          >
            <SquareIcon className="fill-current" />
          </TooltipTrigger>
          <TooltipPopup>Stop and transcribe</TooltipPopup>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onPointerDown={(event) => event.preventDefault()}
              onClick={props.onCancel}
              aria-label="Cancel voice input"
            />
          }
        >
          <XIcon />
        </TooltipTrigger>
        <TooltipPopup>Cancel voice input</TooltipPopup>
      </Tooltip>
    </div>
  );
}
