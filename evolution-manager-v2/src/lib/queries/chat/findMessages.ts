import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { UseQueryParams } from "../types";
import { FindMessagesResponse } from "./types";

interface IParams {
  instanceName: string;
  remoteJid: string;
  offset?: number;
}

const queryKey = (params: Partial<IParams>) => ["chats", "findMessages", JSON.stringify(params)];

export const fetchMessagesPage = async ({ instanceName, remoteJid, offset = 50, page }: IParams & { page: number }) => {
  const response = await api.post(`/chat/findMessages/${instanceName}`, {
    where: { key: { remoteJid } },
    offset,
    page,
  });
  return response.data?.messages || { records: response.data || [], pages: 1, total: 0 };
};

export const findMessages = async (params: IParams) => {
  const response = await fetchMessagesPage({ ...params, page: 1 });
  return response.records;
};

export const useFindMessages = (props: UseQueryParams<FindMessagesResponse> & Partial<IParams>) => {
  const { instanceName, remoteJid, offset, ...rest } = props;
  return useQuery<FindMessagesResponse>({
    ...rest,
    queryKey: queryKey({ instanceName, remoteJid, offset }),
    queryFn: () => findMessages({ instanceName: instanceName!, remoteJid: remoteJid!, offset }),
    enabled: !!instanceName && !!remoteJid,
  });
};
