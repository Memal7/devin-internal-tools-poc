import type { Role } from "@/platform/rbac/roles";

export interface DemoUser {
  email: string;
  name: string;
  roles: Role[];
  note: string;
}

/** Seeded for local development and review. Only usable through the dev login. */
export const DEMO_USERS: readonly DemoUser[] = [
  { email: "viewer@demo.local", name: "Vera Viewer", roles: ["viewer"], note: "Read only" },
  { email: "operator@demo.local", name: "Oscar Operator", roles: ["operator"], note: "Creates and works on items" },
  { email: "approver@demo.local", name: "Ada Approver", roles: ["approver"], note: "Approves or declines" },
  {
    email: "lead@demo.local",
    name: "Leo Lead",
    roles: ["operator", "approver"],
    note: "Operator + approver: proves self-approval is blocked",
  },
  { email: "admin@demo.local", name: "Amira Admin", roles: ["admin"], note: "Manages users, views audit log" },
];
