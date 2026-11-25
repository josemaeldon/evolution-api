/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import { UseQueryParams } from "../types";

interface IParams {
  url: string;
}

const queryKey = (params: Partial<IParams>) => ["auth", "verifyServer", JSON.stringify(params)];

export const verifyServer = async ({ url }: IParams) => {
  const serverUrl = url.replace(/\/+$/, "");
  const response = await axios.get(`${serverUrl}/health`);
  return response.data;
};

export const useVerifyServer = (props: UseQueryParams<any> & { url?: string | null }) => {
  const { url, enabled, ...rest } = props;
  return useQuery<any>({
    ...rest,
    queryKey: queryKey({ url: url ?? undefined }),
    queryFn: () => verifyServer({ url: url! }),
    enabled: !!url && (enabled ?? true),
  });
};
