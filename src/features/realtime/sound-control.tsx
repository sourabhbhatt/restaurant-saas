"use client";

import { Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { useAlertSound } from "./alert-sound";

/** "Enable sound" chip (browsers need a tap first) or a mute toggle. */
export function SoundControl({ sound }: { sound: ReturnType<typeof useAlertSound> }) {
  if (!sound.branchEnabled) {
    return (
      <span
        className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"
        title="Sound is turned off in branch settings"
      >
        <VolumeX className="size-4" aria-hidden /> Sound off
      </span>
    );
  }
  if (sound.needsGesture) {
    return (
      <Button
        type="button"
        size="sm"
        variant="warning"
        className="rounded-full"
        onClick={() => void sound.enable()}
      >
        <Volume2 aria-hidden /> Enable sound
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-pressed={!sound.muted}
      aria-label={sound.muted ? "Unmute alerts" : "Mute alerts"}
      title={sound.muted ? "Unmute alerts" : "Mute alerts"}
      onClick={() => (sound.muted ? void sound.enable() : sound.setMuted(true))}
    >
      {sound.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
    </Button>
  );
}
