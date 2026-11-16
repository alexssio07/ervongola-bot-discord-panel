import { apiClient } from "./client";
import type { Area, Level, Permissions } from "../context/AuthContext";

export interface AdminUser {
  id: number;
  username: string;
  created_at: string | null;
  permissions: Permissions;
}

export const AREA_LABELS: Record<Area, string> = {
  movies: "Film",
  phrases: "Frasi",
  audio: "Audio",
};

export const LEVEL_LABELS: Record<Level, string> = {
  none: "Nessuno",
  read: "Lettura",
  write: "Scrittura",
};

export async function listUsers(): Promise<AdminUser[]> {
  const res = await apiClient.get<{ users: AdminUser[] }>("/api/admin/users");
  return res.data.users;
}

export async function updateUserPermissions(id: number, permissions: Permissions): Promise<AdminUser> {
  const res = await apiClient.put<AdminUser>(`/api/admin/users/${id}/permissions`, { permissions });
  return res.data;
}

export async function deleteUser(id: number): Promise<void> {
  await apiClient.delete(`/api/admin/users/${id}`);
}
