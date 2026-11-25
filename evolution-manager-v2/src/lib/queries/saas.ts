import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import { getToken, TOKEN_ID } from "./token";
import { getProvider } from "./token";

export type ManagerAccount = {
  id?: string;
  companyId?: string;
  name: string;
  email?: string;
  role: "superadmin" | "admin" | "user";
  signMessages?: boolean;
  company?: { id: string; name: string };
};

export type ManagerCompany = {
  id: string;
  name: string;
  maxInstances: number;
  instanceCount: number;
  storageQuotaMb: number;
  storageUsedBytes: number;
  active: boolean;
  _count: { users: number; instances: number };
};

export type ManagerUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: "admin" | "user";
  active: boolean;
  signMessages: boolean;
};

export type UnassignedInstance = { id: string; name: string; connectionStatus: string };

export const saasApi = axios.create({ withCredentials: true, timeout: 30000 });
saasApi.interceptors.request.use((config) => {
  config.baseURL = localStorage.getItem("managerSaas") === "company" || config.url === "/saas/login"
    ? window.location.origin
    : getToken(TOKEN_ID.API_URL) || window.location.origin;
  if (getToken(TOKEN_ID.TOKEN) && !config.headers.has("apikey")) {
    config.headers.set("apikey", getToken(TOKEN_ID.TOKEN));
  }
  return config;
});

export const useManagerAccount = () =>
  useQuery<ManagerAccount>({
    queryKey: ["saas", "me"],
    queryFn: async () => (await saasApi.get("/saas/me")).data,
    retry: false,
    staleTime: 30000,
    enabled: getProvider() === "api" && (!!getToken(TOKEN_ID.TOKEN) || localStorage.getItem("managerSaas") === "company"),
  });

export const signOutManager = async () => {
  try {
    await saasApi.post("/saas/logout");
  } finally {
    localStorage.removeItem("managerSaas");
  }
};
