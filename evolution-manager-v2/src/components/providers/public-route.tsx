import React from "react";
import { Navigate } from "react-router-dom";

import { getProvider, getToken, TOKEN_ID } from "@/lib/queries/token";
import { useManagerAccount } from "@/lib/queries/saas";

type PublicRouteProps = {
  children: React.ReactNode;
};

const PublicRoute = ({ children }: PublicRouteProps) => {
  const apiUrl = getToken(TOKEN_ID.API_URL);
  const token = getToken(TOKEN_ID.TOKEN);
  const version = getToken(TOKEN_ID.VERSION);
  const provider = getProvider();
  const companyMode = localStorage.getItem("managerSaas") === "company";
  const { data: account, isPending } = useManagerAccount();

  const authenticated = companyMode
    ? !!account
    : provider === "go" ? !!apiUrl && !!token : !!apiUrl && !!token && !!version;

  if (companyMode && isPending) return <div className="p-6">Verificando sessão...</div>;

  if (authenticated) {
    return <Navigate to="/" />;
  }

  return children;
};

export default PublicRoute;
