import { invoke } from "@tauri-apps/api/core";
import { ListKnownServersRequest, ListKnownServersResponse, RegistrationInfo, WorkspaceInfo } from "./types";

export async function getDefaultWorkspace(): Promise<RegistrationInfo|null> {

    // For now, just get first saved workspace, if one exists
    console.log("listing known servers...")
    const request: ListKnownServersRequest = {cid: "0"}
    const server_list = (await invoke<ListKnownServersResponse>('list_known_servers', {request})).servers;
    console.log("got ListKnownServersResponse:");
    console.log(server_list);

    if (server_list.length === 0){
        console.warn("No saved workspaces discovered")
        return null
    }
    else {
        return server_list[0]
    }
}