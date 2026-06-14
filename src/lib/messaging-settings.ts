// Welcome + away message settings — shared by the settings API and the webhook.

import { getSetting } from "./store";

export interface WelcomeSetting { enabled: boolean; text: string }
export interface AwaySetting {
  enabled: boolean;
  text: string;
  startHour: number;        // working hours start (0-23), in tzOffsetMinutes timezone
  endHour: number;          // working hours end (exclusive)
  tzOffsetMinutes: number;  // e.g. 330 = IST
}

export const WELCOME_DEFAULT: WelcomeSetting = {
  enabled: false,
  text: "Hi! 👋 Thanks for reaching out. Ask us anything — our assistant replies instantly, and a team member is always close by.",
};

export const AWAY_DEFAULT: AwaySetting = {
  enabled: false,
  text: "Thanks for your message! Our team is available 10:00–19:00 IST. Our AI assistant can still help you right away — just ask your question.",
  startHour: 10,
  endHour: 19,
  tzOffsetMinutes: 330,
};

export async function getWelcomeSetting(): Promise<WelcomeSetting> {
  return { ...WELCOME_DEFAULT, ...(await getSetting<Partial<WelcomeSetting>>("welcome", {})) };
}

export async function getAwaySetting(): Promise<AwaySetting> {
  return { ...AWAY_DEFAULT, ...(await getSetting<Partial<AwaySetting>>("away", {})) };
}

export function isOutsideWorkingHours(s: AwaySetting, now = new Date()): boolean {
  const local = new Date(now.getTime() + s.tzOffsetMinutes * 60000);
  const hour = local.getUTCHours();
  return s.startHour < s.endHour
    ? hour < s.startHour || hour >= s.endHour
    : hour < s.startHour && hour >= s.endHour;   // overnight window (e.g. 22-6)
}
