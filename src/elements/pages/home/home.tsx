/*

Entry point to the main Citadel Workspace window

*/

import Header from "../../components/header/header";
import Sidebar from "../../components/sidebar/sidebar";
import Chat from "../../components/chat/chat";

import "./home.css";
import { WorkspaceInfo } from "../../../api/types";
import { useEffect } from "react";
import { getDefaultWorkspace } from "../../../api/util";
import { redirect } from "react-router-dom";

export default function Home() {

  useEffect(()=>{

    async function setup(){
      console.log("setting up home page")
      let default_server = await getDefaultWorkspace()
      if (default_server === null){
        console.error("Default server is null; redirecting to landing")
        return redirect("/")
      }

      console.log(`connecting to ${default_server.server_address}...`)


    }

    setup()

  },[])


  function getMainWindow() {
    return <Chat />;
  }

  return (
    <div id="home-page">
      <div className="header-panel">
        {" "}
        <Header />{" "}
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
