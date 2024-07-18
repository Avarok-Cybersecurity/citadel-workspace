/*

Entry point to the main Citadel Workspace window

*/

import Header from "../../components/header/header";
import Sidebar from "../../components/sidebar/sidebar";
import Chat from "../../components/chat/chat";

import "./home.css";

export default function Home() {
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
