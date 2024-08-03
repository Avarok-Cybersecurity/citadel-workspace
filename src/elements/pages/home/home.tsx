/*

Entry point to the main Citadel Workspace window

*/

import Header from "../../components/header/header";
import Sidebar from "../../components/sidebar/sidebar";
import Chat from "../../components/chat/chat";

import sampleWorkspaceIcon from "../../../assets/sample-workspace.png";
import "./home.css";
import {
  PeerInformation,
  RegistrationInfo,
  WorkspaceInfo,
} from "../../../api/types";
import { useEffect, useState } from "react";
import {
  connect,
  getDefaultWorkspace,
  list_all_peers,
} from "../../../api/util";
import { redirect } from "react-router-dom";

export default function Home() {
  const [cid, setCid] = useState<string | null>(null);
  const [registrationInfo, setRegistrationInfo] =
    useState<RegistrationInfo | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(
    null,
  );
  const [allPeers, setAllPeers] = useState<Record<
    string,
    PeerInformation
  > | null>(null);

  useEffect(() => {
    async function setup() {
      console.log("setting up home page");

      // Get the default server
      let default_server = await getDefaultWorkspace();
      if (default_server === null) {
        console.error("Default server is null; redirecting to landing");
        return redirect("/");
      }
      setRegistrationInfo(default_server);

      // Connect to the server
      console.log(`connecting to ${default_server.server_address}...`);
      let connection_response = await connect(default_server);
      let cid: string;
      if (connection_response.success && connection_response.cid !== null) {
        cid = connection_response.cid;
        console.log("Connected with cid", cid);
        setCid(cid);
      } else {
        console.error(
          "Failed to connect to server.",
          connection_response.message,
        );
        return;
      }

      // Set info (placeholder)
      const workspaceInfo: WorkspaceInfo = {
        iconPath: sampleWorkspaceIcon,
        name: "placeholder",
      };
      setWorkspaceInfo(workspaceInfo);

      // Discover peers
      console.log(`fetching peer information`);
      let response = await list_all_peers(cid);
      if (response.success) {
        console.log(`successfully discovered peers:`, response.peers);
        setAllPeers(response.peers);
      } else {
        console.error("Failed to list peers", response);
      }
    }

    setup();
  }, []);

  function getMainWindow() {
    return <Chat />;
  }

  return (
    <div id="home-page">
      <div className="header-panel">
        {" "}
        <Header workspaceInfo={workspaceInfo} />{" "}
      </div>

      <div className="content-container">
        <div className="left-panel">
          <Sidebar />
        </div>
        <div className="right-panel">
          <div className="content">{getMainWindow()}</div>
        </div>
      </div>
    </div>
  );
}
