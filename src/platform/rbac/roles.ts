export const ROLES = ["viewer", "operator", "approver", "admin"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Read only",
  operator: "Create and work on items",
  approver: "Approve or reject",
  admin: "Manage users, view audit log",
};
