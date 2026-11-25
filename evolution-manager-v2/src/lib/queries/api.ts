import axios from "axios";

import { getToken, TOKEN_ID } from "./token";

export const api = axios.create({
  timeout: 30000,
  withCredentials: true,
});

api.interceptors.request.use(
  async (config) => {
    const apiUrl = getToken(TOKEN_ID.API_URL);
    if (apiUrl) {
      config.baseURL = apiUrl.toString();
    }

    if (localStorage.getItem("managerSaas") === "company") {
      config.baseURL = window.location.origin;
      config.headers.delete("apikey");
      return config;
    }

    if (!config.headers.has("apikey")) {
      const token = getToken(TOKEN_ID.INSTANCE_TOKEN);
      if (token) {
        config.headers.set("apikey", token);
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

export const apiGlobal = axios.create({
  timeout: 30000,
  withCredentials: true,
});

apiGlobal.interceptors.request.use(
  async (config) => {
    const apiUrl = getToken(TOKEN_ID.API_URL);
    if (apiUrl) {
      config.baseURL = apiUrl.toString();
    }

    if (localStorage.getItem("managerSaas") === "company") {
      config.baseURL = window.location.origin;
      config.headers.delete("apikey");
      return config;
    }

    if (!config.headers.has("apikey")) {
      const token = getToken(TOKEN_ID.TOKEN);
      if (token) {
        config.headers.set("apikey", token);
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);
