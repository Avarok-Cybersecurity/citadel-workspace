/*

Entry point to the main Citadel Workspace window

*/

import Header from "../../components/header/header";
import Sidebar from "../../components/sidebar/sidebar";
import Chat from "../../components/chat/chat";

import sampleWorkspaceIcon from "../../../assets/sample-workspace.png";
import "./home.css";
import { RegistrationInfo, WorkspaceInfo } from "../../../api/types";
import { useEffect, useState } from "react";
import { connect, getDefaultWorkspace } from "../../../api/util";
import { redirect } from "react-router-dom";

export default function Home() {

  const [cid, setCid] = useState<string|null>(null);
  const [registrationInfo, setRegistrationInfo] = useState<RegistrationInfo|null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo|null>(null);


  useEffect(()=>{

    async function setup(){
      console.log("setting up home page")

      // Get the default server
      let default_server = await getDefaultWorkspace()
      if (default_server === null){
        console.error("Default server is null; redirecting to landing")
        return redirect("/")
      }
      setRegistrationInfo(default_server);

      // Connect to the server
      console.log(`connecting to ${default_server.server_address}...`)
      let response = await connect(default_server);
      if (response.success){
        console.log("Connected with cid", response.cid);
        setCid(response.cid)
      }
      else{
        console.error("Failed to connect to server.", response.message);
      }

      // Set info
      const workspaceInfo: WorkspaceInfo = {
        iconPath: sampleWorkspaceIcon, // TODO: store this in local db
        name: "placeholder"
      }
      setWorkspaceInfo(workspaceInfo)
    }

    setup()

  },[])


  function getMainWindow() {
    return <Chat  />;
  }

  return (
    <div id="home-page">
      <div className="header-panel">
        {" "}
        <Header workspaceInfo={workspaceInfo } />{" "}
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
