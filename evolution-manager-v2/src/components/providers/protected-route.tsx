import React from "react";
import { Navigate } from "react-router-dom";

import { FeatureKey, isFeatureEnabled } from "@/lib/provider/features";
import { getProvider, getToken, TOKEN_ID } from "@/lib/queries/token";
import { useManagerAccount } from "@/lib/queries/saas";

type ProtectedRouteProps = {
  children: React.ReactNode;
  feature?: FeatureKey;
};

const ProtectedRoute = ({ children, feature }: ProtectedRouteProps) => {
  const apiUrl = getToken(TOKEN_ID.API_URL);
  const token = getToken(TOKEN_ID.TOKEN);
  const version = getToken(TOKEN_ID.VERSION);
  const provider = getProvider();
  const companyMode = localStorage.getItem("managerSaas") === "company";
  const { data: account, isPending, isError } = useManagerAccount();

  const authenticated = companyMode
    ? !!apiUrl && !!account
    : provider === "go" ? !!apiUrl && !!token : !!apiUrl && !!token && !!version;

  if (companyMode && isPending) return <div className="p-6">Carregando acesso...</div>;
  if (companyMode && isError) return <Navigate to="/manager/login" />;

  if (!authenticated) {
    return <Navigate to="/manager/login" />;
  }

  if (feature && !isFeatureEnabled(feature)) {
    return <Navigate to="/manager/" />;
  }

  if (companyMode && account?.role === "user" && !(/^\/manager\/?$/.test(location.pathname) || /\/chat(?:\/|$)/.test(location.pathname))) {
    return <Navigate to="/manager/" />;
  }

  return children;
};

export default ProtectedRoute;
