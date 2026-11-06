"use client";

// The menu's icons, by the names shell-logic.ts uses (that module stays free
// of JSX so it can be tested on its own).

import { AtSign, Ban, BarChart3, Bot, CalendarDays, ClipboardList, Facebook, Globe, History, Home, Instagram, KanbanSquare, LayoutTemplate, ListChecks, Megaphone, MessageCircle, MessageSquare, Plug, Send, Settings, ShieldCheck, ShoppingBag, Sparkles, Star, TrendingUp, Users, UsersRound, Workflow, Youtube, Zap } from "lucide-react";
import type { NavIcon } from "./shell-logic";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  home: Home, chat: MessageSquare, users: Users, chart: BarChart3, team: UsersRound, whatsapp: MessageCircle,
  instagram: Instagram, facebook: Facebook, youtube: Youtube, star: Star, globe: Globe, send: Send,
  template: LayoutTemplate, workflow: Workflow, history: History, bot: Bot, zap: Zap, sparkles: Sparkles,
  bag: ShoppingBag, trending: TrendingUp, at: AtSign, form: ClipboardList, megaphone: Megaphone,
  checklist: ListChecks, plug: Plug, ban: Ban, settings: Settings, shield: ShieldCheck, calendar: CalendarDays, kanban: KanbanSquare,
};

export function NavIconFor({ icon, className = "w-[18px] h-[18px] shrink-0" }: { icon: NavIcon; className?: string }) {
  const I = ICONS[icon];
  return <I className={className} aria-hidden />;
}
