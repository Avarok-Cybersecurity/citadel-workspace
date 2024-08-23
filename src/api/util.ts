import { invoke } from "@tauri-apps/api/core";
import {
  ConnectRequest,
  ConnectResponse,
  ListAllPeersRequest,
  ListAllPeersResponse,
  ListKnownServersRequest,
  ListKnownServersResponse,
  RegistrationInfo,
} from "./types";

export async function listKnownServers(): Promise<RegistrationInfo[]> {
  console.log("listing known servers...");
  const request: ListKnownServersRequest = { cid: "0" };
  const server_list = await invoke<ListKnownServersResponse>(
    "list_known_servers",
    { request },
  );
  console.log("got ListKnownServersResponse:", server_list);
  return server_list.servers;
}

export async function getDefaultWorkspace(): Promise<RegistrationInfo | null> {
  // For now, just get first saved workspace, if one exists
  const server_list = await listKnownServers();

  if (server_list.length === 0) {
    console.warn("No saved workspaces discovered");
    return null;
  } else {
    return server_list[0];
  }
}

export async function connect(
  info: RegistrationInfo,
): Promise<ConnectResponse> {
  console.log(`connecting to server ${info.server_address}...`);
  const request: ConnectRequest = { registrationInfo: info };
  const response = await invoke<ConnectResponse>("connect", { request });
  console.log("got connection response:");
  console.log(response);

  return response;
}

export async function list_all_peers(
  cid: string,
): Promise<ListAllPeersResponse> {
  console.log(`listing all peers...`);
  const request: ListAllPeersRequest = { cid: cid };
  const response = await invoke<ListAllPeersResponse>("list_all_peers", {
    request,
  });
  console.log("got list all peers response:", response);

  return response;
}
