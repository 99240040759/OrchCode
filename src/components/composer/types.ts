export interface CommandItem {
  key: string;
  label: string;
  hint: string;
}

export const COMMANDS: CommandItem[] = [
  { key: "clear", label: "New chat", hint: "Start a fresh conversation" },
];

export type Trigger = "@" | "/" | null;

export interface ActiveToken {
  trigger: Trigger;
  query: string;
  from: number;
  to: number;
}
